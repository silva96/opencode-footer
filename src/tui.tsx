/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { createEffect, createMemo, createRoot, createSignal, For, Show } from "solid-js"
import { basename } from "node:path"
import { hostname } from "node:os"
import { createCodexQuotaPoller } from "./codex-quota.mjs"
import { shouldShowQuota } from "./options.mjs"
import { buildStatusParts } from "./status-parts.mjs"
import { footerCommandAction } from "./statusline-config.mjs"
import { configureSettings, configureStatusLine } from "./configurator"
import { configFile, settingsFromOptions, settingsKey } from "./settings.mjs"

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
  title?: string
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
type StatusPart = { text: string; tone: StatusTone; item: string; separator?: string }
type SettingsState = {
  settings?: ReturnType<typeof settingsFromOptions>
}

const FooterRuntime = {
  mount(context: Context, stored: SettingsState, update: (mutation: (draft: SettingsState) => void) => Promise<void>, dispose: () => void) {
    const options = createMemo(() => settingsFromOptions(stored.settings))
    const save = async (changes: Record<string, unknown>) => {
      await update((draft) => { draft.settings = settingsFromOptions({ ...draft.settings, ...changes }) })
    }
    let configuring = false
    context.ui.slot({
      append: "app",
      render: () => {
        // Older hosts require a mounted component's keymap provider.
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "opencode-footer.configure", title: "Configure Footer", group: "Footer", palette: true,
            slash: { name: "footer", arguments: true },
            run: async (input) => {
              if (configuring) return
              configuring = true
              try {
                let action = footerCommandAction(input)
                if (action === undefined) {
                  context.ui.toast.show({ message: "Use /footer items or /footer settings", variant: "warning" })
                  return
                }
                if (action === "menu") {
                  action = await context.ui.dialog.select<string>({
                    title: "Configure Footer",
                    options: [
                      { value: "items", title: "Items", description: "Choose and reorder footer items" },
                      { value: "settings", title: "Settings", description: "Codex home, quotas, wrapping, and separator" },
                    ],
                  })
                }
                if (action === undefined) return
                const advanced = () => configureSettings(context, options, save)
                if (action === "settings") await advanced()
                else {
                  let advancedTask: Promise<void> | undefined
                  await configureStatusLine(context, options(), save, () => advancedTask = advanced())
                  await advancedTask
                }
              } finally { configuring = false }
            },
          }],
        }))
        return null
      },
    })
    const [revision, setRevision] = createSignal(0)
    const [quota, setQuota] = createSignal<QuotaState>({ status: "loading", windows: [], updatedAt: null })
    let quotaPoller: ReturnType<typeof createCodexQuotaPoller> | undefined
    let pollerKey: string | undefined
    const selectedProvider = () => {
      revision()
      const selected = context.ui.model.current() as ModelRef | undefined
      return selected?.model?.providerID ?? selected?.providerID
    }
    createEffect(() => {
      const settings = options()
      const enabled = shouldShowQuota(settings, selectedProvider())
      const nextKey = enabled ? JSON.stringify([settings.codexHome, settings.codexCommand, settings.refreshIntervalMs, settings.requestTimeoutMs]) : undefined
      if (nextKey !== pollerKey) {
        quotaPoller?.stop()
        quotaPoller = undefined
        pollerKey = nextKey
        setQuota({ status: "loading", windows: [], updatedAt: null })
      }
      if (enabled && !quotaPoller) {
        setQuota({ status: "loading", windows: [], updatedAt: null })
        quotaPoller = createCodexQuotaPoller({
          codexHome: settings.codexHome,
          intervalMs: settings.refreshIntervalMs,
          requestTimeoutMs: settings.requestTimeoutMs,
          codexCommand: settings.codexCommand,
          onUpdate: setQuota,
        })
      }
    })
    const location = context.location ?? context.data.location.default()
    const refresh = () => setRevision((value) => value + 1)
    const toneColor = (tone: StatusTone) => {
      if (!options().useThemeColors) return context.theme.text.base
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

      const agentName = session?.agent
        ? context.data.location.agent.list(location)?.find((agent) => agent.id === session.agent)?.name ?? session.agent
        : undefined
      const titleizedAgent = agentName?.replace(/(^|[-_\s])([a-z])/g, (_, separator, letter) => `${separator}${letter.toUpperCase()}`)

      let latestTokens: TokenUsage | undefined
      for (const message of (context.data.session.message.list(sessionID) ?? []) as AssistantMessage[]) {
        if (message.type === "assistant" && message.tokens) latestTokens = message.tokens
      }

      const directory = session?.location?.directory ?? location?.directory

      const vcsLocation = session?.location?.directory
        ? { directory: session.location.directory, workspaceID: session.location.workspaceID }
        : location
      const branch = vcsLocation ? context.data.location.vcs.info(vcsLocation)?.branch.current : undefined
      return buildStatusParts({
        agent: titleizedAgent, model: displayModelName, reasoning: variant, fast: fastMode,
        directory: directory ? context.ui.format.path(directory) : undefined,
        project: directory ? basename(directory) : undefined, branch, hostname: hostname(),
        runState: context.data.session.status(sessionID) === "running" ? "Working" : "Ready",
        sessionID, title: session?.title, cost: context.data.session.cost(sessionID), version: context.app.version,
        tokens: session?.tokens, latestTokens, contextLimit: modelInfo?.limit?.context,
      }, options().items, quota(), shouldShowQuota(options(), selectedProvider())) as StatusPart[]
    }

    const currentSession = () => {
      const route = context.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }

    const StatusLine = () => {
      const line = createMemo(() => {
        const sessionID = currentSession()
        return sessionID ? buildLine(sessionID) : buildStatusParts({}, options().items, quota(), shouldShowQuota(options(), selectedProvider())) as StatusPart[]
      })
      return (
        <Show when={line().length ? line() : undefined}>
          {(parts) => (
            <text wrapMode={options().wrapMode} flexShrink={1} minWidth={0}>
              <For each={parts()}>
                {(part, index) => (
                  <>
                    <Show when={index() > 0}>
                      <span style={{ fg: options().useThemeColors ? context.theme.text.muted : context.theme.text.base }}>{part.separator ?? options().separator}</span>
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
      dispose()
    }
  },
}

export default Plugin.define({
  id: "opencode-footer",
  async setup(context) {
    const file = configFile()
    let initial: SettingsState
    try {
      initial = { settings: settingsFromOptions(context.options) }
    } catch {
      context.ui.toast.show({ message: "Invalid footer plugin options; settings were not loaded", variant: "error" })
      return
    }
    const [stored, update] = context.storage.store<SettingsState>(settingsKey(file), { initial })
    // Own reactive computations explicitly across the initial storage setup.
    return createRoot((dispose) => FooterRuntime.mount(context, stored, update, dispose))
  },
})
