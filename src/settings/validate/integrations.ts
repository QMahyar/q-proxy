import type { Settings } from "../../types/settings";
import { TG_CHAT_ID_RE, TG_TOKEN_RE, fail, sanitizeStrArray, strField } from "./shared";

// Integrations domain: routing lists, telegram bot, bootstrap consistency.
export function applyIntegrationsCustom(
  path: string,
  patch: Record<string, unknown>,
  out: Settings,
  fields: Record<string, string>,
): boolean {
  switch (path) {
    case "routingRules.customBypass": {
      const bypassV = patch["customBypass"];
      if (bypassV !== undefined) {
        if (!Array.isArray(bypassV)) fail(fields, "customBypass", "must be an array");
        else {
          const { values, truncated } = sanitizeStrArray(bypassV, { maxItems: 200, itemMaxLen: 253, lowerCase: true });
          if (truncated) fail(fields, "customBypass", "too many entries (max 200)");
          else out.routingRules.customBypass = values;
        }
      }
      return true;
    }
    case "routingRules.customBlock": {
      const blockV = patch["customBlock"];
      if (blockV !== undefined) {
        if (!Array.isArray(blockV)) fail(fields, "customBlock", "must be an array");
        else {
          const { values, truncated } = sanitizeStrArray(blockV, { maxItems: 200, itemMaxLen: 253, lowerCase: true });
          if (truncated) fail(fields, "customBlock", "too many entries (max 200)");
          else out.routingRules.customBlock = values;
        }
      }
      return true;
    }
    case "telegram.botToken": {
      const token = strField(patch, "botToken", fields, { maxLen: 64 });
      if (token !== undefined) {
        const trimmed = token.trim();
        if (out.telegram.enabled && trimmed.length > 0 && !TG_TOKEN_RE.test(trimmed)) {
          fail(fields, "botToken", "must look like 123456789:AAExample_Token35chars_1234567890");
        } else out.telegram.botToken = trimmed;
      }
      return true;
    }
    case "telegram.chatId": {
      const chatId = strField(patch, "chatId", fields, { maxLen: 64 });
      if (chatId !== undefined) {
        const trimmed = chatId.trim();
        if (!TG_CHAT_ID_RE.test(trimmed)) fail(fields, "chatId", "must be a numeric chat id (message the bot once, then use the numeric id; @usernames are not accepted)");
        else out.telegram.chatId = trimmed;
      }
      return true;
    }
    default:
      return false;
  }
}

export function validateBootstrapConsistency(out: Settings, fields: Record<string, string>): void {
  if (out.passwordHash === null && out.passwordIsBootstrap) {
    fail(fields, "passwordIsBootstrap", "requires an existing admin password");
  }
}
