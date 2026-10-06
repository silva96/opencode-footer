import { quotaDisplayParts } from "./codex-quota.mjs"

export const compact = (value) => {
  if (value < 1_000) return String(Math.round(value))
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}

export const tokenTotal = (tokens) =>
  (tokens?.input ?? 0) + (tokens?.output ?? 0) + (tokens?.reasoning ?? 0) +
  (tokens?.cache?.read ?? 0) + (tokens?.cache?.write ?? 0)

export const effortTone = (effort) => ({
  low: "effortLow", minimal: "effortLow", medium: "effortMedium", high: "effortHigh",
  xhigh: "effortXhigh", max: "effortMax",
})[effort?.toLowerCase()] ?? "model"

/** Render available data in item order; missing values never produce separators. */
export function buildStatusParts(data, items, quota, quotaEnabled, now = Date.now()) {
  const values = new Map()
  const put = (id, text, tone = "model", separator) => {
    if (text === undefined || text === null || text === "") return
    const parts = values.get(id) ?? []
    parts.push({ item: id, text, tone, ...(separator ? { separator } : {}) })
    values.set(id, parts)
  }
  put("agent", data.agent, "agent")
  put("model", data.model, "model")
  put("reasoning", data.reasoning, effortTone(data.reasoning))
  put("model-with-reasoning", data.model, "model")
  if (data.model && data.reasoning) put("model-with-reasoning", data.reasoning, effortTone(data.reasoning), " ")
  if (data.model) put("fast-mode", data.fast ? "Fast on" : "Fast off", data.fast ? "fastOn" : "fastOff")
  put("current-dir", data.directory, "path")
  put("git-branch", data.branch, "branch")
  put("project-name", data.project, "path")
  put("hostname", data.hostname, "path")
  put("run-state", data.runState, "agent")
  put("session-id", data.sessionID, "path")
  put("session-title", data.title, "agent")
  put("opencode-version", data.version, "model")
  if (Number.isFinite(data.cost) && data.cost > 0) put("session-cost", `$${data.cost.toFixed(2)}`, "context")
  const input = data.tokens?.input ?? 0
  const output = data.tokens?.output ?? 0
  if (input > 0 || output > 0) {
    put("total-input-tokens", `${compact(input)} in`, "input")
    put("total-output-tokens", `${compact(output)} out`, "output")
  }
  const total = tokenTotal(data.tokens)
  if (total > 0) put("used-tokens", `${compact(total)} tokens`, "input")
  if (Number.isFinite(data.contextLimit) && data.contextLimit > 0) {
    put("context-window-size", `${compact(data.contextLimit)} context`, "context")
    if (data.latestTokens) {
      const used = Math.max(0, Math.min(100, Math.round(tokenTotal(data.latestTokens) / data.contextLimit * 100)))
      put("context-used", `${used}% context used`, "context")
      put("context-remaining", `${100 - used}% context left`, "context")
    }
  }
  if (quotaEnabled) {
    const displayed = quotaDisplayParts(quota, now)
    if (!quota.windows.length) put("quota-status", displayed[0].text, "fastOff")
    else quota.windows.forEach((window, index) => {
      const id = window.label === "5h" ? "five-hour-limit" : window.label === "weekly" ? "weekly-limit" : "other-limits"
      const part = displayed[index]
      put(id, part.text, part.stale ? "fastOff" : part.remaining !== null && part.remaining <= 10 ? "effortXhigh" : "context")
    })
  }
  return items.flatMap((id) => values.get(id) ?? [])
}
