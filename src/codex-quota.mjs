import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { isAbsolute } from "node:path"
import { createInterface } from "node:readline"

/** @typedef {{ label: string, remaining: number, resetsAt: number | null }} QuotaWindow */
/** @typedef {{ status: "loading" | "ready" | "stale" | "unavailable", windows: QuotaWindow[], updatedAt: number | null }} QuotaState */

export const REFRESH_INTERVAL_MS = 15_000

const windowLabel = (minutes) => {
  if (minutes === 10_080) return "weekly"
  if (minutes < 60) return `${minutes}m`
  if (minutes % 1_440 === 0) return `${minutes / 1_440}d`
  return `${minutes / 60}h`
}

/** Read the Codex bucket only; never substitute another model/review bucket. */
export function parseQuotaWindows(result) {
  const bucket = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits
  if (!bucket || (bucket.limitId && bucket.limitId !== "codex")) return []
  const windows = []
  for (const window of [bucket.primary, bucket.secondary]) {
    if (!window || !Number.isFinite(window.usedPercent) ||
      !Number.isFinite(window.windowDurationMins) || window.windowDurationMins <= 0) continue
    windows.push({
      label: windowLabel(window.windowDurationMins),
      remaining: Math.max(0, Math.min(100, Math.round(100 - window.usedPercent))),
      resetsAt: Number.isFinite(window.resetsAt) ? window.resetsAt : null,
    })
  }
  return windows
}

/** @param {QuotaState} state */
export function quotaDisplayParts(state, now = Date.now()) {
  if (!state.windows.length) {
    return [{ text: state.status === "loading" ? "Codex quota …" : "Codex quota unavailable", remaining: null, stale: true }]
  }
  return state.windows.map((window) => {
    const expired = window.resetsAt !== null && window.resetsAt * 1_000 <= now
    const stale = state.status !== "ready" || expired
    return {
      text: expired ? `${window.label} —` : `${window.label} ${window.remaining}% left${stale ? " (stale)" : ""}`,
      remaining: expired ? null : window.remaining,
      stale,
    }
  })
}

/**
 * Persistent, read-only stdio client. Codex owns authentication/refresh; this
 * plugin never opens auth.json, copies credentials, or starts threads/turns.
 * @param {{ codexHome: string, codexCommand?: string, intervalMs?: number, requestTimeoutMs?: number,
 *   onUpdate: (state: QuotaState) => void, spawnProcess?: typeof spawn }} options
 */
export function createCodexQuotaPoller({
  codexHome,
  codexCommand = "codex",
  intervalMs = REFRESH_INTERVAL_MS,
  requestTimeoutMs = 12_000,
  onUpdate,
  spawnProcess = spawn,
}) {
  /** @type {QuotaState} */
  let state = { status: "loading", windows: [], updatedAt: null }
  let stopped = false
  let inFlight = null
  let connection = null
  let nextId = 0
  let accountRevision = 0
  const pending = new Map()

  const publish = (next) => {
    state = next
    if (!stopped) onUpdate({ ...state, windows: [...state.windows] })
  }

  const closeConnection = () => {
    const current = connection
    connection = null
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error("connection_closed"))
    }
    pending.clear()
    if (!current) return
    current.lines.close()
    current.process.stdin.destroy()
    current.process.kill("SIGTERM")
    if (current.process.exitCode === null) {
      const force = setTimeout(() => {
        if (current.process.exitCode === null) current.process.kill("SIGKILL")
      }, 2_000)
      force.unref()
      current.process.once("exit", () => clearTimeout(force))
    }
  }

  const rpc = (method, params) => new Promise((resolve, reject) => {
    if (!connection || stopped) return reject(new Error("not_connected"))
    const id = ++nextId
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error("request_timeout"))
      closeConnection()
    }, requestTimeoutMs)
    pending.set(id, { resolve, reject, timer })
    connection.process.stdin.write(`${JSON.stringify({ method, id, ...(params === undefined ? {} : { params }) })}\n`, (error) => {
      if (!error) return
      const request = pending.get(id)
      if (!request) return
      clearTimeout(request.timer)
      pending.delete(id)
      request.reject(new Error("write_failed"))
    })
  })

  const connect = async () => {
    if (connection) return
    // An explicit, existing home is mandatory. Never fall back to another login.
    if (!isAbsolute(codexHome) || !existsSync(codexHome)) throw new Error("invalid_codex_home")
    const child = spawnProcess(codexCommand, ["app-server", "--stdio", "-c", "analytics.enabled=false"], {
      cwd: codexHome,
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ["pipe", "pipe", "ignore"],
    })
    const lines = createInterface({ input: child.stdout })
    const current = { process: child, lines }
    connection = current
    const disconnected = () => {
      if (connection === current) closeConnection()
    }
    child.on("error", disconnected)
    child.on("exit", disconnected)
    child.stdin.on("error", disconnected)
    lines.on("line", (line) => {
      let message
      try { message = JSON.parse(line) } catch { return }
      if (connection !== current || stopped) return
      if (message.method === "account/updated") {
        accountRevision += 1
        // A changed login must never inherit the previous account's cache.
        publish({ status: "loading", windows: [], updatedAt: null })
      }
      const request = pending.get(message.id)
      if (!request) return
      clearTimeout(request.timer)
      pending.delete(message.id)
      // Do not relay upstream error text: it can contain private diagnostics.
      if (message.error) request.reject(new Error("rpc_failed"))
      else request.resolve(message.result)
    })
    await rpc("initialize", {
      clientInfo: { name: "opencode_footer", title: "OpenCode Footer", version: "0.1.0" },
    })
    if (!connection || stopped) throw new Error("connection_closed")
    connection.process.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`)
  }

  const read = async () => {
    try {
      await connect()
      const revision = accountRevision
      const auth = await rpc("account/read", { refreshToken: false })
      if (!["chatgpt", "chatgptAuthTokens"].includes(auth?.account?.type)) {
        publish({ status: "unavailable", windows: [], updatedAt: null })
        return
      }
      const result = await rpc("account/rateLimits/read")
      if (stopped || revision !== accountRevision) return
      const windows = parseQuotaWindows(result)
      publish({ status: windows.length ? "ready" : "unavailable", windows, updatedAt: Date.now() })
    } catch {
      if (stopped) return
      publish({ ...state, status: state.windows.length ? "stale" : "unavailable" })
      closeConnection()
    }
  }

  const refresh = () => {
    if (stopped) return Promise.resolve()
    if (inFlight) return inFlight
    inFlight = read().finally(() => { inFlight = null })
    return inFlight
  }
  const timer = setInterval(() => { void refresh() }, intervalMs)
  void refresh()
  return {
    refresh,
    snapshot: () => ({ ...state, windows: [...state.windows] }),
    stop: () => {
      stopped = true
      clearInterval(timer)
      closeConnection()
    },
  }
}
