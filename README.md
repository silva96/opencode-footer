# opencode-footer

[![npm version](https://img.shields.io/npm/v/opencode-footer)](https://www.npmjs.com/package/opencode-footer)
[![Tests](https://github.com/silva96/opencode-footer/actions/workflows/test.yml/badge.svg)](https://github.com/silva96/opencode-footer/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A footer for OpenCode V2 showing the agent, model, Codex quotas, project path,
Git branch, token usage, and remaining context. It uses your theme's colors and
wraps to fit the terminal.

## Preview

![OpenCode session with opencode-footer showing model, Codex quotas, project, Git branch, token usage, and remaining context](https://raw.githubusercontent.com/silva96/opencode-footer/main/docs/images/footer-demo.png)

## Requirements

- OpenCode V2.
- For quotas: Codex CLI on `PATH` and a ChatGPT login in `~/.codex`.

To use the footer without Codex, omit `quota` from `sections`.

## Install

```sh
opencode plugin add opencode-footer
```

This adds the plugin to `~/.config/opencode/cli.json`, or
`$XDG_CONFIG_HOME/opencode/cli.json` when set.

Add `"-opencode.prompt.footer"` to the same plugin array to disable the built-in
footer contribution. Keep your other plugin entries:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    "-opencode.prompt.footer",
    { "package": "opencode-footer" }
  ]
}
```

Reopen OpenCode. To update:

```sh
opencode plugin update opencode-footer
```

## Configuration

Edit the existing plugin entry in `cli.json` to set options. For example:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    "-opencode.prompt.footer",
    {
      "package": "opencode-footer",
      "options": {
        "sections": ["model", "quota", "path", "branch", "context"]
      }
    }
  ]
}
```

The default section order is `agent`, `model`, `fast`, `quota`, `path`, `branch`,
`tokens`, `context`. Omit sections to hide them or reorder the list to move them.

| Option | Default | Description |
|---|---|---|
| `sections` | All, in the order above | Visible sections; names must be unique. |
| `codexHome` | `~/.codex` | Codex login directory. Accepts absolute paths and `~/`. Overrides inherited `CODEX_HOME`. |
| `refreshIntervalMs` | `15000` | Quota polling interval in milliseconds; integer, minimum `1000`. |
| `requestTimeoutMs` | `12000` | RPC timeout in milliseconds; integer, minimum `1000`. |
| `quotaProviders` | `["openai"]` | Provider IDs that enable quotas. `[]` disables them. |
| `codexCommand` | `codex` | Executable name or path. |
| `wrapMode` | `word` | `word`, `char`, or `none`. |
| `separator` | ` · ` | Separator between items. |

For a custom OpenAI provider, add its ID to `quotaProviders`. Quotas always come
from the login in `codexHome`; use the account you want to track.

## Troubleshooting

- **Quota unavailable:** check `codex --version` and run `codex login` for the
  configured home. For a custom path: `CODEX_HOME="/path/to/home" codex login`.
- **Only one quota window:** the server returned one window.
- **Duplicate footer:** disable `opencode.prompt.footer` and keep one installation
  of this plugin.
- **Agent/model label inside the prompt box:** OpenCode renders that separately.
  In 2.0.22, it has no setting or plugin slot for hiding it.

## Development

Requires Node.js 22+.

```sh
git clone https://github.com/silva96/opencode-footer.git
cd opencode-footer
npm test
```

To load a local checkout, set the plugin's `package` in `cli.json` to its absolute
path. Multiple configurations can share that checkout with separate options.
After pulling changes, reopen each client.

Tests use Node's built-in runner and a fake Codex subprocess. CI runs on Node 22
and 24.

See [Architecture](docs/ARCHITECTURE.md) for adding sections and quota sources.

## License

[MIT](LICENSE)
