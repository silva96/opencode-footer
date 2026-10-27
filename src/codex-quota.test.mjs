import assert from "node:assert/strict"
import { setTimeout as delay } from "node:timers/promises"
import test from "node:test"
import { createCodexQuotaPoller, parseQuotaWindows, quotaDetails, quotaDisplayParts, REFRESH_INTERVAL_MS } from "./codex-quota.mjs"
import serverPlugin from "./index.mjs"
import { FooterQuota } from "./quota-rpc.mjs"

const limits = (used = 9) => ({
  rate_limit: {
    primary_window: { used_percent: used, limit_window_seconds: 18_000, reset_at: 2_000_000_000 },
    secondary_window: { used_percent: 40, limit_window_seconds: 604_800, reset_at: 2_000_100_000 },
  },
})

test("usage modal rows have separate labels, 20-cell remaining bars, and reset text", () => {
  const state = { status: "ready", windows: [
    { label: "5h", remaining: 0, resetsAt: 2_000_000_000 },
    { label: "weekly", remaining: 46, resetsAt: 2_000_100_000 },
  ], updatedAt: 1 }
  const rows = quotaDetails(state, 1)
  assert.equal(rows[0].label, "5h limit:")
  assert.equal(rows[0].filled, "")
  assert.equal(rows[0].empty, "░".repeat(20))
  assert.equal(rows[1].label, "Weekly limit:")
  assert.equal(rows[1].filled, "█".repeat(9))
  assert.equal(rows[1].empty, "░".repeat(11))
  assert.equal(rows[1].remaining, 46)
  assert.match(rows[1].reset, /^ \(resets .+\)$/)
  assert.deepEqual(quotaDetails({ ...state, windows: [] }), [])
  state.windows[1].resetsAt = null
  assert.equal(quotaDetails(state, 1)[1].reset, "")
  const expired = quotaDetails(state, 2_000_000_001_000)[0]
  assert.equal(expired.remaining, null)
  assert.equal(expired.filled + expired.empty, "")
  assert.equal(expired.reset, "")
})

function fakeServer(handler = () => ({ account: "account-1", windows: parseQuotaWindows(limits()) })) {
  const requests = []
  const readQuota = async (signal) => {
    requests.push(signal)
    return handler(signal)
  }
  return { requests, readQuota }
}

const poller = (server, overrides = {}) => createCodexQuotaPoller({
  onUpdate: () => {},
  readQuota: server.readQuota,
  ...overrides,
})

test("formats the 5h and weekly remaining percentages with reset times", () => {
  assert.equal(REFRESH_INTERVAL_MS, 15_000)
  const windows = parseQuotaWindows(limits())
  assert.deepEqual(windows.map(({ label, remaining }) => ({ label, remaining })), [
    { label: "5h", remaining: 91 }, { label: "weekly", remaining: 60 },
  ])
  const displayed = quotaDisplayParts({ status: "ready", windows, updatedAt: 1 }, 1).map((part) => part.text)
  assert.match(displayed[0], /^5h 91% left \(resets .+\)$/)
  assert.match(displayed[1], /^weekly 60% left \(resets .+\)$/)
  assert.deepEqual(quotaDisplayParts({ status: "ready", windows, updatedAt: 1 }, 1, false).map((part) => part.text), ["5h 91% left", "weekly 60% left"])
})

test("omits today's reset date and includes a date for a later reset day", () => {
  const now = new Date(2026, 9, 6, 12).getTime()
  const today = new Date(2026, 9, 6, 21, 58)
  const nextWeek = new Date(2026, 9, 12, 10, 48)
  const windows = [
    { label: "5h", remaining: 0, resetsAt: today.getTime() / 1_000 },
    { label: "weekly", remaining: 46, resetsAt: nextWeek.getTime() / 1_000 },
  ]
  const displayed = quotaDisplayParts({ status: "ready", windows, updatedAt: now }, now).map((part) => part.text)
  const timeOptions = { hour: "numeric", minute: "2-digit" }
  assert.equal(displayed[0], `5h 0% left (resets ${today.toLocaleTimeString(undefined, timeOptions)})`)
  assert.equal(displayed[1], `weekly 46% left (resets ${nextWeek.toLocaleTimeString(undefined, timeOptions)} on ${nextWeek.toLocaleDateString(undefined, { day: "numeric", month: "short" })})`)
})

test("uses actual durations rather than assuming primary/secondary order", () => {
  const result = limits()
  const { primary_window, secondary_window } = result.rate_limit
  result.rate_limit.primary_window = secondary_window
  result.rate_limit.secondary_window = primary_window
  assert.deepEqual(parseQuotaWindows(result).map((part) => part.label), ["weekly", "5h"])
  result.rate_limit.secondary_window = null
  assert.equal(parseQuotaWindows(result).length, 1)
})

test("selects subscription limits and ignores unrelated review limits", () => {
  const result = { ...limits(), code_review_rate_limit: limits(50).rate_limit }
  assert.equal(parseQuotaWindows(result)[0].remaining, 91)
  delete result.rate_limit
  assert.deepEqual(parseQuotaWindows(result), [])
})

test("rejects missing/invalid numbers and clamps over-limit percentages", () => {
  assert.deepEqual(parseQuotaWindows(null), [])
  const result = limits(110)
  result.rate_limit.secondary_window.used_percent = "40"
  assert.equal(parseQuotaWindows(result)[0].remaining, 0)
  assert.equal(parseQuotaWindows(result).length, 1)
  result.rate_limit.primary_window.limit_window_seconds = null
  assert.deepEqual(parseQuotaWindows(result), [])
})

test("marks failed/expired cached data and never invents a reset", () => {
  const windows = parseQuotaWindows(limits())
  assert.match(quotaDisplayParts({ status: "stale", windows, updatedAt: 1 }, 1)[0].text, /resets .+ \(stale\)$/)
  assert.equal(quotaDisplayParts({ status: "ready", windows, updatedAt: 1 }, 2_000_000_001_000)[0].text, "5h —")
  windows[0].resetsAt = null
  assert.equal(quotaDisplayParts({ status: "stale", windows, updatedAt: 1 }, 1)[0].text, "5h 91% left (stale)")
  assert.equal(quotaDisplayParts({ status: "unavailable", windows: [], updatedAt: null })[0].text, "Codex quota unavailable")
})

test("polls the server with cancellable requests instead of starting Codex", async () => {
  const server = fakeServer()
  const client = poller(server)
  try {
    await client.refresh()
    await client.refresh()
    assert.equal(client.snapshot().status, "ready")
    assert.equal(server.requests.length, 2)
    assert.ok(server.requests.every((signal) => signal instanceof AbortSignal))
  } finally { client.stop() }
  assert.ok(server.requests.every((signal) => signal.aborted))
})

test("does not overlap requests and continues refreshing on the interval", async () => {
  let reads = 0
  let release
  const server = fakeServer(() => {
    reads += 1
    if (reads === 1) {
      return new Promise((resolve) => {
        release = () => resolve({ account: "account-1", windows: parseQuotaWindows(limits()) })
      })
    }
    return { account: "account-1", windows: parseQuotaWindows(limits(10)) }
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

test("fails closed when the server RPC is unavailable", async () => {
  const server = fakeServer(() => { throw new Error("private upstream diagnostics") })
  const client = poller(server)
  try {
    await client.refresh()
    assert.equal(client.snapshot().status, "unavailable")
    assert.deepEqual(client.snapshot().windows, [])
  } finally { client.stop() }
})

test("an unavailable quota displays loading again while a retry is in flight", async () => {
  let reads = 0
  const server = fakeServer((signal) => {
    reads += 1
    if (reads === 1) {
      throw new Error("unavailable")
    }
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
  })
  const updates = []
  const client = poller(server, { onUpdate: (state) => updates.push(state.status) })
  try {
    await client.refresh()
    assert.equal(client.snapshot().status, "unavailable")
    const retry = client.refresh()
    assert.equal(client.snapshot().status, "loading")
    assert.equal(updates.at(-1), "loading")
    client.stop()
    await retry
  } finally { client.stop() }
})

test("the server uses OpenCode OAuth and returns only account identity and quota windows", async (t) => {
  const connection = { id: "account-1", type: "credential", method: "oauth" }
  let read
  await serverPlugin.setup({
    rpc: { register: async (definition, handlers) => {
      assert.equal(definition, FooterQuota)
      read = handlers.read
    } },
    integration: { connection: {
      active: async (id) => { assert.equal(id, "openai"); return connection },
      resolve: async (value) => {
        assert.equal(value, connection)
        return { type: "oauth", access: "test-access", metadata: { accountID: "test-account" } }
      },
    } },
  })
  const signal = new AbortController().signal
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://chatgpt.com/backend-api/wham/usage")
    assert.equal(options.headers.Authorization, "Bearer test-access")
    assert.equal(options.headers["ChatGPT-Account-Id"], "test-account")
    assert.equal(options.signal, signal)
    return Response.json(limits())
  })
  assert.deepEqual(await read({}, { signal }), { account: "account-1", windows: parseQuotaWindows(limits()) })
  connection.method = "key"
  assert.deepEqual(await read({}, { signal }), { account: null, windows: [] })
  assert.equal(globalThis.fetch.mock.calls.length, 1)
})

test("a failed refresh retains a visibly stale value and retries cleanly", async () => {
  let reads = 0
  const server = fakeServer(() => {
    reads += 1
    if (reads === 2) {
      return { account: "account-1", windows: null }
    }
    return { account: "account-1", windows: parseQuotaWindows(limits()) }
  })
  const client = poller(server)
  try {
    await client.refresh()
    await client.refresh()
    assert.equal(client.snapshot().status, "stale")
    assert.equal(client.snapshot().windows[0].remaining, 91)
    await client.refresh()
    assert.equal(client.snapshot().status, "ready")
    assert.equal(server.requests.length, 3)
  } finally { client.stop() }
})

test("an account change clears the old cache before accepting another response", async () => {
  let reads = 0
  const server = fakeServer(() => {
    reads += 1
    if (reads === 2) {
      return { account: "account-2", windows: null }
    }
    return { account: reads === 1 ? "account-1" : "account-2", windows: parseQuotaWindows(limits(50)) }
  })
  const client = poller(server)
  try {
    await client.refresh()
    await client.refresh()
    assert.deepEqual(client.snapshot().windows, [])
    assert.equal(client.snapshot().status, "unavailable")
    await client.refresh()
    assert.equal(client.snapshot().status, "ready")
  } finally { client.stop() }
})

test("timeout and cleanup reject pending RPCs without hanging or publishing after stop", async () => {
  const server = fakeServer((signal) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  }))
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
  assert.ok(server.requests.every((signal) => signal.aborted))
})
