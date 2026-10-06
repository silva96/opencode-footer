import { homedir } from "node:os"
import { isAbsolute, join, normalize } from "node:path"

export const DEFAULT_SECTIONS = ["agent", "model", "fast", "quota", "path", "branch", "tokens", "context"]

const positiveInterval = (value, name, fallback) => {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1_000) throw new TypeError(`${name} must be an integer of at least 1000 milliseconds`)
  return value
}

export function normalizeOptions(options = {}) {
  const sections = options.sections ?? DEFAULT_SECTIONS
  if (!Array.isArray(sections) || sections.some((section) => !DEFAULT_SECTIONS.includes(section)) || new Set(sections).size !== sections.length) {
    throw new TypeError("sections must contain unique, supported section names")
  }
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
    sections: [...sections], quotaProviders: [...quotaProviders], codexHome: normalize(codexHome),
    refreshIntervalMs: positiveInterval(options.refreshIntervalMs, "refreshIntervalMs", 15_000),
    requestTimeoutMs: positiveInterval(options.requestTimeoutMs, "requestTimeoutMs", 12_000),
    wrapMode, codexCommand, separator,
  }
}

export const shouldShowQuota = (options, providerID) =>
  options.sections.includes("quota") && typeof providerID === "string" && options.quotaProviders.includes(providerID)

export const orderStatusParts = (parts, sections) => parts
  .filter((part) => sections.includes(part.section))
  .sort((left, right) => sections.indexOf(left.section) - sections.indexOf(right.section))
