import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../../src/types/settings";
import type { Settings } from "../../../src/types/settings";
import { invalidateSettingsCache } from "../../../src/settings/store";
import {
  handleTelegramRemove,
  handleTelegramSetup,
  handleTelegramWebhook,
  normalizeTelegramChatId,
  telegramMenuKeyboard,
  telegramWebhookSecret,
} from "../../../src/handlers/api/telegram";

const BOT_TOKEN = "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const CHAT_ID = "424242";
const SESSION_SECRET = "unit-session-secret";

class FakeKV {
  map = new Map<string, string>();
  putOptions = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    const raw = this.map.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  }

  async put(key: string, value: string, options?: unknown): Promise<void> {
    this.map.set(key, value);
    if (options !== undefined) this.putOptions.set(key, options);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  asEnv(): unknown {
    return { QPROXY_KV: this };
  }
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    securePath: "testpath",
    sessionSecret: SESSION_SECRET,
    language: "en",
    telegram: { enabled: true, botToken: BOT_TOKEN, chatId: CHAT_ID },
    ...overrides,
  };
}

type FetchCall = { url: string; init: RequestInit | undefined };

let calls: FetchCall[];
let respond: (url: string) => Response;

function stubFetch(handler?: (url: string, init: RequestInit | undefined) => Response | Promise<Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ url, init });
      if (handler) return await handler(url, init);
      return respond(url);
    }),
  );
}

function usernameWebhookRequest(text: string, username: string, secret: string): Request {
  return new Request(`https://panel.example.com/testpath/telegram/webhook/${secret}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ update_id: 2, message: { message_id: 2, chat: { id: 777001, username }, text } }),
  });
}

function webhookRequest(text: string, chatId: number | string, secret?: string): Request {
  return new Request(`https://panel.example.com/testpath/telegram/webhook/${secret ?? "0123456789abcdef"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: chatId }, text } }),
  });
}

async function lastSent(): Promise<{ url: string; body: Record<string, unknown> }> {
  await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
  const call = calls[calls.length - 1]!;
  return { url: call.url, body: JSON.parse(String(call.init!.body)) as Record<string, unknown> };
}

beforeEach(() => {
  calls = [];
  respond = () => new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
  stubFetch();
  invalidateSettingsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("telegram webhook secret", () => {
  it("derives 16 hex chars deterministically from the session secret", async () => {
    const a = await telegramWebhookSecret(SESSION_SECRET);
    const b = await telegramWebhookSecret(SESSION_SECRET);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
    expect(await telegramWebhookSecret("other")).not.toBe(a);
  });
});

describe("handleTelegramWebhook", () => {
  it("answers silently on secret mismatch without touching telegram", async () => {
    const res = await handleTelegramWebhook(webhookRequest("/status", CHAT_ID, "ffffffffffffffff"), new FakeKV().asEnv() as never, makeSettings());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({});
    expect(calls.length).toBe(0);
  });

  it("answers silently when disabled even with the correct secret", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    const res = await handleTelegramWebhook(webhookRequest("/status", CHAT_ID, secret), new FakeKV().asEnv() as never, makeSettings({ telegram: { enabled: false, botToken: BOT_TOKEN, chatId: CHAT_ID } }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({});
    expect(calls.length).toBe(0);
  });

  it("ignores updates from other chats", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    const res = await handleTelegramWebhook(webhookRequest("/kill on", 999999, secret), new FakeKV().asEnv() as never, makeSettings());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({});
    expect(calls.length).toBe(0);
  });

  it("replies to /status with version and usage counts via sendMessage", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    const res = await handleTelegramWebhook(webhookRequest("/status", CHAT_ID, secret), new FakeKV().asEnv() as never, makeSettings());
    expect(res.status).toBe(200);
    const sent = await lastSent();
    expect(sent.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    expect(sent.body.chat_id).toBe(CHAT_ID);
    expect(String(sent.body.text)).toContain("Version: 0.0.0-dev");
    expect(String(sent.body.text)).toMatch(/Today: \d+ requests/);
    expect(String(sent.body.text)).toMatch(/Total: \d+ requests/);
  });

  it("flips killSwitch through saveSettings on /kill on", async () => {
    const kv = new FakeKV();
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    const res = await handleTelegramWebhook(webhookRequest("/kill on", CHAT_ID, secret), kv.asEnv() as never, makeSettings());
    expect(res.status).toBe(200);
    const sent = await lastSent();
    expect(String(sent.body.text)).toContain("enabled");
    const blob = JSON.parse(kv.map.get("qproxy:settings")!) as { data: Settings };
    expect(blob.data.killSwitch).toBe(true);
  });

  it("flips killSwitch back off on /kill off", async () => {
    const kv = new FakeKV();
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    await handleTelegramWebhook(webhookRequest("/kill on", CHAT_ID, secret), kv.asEnv() as never, makeSettings());
    await lastSent();
    calls = [];
    await handleTelegramWebhook(webhookRequest("/kill off", CHAT_ID, secret), kv.asEnv() as never, makeSettings({ killSwitch: true }));
    const sent = await lastSent();
    expect(String(sent.body.text)).toContain("disabled");
    const blob = JSON.parse(kv.map.get("qproxy:settings")!) as { data: Settings };
    expect(blob.data.killSwitch).toBe(false);
  });

  it("lists subscription urls on /sub", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    await handleTelegramWebhook(webhookRequest("/sub", CHAT_ID, secret), new FakeKV().asEnv() as never, makeSettings());
    const sent = await lastSent();
    const text = String(sent.body.text);
    expect(text).toContain("https://panel.example.com/testpath/sub?target=singbox");
    expect(text).not.toContain("?target=clash");
    expect(text).toContain("Base64/Mixed");
  });

  it("answers removed commands (/usage, /expiry) with the trimmed help text", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    for (const text of ["/usage", "/expiry"]) {
      calls = [];
      await handleTelegramWebhook(webhookRequest(text, CHAT_ID, secret), new FakeKV().asEnv() as never, makeSettings());
      const sent = await lastSent();
      const body = String(sent.body.text);
      expect(body).toContain("/status");
      expect(body).toContain("/sub");
      expect(body).toContain("/kill");
      expect(body).not.toContain("/usage");
      expect(body).not.toContain("/expiry");
    }
  });

  it("sends help text for unknown or empty commands", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    for (const text of ["/nonsense", ""]) {
      calls = [];
      await handleTelegramWebhook(webhookRequest(text, CHAT_ID, secret), new FakeKV().asEnv() as never, makeSettings());
      const sent = await lastSent();
      expect(String(sent.body.text)).toContain("/status");
      expect(String(sent.body.text)).toContain("/kill");
    }
  });

  it("never leaks the bot token when outbound fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`network failure for https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
      }),
    );
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    const res = await handleTelegramWebhook(webhookRequest("/status", CHAT_ID, secret), new FakeKV().asEnv() as never, makeSettings());
    expect(res.status).toBe(200);
    const payload = JSON.stringify(await res.json());
    expect(payload).not.toContain(BOT_TOKEN);
    expect(payload).not.toContain("sendMessage");
  });

  it("ignores a username-form identity even when it names the owner", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    const settings = makeSettings();
    const res = await handleTelegramWebhook(usernameWebhookRequest("/status", "owner", secret), new FakeKV().asEnv() as never, settings);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({});
    expect(calls.length).toBe(0);
  });

  it("discloses nothing and toggles nothing for a legacy @username binding", async () => {
    const kv = new FakeKV();
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    const settings = makeSettings({ telegram: { enabled: true, botToken: BOT_TOKEN, chatId: "@opsalerts" } });
    const res = await handleTelegramWebhook(usernameWebhookRequest("/kill on", "OpsAlerts", secret), kv.asEnv() as never, settings);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({});
    expect(calls.length).toBe(0);
    expect(kv.map.has("qproxy:settings")).toBe(false);
  });

  it("stays silent for username-identity callbacks under a legacy binding", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    const settings = makeSettings({ telegram: { enabled: true, botToken: BOT_TOKEN, chatId: "@opsalerts" } });
    const callback: Record<string, unknown> = {
      id: "cb-1",
      data: "tg:kill-on",
      from: { id: 777001, username: "OpsAlerts" },
      message: { message_id: 11, chat: { id: 777001, username: "OpsAlerts" } },
    };
    const req = new Request(`https://panel.example.com/testpath/telegram/webhook/${secret}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 3, callback_query: callback }),
    });
    const res = await handleTelegramWebhook(req, new FakeKV().asEnv() as never, settings);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({});
    await new Promise((r) => setTimeout(r, 25));
    expect(calls.length).toBe(0);
  });

  it("keeps serving the numeric identity for status, sub, kill, and usage-adjacent commands", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    const env = new FakeKV().asEnv() as never;
    const settings = makeSettings();
    for (const text of ["/status", "/sub", "/menu"]) {
      calls = [];
      const res = await handleTelegramWebhook(webhookRequest(text, Number(CHAT_ID), secret), env, settings);
      expect(res.status).toBe(200);
      const sent = await lastSent();
      expect(String(sent.body.text).length).toBeGreaterThan(0);
    }
  });

  it("replies in persian when settings.language is fa", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    await handleTelegramWebhook(webhookRequest("/kill on", CHAT_ID, secret), new FakeKV().asEnv() as never, makeSettings({ language: "fa" }));
    const sent = await lastSent();
    expect(String(sent.body.text)).toContain("کلید قطع");
  });
});

describe("normalizeTelegramChatId", () => {
  it("lowercases @names and leaves numeric ids alone", () => {
    expect(normalizeTelegramChatId("@OpsAlerts")).toBe("@opsalerts");
    expect(normalizeTelegramChatId("@opsalerts")).toBe("@opsalerts");
    expect(normalizeTelegramChatId("424242")).toBe("424242");
    expect(normalizeTelegramChatId("")).toBe("");
  });
});

describe("telegram admin endpoints", () => {
  it("setup proxies setWebhook with the derived hook url and sanitizes the reply", async () => {
    respond = (url) =>
      new Response(JSON.stringify({ ok: true, description: `Webhook was set to ${url}` }), { status: 200 });
    const req = new Request("https://panel.example.com/testpath/telegram/setup", {
      method: "POST",
      headers: { "X-Q-Panel": "1" },
    });
    const res = await handleTelegramSetup(req, new FakeKV().asEnv() as never, makeSettings());
    expect(res.status).toBe(200);
    const data = ((await res.json()) as { data: { ok: boolean; description: string } }).data;
    expect(data.ok).toBe(true);
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`);
    expect(String(JSON.parse(String(calls[0]!.init!.body)).url)).toBe(
      `https://panel.example.com/testpath/telegram/webhook/${secret}`,
    );
    expect(data.description).not.toContain(BOT_TOKEN);
  });

  it("setup reports failure without leaking the token", async () => {
    respond = () =>
      new Response(JSON.stringify({ ok: false, description: `Bad Request: bad token ${BOT_TOKEN}` }), { status: 400 });
    const req = new Request("https://panel.example.com/testpath/telegram/setup", {
      method: "POST",
      headers: { "X-Q-Panel": "1" },
    });
    const res = await handleTelegramSetup(req, new FakeKV().asEnv() as never, makeSettings());
    const data = ((await res.json()) as { data: { ok: boolean; description: string } }).data;
    expect(data.ok).toBe(false);
    expect(data.description).toContain("***");
    expect(data.description).not.toContain(BOT_TOKEN);
  });

  it("remove calls deleteWebhook", async () => {
    const req = new Request("https://panel.example.com/testpath/telegram/remove", {
      method: "POST",
      headers: { "X-Q-Panel": "1" },
    });
    const res = await handleTelegramRemove(req, new FakeKV().asEnv() as never, makeSettings());
    expect(res.status).toBe(200);
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
    expect(((await res.json()) as { data: { ok: boolean } }).data.ok).toBe(true);
  });

  it("admin calls fail gracefully with an empty token", async () => {
    const req = new Request("https://panel.example.com/testpath/telegram/setup", {
      method: "POST",
      headers: { "X-Q-Panel": "1" },
    });
    const res = await handleTelegramSetup(req, new FakeKV().asEnv() as never, makeSettings({ telegram: { enabled: false, botToken: "", chatId: "" } }));
    const data = ((await res.json()) as { data: { ok: boolean; description: string } }).data;
    expect(data.ok).toBe(false);
    expect(data.description).toContain("token");
    expect(calls.length).toBe(0);
  });
});

function callbackRequest(
  data: unknown,
  chatId: number | string,
  secret: string,
  messageId: number | null = 11,
): Request {
  const callback: Record<string, unknown> = { id: "cb-1", data, from: { id: chatId } };
  if (messageId !== null) callback.message = { message_id: messageId, chat: { id: chatId } };
  return new Request(`https://panel.example.com/testpath/telegram/webhook/${secret}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ update_id: 3, callback_query: callback }),
  });
}

function sentTo(method: string): Array<{ url: string; body: Record<string, unknown> }> {
  return calls
    .filter((c) => c.url === `https://api.telegram.org/bot${BOT_TOKEN}/${method}`)
    .map((c) => ({ url: c.url, body: JSON.parse(String(c.init!.body)) as Record<string, unknown> }));
}

describe("telegram menu keyboard", () => {
  it("exposes the four surviving payloads (status, sub, kill on/off)", () => {
    const keyboard = telegramMenuKeyboard();
    expect(keyboard.inline_keyboard.flat().map((b) => b.callback_data)).toEqual([
      "tg:status",
      "tg:sub",
      "tg:kill-on",
      "tg:kill-off",
    ]);
  });

  it("attaches the keyboard to /menu replies", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    await handleTelegramWebhook(webhookRequest("/menu", CHAT_ID, secret), new FakeKV().asEnv() as never, makeSettings());
    const sent = await lastSent();
    expect(String(sent.body.text)).toContain("/status");
    const markup = sent.body.reply_markup as { inline_keyboard: unknown };
    expect(markup.inline_keyboard).toEqual(telegramMenuKeyboard().inline_keyboard);
  });

  it("attaches the keyboard to /start replies", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    await handleTelegramWebhook(webhookRequest("/start", CHAT_ID, secret), new FakeKV().asEnv() as never, makeSettings());
    const sent = await lastSent();
    expect(String(sent.body.text)).toContain("/kill");
    const markup = sent.body.reply_markup as { inline_keyboard: unknown };
    expect(markup.inline_keyboard).toEqual(telegramMenuKeyboard().inline_keyboard);
  });

  it("leaves plain command replies without a keyboard", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    await handleTelegramWebhook(webhookRequest("/status", CHAT_ID, secret), new FakeKV().asEnv() as never, makeSettings());
    const sent = await lastSent();
    expect(sent.body.reply_markup).toBeUndefined();
  });
});

describe("handleTelegramWebhook callback_query", () => {
  it("answers tg:status and edits the menu message in place", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    const res = await handleTelegramWebhook(
      callbackRequest("tg:status", Number(CHAT_ID), secret),
      new FakeKV().asEnv() as never,
      makeSettings(),
    );
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(calls.length).toBe(2));
    const answers = sentTo("answerCallbackQuery");
    expect(answers).toHaveLength(1);
    expect(answers[0]!.body.callback_query_id).toBe("cb-1");
    const edits = sentTo("editMessageText");
    expect(edits).toHaveLength(1);
    expect(String(edits[0]!.body.text)).toContain("Version: 0.0.0-dev");
    expect(edits[0]!.body.message_id).toBe(11);
    expect(edits[0]!.body.chat_id).toBe(CHAT_ID);
    const markup = edits[0]!.body.reply_markup as { inline_keyboard: unknown };
    expect(markup.inline_keyboard).toEqual(telegramMenuKeyboard().inline_keyboard);
    expect(sentTo("sendMessage")).toHaveLength(0);
  });

  it("ignores unknown callback data without touching telegram", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    for (const data of ["tg:nope", "status", ""]) {
      calls = [];
      const res = await handleTelegramWebhook(
        callbackRequest(data, Number(CHAT_ID), secret),
        new FakeKV().asEnv() as never,
        makeSettings(),
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as { data: unknown }).data).toEqual({});
    }
    await new Promise((r) => setTimeout(r, 25));
    expect(calls.length).toBe(0);
  });

  it("stays silent for callbacks from other chats", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    const res = await handleTelegramWebhook(
      callbackRequest("tg:status", 999999, secret),
      new FakeKV().asEnv() as never,
      makeSettings(),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({});
    await new Promise((r) => setTimeout(r, 25));
    expect(calls.length).toBe(0);
  });

  it("applies tg:kill-on immediately with the same text as /kill on", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    const textKv = new FakeKV();
    await handleTelegramWebhook(webhookRequest("/kill on", CHAT_ID, secret), textKv.asEnv() as never, makeSettings());
    const textReply = String((await lastSent()).body.text);
    calls = [];
    const buttonKv = new FakeKV();
    await handleTelegramWebhook(
      callbackRequest("tg:kill-on", Number(CHAT_ID), secret),
      buttonKv.asEnv() as never,
      makeSettings(),
    );
    await vi.waitFor(() => expect(calls.length).toBe(2));
    const edits = sentTo("editMessageText");
    expect(String(edits[0]!.body.text)).toBe(textReply);
    expect(String(edits[0]!.body.text)).toContain("enabled");
    const textBlob = JSON.parse(textKv.map.get("qproxy:settings")!) as { data: Settings };
    const buttonBlob = JSON.parse(buttonKv.map.get("qproxy:settings")!) as { data: Settings };
    expect(textBlob.data.killSwitch).toBe(true);
    expect(buttonBlob.data.killSwitch).toBe(true);
  });

  it("applies tg:kill-off immediately", async () => {
    const kv = new FakeKV();
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    await handleTelegramWebhook(
      callbackRequest("tg:kill-off", Number(CHAT_ID), secret),
      kv.asEnv() as never,
      makeSettings({ killSwitch: true }),
    );
    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(String(sentTo("editMessageText")[0]!.body.text)).toContain("disabled");
    const blob = JSON.parse(kv.map.get("qproxy:settings")!) as { data: Settings };
    expect(blob.data.killSwitch).toBe(false);
  });

  it("sends a fresh keyboard message when the callback carries no message", async () => {
    const secret = await telegramWebhookSecret(SESSION_SECRET);
    await handleTelegramWebhook(
      callbackRequest("tg:status", Number(CHAT_ID), secret, null),
      new FakeKV().asEnv() as never,
      makeSettings(),
    );
    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(sentTo("editMessageText")).toHaveLength(0);
    const sent = sentTo("sendMessage");
    expect(sent).toHaveLength(1);
    expect(String(sent[0]!.body.text)).toMatch(/^Version: /);
    expect(sent[0]!.body.chat_id).toBe(CHAT_ID);
    const markup = sent[0]!.body.reply_markup as { inline_keyboard: unknown };
    expect(markup.inline_keyboard).toEqual(telegramMenuKeyboard().inline_keyboard);
  });
});
