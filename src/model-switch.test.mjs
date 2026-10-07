import assert from "node:assert/strict"
import test from "node:test"
import { switchPromptModel } from "./model-switch.mjs"

function host(variant, sessionVariant = variant) {
  let committed = { id: "astra", providerID: "openai", variant: sessionVariant }
  let draft = { modelID: "astra", providerID: "openai", variant }
  const calls = []
  const current = () => draft ?? { modelID: committed.id, providerID: committed.providerID, variant: committed.variant }
  const context = {
    ui: {
      router: { current: () => ({ type: "session", sessionID: "session" }) },
      model: { current, variant: { set(value) {
        const selected = current()
        draft = selected.modelID === committed.id && selected.providerID === committed.providerID && value === committed.variant
          ? undefined : { ...selected, variant: value }
        return true
      } } },
    },
    data: { session: { invalidate() {}, async sync() {}, get: () => ({ model: committed }) } },
    client: { session: { async switchModel({ model }) { calls.push(model); committed = model } } },
  }
  return { context, calls }
}

test("Fast changes the prompt selection, not just the server, and preserves high/xhigh/default", async () => {
  for (const variant of ["high", "xhigh", undefined]) {
    const { context, calls } = host(variant)
    const selected = context.ui.model.current()
    const target = { id: "astra-fast", providerID: "openai", variant: selected.variant }
    await switchPromptModel(context, "session", selected, target)
    assert.deepEqual(context.ui.model.current(), { modelID: "astra-fast", providerID: "openai", variant: selected.variant })
    assert.deepEqual(calls.at(-1), target)
  }
})

test("server-only switching leaves the old prompt selection active", async () => {
  const { context } = host("high")
  await context.client.session.switchModel({ model: { id: "astra-fast", providerID: "openai", variant: "high" } })
  assert.equal(context.ui.model.current().modelID, "astra")
})

test("a locally changed effort is committed before clearing the prompt override", async () => {
  const { context, calls } = host("xhigh", "high")
  const selected = context.ui.model.current()
  const target = { id: "astra-fast", providerID: "openai", variant: "xhigh" }
  await switchPromptModel(context, "session", selected, target)
  assert.deepEqual(calls, [{ id: "astra", providerID: "openai", variant: "xhigh" }, target])
  assert.equal(context.ui.model.current().variant, "xhigh")
  assert.equal(context.ui.model.current().modelID, "astra-fast")
})
