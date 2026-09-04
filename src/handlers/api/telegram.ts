import type { Env } from "../../types/env";
import type { RouteHandler } from "../../types/context";
import type { Language, Settings } from "../../types/settings";
import { jsonOk } from "../../core/respond";
import { assertCsrf } from "../../auth/guard";
import { constantTimeEqual } from "../../utils/random";
import { hmacSha256Hex } from "../../utils/hmac";
import { readUsage } from "../../core/counters";
import { appVersion, loadSettingsFresh, saveSettings } from "../../settings/store";
import { validateSettings } from "../../settings/validate";
import { resolveHostname } from "../../core/routes";
import { buildSubUrls } from "./status";
import { getUserHits, listUsers } from "../../users/store";
import type { UserAccount } from "../../users/store";
import { dayKeyUtc } from "../../utils/time";

const TG_API_BASE = "https://api.telegram.org/bot";
const SEND_TIMEOUT_MS = 5000;
const ADMIN_TIMEOUT_MS = 8000;
const WEBHOOK_SECRET_MESSAGE = "tg-webhook";

interface TgApiResult {
  ok: boolean;
  description: string;
}

export async function telegramWebhookSecret(sessionSecret: string): Promise<string> {
  return (await hmacSha256Hex(WEBHOOK_SECRET_MESSAGE, sessionSecret)).slice(0, 16);
}

function silentOk(): Response {
  return jsonOk({});
}

const MSG = {
  en: {
    help: () =>
      "Commands:\n/status — version, kill switch, usage\n/sub — subscription URLs\n/kill on|off — toggle kill switch\n/usage — request counts\n/expiry — users expiring soon or over quota",
    status: (version: string, killOn: boolean, today: number, total: number) =>
      `Version: ${version}\nKill switch: ${killOn ? "ON" : "OFF"}\nToday: ${today} requests\nTotal: ${total} requests`,
    sub: (urls: string) => urls,
    kill: (on: boolean) => `Kill switch ${on ? "enabled" : "disabled"}`,
    usage: (today: number, total: number) => `Today: ${today} requests\nTotal: ${total} requests`,
    expiringSoon: (name: string, days: number) =>
      days <= 0 ? `User "${name}" expires today` : `User "${name}" expires in ${days} day${days === 1 ? "" : "s"}`,
    quotaExhausted: (name: string) => `User "${name}" has exhausted the daily quota`,
    quotaWarning: (name: string, hits: number, limit: number) =>
      `User "${name}" quota usage ${hits}/${limit} (over 80%)`,
    expiryEmpty: () => "No users expiring within 7 days or over 80% of quota.",
  },
  fa: {
    help: () =>
      "دستورها:\n/status — نسخه، کلید قطع، مصرف\n/sub — نشانی‌های اشتراک\n/kill on|off — کلید قطع\n/usage — شمارنده درخواست‌ها\n/expiry — کاربران در آستانه انقضا یا پرمصرف",
    status: (version: string, killOn: boolean, today: number, total: number) =>
      `نسخه: ${version}\nکلید قطع: ${killOn ? "روشن" : "خاموش"}\nامروز: ${today} درخواست\nمجموع: ${total} درخواست`,
    sub: (urls: string) => urls,
    kill: (on: boolean) => `کلید قطع ${on ? "فعال شد" : "غیرفعال شد"}`,
    usage: (today: number, total: number) => `امروز: ${today} درخواست\nمجموع: ${total} درخواست`,
    expiringSoon: (name: string, days: number) =>
      days <= 0 ? `کاربر "${name}" امروز منقضی می‌شود` : `کاربر "${name}" تا ${days} روز دیگر منقضی می‌شود`,
    quotaExhausted: (name: string) => `کاربر "${name}" سقف مصرف روزانه را تمام کرد`,
    quotaWarning: (name: string, hits: number, limit: number) =>
      `مصرف کاربر "${name}": ${hits} از ${limit} (بالای ۸۰٪)`,
    expiryEmpty: () => "کاربری در ۷ روز آینده منقضی نمی‌شود و مصرف هیچ کاربری بالای ۸۰٪ نیست.",
  },
};

type TgLang = typeof MSG.en;

function langFor(s: Settings): TgLang {
  return MSG[s.language] ?? MSG.en;
}

const EXPIRY_WINDOW_MS = 7 * 86400 * 1000;
const QUOTA_WARN_RATIO = 0.8;
const DAY_MS = 86400 * 1000;
const NOTIFY_PREFIX = "qproxy:notify-sent:";
const NOTIFY_TTL_SEC = 48 * 3600;

export interface ExpirySweepResult {
  sent: number;
  skipped: number;
}

export function userExpiringSoon(
  user: Pick<UserAccount, "name">,
  daysLeft: number,
  language: Language = "en",
): string {
  return (MSG[language] ?? MSG.en).expiringSoon(user.name, daysLeft);
}

export function userQuotaExhausted(user: Pick<UserAccount, "name">, language: Language = "en"): string {
  return (MSG[language] ?? MSG.en).quotaExhausted(user.name);
}

function isExpiringSoon(expiresAt: number | null, now: number): boolean {
  return expiresAt !== null && expiresAt > now && expiresAt - now <= EXPIRY_WINDOW_MS;
}

function daysUntil(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));
}

async function quotaLine(
  env: Env,
  s: Settings,
  user: UserAccount,
  warnOnly: boolean,
): Promise<string | null> {
  if (user.dailyReqLimit === null || user.dailyReqLimit <= 0) return null;
  const hits = await getUserHits(env, user.tokenHash);
  if (hits >= user.dailyReqLimit) return userQuotaExhausted(user, s.language);
  if (warnOnly && hits / user.dailyReqLimit >= QUOTA_WARN_RATIO)
    return langFor(s).quotaWarning(user.name, hits, user.dailyReqLimit);
  return null;
}

async function buildExpiryReport(env: Env, s: Settings): Promise<string> {
  const now = Date.now();
  const users = await listUsers(env);
  const lines: string[] = [];
  for (const u of users) {
    const exp = u.expiresAt;
    if (isExpiringSoon(exp, now) && exp !== null) lines.push(userExpiringSoon(u, daysUntil(exp, now), s.language));
    const quota = await quotaLine(env, s, u, true);
    if (quota !== null) lines.push(quota);
  }
  if (lines.length === 0) return langFor(s).expiryEmpty();
  return lines.join("\n");
}

export async function runExpirySweep(env: Env, s: Settings, now: number = Date.now()): Promise<ExpirySweepResult> {
  const result: ExpirySweepResult = { sent: 0, skipped: 0 };
  if (!s.telegram.enabled || s.telegram.chatId.length === 0 || s.telegram.botToken.length === 0) return result;
  const day = dayKeyUtc(new Date(now));
  const users = await listUsers(env);
  for (const u of users) {
    const alerts: Array<{ kind: string; text: string }> = [];
    const exp = u.expiresAt;
    if (isExpiringSoon(exp, now) && exp !== null)
      alerts.push({ kind: "expiry", text: userExpiringSoon(u, daysUntil(exp, now), s.language) });
    const quota = await quotaLine(env, s, u, false);
    if (quota !== null) alerts.push({ kind: "quota", text: quota });
    for (const alert of alerts) {
      const key = NOTIFY_PREFIX + day + ":" + u.id + ":" + alert.kind;
      let seen = false;
      try {
        seen = (await env.QPROXY_KV.get(key, "json")) !== null;
      } catch {
        seen = false;
      }
      if (seen) {
        result.skipped += 1;
        continue;
      }
      await sendTelegramMessage(s.telegram.botToken, s.telegram.chatId, alert.text);
      try {
        await env.QPROXY_KV.put(key, JSON.stringify(1), { expirationTtl: NOTIFY_TTL_SEC });
      } catch {}
      result.sent += 1;
    }
  }
  return result;
}

interface TelegramUpdate {
  message?: {
    chat?: { id?: unknown; username?: unknown };
    text?: unknown;
  };
}

async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  try {
    await fetch(`${TG_API_BASE}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {}
}

export function normalizeTelegramChatId(chatId: string): string {
  return chatId.startsWith("@") ? chatId.toLowerCase() : chatId;
}

function chatMatches(update: TelegramUpdate, s: Settings): boolean {
  const wanted = s.telegram.chatId;
  if (wanted.length === 0) return false;
  const id = update.message?.chat?.id;
  if (id !== undefined && id !== null && String(id) === wanted) return true;
  const wantUsername = normalizeTelegramChatId(wanted);
  if (wantUsername.startsWith("@")) {
    const username = update.message?.chat?.username;
    return typeof username === "string" && username.length > 0 && `@${username.toLowerCase()}` === wantUsername;
  }
  return false;
}

async function buildReply(env: Env, s: Settings, req: Request, text: string): Promise<string> {
  const lang = langFor(s);
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  const cmd = tokens.length > 0 ? tokens[0]!.split("@")[0]!.toLowerCase() : "";
  const arg = tokens.length > 1 ? tokens[1]!.toLowerCase() : "";
  switch (cmd) {
    case "/status": {
      const usage = await readUsage(env);
      return lang.status(appVersion(), s.killSwitch, usage.requestsToday, usage.requestsTotal);
    }
    case "/usage": {
      const usage = await readUsage(env);
      return lang.usage(usage.requestsToday, usage.requestsTotal);
    }
    case "/expiry": {
      return buildExpiryReport(env, s);
    }
    case "/sub": {
      const hostname = resolveHostname(s, new URL(req.url));
      return lang.sub(
        buildSubUrls(hostname, s.securePath)
          .map((u) => `${u.label}: ${u.url}`)
          .join("\n"),
      );
    }
    case "/kill": {
      if (arg !== "on" && arg !== "off") return lang.help();
      const fresh = await loadSettingsFresh(env);
      const next = structuredClone(fresh);
      next.telegram.chatId = normalizeTelegramChatId(next.telegram.chatId);
      next.killSwitch = arg === "on";
      const v = validateSettings(next);
      if (!v.ok) return "error: kill switch update failed";
      await saveSettings(env, v.value);
      return lang.kill(arg === "on");
    }
    default:
      return lang.help();
  }
}

export const handleTelegramWebhook: RouteHandler = async (req, env, s) => {
  const segs = new URL(req.url).pathname.split("/").filter((p) => p.length > 0);
  const given = segs.length === 4 ? segs[3]! : "";
  const expected = await telegramWebhookSecret(s.sessionSecret);
  const pathOk = given.length === 16 && constantTimeEqual(expected, given.toLowerCase());
  const headerToken = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  const headerOk = headerToken.length === 16 && constantTimeEqual(expected, headerToken);
  if ((!pathOk && !headerOk) || !s.telegram.enabled || s.telegram.botToken.length === 0) return silentOk();
  let update: TelegramUpdate;
  try {
    const raw: unknown = await req.json();
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return silentOk();
    update = raw as TelegramUpdate;
  } catch {
    return silentOk();
  }
  if (!chatMatches(update, s)) return silentOk();
  const rawText = update.message?.text;
  const text = typeof rawText === "string" ? rawText.trim() : "";
  const reply = await buildReply(env, s, req, text);
  void sendTelegramMessage(s.telegram.botToken, s.telegram.chatId, reply).catch(() => {});
  return silentOk();
}

function stripTokenRefs(text: string): string {
  return text.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***").replace(/\b\d{4,}:[A-Za-z0-9_-]{16,}\b/g, "***");
}

async function tgAdminCall(token: string, method: string, payload: Record<string, unknown>): Promise<TgApiResult> {
  if (token.length === 0) return { ok: false, description: "bot token is not configured" };
  try {
    const res = await fetch(`${TG_API_BASE}${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(ADMIN_TIMEOUT_MS),
    });
    const data: unknown = await res.json().catch(() => null);
    const record = data !== null && typeof data === "object" && !Array.isArray(data) ? (data as { ok?: unknown; description?: unknown }) : null;
    const description =
      typeof record?.description === "string" ? stripTokenRefs(record.description) : "";
    return { ok: record?.ok === true, description };
  } catch {
    return { ok: false, description: "network error" };
  }
}

export const handleTelegramSetup: RouteHandler = async (req, _env, s) => {
  assertCsrf(req);
  const host = resolveHostname(s, new URL(req.url));
  const secret = await telegramWebhookSecret(s.sessionSecret);
  const hookUrl = `https://${host}/${s.securePath}/telegram/webhook/${secret}`;
  const result = await tgAdminCall(s.telegram.botToken, "setWebhook", {
    url: hookUrl,
    allowed_updates: ["message"],
    secret_token: secret,
  });
  return jsonOk(result);
};

export const handleTelegramRemove: RouteHandler = async (req, _env, s) => {
  assertCsrf(req);
  const result = await tgAdminCall(s.telegram.botToken, "deleteWebhook", {});
  return jsonOk(result);
};
