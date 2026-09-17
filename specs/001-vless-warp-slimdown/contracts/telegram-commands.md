# Contract: Telegram Commands (Post-Cut)

**Feature**: `001-vless-warp-slimdown` | **Date**: 2026-09-16

## Surviving commands (exact set)

| Command | Behavior |
|---------|----------|
| Status query | Reports worker status within surviving scope (version, switch state, usage totals) |
| Subscription links | Returns the admin's subscription URLs (surviving targets only) |
| Kill on / off | Flips the kill-switch, confirms new state |
| Anything else (including former per-user usage) | Help reply describing exactly the three commands above |

## Rules

1. No command may reference users, quotas, per-user usage, deleted
   protocols, or deleted formats — in replies or in help, in either
   language.
2. Webhook authentication and chat binding behavior are unchanged.
3. Replies respect the configured panel language.
4. A command for a deleted feature MUST NOT exist as a stub that errors;
   unknown input falls into the help reply.
