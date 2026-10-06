import { homedir } from "node:os"
import { isAbsolute, join, normalize } from "node:path"
import { QUOTA_ITEMS, validateItems } from "./statusline-config.mjs"

export const DEFAULT_ITEMS = ["agent", "model-with-reasoning", "fast-mode", ...QUOTA_ITEMS,
  "current-dir", "git-branch", "total-input-tokens", "total-output-tokens", "context-remaining"]

const positiveInterval = (value, name, fallback) => {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1_000) throw new TypeError(`${name} must be an integer of at least 1000 milliseconds`)
  return value
}

export function normalizeOptions(options = {}) {
  const items = options.items === undefined ? [...DEFAULT_ITEMS] : validateItems(options.items)
  const useThemeColors = options.useThemeColors ?? true
  if (typeof useThemeColors !== "boolean") throw new TypeError("useThemeColors must be a boolean")
  const quotaProviders = options.quotaProviders ?? ["openai"]
  if (!Array.isArray(quotaProviders) || quotaProviders.some((id) => typeof id !== "string" || !id.trim())) {
    throw new TypeError("quotaProviders must be an array of provider IDs")
  }
  let codexHome = options.codexHome ?? join(homedir(), ".codex")
  if (typeof codexHome !== "string") throw new TypeError("codexHome must be a path")
  if (codexHome === "~") codexHome = homedir()
  if (codexHome.startsWith("~/")) codexHome = join(homedir(), codexHome.slice(2))
  if (!isAbsolute(codexHome)) throw new TypeError("codexHome must be absolute or start with ~/")
  const wrapMode = options.wrapMode ?? "word"
  if (!["word", "char", "none"].includes(wrapMode)) throw new TypeError("wrapMode must be word, char, or none")
  const codexCommand = options.codexCommand ?? "codex"
  if (typeof codexCommand !== "string" || !codexCommand.trim()) throw new TypeError("codexCommand must name an executable")
  const separator = options.separator ?? " · "
  if (typeof separator !== "string") throw new TypeError("separator must be text")
  return {
    items, useThemeColors, quotaProviders: [...quotaProviders], codexHome: normalize(codexHome),
    refreshIntervalMs: positiveInterval(options.refreshIntervalMs, "refreshIntervalMs", 15_000),
    requestTimeoutMs: positiveInterval(options.requestTimeoutMs, "requestTimeoutMs", 12_000),
    wrapMode, codexCommand, separator,
  }
}

export const shouldShowQuota = (options, providerID) =>
  options.items.some((id) => QUOTA_ITEMS.includes(id)) &&
  typeof providerID === "string" && options.quotaProviders.includes(providerID)
