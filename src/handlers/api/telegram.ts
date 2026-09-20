import type { RouteHandler } from "../../types/context";
import type { Settings } from "../../types/settings";
import { jsonOk, readJsonObject } from "../../core/respond";
import { assertCsrf } from "../../auth/guard";
import { constantTimeEqual } from "../../utils/random";
import { hmacSha256Hex } from "../../utils/hmac";
import { readUsage } from "../../core/counters";
import { estimatedDownloadBytes } from "../../subscription/headers";
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

export async function telegramWebhookSecret(sessionSecret: string): Promise<string> {
  return (await hmacSha256Hex(WEBHOOK_SECRET_MESSAGE, sessionSecret)).slice(0, 16);
}

function silentOk(): Response {
  return jsonOk({});
}

const MSG = {
  en: {
    help: () =>
      "Commands:\n/status — version, kill switch, usage\n/sub — subscription URLs\n/kill on|off — toggle kill switch",
    status: (version: string, killOn: boolean, today: number, total: number, download: string) =>
      `Version: ${version}\nKill switch: ${killOn ? "ON" : "OFF"}\nToday: ${today} requests\nTotal: ${total} requests\nDownload: ~${download} (estimate)`,
    sub: (urls: string) => urls,
    kill: (on: boolean) => `Kill switch ${on ? "enabled" : "disabled"}`,
  },
  fa: {
    help: () =>
      "دستورها:\n/status — نسخه، کلید قطع، مصرف\n/sub — نشانی‌های اشتراک\n/kill on|off — کلید قطع",
    status: (version: string, killOn: boolean, today: number, total: number, download: string) =>
      `نسخه: ${version}\nکلید قطع: ${killOn ? "روشن" : "خاموش"}\nامروز: ${today} درخواست\nمجموع: ${total} درخواست\nدانلود: ~${download} (تخمینی)`,
    sub: (urls: string) => urls,
    kill: (on: boolean) => `کلید قطع ${on ? "فعال شد" : "غیرفعال شد"}`,
  },
};

type TgLang = typeof MSG.en;

function langFor(s: Settings): TgLang {
  return MSG[s.language] ?? MSG.en;
}

interface TelegramChat {
  id?: unknown;
  username?: unknown;
}

interface TelegramUpdate {
  message?: {
    chat?: TelegramChat;
    text?: unknown;
  };
  callback_query?: {
    id?: unknown;
    data?: unknown;
    from?: TelegramChat;
    message?: {
      message_id?: unknown;
      chat?: TelegramChat;
    };
  };
}

interface TgInlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

export function telegramMenuKeyboard(): TgInlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "Status", callback_data: "tg:status" }],
      [{ text: "Subscription", callback_data: "tg:sub" }],
      [
        { text: "Kill ON", callback_data: "tg:kill-on" },
        { text: "Kill OFF", callback_data: "tg:kill-off" },
      ],
    ],
  };
}

async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  replyMarkup?: TgInlineKeyboard,
): Promise<void> {
  try {
    await fetch(`${TG_API_BASE}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        replyMarkup === undefined
          ? { chat_id: chatId, text }
          : { chat_id: chatId, text, reply_markup: replyMarkup },
      ),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {}
}

async function answerTelegramCallback(token: string, callbackId: string): Promise<void> {
  try {
    await fetch(`${TG_API_BASE}${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {}
}

async function editTelegramMessage(
  token: string,
  chatId: string,
  messageId: number,
  text: string,
  replyMarkup?: TgInlineKeyboard,
): Promise<void> {
  try {
    await fetch(`${TG_API_BASE}${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        replyMarkup === undefined
          ? { chat_id: chatId, text, message_id: messageId }
          : { chat_id: chatId, text, message_id: messageId, reply_markup: replyMarkup },
      ),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {}
}

export function normalizeTelegramChatId(chatId: string): string {
  return chatId.startsWith("@") ? chatId.toLowerCase() : chatId;
}

function updateChat(update: TelegramUpdate): TelegramChat | undefined {
  return update.message?.chat ?? update.callback_query?.message?.chat ?? update.callback_query?.from;
}

function chatMatches(update: TelegramUpdate, s: Settings): boolean {
  const wanted = s.telegram.chatId;
  if (wanted.length === 0) return false;
  if (wanted.startsWith("@")) return false;
  const chat = updateChat(update);
  const id = chat?.id;
  return id !== undefined && id !== null && String(id) === wanted;
}

interface BotReply {
  text: string;
  keyboard: boolean;
}

function formatBytesEstimate(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.floor(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

async function replyStatus(env: Env, s: Settings): Promise<string> {
  const usage = await readUsage(env);
  return langFor(s).status(
    appVersion(),
    s.killSwitch,
    usage.requestsToday,
    usage.requestsTotal,
    formatBytesEstimate(estimatedDownloadBytes(usage)),
  );
}

function replySub(s: Settings, req: Request): string {
  const hostname = resolveHostname(s, new URL(req.url));
  return langFor(s).sub(
    buildSubUrls(hostname, s.securePath)
      .map((u) => `${u.label}: ${u.url}`)
      .join("\n"),
  );
}

async function applyKillSwitch(env: Env, s: Settings, on: boolean): Promise<string> {
  const fresh = await loadSettingsFresh(env);
  const next = structuredClone(fresh);
  next.telegram.chatId = normalizeTelegramChatId(next.telegram.chatId);
  next.killSwitch = on;
  const v = validateSettings(next);
  if (!v.ok) return "error: kill switch update failed";
  await saveSettings(env, v.value);
  return langFor(s).kill(on);
}

async function buildReply(env: Env, s: Settings, req: Request, text: string): Promise<BotReply> {
  const lang = langFor(s);
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  const cmd = tokens.length > 0 ? tokens[0]!.split("@")[0]!.toLowerCase() : "";
  const arg = tokens.length > 1 ? tokens[1]!.toLowerCase() : "";
  switch (cmd) {
    case "/start":
    case "/menu":
      return { text: lang.help(), keyboard: true };
    case "/status":
      return { text: await replyStatus(env, s), keyboard: false };
    case "/sub":
      return { text: replySub(s, req), keyboard: false };
    case "/kill": {
      if (arg !== "on" && arg !== "off") return { text: lang.help(), keyboard: false };
      return { text: await applyKillSwitch(env, s, arg === "on"), keyboard: false };
    }
    default:
      return { text: lang.help(), keyboard: false };
  }
}

async function buildCallbackReply(env: Env, s: Settings, req: Request, data: string): Promise<BotReply | null> {
  switch (data) {
    case "tg:status":
      return { text: await replyStatus(env, s), keyboard: true };
    case "tg:sub":
      return { text: replySub(s, req), keyboard: true };
    case "tg:kill-on":
      return { text: await applyKillSwitch(env, s, true), keyboard: true };
    case "tg:kill-off":
      return { text: await applyKillSwitch(env, s, false), keyboard: true };
    default:
      return null;
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
    const raw: unknown = await readJsonObject(req);
    update = raw as TelegramUpdate;
  } catch {
    return silentOk();
  }
  if (!chatMatches(update, s)) return silentOk();
  const callback = update.callback_query;
  if (callback !== undefined && callback !== null && typeof callback === "object") {
    const data = typeof callback.data === "string" ? callback.data : "";
    const reply = await buildCallbackReply(env, s, req, data);
    if (reply === null) return silentOk();
    const rawId = callback.id;
    const callbackId =
      typeof rawId === "string" ? rawId : rawId === undefined || rawId === null ? "" : String(rawId);
    if (callbackId.length > 0) void answerTelegramCallback(s.telegram.botToken, callbackId).catch(() => {});
    const rawMessageId = callback.message?.message_id;
    if (typeof rawMessageId === "number" && Number.isInteger(rawMessageId)) {
      const rawChatId = callback.message?.chat?.id;
      const chatId = rawChatId === undefined || rawChatId === null ? s.telegram.chatId : String(rawChatId);
      void editTelegramMessage(s.telegram.botToken, chatId, rawMessageId, reply.text, telegramMenuKeyboard()).catch(
        () => {},
      );
    } else {
      void sendTelegramMessage(s.telegram.botToken, s.telegram.chatId, reply.text, telegramMenuKeyboard()).catch(
        () => {},
      );
    }
    return silentOk();
  }
  const rawText = update.message?.text;
  const text = typeof rawText === "string" ? rawText.trim() : "";
  const reply = await buildReply(env, s, req, text);
  void sendTelegramMessage(
    s.telegram.botToken,
    s.telegram.chatId,
    reply.text,
    reply.keyboard ? telegramMenuKeyboard() : undefined,
  ).catch(() => {});
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
    allowed_updates: ["message", "callback_query"],
    secret_token: secret,
  });
  return jsonOk(result);
};

export const handleTelegramRemove: RouteHandler = async (req, _env, s) => {
  assertCsrf(req);
  const result = await tgAdminCall(s.telegram.botToken, "deleteWebhook", {});
  return jsonOk(result);
};
