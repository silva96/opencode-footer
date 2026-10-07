import assert from "node:assert/strict"
import { homedir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { DEFAULT_ITEMS, normalizeOptions, shouldShowQuota } from "./options.mjs"

test("generic defaults use ~/.codex, word wrapping, and 15-second polling", () => {
  const options = normalizeOptions()
  assert.equal(options.codexHome, join(homedir(), ".codex"))
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

test("expands portable home paths and accepts configurable polling/wrapping", () => {
  const options = normalizeOptions({ codexHome: "~/.codex", refreshIntervalMs: 30000, wrapMode: "char" })
  assert.equal(options.codexHome, join(homedir(), ".codex"))
  assert.equal(options.refreshIntervalMs, 30000)
  assert.equal(options.wrapMode, "char")
})

test("rejects invalid options before starting any processes", () => {
  for (const options of [{ refreshIntervalMs: 0 }, { requestTimeoutMs: -1 }, { codexHome: "relative" }, { items: "model" }, { items: ["model-with-reasoning", "model-with-reasoning"] }, { quotaProviders: [null] }, { wrapMode: "invalid" }, { codexCommand: "" }]) {
    assert.throws(() => normalizeOptions(options), TypeError)
  }
})
