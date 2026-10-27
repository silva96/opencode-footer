# Architecture and extension guide

## Modules

| File | Responsibility |
|---|---|
| `index.ts`, `tui.ts` | Local discovery entrypoints for server and terminal plugins. |
| `src/index.mjs` | Server quota RPC using OpenCode's active OpenAI OAuth connection. |
| `src/tui.tsx` | OpenCode/Solid adapter: selected model, session data, theme colors, lifecycle, footer rendering, and state-aware animated pet. |
| `src/options.mjs` | Portable defaults, option validation, provider eligibility. |
| `src/settings.mjs` | Profile-scoped storage keys and validated advanced settings. |
| `src/configurator.tsx` | `/footer items` picker and `/footer settings` dialogs. |
| `src/renderer-size.mjs` | Host-renderer dimensions and disposable resize subscriptions. |
| `src/agent-display.mjs` | Agent labels and native categorical/configured agent colors. |
| `src/statusline-config.mjs` | Item catalog, immutable picker drafts and search. |
| `src/status-parts.mjs` | Ordered footer items built from available session, machine, and quota data. |
| `src/codex-quota.mjs` | Quota RPC polling, normalization, cache, and safe display text. |
| `src/quota-rpc.mjs` | Shared RPC schema; only account identity and quota windows cross to the terminal. |
| `src/pull-request.mjs` | Read-only GitHub CLI lookup of the branch's open PR. |
| `src/*.test.mjs` | Offline tests using fabricated quota RPC and HTTP responses. |

The package exports a server plugin (`.`) and terminal plugin (`./tui`). Configure
it in `opencode.json(c)` so the server quota RPC is available; the terminal UI is
loaded automatically. It needs no server-side tools, model-provider hooks, or
changes to OpenCode's core code.

Local discovery uses `index.ts`, `tui.ts`, and their sources. `npm pack` compiles
`dist/tui.js` and copies the server's `dist/index.mjs` through `scripts/build.mjs`.
The build uses OpenCode's
shared `opentui:runtime-module:*` imports for Solid and OpenTUI render helpers,
without bundling their runtimes. OpenCode 2.0.22 skips its JSX transform inside
`node_modules`; shipping raw TSX there creates separate runtime contexts and
breaks reactive updates. Test the packed entrypoint **inside node_modules**, not
just an extracted directory or the local discovery entrypoint.

## Rendering contract

Each part has `text`, `tone`, and `item`, plus optional `separator`, `color`, and `url`.
`buildStatusParts` filters unavailable data and applies the saved item order,
preserving part order within an item. Semantic theme colors are applied by the
renderer; data sources should not embed ANSI sequences.

The agent item uses its configured hex color or OpenCode's deduplicated
`theme.categorical[*][200]` palette, indexed by visible agents (including visible
subagents). Disabling theme colors still uses the base text color for every item.
The label reads the session's committed agent. OpenCode 2.0.22's public plugin API
does not expose the client-local draft agent, so a native agent selection is not
reflected until it is committed when a prompt is sent. Do not guess the selection
from a model or intercept the host's agent commands to hide this API limitation.

The plugin replaces `prompt.footer`, including the native `prompt.footer.status`
and `prompt.footer.file` contents. The custom run-state item provides its own
Working spinner; keyboard interrupt behavior is unchanged. The wrapping row uses
full-parent width, `flexShrink={1}`, and `minWidth={0}`. The spacer item expands
between available groups without leading/trailing gaps or adjacent separators.
Open PR numbers are links attached to the Git branch item. Lookups refresh every
minute and are cancelled when the session location or branch changes.

Read terminal dimensions from `context.renderer` and dispose resize listeners when
the dialog closes. Avoid OpenTUI renderer-context hooks: an npm-installed peer can
have a separate context from the host, causing a `No renderer found` crash.

## Add an information section

1. Add an item to `STATUS_ITEMS` in `statusline-config.mjs`.
2. Collect the relevant data in `buildLine` in `tui.tsx` and render it in
   `status-parts.mjs`. Skip unavailable values instead of manufacturing defaults.
3. Reuse a semantic tone, or add a new `StatusTone` and theme mapping.
4. Extend option/ordering tests and document the section in the README.
5. Test a narrow terminal, idle and processing states, provider switching, and
   multiple session tabs. Avoid layout changes affecting the host's native controls.

## Add an option

Normalize/validate it before polling, add a documented default, and
write tests for both defaults and invalid values. Never default to a particular
user's path, organization, account, or profile. Paths must be portable and secrets
must not appear in options or examples.

## Settings

`context.storage.store` owns persistence and cross-client synchronization. Store
data contains normalized `settings`.
Its key is derived from the resolved CLI config path (including
`OPENCODE_CONFIG_DIR` / XDG overrides). Inline plugin arrays get a separate scope.
This is required because native TUI storage itself is shared across profiles.

Initial plugin options seed the store once; thereafter, saved UI preferences take
precedence. UI edits are validated inside the storage mutation and immediately
update the footer and poller. The plugin does not modify `cli.json`.

The item picker applies and persists each toggle or reorder immediately; Esc only
closes it. Opening advanced settings keeps the applied item changes; advanced edits
also save individually. Theme colors are toggled in Settings, not the item picker;
item saves only write the item list so they don't overwrite appearance changes.

## Provider and quota lifecycle

The selected model's provider is the gate for both display and polling. With no
eligible provider, **no quota polling should run**. OpenAI is enabled by default;
custom provider IDs require explicit opt-in. Merely recognizing a model name as
GPT is not enough to infer which account supplies its quota.

A reactive effect starts the poller on an eligible provider and stops it when the
provider becomes ineligible. Stopping also cancels pending RPCs and ignores late
results. Re-enabling starts fresh rather than showing another provider's cache.
If no quota windows exist, the first selected quota item shows loading or
unavailable status. A changed account clears the previous account's cached windows.

Keep account limits separate from context usage, session token totals, and model
service-tier hints. Future quota sources should implement similarly scoped
normalization, caching, and cleanup rather than adding credential reads to JSX.

## Read-only protocol boundary

The server resolves OpenCode's active OpenAI OAuth connection and reads
`https://chatgpt.com/backend-api/wham/usage`. OpenCode owns credential refresh.
Only account identity and normalized quota windows are returned by
`opencode-footer.quota.read`; credentials and upstream error bodies stay on the
server. API-key connections do not fetch ChatGPT quotas. Do not add inference,
automatic sign-in, resets, or account mutations as side effects of rendering a footer.

Quota tests inject fake RPCs and HTTP responses. New tests must remain offline and portable:
use temporary directories instead of an author's real home or login. Test missing
windows, invalid percentages, expired caches, RPC failures, timeouts,
non-overlapping polling, provider gates, and cleanup.
