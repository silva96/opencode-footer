import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_ITEMS, normalizeOptions, shouldShowQuota } from "./options.mjs"

test("generic defaults keep model items, use a spacer, and poll every 15 seconds", () => {
  const options = normalizeOptions()
  assert.equal("codexHome" in options, false)
  assert.equal("codexCommand" in options, false)
  assert.ok(options.items.includes("model-with-reasoning"))
  assert.ok(options.items.includes("fast-mode"))
  assert.ok(options.items.indexOf("spacer") < options.items.indexOf("total-input-tokens"))
  assert.equal(options.refreshIntervalMs, 15000)
  assert.equal(options.wrapMode, "word")
  assert.deepEqual(options.items, DEFAULT_ITEMS)
})

test("quotas are visible only for a selected OpenAI provider", () => {
  const options = normalizeOptions()
  for (const provider of [undefined, null, "anthropic", "google", "ollama", "openai-compatible"]) {
    assert.equal(shouldShowQuota(options, provider), false)
  }
  assert.equal(shouldShowQuota(options, "openai"), true)
})

test("removing quota disables it even for OpenAI; custom providers require opt-in", () => {
  assert.equal(shouldShowQuota(normalizeOptions({ items: ["model-with-reasoning"] }), "openai"), false)
  assert.equal(shouldShowQuota(normalizeOptions({ quotaProviders: ["my-openai-provider"] }), "my-openai-provider"), true)
  assert.equal(shouldShowQuota(normalizeOptions({ quotaProviders: [] }), "openai"), false)
})

test("accepts configurable polling and wrapping without Codex settings", () => {
  const options = normalizeOptions({ refreshIntervalMs: 30000, wrapMode: "char" })
  assert.equal(options.refreshIntervalMs, 30000)
  assert.equal(options.wrapMode, "char")
})

test("rejects invalid options before polling", () => {
  for (const options of [{ refreshIntervalMs: 0 }, { requestTimeoutMs: -1 }, { items: "model" }, { items: ["model-with-reasoning", "model-with-reasoning"] }, { quotaProviders: [null] }, { wrapMode: "invalid" }]) {
    assert.throws(() => normalizeOptions(options), TypeError)
  }
})
