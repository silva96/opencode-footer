/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { createCodexQuotaPoller, quotaDisplayParts } from "./codex-quota.mjs"
import { normalizeOptions, orderStatusParts, shouldShowQuota } from "./options.mjs"

type QuotaState = {
  status: "loading" | "ready" | "stale" | "unavailable"
  windows: { label: string; remaining: number; resetsAt: number | null }[]
  updatedAt: number | null
}

type TokenUsage = {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

type ModelRef = {
  id?: string
  providerID?: string
  name?: string
  variant?: string
  modelID?: string
  model?: ModelRef
}

type SessionRecord = {
  agent?: string
  model?: ModelRef
  location?: { directory?: string | null; workspaceID?: string }
  tokens?: TokenUsage
}

type AssistantMessage = {
  type?: string
  tokens?: TokenUsage
  model?: ModelRef
}

type StatusTone =
  | "agent"
  | "model"
  | "context"
  | "path"
  | "branch"
  | "input"
  | "output"
  | "fastOn"
  | "fastOff"
  | "effortLow"
  | "effortMedium"
  | "effortHigh"
  | "effortXhigh"
  | "effortMax"
type StatusPart = { text: string; tone: StatusTone; section: string; separator?: string }

const effortTone = (effort: string): StatusTone => {
  switch (effort.toLowerCase()) {
    case "low":
    case "minimal":
      return "effortLow"
    case "medium":
      return "effortMedium"
    case "high":
      return "effortHigh"
    case "xhigh":
      return "effortXhigh"
    case "max":
      return "effortMax"
    default:
      return "model"
  }
}

const compact = (value: number) => {
  if (value < 1_000) return String(Math.round(value))
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}

const contextUsed = (tokens?: TokenUsage) =>
  (tokens?.input ?? 0) +
  (tokens?.output ?? 0) +
  (tokens?.reasoning ?? 0) +
  (tokens?.cache?.read ?? 0) +
  (tokens?.cache?.write ?? 0)

export default Plugin.define({
  id: "opencode-footer",
  setup(context) {
    const options = normalizeOptions(context.options)
    const [revision, setRevision] = createSignal(0)
    const [quota, setQuota] = createSignal<QuotaState>({ status: "loading", windows: [], updatedAt: null })
    let quotaPoller: ReturnType<typeof createCodexQuotaPoller> | undefined
    const selectedProvider = () => {
      revision()
      const selected = context.ui.model.current() as ModelRef | undefined
      return selected?.model?.providerID ?? selected?.providerID
    }
    createEffect(() => {
      const enabled = shouldShowQuota(options, selectedProvider())
      if (enabled && !quotaPoller) {
        setQuota({ status: "loading", windows: [], updatedAt: null })
        quotaPoller = createCodexQuotaPoller({
          codexHome: options.codexHome,
          intervalMs: options.refreshIntervalMs,
          requestTimeoutMs: options.requestTimeoutMs,
          codexCommand: options.codexCommand,
          onUpdate: setQuota,
        })
      } else if (!enabled && quotaPoller) {
        quotaPoller.stop()
        quotaPoller = undefined
        setQuota({ status: "loading", windows: [], updatedAt: null })
      }
    })
    const quotaParts = (): StatusPart[] => !shouldShowQuota(options, selectedProvider()) ? [] : quotaDisplayParts(quota()).map((part) => ({
      text: part.text,
      section: "quota",
      tone: part.stale ? "fastOff" : part.remaining !== null && part.remaining <= 10 ? "effortXhigh" : "context",
    }))
    const location = context.location ?? context.data.location.default()
    const refresh = () => setRevision((value) => value + 1)
    const toneColor = (tone: StatusTone) => {
      switch (tone) {
        case "agent":
        case "model":
        case "effortMedium":
          return context.theme.syntax.type
        case "context":
        case "fastOn":
          return context.theme.markdown.heading
        case "path":
        case "effortLow":
          return context.theme.text.feedback.success.base
        case "branch":
          return context.theme.markdown.linkText
        case "input":
        case "output":
        case "effortHigh":
          return context.theme.text.feedback.info.base
        case "fastOff":
          return context.theme.text.muted
        case "effortXhigh":
          return context.theme.text.feedback.error.base
        case "effortMax":
          return "#d81558"
      }
    }
    if (location) {
      void context.data.location.model.sync(location).catch(() => {})
      void context.data.location.vcs.sync(location).catch(() => {})
      void context.data.location.agent.sync(location).then(refresh).catch(() => {})
    }

    const stops = [
      context.data.on("session.usage.updated", refresh),
      context.data.on("session.model.selected", refresh),
      context.data.on("session.agent.selected", refresh),
    ]
    const timer = setInterval(() => {
      refresh()
      if (location) void context.data.location.vcs.sync(location).catch(() => {})
    }, 5_000)

    const buildLine = (sessionID: string) => {
      revision()
      const session = context.data.session.get(sessionID) as SessionRecord | undefined
      const selected = context.ui.model.current() as ModelRef | undefined
      const sessionModel = session?.model
      const modelID = selected?.model?.id ?? selected?.modelID ?? selected?.id ?? sessionModel?.id
      const providerID =
        selected?.model?.providerID ?? selected?.providerID ?? sessionModel?.providerID
      const variant = selected?.variant ?? sessionModel?.variant
      const models = location ? context.data.location.model.list(location) ?? [] : []
      const modelInfo = models.find(
        (model) => (model.id === modelID || model.modelID === modelID) && model.providerID === providerID,
      ) as (ModelRef & { limit?: { context?: number } }) | undefined
      const modelName = modelInfo?.name ?? selected?.model?.name ?? selected?.name ?? modelID
      const fastMode = /\bfast\b/i.test(`${modelName ?? ""} ${modelID ?? ""}`)
      const displayModelName = modelName
        ?.replace(/(?:[-\s]+)?\bfast\b/gi, "")
        .replace(/\s+/g, " ")
        .trim()
      const parts: StatusPart[] = []

      const agentName = session?.agent
        ? context.data.location.agent.list(location)?.find((agent) => agent.id === session.agent)?.name ?? session.agent
        : undefined
      if (agentName) {
        const titleizedAgent = agentName.replace(/(^|[-_\s])([a-z])/g, (_, separator, letter) => `${separator}${letter.toUpperCase()}`)
        parts.push({ text: titleizedAgent, tone: "agent", section: "agent" })
      }

      if (displayModelName) {
        parts.push({ text: displayModelName, tone: "model", section: "model" })
      }
      if (variant) parts.push({ text: variant, tone: effortTone(variant), section: "model", separator: " " })
      parts.push({ text: fastMode ? "Fast on" : "Fast off", tone: fastMode ? "fastOn" : "fastOff", section: "fast" })
      parts.push(...quotaParts())

      let latestTokens: TokenUsage | undefined
      for (const message of (context.data.session.message.list(sessionID) ?? []) as AssistantMessage[]) {
        if (message.type === "assistant" && message.tokens) latestTokens = message.tokens
      }

      const directory = session?.location?.directory ?? location?.directory
      if (directory) parts.push({ text: context.ui.format.path(directory), tone: "path", section: "path" })

      const vcsLocation = session?.location?.directory
        ? { directory: session.location.directory, workspaceID: session.location.workspaceID }
        : location
      const branch = vcsLocation ? context.data.location.vcs.info(vcsLocation)?.branch.current : undefined
      if (branch) parts.push({ text: branch, tone: "branch", section: "branch" })

      const input = session?.tokens?.input ?? 0
      const output = session?.tokens?.output ?? 0
      if (input > 0 || output > 0) {
        parts.push({ text: `${compact(input)} in`, tone: "input", section: "tokens" })
        parts.push({ text: `${compact(output)} out`, tone: "output", section: "tokens" })
      }

      const limit = modelInfo?.limit?.context
      const used = contextUsed(latestTokens)
      if (limit && used > 0) {
        const left = Math.max(0, Math.round((1 - used / limit) * 100))
        parts.push({ text: `${left}% context left`, tone: "context", section: "context" })
      }

      return orderStatusParts(parts, options.sections) as StatusPart[]
    }

    const currentSession = () => {
      const route = context.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }

    const StatusLine = () => {
      const line = createMemo(() => {
        const sessionID = currentSession()
        return sessionID ? buildLine(sessionID) : quotaParts()
      })
      return (
        <Show when={line().length ? line() : undefined}>
          {(parts) => (
            <text wrapMode={options.wrapMode} flexShrink={1} minWidth={0}>
              <For each={parts()}>
                {(part, index) => (
                  <>
                    <Show when={index() > 0}>
                      <span style={{ fg: context.theme.text.muted }}>{part.separator ?? options.separator}</span>
                    </Show>
                    <span style={{ fg: toneColor(part.tone) }}>{part.text}</span>
                  </>
                )}
              </For>
            </text>
          )}
        </Show>
      )
    }

    context.ui.slot({
      append: "prompt.footer",
      render: () => <StatusLine />,
    })

    return () => {
      quotaPoller?.stop()
      for (const stop of stops) stop()
      clearInterval(timer)
    }
  },
})
