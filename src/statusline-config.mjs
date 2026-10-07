export const STATUS_ITEMS = [
  { id: "agent", description: "Current agent" },
  { id: "model-with-reasoning", description: "Current model name with reasoning level" },
  { id: "context-remaining", description: "Context window remaining (omitted when unknown)" },
  { id: "current-dir", description: "Current working directory" },
  { id: "git-branch", description: "Current Git branch (omitted when unavailable)" },
  { id: "five-hour-limit", description: "Remaining 5-hour Codex quota (omitted when unavailable)" },
  { id: "weekly-limit", description: "Remaining weekly Codex quota (omitted when unavailable)" },
  { id: "other-limits", description: "Other server-reported Codex quota windows" },
  { id: "total-input-tokens", description: "Total input tokens used in the session" },
  { id: "total-output-tokens", description: "Total output tokens used in the session" },
  { id: "fast-mode", description: "Fast mode inferred from the model name" },
  { id: "model", description: "Current model name" },
  { id: "reasoning", description: "Current reasoning level" },
  { id: "project-name", description: "Project directory name" },
  { id: "hostname", description: "Local machine hostname" },
  { id: "run-state", description: "Session state: Ready or Working" },
  { id: "context-used", description: "Context window used (omitted when unknown)" },
  { id: "context-window-size", description: "Model context limit in tokens" },
  { id: "used-tokens", description: "Total session tokens, including cache and reasoning" },
  { id: "session-id", description: "Current OpenCode session identifier" },
  { id: "session-title", description: "Current session title (omitted when unnamed)" },
  { id: "session-cost", description: "Reported session cost in USD (omitted when zero)" },
  { id: "opencode-version", description: "OpenCode application version" },
]

export const QUOTA_ITEMS = ["five-hour-limit", "weekly-limit", "other-limits"]

export function fastModelCounterpart(current, models) {
  const fast = (model) => /\bfast\b/i.test(`${model.name ?? ""} ${model.id ?? ""} ${model.modelID ?? ""}`)
  const normalize = (value) => (value ?? "").toLowerCase()
    .replace(/\bfast\b/g, "").replace(/[^a-z0-9]/g, "")
  const sameBase = (model) => {
    const currentName = normalize(current.name)
    const modelName = normalize(model.name)
    if (currentName && modelName) return currentName === modelName
    const currentID = normalize(current.modelID ?? current.id)
    return currentID !== "" && currentID === normalize(model.modelID ?? model.id)
  }
  return models.find((model) => model.enabled !== false && model.providerID === current.providerID &&
    fast(model) !== fast(current) && sameBase(model))
}

export function fastModelSwitchTarget(current, models, variant) {
  const target = fastModelCounterpart(current, models)
  if (!target) return undefined
  return {
    id: target.id,
    providerID: target.providerID,
    ...(variant ? { variant } : {}),
  }
}

export function footerCommandAction(input = "") {
  const action = input.trim()
  if (!action) return "menu"
  return ["items", "settings"].includes(action) ? action : undefined
}

const ids = new Set(STATUS_ITEMS.map((item) => item.id))
export function validateItems(items) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array")
  const supported = items.filter((id) => ids.has(id))
  if (new Set(supported).size !== supported.length) throw new TypeError("items must contain unique status line item IDs")
  return supported
}

export function createDraft(preferences) {
  const selected = validateItems(preferences.items)
  return {
    rows: [...selected, ...STATUS_ITEMS.map((item) => item.id).filter((id) => !selected.includes(id))]
      .map((id) => ({ id, enabled: selected.includes(id) })),
  }
}

export function toggleDraft(draft, id) {
  return { ...draft, rows: draft.rows.map((row) => row.id === id ? { ...row, enabled: !row.enabled } : row) }
}

export function moveDraft(draft, id, direction) {
  const rows = [...draft.rows]
  const index = rows.findIndex((row) => row.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= rows.length || ![-1, 1].includes(direction)) return draft
  const row = rows[index]
  rows[index] = rows[target]
  rows[target] = row
  return { ...draft, rows }
}

export const draftPreferences = (draft) => ({
  items: draft.rows.filter((row) => row.enabled).map((row) => row.id),
})

export function draftOptions(draft) {
  const definitions = new Map(STATUS_ITEMS.map((item) => [item.id, item]))
  return draft.rows.map((row) => ({
    value: row.id, title: `[${row.enabled ? "x" : " "}] ${row.id}`,
    description: definitions.get(row.id).description, category: "Items",
  })).map((option) => ({ ...option, footer: "enter/space toggle · esc close" }))
}

export function searchDraftOptions(query, options) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return options.filter((option) => words.every((word) => `${option.title} ${option.description}`.toLowerCase().includes(word)))
}
