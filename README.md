# opencode-footer

[![npm version](https://img.shields.io/npm/v/opencode-footer)](https://www.npmjs.com/package/opencode-footer)
[![Tests](https://github.com/silva96/opencode-footer/actions/workflows/test.yml/badge.svg)](https://github.com/silva96/opencode-footer/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A footer for OpenCode V2 showing the agent, model, Codex quotas, project path,
Git branch, token usage, and remaining context. It uses your theme's colors and
wraps to fit the terminal.

## Preview

https://github.com/user-attachments/assets/d0bafc04-0ae7-4e18-9a28-7534150993e1

## Requirements

- OpenCode V2.
- For quotas: an OpenAI ChatGPT OAuth connection in OpenCode. Codex CLI is not required.
- For pull-request links: GitHub CLI (`gh`) on `PATH`, signed in to GitHub.

To use the footer without quotas, disable the quota items in `/footer items`.

## Install

```sh
opencode plugin add opencode-footer
```

Configure the package in `~/.config/opencode/opencode.json(c)`, or the equivalent
under `$XDG_CONFIG_HOME`, so both the server quota reader and terminal UI load:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": "opencode-footer" }
  ]
}
```

When upgrading from a CLI-only installation, move the `opencode-footer` entry
from `cli.json` to `opencode.json(c)`; the terminal component loads automatically.
The plugin now replaces the entire native prompt footer, including its spinner,
directory/branch, and editor-file label. `"-opencode.prompt.footer"` is no longer
needed and can be removed from `cli.json`. Enable `run-state` for the custom
Working spinner.

To update:

```sh
opencode plugin update opencode-footer
```

## Configuration

Run **`/footer`** to choose between **Items** and **Settings**, or open either
directly.

Run **`/footer items`** to choose what appears in the footer:

- Type to search; **↑/↓** to select.
- **Space** or **Enter** toggles an item.
- **←/→** changes item order; changes apply immediately.
- **Esc** closes the picker.

Available items include agent, model/reasoning, separate quota windows, directory,
Git branch, token totals, context, hostname, session title/ID/cost, and run state.
The **Spacer** item fills available width between groups; defaults put token and
context information after it. Existing saved item selections are preserved.
The Git branch item includes a clickable open PR number when `gh` can find one;
it refreshes every minute.
Unavailable information is omitted. Fast mode is inferred from the model name.
An optional animated cat is available as the **Pet** item. It sleeps after being
idle, thinks during reasoning, and reacts to completed or failed runs. Enable it
with `/footer items`.
The agent item shows the session's committed agent; after selecting another agent,
the label updates when you send a prompt. OpenCode 2.0.22 does not expose the
pending agent selection to plugins.
The Working run state includes an animated spinner and uses the quota/Fast on/context-remaining color.
Ready uses the current-directory color. Both follow your theme.
Quota items show loading or unavailable messages when no quota windows are available.

Run **`/footer settings`** (or **Ctrl+S** in the picker) for advanced settings:

| Setting | Default |
|---|---|
| Use theme colors | `true` (select to toggle) |
| Quota providers | `openai` |
| Quota refresh interval | `15000` ms |
| Quota request timeout | `12000` ms |
| Wrapping | `word` |
| Separator | ` · ` |

Changes are saved in OpenCode's durable local plugin storage, take effect
immediately, and sync across running clients using the same configuration.
Different CLI configuration paths keep separate settings.
OpenCode manages this storage under `~/.local/state/opencode`, or
`$XDG_STATE_HOME/opencode` when set.
Quotas come from OpenCode's active OpenAI OAuth connection and are only polled for
eligible providers. OpenCode handles credential refresh; credentials never reach
the terminal plugin.

## Clickable footer items

| Item | Click action |
|---|---|
| Agent (`agent`) | Opens OpenCode's agent picker. |
| Model name (`model` or the name in `model-with-reasoning`) | Opens OpenCode's model picker. |
| Reasoning effort (`reasoning` or the effort in `model-with-reasoning`) | Opens OpenCode's variant picker. |
| Fast on/off (`fast-mode`) | Switches to the same-name fast/non-fast model in the same provider, preserving the current effort. If no counterpart exists, the model stays unchanged. |
| Quota (`five-hour-limit`, `weekly-limit`, `other-limits`) | Opens the Codex Usage modal with remaining bars/percentages and local reset times. Labels, empty blocks, and reset times are dimmed. |
| PR number beside Git branch (`git-branch`) | Opens the pull request URL. |

All other footer items are informational only. Clicking requires mouse support in
your terminal and OpenCode; no hover action is needed.

## Troubleshooting

- **Quota unavailable:** check that the package is configured in `opencode.json(c)`
  and that OpenCode's OpenAI integration is signed in with ChatGPT OAuth, not an API key.
- **Only one quota window:** the server returned one window.
- **Duplicate footer:** keep one installation of this plugin; do not configure it
  in both `cli.json` and `opencode.json(c)`.
- **No PR link:** check that `gh` is installed, signed in, and the branch has an open PR.
- **Agent/model label inside the prompt box:** OpenCode renders that separately.
  In 2.0.22, it has no setting or plugin slot for hiding it.

## Development

Requires Node.js 22+.

```sh
git clone https://github.com/silva96/opencode-footer.git
cd opencode-footer
npm test
```

To load a local checkout, set the plugin's `package` in `opencode.json(c)` to its absolute
path. Multiple configurations can share that checkout with separate saved settings.
After pulling changes, reopen each client.

Run `npm install --ignore-scripts --legacy-peer-deps` before testing. Tests use
Node's built-in runner with fake quota RPCs and HTTP responses. CI runs on Node 22
and 24.

See [Architecture](docs/ARCHITECTURE.md) for adding footer items and quota sources.

## License

[MIT](LICENSE)
