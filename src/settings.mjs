import { createHash } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { normalizeOptions } from "./options.mjs"

export const ADVANCED_SETTINGS = [
  { id: "codexHome", title: "Codex home", description: "Codex login directory; absolute path or ~/" },
  { id: "codexCommand", title: "Codex executable", description: "Executable name or path" },
  { id: "quotaProviders", title: "Quota providers", description: "Comma-separated provider IDs; empty disables quotas" },
  { id: "refreshIntervalMs", title: "Quota refresh interval", description: "Milliseconds, at least 1000" },
  { id: "requestTimeoutMs", title: "Codex request timeout", description: "Milliseconds, at least 1000" },
  { id: "wrapMode", title: "Wrapping", description: "word, char, or none" },
  { id: "separator", title: "Separator", description: "Text between footer items" },
]

export function settingsFromOptions(raw = {}) {
  return normalizeOptions(raw)
}

export function parseSetting(settings, id, text) {
  if (!ADVANCED_SETTINGS.some((setting) => setting.id === id)) throw new TypeError("Unknown setting")
  const value = id === "quotaProviders" ? text.split(",").map((id) => id.trim()).filter(Boolean)
    : ["refreshIntervalMs", "requestTimeoutMs"].includes(id) ? Number(text) : text
  return settingsFromOptions({ ...settings, [id]: value })
}

export function configFile(env = process.env, home = homedir()) {
  const file = resolve(env.OPENCODE_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "opencode"), "cli.json")
  return existsSync(file) ? realpathSync(file) : file
}

export function settingsKey(file, env = process.env) {
  // Native TUI storage is global: isolate profiles and inline plugin registrations.
  let inline
  try { inline = JSON.parse(env.OPENCODE_CLI_CONFIG_CONTENT ?? "{}").plugins } catch { inline = env.OPENCODE_CLI_CONFIG_CONTENT }
  return `settings.v1.${createHash("sha256").update(JSON.stringify([file, inline])).digest("hex").slice(0, 24)}`
}
