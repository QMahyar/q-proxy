import { describe, expect, it, vi } from "vitest";
import { notifyTelegramEvent } from "../../src/handlers/api/telegram";
import type { Settings } from "../../src/types/settings";
import { DEFAULT_SETTINGS } from "../../src/types/settings";

function settings(): Settings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    securePath: "sp12345678",
    sessionSecret: "x".repeat(64),
    telegram: {
      enabled: true,
      botToken: "123456:AAExample_Token35chars_1234567890",
      chatId: "424242",
      onSubscribe: true,
      onSaveConfig: true,
      onAdminLogin: true,
      silent: false,
    },
  };
}

describe("notifyTelegramEvent", () => {
  it("sends subscribe/save/login events when enabled with toggles on", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const s = settings();
    await notifyTelegramEvent(s, "subscribe", "Subscription served (clash)", fetchFn as unknown as typeof fetch);
    await notifyTelegramEvent(s, "save-config", "Settings saved (cf)", fetchFn as unknown as typeof fetch);
    await notifyTelegramEvent(s, "admin-login", "Admin login from 1.2.3.4", fetchFn as unknown as typeof fetch);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toContain("api.telegram.org");
    // The bot token in the endpoint path is the Bot API's inherent auth
    // (same as the existing sender); bodies must carry no secrets.
    expect(JSON.stringify(calls.map((c) => c.body))).not.toContain("123456:AAExample");
    expect(calls[0]!.body).toEqual({ chat_id: "424242", text: "Subscription served (clash)" });
  });

  it("stays silent when disabled, silenced, untoggled, or unconfigured", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const cases: Array<(s: Settings) => void> = [
      (s) => {
        s.telegram.enabled = false;
      },
      (s) => {
        s.telegram.silent = true;
      },
      (s) => {
        s.telegram.onSubscribe = false;
      },
      (s) => {
        s.telegram.botToken = "";
      },
      (s) => {
        s.telegram.chatId = "";
      },
    ];
    for (const mutate of cases) {
      fetchFn.mockClear();
      const s = settings();
      mutate(s);
      await notifyTelegramEvent(s, "subscribe", "hi", fetchFn as unknown as typeof fetch);
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it("never throws and never sends secrets", async () => {
    const s = settings();
    await notifyTelegramEvent(s, "subscribe", "", undefined);
    const failing = async (): Promise<Response> => {
      throw new Error("down");
    };
    await notifyTelegramEvent(s, "subscribe", "hi", failing as unknown as typeof fetch);
    const calls: string[] = [];
    const spy = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${url} ${String(init?.body)}`);
      return new Response("{}", { status: 200 });
    });
    await notifyTelegramEvent(s, "subscribe", "hi", spy as unknown as typeof fetch);
    const blob = calls.join("\n");
    expect(blob).not.toContain("sp12345678");
    expect(blob).not.toContain("x".repeat(64));
  });
});
