/** @typedef {{ label: string, remaining: number, resetsAt: number | null }} QuotaWindow */
/** @typedef {{ status: "loading" | "ready" | "stale" | "unavailable", windows: QuotaWindow[], updatedAt: number | null }} QuotaState */

export const REFRESH_INTERVAL_MS = 15_000

const windowLabel = (minutes) => {
  if (minutes === 10_080) return "weekly"
  if (minutes < 60) return `${minutes}m`
  if (minutes % 1_440 === 0) return `${minutes / 1_440}d`
  return `${minutes / 60}h`
}

/** Read subscription windows from ChatGPT's usage endpoint, not review limits. */
export function parseQuotaWindows(result) {
  const bucket = result?.rate_limit
  const windows = []
  for (const window of [bucket?.primary_window, bucket?.secondary_window]) {
    if (!window || !Number.isFinite(window.used_percent) ||
      !Number.isFinite(window.limit_window_seconds) || window.limit_window_seconds <= 0) continue
    windows.push({
      label: windowLabel(window.limit_window_seconds / 60),
      remaining: Math.max(0, Math.min(100, Math.round(100 - window.used_percent))),
      resetsAt: Number.isFinite(window.reset_at) ? window.reset_at : null,
    })
  }
  return windows
}

function resetText(resetsAt, now) {
  if (resetsAt === null) return ""
  const reset = new Date(resetsAt * 1_000)
  const current = new Date(now)
  const time = reset.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  const sameDay = reset.getFullYear() === current.getFullYear() &&
    reset.getMonth() === current.getMonth() && reset.getDate() === current.getDate()
  const date = sameDay ? "" : ` on ${reset.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
  return ` (resets ${time}${date})`
}

/** @param {QuotaState} state */
export function quotaDisplayParts(state, now = Date.now(), includeReset = true) {
  if (!state.windows.length) {
    return [{ text: state.status === "loading" ? "Codex quota …" : "Codex quota unavailable", remaining: null, stale: true }]
  }
  return state.windows.map((window) => {
    const expired = window.resetsAt !== null && window.resetsAt * 1_000 <= now
    const stale = state.status !== "ready" || expired
    return {
      text: expired ? `${window.label} —` : `${window.label} ${window.remaining}% left${includeReset ? resetText(window.resetsAt, now) : ""}${stale ? " (stale)" : ""}`,
      remaining: expired ? null : window.remaining,
      stale,
    }
  })
}

/** Structured usage rows for the modal; keep label/reset styling out of data.
 * @param {QuotaState} state
 */
export function quotaDetails(state, now = Date.now()) {
  const displayed = quotaDisplayParts(state, now, false)
  return state.windows.map((window, index) => {
    const part = displayed[index]
    const filled = part.remaining === null ? 0 : Math.round(part.remaining / 5)
    return {
      label: `${window.label === "weekly" ? "Weekly" : window.label} limit:`,
      filled: part.remaining === null ? "" : "█".repeat(filled),
      empty: part.remaining === null ? "" : "░".repeat(20 - filled),
      remaining: part.remaining,
      reset: part.remaining === null ? "" : resetText(window.resetsAt, now),
      stale: part.stale,
    }
  })
}

/**
 * Poll the server plugin without sending credentials to the terminal.
 * @param {{ readQuota: (signal: AbortSignal) => Promise<{ account: string | null, windows: QuotaWindow[] | null }>,
 *   intervalMs?: number, requestTimeoutMs?: number, onUpdate: (state: QuotaState) => void }} options
 */
export function createCodexQuotaPoller({
  readQuota,
  intervalMs = REFRESH_INTERVAL_MS,
  requestTimeoutMs = 12_000,
  onUpdate,
}) {
  /** @type {QuotaState} */
  let state = { status: "loading", windows: [], updatedAt: null }
  let stopped = false
  let inFlight = null
  let account = null
  const controller = new AbortController()

  const publish = (next) => {
    state = next
    if (!stopped) onUpdate({ ...state, windows: [...state.windows] })
  }

  const read = async () => {
    // When there is no cached window to keep visible, reflect each in-flight
    // attempt instead of leaving the previous unavailable state on screen.
    if (!state.windows.length) publish({ status: "loading", windows: [], updatedAt: null })
    try {
      const result = await readQuota(AbortSignal.any([controller.signal, AbortSignal.timeout(requestTimeoutMs)]))
      if (stopped) return
      if (result.account !== account) {
        account = result.account
        state = { status: "loading", windows: [], updatedAt: null }
      }
      if (result.windows === null) throw new Error("quota_unavailable")
      const windows = result.windows
      publish({ status: windows.length ? "ready" : "unavailable", windows, updatedAt: Date.now() })
    } catch {
      if (stopped) return
      publish({ ...state, status: state.windows.length ? "stale" : "unavailable" })
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
      controller.abort()
    },
  }
}
