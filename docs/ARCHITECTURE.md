# Architecture and extension guide

## Modules

| File | Responsibility |
|---|---|
| `tui.ts` | Local discovery entrypoint. |
| `src/tui.tsx` | OpenCode/Solid adapter: selected model, session data, theme colors, lifecycle, and footer rendering. |
| `src/options.mjs` | Portable defaults, option validation, provider eligibility, section visibility/order. |
| `src/codex-quota.mjs` | Read-only JSON-RPC connection, polling, normalization, cache, and safe display text. |
| `src/*.test.mjs` | Offline tests using fabricated rate-limit responses and subprocess streams. |

Keep the package CLI-only (`./tui` export). It needs no server-side tools, shared
account configuration, model-provider hooks, or changes to OpenCode's core code.

## Rendering contract

Each item has `text`, `tone`, and `section`, plus an optional `separator`.
`orderStatusParts` filters hidden sections and applies the configured order,
preserving item order within a section. Semantic theme colors are applied by the
renderer; data sources should not embed ANSI sequences.

The plugin appends to `prompt.footer`. It does **not** replace the host's footer
or render above the input. The text uses word wrapping, `flexShrink={1}`, and
`minWidth={0}` so it shares the native row's available width. Do not give it a
full-parent width or absolute position: those can cover processing/cancel controls.

## Add an information section

1. Add a name to `DEFAULT_SECTIONS` in `options.mjs`.
2. Collect the relevant data in `buildLine` in `tui.tsx` and append an item with that
   `section`. Skip unavailable values instead of manufacturing defaults.
3. Reuse a semantic tone, or add a new `StatusTone` and theme mapping.
4. Extend option/ordering tests and document the section in the README.
5. Test a narrow terminal, idle and processing states, provider switching, and
   multiple session tabs. Avoid layout changes affecting the host's native controls.

## Add an option

Normalize/validate it before starting processes, add a documented default, and
write tests for both defaults and invalid values. Never default to a particular
user's path, organization, account, or profile. Paths must be portable and secrets
must not appear in options or examples.

## Provider and quota lifecycle

The selected model's provider is the gate for both display and polling. With no
eligible provider, **no Codex process should run**. OpenAI is enabled by default;
custom provider IDs require explicit opt-in. Merely recognizing a model name as
GPT is not enough to infer which account supplies its quota.

A reactive effect starts the poller on an eligible provider and stops it when the
provider becomes ineligible. Stopping also cancels pending RPCs and ignores late
results. Re-enabling starts fresh rather than showing another provider's cache.

Keep account limits separate from context usage, session token totals, and model
service-tier hints. Future quota sources should implement similarly scoped
normalization, caching, and cleanup rather than adding credential reads to JSX.

## Read-only protocol boundary

Allowed methods are `initialize`, `initialized`, `account/read`, and
`account/rateLimits/read`. Account-change notifications invalidate the cache.
Do not add thread creation, inference, automatic sign-in, resets, or account
mutations as side effects of rendering a footer.

Quota tests inject a fake subprocess. New tests must remain offline and portable:
use temporary directories instead of an author's real home or login. Test missing
windows, invalid percentages, expired caches, disconnections, timeouts,
non-overlapping polling, provider gates, and cleanup.
