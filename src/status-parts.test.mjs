import assert from "node:assert/strict"
import test from "node:test"
import { buildStatusParts, latestAssistantTokens, needsLatestAssistantTokens } from "./status-parts.mjs"

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

test("spacers separate available groups without leading or trailing space", () => {
  const items = ["current-dir", "spacer", "total-input-tokens"]
  const data = { directory: "/project", tokens: { input: 100 } }
  assert.deepEqual(buildStatusParts(data, items, {}, false).map((part) => part.item), items)
  assert.deepEqual(buildStatusParts({ directory: "/project" }, items, {}, false).map((part) => part.item), ["current-dir"])
  assert.deepEqual(buildStatusParts({ tokens: { input: 100 } }, items, {}, false).map((part) => part.item), ["total-input-tokens"])
})

test("an open pull request is a link beside its branch", () => {
  const pullRequest = { number: 42, url: "https://github.com/example/project/pull/42" }
  const parts = buildStatusParts({ branch: "feature", pullRequest }, ["git-branch"], {}, false)
  assert.deepEqual(parts.map(({ item, text }) => [item, text]), [["git-branch", "feature"], ["pull-request", "#42"]])
  assert.equal(parts[1].url, pullRequest.url)
  assert.equal(parts[1].separator, " ")
  assert.deepEqual(buildStatusParts({ pullRequest }, ["git-branch"], {}, false), [])
})
