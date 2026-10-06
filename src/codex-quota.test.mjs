import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EventEmitter } from "node:events"
import { PassThrough, Writable } from "node:stream"
import { setTimeout as delay } from "node:timers/promises"
import test, { after } from "node:test"
import { createCodexQuotaPoller, parseQuotaWindows, quotaDisplayParts, REFRESH_INTERVAL_MS } from "./codex-quota.mjs"

const testHome = mkdtempSync(join(tmpdir(), "opencode-footer-test-"))
after(() => rmSync(testHome, { recursive: true, force: true }))

const limits = (used = 9) => ({
  rateLimits: {
    limitId: "codex",
    primary: { usedPercent: used, windowDurationMins: 300, resetsAt: 2_000_000_000 },
    secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: 2_000_100_000 },
  },
})

function fakeServer(handler = () => undefined) {
  const requests = []
  const starts = []
  const children = []
  const spawnProcess = (command, args, options) => {
    starts.push({ command, args, options })
    const child = new EventEmitter()
    children.push(child)
    child.exitCode = null
    child.stdout = new PassThrough()
    const send = (message) => child.stdout.write(`${JSON.stringify(message)}\n`)
    child.stdin = new Writable({
      write(chunk, _encoding, done) {
        const request = JSON.parse(chunk.toString())
        requests.push(request)
        queueMicrotask(() => {
          const custom = handler(request, send)
          if (custom === false || request.method === "initialized") return
          const result = custom ?? (request.method === "account/read" ? { account: { type: "chatgpt" } } : request.method === "account/rateLimits/read" ? limits() : {})
          send({ id: request.id, result })
        })
        done()
      },
    })
    child.kill = () => {
      child.exitCode = 0
      queueMicrotask(() => child.emit("exit", 0))
      return true
    }
    return child
  }
  return { requests, starts, children, spawnProcess }
}

const poller = (server, overrides = {}) => createCodexQuotaPoller({
  codexHome: testHome,
  onUpdate: () => {},
  spawnProcess: server.spawnProcess,
  ...overrides,
})

test("formats the 5h and weekly remaining percentages", () => {
  assert.equal(REFRESH_INTERVAL_MS, 15_000)
  const windows = parseQuotaWindows(limits())
  assert.deepEqual(windows.map(({ label, remaining }) => ({ label, remaining })), [
    { label: "5h", remaining: 91 }, { label: "weekly", remaining: 60 },
  ])
  assert.deepEqual(quotaDisplayParts({ status: "ready", windows, updatedAt: 1 }, 1).map((part) => part.text), ["5h 91% left", "weekly 60% left"])
})

test("uses actual durations rather than assuming primary/secondary order", () => {
  const result = limits()
  const { primary, secondary } = result.rateLimits
  result.rateLimits.primary = secondary
  result.rateLimits.secondary = primary
  assert.deepEqual(parseQuotaWindows(result).map((part) => part.label), ["weekly", "5h"])
  result.rateLimits.secondary = null
  assert.equal(parseQuotaWindows(result).length, 1)
})

test("selects the codex bucket and refuses an unrelated model bucket", () => {
  const result = { rateLimits: { ...limits().rateLimits, limitId: "review" }, rateLimitsByLimitId: { codex: limits().rateLimits } }
  assert.equal(parseQuotaWindows(result)[0].remaining, 91)
  delete result.rateLimitsByLimitId.codex
  assert.deepEqual(parseQuotaWindows(result), [])
})

test("rejects missing/invalid numbers and clamps over-limit percentages", () => {
  assert.deepEqual(parseQuotaWindows(null), [])
  const result = limits(110)
  result.rateLimits.secondary.usedPercent = "40"
  assert.equal(parseQuotaWindows(result)[0].remaining, 0)
  assert.equal(parseQuotaWindows(result).length, 1)
  result.rateLimits.primary.windowDurationMins = null
  assert.deepEqual(parseQuotaWindows(result), [])
})

test("marks failed/expired cached data and never invents a reset", () => {
  const windows = parseQuotaWindows(limits())
  assert.equal(quotaDisplayParts({ status: "stale", windows, updatedAt: 1 }, 1)[0].text, "5h 91% left (stale)")
  assert.equal(quotaDisplayParts({ status: "ready", windows, updatedAt: 1 }, 2_000_000_001_000)[0].text, "5h —")
  assert.equal(quotaDisplayParts({ status: "unavailable", windows: [], updatedAt: null })[0].text, "Codex quota unavailable")
})

test("uses one persistent process, the explicit home, and only read RPCs", async () => {
  const server = fakeServer()
  const client = poller(server)
  try {
    await client.refresh()
    await client.refresh()
    assert.equal(client.snapshot().status, "ready")
    assert.equal(server.starts.length, 1)
    assert.equal(server.starts[0].options.env.CODEX_HOME, testHome)
    assert.deepEqual(server.requests.map((request) => request.method), [
      "initialize", "initialized", "account/read", "account/rateLimits/read", "account/read", "account/rateLimits/read",
    ])
  } finally { client.stop() }
  assert.equal(server.children[0].exitCode, 0)
})

test("does not overlap requests and continues refreshing on the interval", async () => {
  let reads = 0
  let release
  const server = fakeServer((request, send) => {
    if (request.method !== "account/rateLimits/read") return
    reads += 1
    if (reads === 1) {
      release = () => send({ id: request.id, result: limits() })
      return false
    }
    return limits(10)
  })
  const client = poller(server, { intervalMs: 20 })
  try {
    const first = client.refresh()
    assert.equal(first, client.refresh())
    await delay(45)
    assert.equal(reads, 1)
    release()
    await first
    await delay(45)
    assert.ok(reads >= 2)
    assert.equal(client.snapshot().windows[0].remaining, 90)
  } finally { client.stop() }
})

test("fails closed for a missing Codex home without spawning a fallback", async () => {
  const server = fakeServer()
  const client = poller(server, { codexHome: join(testHome, "nonexistent") })
  try {
    await client.refresh()
    assert.equal(client.snapshot().status, "unavailable")
    assert.equal(server.starts.length, 0)
  } finally { client.stop() }
})

test("API-key accounts cannot inherit or fetch ChatGPT quotas", async () => {
  const server = fakeServer((request) => request.method === "account/read" ? { account: { type: "apiKey" } } : undefined)
  const client = poller(server)
  try {
    await client.refresh()
    assert.equal(client.snapshot().status, "unavailable")
    assert.ok(!server.requests.some((request) => request.method === "account/rateLimits/read"))
  } finally { client.stop() }
})

test("a failed refresh retains a visibly stale value and retries cleanly", async () => {
  let reads = 0
  const server = fakeServer((request, send) => {
    if (request.method !== "account/rateLimits/read") return
    reads += 1
    if (reads === 2) {
      send({ id: request.id, error: { message: "private upstream diagnostics" } })
      return false
    }
  })
  const client = poller(server)
  try {
    await client.refresh()
    await client.refresh()
    assert.equal(client.snapshot().status, "stale")
    assert.equal(client.snapshot().windows[0].remaining, 91)
    await client.refresh()
    assert.equal(client.snapshot().status, "ready")
    assert.equal(server.starts.length, 2)
  } finally { client.stop() }
})

test("an account change clears the old cache before accepting another response", async () => {
  let reads = 0
  const server = fakeServer((request, send) => {
    if (request.method !== "account/rateLimits/read") return
    reads += 1
    if (reads === 2) {
      send({ method: "account/updated", params: { authMode: "chatgpt" } })
      send({ id: request.id, result: limits(50) })
      return false
    }
  })
  const client = poller(server)
  try {
    await client.refresh()
    await client.refresh()
    assert.deepEqual(client.snapshot().windows, [])
    assert.equal(client.snapshot().status, "loading")
    await client.refresh()
    assert.equal(client.snapshot().status, "ready")
  } finally { client.stop() }
})

test("timeout and cleanup reject pending RPCs without hanging or publishing after stop", async () => {
  const server = fakeServer(() => false)
  let updates = 0
  const client = poller(server, { requestTimeoutMs: 20, onUpdate: () => { updates += 1 } })
  await client.refresh()
  assert.equal(client.snapshot().status, "unavailable")
  const pending = client.refresh()
  client.stop()
  await pending
  const countAtStop = updates
  await delay(30)
  assert.equal(updates, countAtStop)
  assert.ok(server.children.every((child) => child.exitCode === 0))
})
