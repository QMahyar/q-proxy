import type { Env } from "../../types/env";
import type { RouteHandler } from "../../types/context";
import type { Settings } from "../../types/settings";
import { jsonOk } from "../../core/respond";
import { assertCsrf } from "../../auth/guard";
import { constantTimeEqual } from "../../utils/random";
import { bytesToHex, utf8Encode } from "../../utils/bytes";
import { readUsage } from "../../core/counters";
import { appVersion, loadSettingsFresh, saveSettings } from "../../settings/store";
import { validateSettings } from "../../settings/validate";
import { resolveHostname } from "../../core/routes";
import { buildSubUrls } from "./status";

const TG_API_BASE = "https://api.telegram.org/bot";
const SEND_TIMEOUT_MS = 5000;
const ADMIN_TIMEOUT_MS = 8000;
const WEBHOOK_SECRET_MESSAGE = "tg-webhook";

interface TgApiResult {
  ok: boolean;
  description: string;
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8Encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, utf8Encode(message));
  return bytesToHex(new Uint8Array(sig));
}

export async function telegramWebhookSecret(sessionSecret: string): Promise<string> {
  return (await hmacHex(WEBHOOK_SECRET_MESSAGE, sessionSecret)).slice(0, 16);
}

function silentOk(): Response {
  return jsonOk({});
}

const MSG = {
  en: {
    help: () =>
      "Commands:\n/status — version, kill switch, usage\n/sub — subscription URLs\n/kill on|off — toggle kill switch\n/usage — request counts",
    status: (version: string, killOn: boolean, today: number, total: number) =>
      `Version: ${version}\nKill switch: ${killOn ? "ON" : "OFF"}\nToday: ${today} requests\nTotal: ${total} requests`,
    sub: (urls: string) => urls,
    kill: (on: boolean) => `Kill switch ${on ? "enabled" : "disabled"}`,
    usage: (today: number, total: number) => `Today: ${today} requests\nTotal: ${total} requests`,
  },
  fa: {
    help: () =>
      "دستورها:\n/status — نسخه، کلید قطع، مصرف\n/sub — نشانی‌های اشتراک\n/kill on|off — کلید قطع\n/usage — شمارنده درخواست‌ها",
    status: (version: string, killOn: boolean, today: number, total: number) =>
      `نسخه: ${version}\nکلید قطع: ${killOn ? "روشن" : "خاموش"}\nامروز: ${today} درخواست\nمجموع: ${total} درخواست`,
    sub: (urls: string) => urls,
    kill: (on: boolean) => `کلید قطع ${on ? "فعال شد" : "غیرفعال شد"}`,
    usage: (today: number, total: number) => `امروز: ${today} درخواست\nمجموع: ${total} درخواست`,
  },
};

type TgLang = typeof MSG.en;

function langFor(s: Settings): TgLang {
  return MSG[s.language] ?? MSG.en;
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

function chatMatches(update: TelegramUpdate, s: Settings): boolean {
  const wanted = s.telegram.chatId;
  if (wanted.length === 0) return false;
  const id = update.message?.chat?.id;
  if (id !== undefined && id !== null && String(id) === wanted) return true;
  if (wanted.startsWith("@")) {
    const username = update.message?.chat?.username;
    return typeof username === "string" && username.length > 0 && `@${username}` === wanted;
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
      const v = validateSettings({ ...structuredClone(fresh), killSwitch: arg === "on" });
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
  const secretOk = given.length === 16 && constantTimeEqual(await telegramWebhookSecret(s.sessionSecret), given.toLowerCase());
  if (!secretOk || !s.telegram.enabled || s.telegram.botToken.length === 0) return silentOk();
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
  });
  return jsonOk(result);
};

export const handleTelegramRemove: RouteHandler = async (req, _env, s) => {
  assertCsrf(req);
  const result = await tgAdminCall(s.telegram.botToken, "deleteWebhook", {});
  return jsonOk(result);
};
