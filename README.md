# opencode-footer

[![npm version](https://img.shields.io/npm/v/opencode-footer)](https://www.npmjs.com/package/opencode-footer)
[![Tests](https://github.com/silva96/opencode-footer/actions/workflows/test.yml/badge.svg)](https://github.com/silva96/opencode-footer/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A configurable footer for **OpenCode V2**. Keep session information and optional
Codex account quotas in the native footer, with automatic wrapping and theme-aware
colors. The native processing indicator and **Esc to cancel** stay in their own
allocated space.

## Preview

![OpenCode session with opencode-footer showing model, Codex quotas, project, Git branch, token usage, and remaining context](https://raw.githubusercontent.com/silva96/opencode-footer/main/docs/images/footer-demo.png)

*Demonstration content with the project path anonymized. Quota percentages are a
point-in-time snapshot, not fixed values.*

An illustrative session line:

```text
Build · GPT model high · Fast off · 5h 80% left · weekly 50% left · ~/project · main · 12k in · 3k out · 85% context left
```

## Features

- Agent, model, reasoning variant, working directory, Git branch, and token counts.
- A context-remaining estimate, separate from account quota.
- Codex quota updates every **15 seconds** by default, without sending model prompts.
- **Quotas are shown and polled only when an OpenAI provider is selected.** Changing
  to another provider hides them and stops the quota process.
- Word wrapping within the footer's available space, rather than a full-width
  overlay or a separate panel above the input.
- Configurable section visibility/order, separators, wrapping, and quota settings.

## Requirements

- OpenCode V2 with the TUI plugin API. Initially tested on **2.0.22**.
- For quotas: `codex` on `PATH`, with `codex app-server` and
  `account/rateLimits/read` support. Initially tested on Codex CLI **0.160.0**.
- A ChatGPT-backed Codex login in **`~/.codex`**. API-key-only logins do not expose
  these subscription quota windows.

Codex is optional: omit the `quota` section to use the other footer information
without it. Node.js 22+ is needed only for running the standalone tests.

## Install

Available on [npm](https://www.npmjs.com/package/opencode-footer).
Use OpenCode's dedicated plugin installer:

```sh
opencode plugin add opencode-footer
```

The installer detects this package's TUI-only entrypoint and adds it to the
global `cli.json`. The published npm name is **`opencode-footer`**, not
`@silva96/opencode-footer`; no separate `npm install` or `pnpm add` is needed.

To disable OpenCode's built-in footer contribution, merge
`"-opencode.prompt.footer"` into the same plugin array, preserving existing
entries. The result should include:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    "-opencode.prompt.footer",
    { "package": "opencode-footer" }
  ]
}
```

Editing `~/.config/opencode/cli.json` directly is also supported: OpenCode resolves
and installs the configured package. Do not add a second entry if the installer
already created one. Reopen OpenCode after installation.

For a reproducible installation, pin a version instead:

```sh
opencode plugin add opencode-footer@0.1.0
```

Use either the pinned or unpinned entry, not both. Unpinned installations can be
updated with `opencode plugin update opencode-footer`. Exact versions remain
pinned until you change the configured version.

See [OpenCode's plugin management documentation](https://opencode.ai/v2/docs/plugins#manage).

## Install from GitHub

For development or a shared local checkout, clone the repository:

```sh
git clone https://github.com/silva96/opencode-footer.git "$HOME/opencode-footer"
```

Merge this into `~/.config/opencode/cli.json`, preserving your existing settings
and plugin entries. **Replace `/absolute/path` with your actual home directory**;
this is an example, not a literal path to use.

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    "-opencode.prompt.footer",
    { "package": "/absolute/path/opencode-footer" }
  ]
}
```

The disable directive removes OpenCode's built-in footer contribution; the
host's processing/cancel controls remain native. It does not hide the separate
agent/model/variant label inside the prompt box. CLI settings use
`$XDG_CONFIG_HOME/opencode/cli.json` when `XDG_CONFIG_HOME` is set. Do not configure
this CLI-only plugin in `opencode.json`.

Alternatively, clone into OpenCode's global `plugins/opencode-footer` directory
for automatic discovery, without also adding the same local package explicitly.
See [OpenCode's CLI plugin documentation](https://opencode.ai/v2/docs/cli/plugins).

Reopen OpenCode after installing. Update the clone with `git pull` and reopen to
load subsequent changes. No separate build step is required: OpenCode loads the
TUI entrypoint and provides the host runtime dependencies.

### One checkout, multiple configurations

Multiple OpenCode configuration environments can point to the **same absolute
checkout path**. Keep only environment-specific plugin `options` in each CLI
configuration; there is no need to copy the source code. A single `git pull`
updates that checkout for every environment, after reopening each client.

Each running client still has its own plugin instance, in-memory cache, and
eligible Codex subprocess. Shared code does not merge accounts or quota state.
Keep account-specific paths and configuration files outside this repository.

## Configuration

Plugin options belong in the same `cli.json` entry. Replace the installer-created
string entry with the object form below rather than adding another copy. Keep the
exact package specifier if you installed a pinned version.

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    "-opencode.prompt.footer",
    {
      "package": "opencode-footer",
      "options": {
        "sections": ["agent", "model", "fast", "quota", "path", "branch", "tokens", "context"],
        "codexHome": "~/.codex",
        "refreshIntervalMs": 15000,
        "requestTimeoutMs": 12000,
        "quotaProviders": ["openai"],
        "codexCommand": "codex",
        "wrapMode": "word",
        "separator": " · "
      }
    }
  ]
}
```

| Option | Default | Description |
|---|---|---|
| `sections` | All sections, in the example order | Omit sections to hide them; reorder the list to move them. No duplicate or unknown names. |
| `codexHome` | `~/.codex` | Existing Codex home. Absolute paths and `~/` paths are supported. |
| `refreshIntervalMs` | `15000` | Quota polling interval, integer milliseconds, minimum `1000`. Requests never overlap. |
| `requestTimeoutMs` | `12000` | Per-RPC timeout, integer milliseconds, minimum `1000`. |
| `quotaProviders` | `["openai"]` | Exact OpenCode provider IDs allowed to display/poll quotas. An empty list disables them. |
| `codexCommand` | `codex` | Executable name or path; not a shell command or command with arguments. |
| `wrapMode` | `word` | `word`, `char`, or `none`. Wrapping can use more than two rows on very narrow terminals. |
| `separator` | ` · ` | Separator between information items. The model's variant stays attached with a space. |

For a minimal footer without Codex:

```json
"options": { "sections": ["model", "path", "branch", "context"] }
```

For a custom OpenAI provider, explicitly add its provider ID to `quotaProviders`.
OpenAI-compatible providers are **not** automatically assumed to use an OpenAI
subscription or the same quota. The selected provider does not supply credentials
to this plugin: the configured Codex login is always the quota source. Ensure it
is the account whose limits you want to see.

## How quotas work

The plugin maintains one background `codex app-server --stdio` process per loaded
plugin instance, only while quotas are enabled for the selected provider. It
initializes the connection and calls `account/read` and `account/rateLimits/read`.
It does **not** create threads, send prompts, or spend inference tokens.

Remaining quota is `100 - usedPercent`. Labels use the server-reported window
duration: 300 minutes is `5h`, and 10080 minutes is `weekly`. Missing windows are
omitted; they are never invented or assumed to be 100% available.

The last successful result stays visible while refreshing. Failed refreshes mark
it `(stale)`. An expired cached window displays `—` until another response arrives,
instead of assuming a reset. Without a usable login or quota response, OpenAI
models show `Codex quota unavailable`; other providers show no quota section.

Polling stops on provider changes and plugin unload. In-flight results cannot
update an unloaded plugin. Account-change notifications clear the old cache.

Protocol: [Codex App Server](https://learn.chatgpt.com/docs/app-server).

## Privacy and scope

- No bundled account settings, credentials, personal paths, or session data.
- The default home is computed from the operating system's home directory, not a
  hardcoded user path. Inherited `CODEX_HOME` is deliberately overridden with the
  configured home to avoid accidentally reading another login.
- This plugin never opens or copies `auth.json`. Codex handles its own saved login
  and token refresh, and contacts its upstream services to retrieve quotas.
- Quota results are cached in memory, not persisted by the plugin. Upstream errors
  and subprocess stderr are not copied into the footer or application logs.
- Read-only quota requests do not log out, sign in, consume reset credits, or send
  emails. Codex may maintain its own authentication/runtime files.
- OpenCode must support the plugin API; no claim of compatibility with OpenCode V1.

The Fast indicator currently uses the selected model's name/ID (`fast`) as a hint;
it is not an authoritative report of a backend service tier. Context remaining is
an estimate based on the latest reported token usage and the model's context limit.

## Troubleshooting

- **No quotas with another provider:** intentional. Only `quotaProviders` are
  eligible, and the `quota` section must be enabled.
- **Quota unavailable:** check `codex --version`, then authenticate the intended
  Codex home using `codex login`. For an explicit home, use
  `CODEX_HOME="/absolute/path/to/codex-home" codex login`.
- **Only one window:** the service returned only that window; no fabricated second
  percentage is shown.
- **Duplicate footer:** keep the built-in footer disable directive and avoid
  installing both an explicitly configured and a discovered copy.
- **Agent/model label still inside the prompt box:** this is separate native UI,
  not this plugin. OpenCode 2.0.22 exposes neither a setting nor a plugin slot to
  hide it. Disabling `opencode.prompt.footer` does not remove that label.
- **Clipped/overlapping output:** use `word` wrapping and keep `flexShrink={1}` /
  `minWidth={0}`. Do not force the text to `width="100%"` inside the native row.
- **Connection problems:** the plugin retries at the configured interval. Increase
  `requestTimeoutMs` on slow connections; the UI stays responsive.

## Development and extension

```sh
npm test
```

Tests run using Node's built-in test runner, without dependencies, real account
logins, network access, or inference. GitHub Actions runs them on Node 22 and 24.

See [the architecture and extension guide](docs/ARCHITECTURE.md) for adding
sections, options, and quota sources while preserving the native footer layout.
License: [MIT](LICENSE).
