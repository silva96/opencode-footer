import assert from "node:assert/strict"
import test from "node:test"
import { normalizeOptions, shouldShowQuota } from "./options.mjs"
import { createDraft, draftOptions, draftPreferences, fastModelCounterpart, fastModelSwitchTarget, footerCommandAction, moveDraft, searchDraftOptions, toggleDraft } from "./statusline-config.mjs"
import { buildStatusParts } from "./status-parts.mjs"

test("fast mode finds the same model with opposite fast status in the same provider regardless of variant metadata", () => {
  const regular = { id: "example", name: "Example Model", providerID: "openai", variants: [{ id: "high" }] }
  const fast = { id: "example-fast", name: "Example Model (Fast)", providerID: "openai", variants: [{ id: "high" }] }
  const models = [
    { ...fast, providerID: "other" },
    { ...fast, enabled: false },
    { ...fast, name: "Different Fast" },
    regular, fast,
  ]
  assert.equal(fastModelCounterpart(regular, models), fast)
  assert.equal(fastModelCounterpart(fast, models), regular)
  assert.deepEqual(fastModelSwitchTarget(fast, models, "xhigh"), { id: "example", providerID: "openai", variant: "xhigh" })
  assert.deepEqual(fastModelSwitchTarget(regular, models, "medium"), { id: "example-fast", providerID: "openai", variant: "medium" })
  assert.equal(fastModelCounterpart(regular, [regular]), undefined)
})

test("footer subcommands route explicitly and reject unknown arguments", () => {
  assert.equal(footerCommandAction(), "menu")
  assert.equal(footerCommandAction("  "), "menu")
  assert.equal(footerCommandAction(" items "), "items")
  assert.equal(footerCommandAction("settings"), "settings")
  assert.equal(footerCommandAction("unknown"), undefined)
  assert.equal(footerCommandAction("items extra"), undefined)
})

test("draft toggles and reorders without changing saved preferences; empty selection is valid", () => {
  const preferences = { items: ["model", "current-dir"], useThemeColors: true }
  const original = createDraft(preferences)
  let draft = moveDraft(original, "current-dir", -1)
  assert.deepEqual(draftPreferences(draft), { items: ["current-dir", "model"] })
  draft = toggleDraft(toggleDraft(draft, "model"), "current-dir")
  assert.deepEqual(draftPreferences(draft).items, [])
  assert.equal(preferences.useThemeColors, true)
  assert.deepEqual(preferences.items, ["model", "current-dir"])
  assert.equal(moveDraft(original, "model", -1), original)
  assert.equal(moveDraft(original, "use-theme-colors", 1), original)
})

test("search matches labels and descriptions while retaining reordered results", () => {
  const options = draftOptions(createDraft({ items: ["weekly-limit", "five-hour-limit"], useThemeColors: true }))
  assert.ok(options[0].title.startsWith("[x] weekly-limit"))
  assert.equal(options.some((option) => option.value === "use-theme-colors"), false)
  assert.deepEqual(searchDraftOptions("remaining codex", options).map((option) => option.value), ["weekly-limit", "five-hour-limit"])
  assert.equal(searchDraftOptions("impossible", options).length, 0)
})

test("item visibility gates quota polling", () => {
  assert.equal(shouldShowQuota(normalizeOptions({ items: ["weekly-limit"] }), "openai"), true)
  assert.equal(shouldShowQuota(normalizeOptions({ items: [] }), "openai"), false)
  assert.equal(shouldShowQuota(normalizeOptions({ items: ["weekly-limit"] }), "anthropic"), false)
  assert.throws(() => normalizeOptions({ items: ["weekly-limit", "weekly-limit"] }), TypeError)
  assert.deepEqual(normalizeOptions({ items: ["unknown"] }).items, [])
  assert.throws(() => normalizeOptions({ useThemeColors: "true" }), TypeError)
})

test("parts follow item order, omit unavailable data, and use actual quota window labels", () => {
  const quota = { status: "ready", windows: [{ label: "weekly", remaining: 80, resetsAt: null }, { label: "2h", remaining: 50, resetsAt: null }], updatedAt: 1000 }
  const parts = buildStatusParts({ model: "Example", reasoning: "high", latestTokens: { input: 250 }, contextLimit: 1000 },
    ["git-branch", "context-remaining", "five-hour-limit", "model-with-reasoning", "weekly-limit", "other-limits"], quota, true, 1000)
  assert.deepEqual(parts.map((part) => part.text), ["75% context left", "Example", "high", "weekly 80% left", "2h 50% left"])
  assert.equal(parts[2].separator, " ")
  assert.equal(parts[2].tone, "effortHigh")
  assert.deepEqual(buildStatusParts({}, ["five-hour-limit", "weekly-limit"], quota, false), [])
})

test("context unknown, quotas expired, and zero token totals are handled without fabricated values", () => {
  const quota = { status: "stale", windows: [{ label: "5h", remaining: 75, resetsAt: 1 }], updatedAt: 0 }
  assert.deepEqual(buildStatusParts({}, ["context-remaining", "used-tokens"], quota, false), [])
  assert.equal(buildStatusParts({}, ["five-hour-limit"], quota, true, 2000)[0].text, "5h —")
  assert.equal(buildStatusParts({ contextLimit: 100, latestTokens: { input: 200 } }, ["context-used"], quota, false)[0].text, "100% context used")
})

test("quotas without data are hidden and status is not a configurable item", () => {
  const options = draftOptions(createDraft({ items: ["weekly-limit"], useThemeColors: true }))
  assert.equal(options.some((option) => option.value === "quota-status"), false)
  assert.deepEqual(normalizeOptions({ items: ["removed-item", "quota-status", "weekly-limit"] }).items, ["weekly-limit"])
  assert.deepEqual(buildStatusParts({}, ["weekly-limit"], { status: "loading", windows: [], updatedAt: null }, true), [])
  assert.deepEqual(buildStatusParts({}, ["weekly-limit"], { status: "unavailable", windows: [], updatedAt: null }, true), [])
  assert.deepEqual(buildStatusParts({}, ["weekly-limit"], { status: "loading", windows: [], updatedAt: null }, false), [])
})

test("additional session and machine items render from OpenCode data", () => {
  const parts = buildStatusParts({ model: "Example", fast: false, hostname: "machine", project: "project", sessionID: "session", title: "title", cost: 1.25, version: "2.0", runState: "Working", tokens: { input: 1000, output: 500 } },
    ["total-input-tokens", "total-output-tokens", "used-tokens", "fast-mode", "hostname", "project-name", "session-id", "session-title", "session-cost", "opencode-version", "run-state"], {}, false)
  assert.deepEqual(parts.map((part) => part.text), ["1.0k in", "500 out", "1.5k tokens", "Fast off", "machine", "project", "session", "title", "$1.25", "2.0", "Working"])
})
