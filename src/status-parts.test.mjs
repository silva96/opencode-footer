import assert from "node:assert/strict"
import test from "node:test"
import { latestAssistantTokens, needsLatestAssistantTokens } from "./status-parts.mjs"

test("context messages are only needed for configured context items with a valid limit", () => {
  assert.equal(needsLatestAssistantTokens(["agent"], 100), false)
  assert.equal(needsLatestAssistantTokens(["context-remaining"], undefined), false)
  assert.equal(needsLatestAssistantTokens(["context-used"], 100), true)
})

test("latest assistant tokens are selected newest-first with an early exit", () => {
  const latest = { input: 20 }
  const messages = new Proxy([
    { type: "assistant", tokens: { input: 10 } },
    { type: "user" },
    { type: "assistant", tokens: latest },
    { type: "assistant" },
  ], {
    get(target, property, receiver) {
      if (property === "0") throw new Error("older message should not be read")
      return Reflect.get(target, property, receiver)
    },
  })
  assert.equal(latestAssistantTokens(messages), latest)
})
