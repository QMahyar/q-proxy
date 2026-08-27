# Decisions

Index of Architecture Decision Records for Q Proxy. ADRs capture technical architecture that is expensive to reverse.

## Active ADRs

| ADR | Title | Date | Status |
|-----|-------|------|--------|
| [ADR-001](ADR-001-single-file-zero-deps.md) | Single-file bundle with zero runtime dependencies | 2026-08-24 | Accepted |
| [ADR-002](ADR-002-kv-only-with-isolate-cache.md) | KV-only persistence with 60s isolate cache | 2026-08-24 | Accepted |
| [ADR-003](ADR-003-stateless-hmac-sessions.md) | Stateless HMAC sessions with iat revocation floor | 2026-08-26 | Accepted |
| [ADR-004](ADR-004-pure-emitters-and-parsers-never-throw.md) | Pure emitters and parsers-never-throw contract | 2026-08-24 | Accepted |
| [ADR-005](ADR-005-hand-rolled-x25519.md) | Hand-rolled X25519 for WARP device registration | 2026-08-24 | Accepted |

## Conventions

- Location: `docs/decisions/ADR-###-kebab-title.md` (Markdown, sequential numbering)
- Status lifecycle: `Proposed → Accepted → Superseded by ADR-XXX | Deprecated` — never delete old ADRs
- Match `docs/ARCHITECTURE.md` frozen contracts — ADRs explain *why*, ARCHITECTURE is the *what* (verbatim types/routes/KV keys)
- Template: see `ADR-001` — Context / Decision / Alternatives Considered / Consequences / References
- Adding an ADR: continue the sequence, update this index, and link from `README.md` Architecture section and `AGENTS.md` if the decision affects the Boundary/Invariants lists

## Verification

- [ ] Every ADR references the owning files and the frozen section in `docs/ARCHITECTURE.md` it explains
- [ ] Alternatives include at least one rejected option with trade-off
- [ ] Consequences note what breaks if the decision is violated (tests, build assertion, KV cost)
