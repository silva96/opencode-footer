import assert from "node:assert/strict"
import test from "node:test"
import { agentDisplay } from "./agent-display.mjs"
import { buildStatusParts } from "./status-parts.mjs"

const theme = { categorical: [{ 200: "red" }, { 200: "blue" }, { 200: "green" }], syntax: { type: "fallback" } }
const agents = [
  { id: "build", name: "build", hidden: false },
  { id: "hidden", name: "hidden", hidden: true },
  { id: "explore", name: "explore", mode: "subagent", hidden: false },
  { id: "plan", name: "plan", hidden: false },
]

test("agent changes update both label and native categorical color", () => {
  assert.deepEqual(agentDisplay("build", agents, theme), { name: "Build", color: "red" })
  assert.deepEqual(agentDisplay("plan", agents, theme), { name: "Plan", color: "green" })
})

test("hidden agents do not consume colors but visible subagents do", () => {
  assert.equal(agentDisplay("explore", agents, theme).color, "blue")
  assert.equal(agentDisplay("hidden", agents, theme).color, "red")
})

test("configured hex colors and custom display names are preserved", () => {
  assert.deepEqual(agentDisplay("custom", [{ id: "custom", name: "code-review", color: "#aabbcc" }], theme), {
    name: "Code-Review", color: "#aabbcc",
  })
})

test("equal categorical colors are deduplicated as in the host", () => {
  const color = (hex) => ({ hex, equals: (other) => other.hex === hex })
  const first = color("#112233")
  const second = color("#445566")
  const categorical = [{ 200: first }, { 200: color("#112233") }, { 200: second }]
  assert.equal(agentDisplay("explore", agents, { ...theme, categorical }).color, second)
  assert.equal(agentDisplay("plan", agents, { ...theme, categorical }).color, first)
})

test("unknown agents and missing palettes have safe fallbacks", () => {
  assert.deepEqual(agentDisplay(undefined, agents, theme), {})
  assert.deepEqual(agentDisplay("custom_agent", agents, theme), { name: "Custom_Agent", color: "red" })
  assert.deepEqual(agentDisplay("build", agents, { syntax: theme.syntax }), { name: "Build", color: "fallback" })
})

test("agent color is carried only by the agent item", () => {
  const parts = buildStatusParts({ agent: "Plan", agentColor: "#123456", title: "Session", model: "Model" },
    ["agent", "session-title", "model"], { windows: [] }, false)
  assert.equal(parts[0].color, "#123456")
  assert.equal(parts[1].color, undefined)
  assert.equal(parts[2].color, undefined)
})
