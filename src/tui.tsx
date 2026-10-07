/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { createEffect, createMemo, createRoot, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { basename } from "node:path"
import { hostname } from "node:os"
import { createCodexQuotaPoller } from "./codex-quota.mjs"
import { shouldShowQuota } from "./options.mjs"
import { buildStatusParts } from "./status-parts.mjs"
import { fastModelSwitchTarget, footerCommandAction, QUOTA_ITEMS } from "./statusline-config.mjs"
import { configureSettings, configureStatusLine, showQuotaUsage } from "./configurator"
import { configFile, settingsFromOptions, settingsKey } from "./settings.mjs"
import { switchPromptModel } from "./model-switch.mjs"
import { agentDisplay } from "./agent-display.mjs"

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
type PetState = "idle" | "working" | "thinking" | "sleeping" | "error" | "happy"
type StatusPart = { text: string; tone: StatusTone; item: string; separator?: string; color?: string | Context["theme"]["text"]["base"]; petState?: PetState }

const WorkingIndicator = () => {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  const [frame, setFrame] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => setFrame((value) => (value + 1) % frames.length), 100)
    onCleanup(() => clearInterval(timer))
  })
  return <span>{frames[frame()]} Working</span>
}

const FooterPet = (props: { state: PetState; sessionID: string }) => {
  const frames: Record<PetState, string[]> = {
    idle: ["=^._.^=", "=^-.-^="],
    working: ["=^o.o^=", "=^-.-^="],
    thinking: ["=^-.o^=", "=^-.-^="],
    sleeping: ["=^-.-^=", "=^z.z^="],
    error: ["=^x.x^=", "=^-.-^="],
    happy: ["=^ᵔ.ᵔ^=", "=^-.-^="],
  }
  const [frame, setFrame] = createSignal(0)
  const [sleeping, setSleeping] = createSignal(false)
  createEffect(() => {
    const state = props.state
    props.sessionID
    setFrame(0)
    setSleeping(false)
    let sleepTimer: ReturnType<typeof setTimeout> | undefined
    if (state === "idle") sleepTimer = setTimeout(() => setSleeping(true), 45_000)
    const interval = { idle: 1_200, working: 450, thinking: 900, sleeping: 1_800, error: 600, happy: 700 } as const
    const timer = setInterval(() => setFrame((value) => value + 1), interval[state])
    onCleanup(() => {
      clearInterval(timer)
      if (sleepTimer) clearTimeout(sleepTimer)
    })
  })
  const currentState = () => sleeping() && props.state === "idle" ? "sleeping" : props.state
  return <span>{frames[currentState()][frame() % 2]}</span>
}

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
    const [petMood, setPetMood] = createSignal<{ sessionID: string; state: "thinking" | "error" | "happy" }>()
    let petMoodTimer: ReturnType<typeof setTimeout> | undefined
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
    const clearPetMood = (sessionID: string) => {
      if (petMood()?.sessionID !== sessionID) return
      if (petMoodTimer) clearTimeout(petMoodTimer)
      petMoodTimer = undefined
      setPetMood(undefined)
      refresh()
    }
    const showPetMood = (sessionID: string, state: "error" | "happy", duration: number) => {
      if (petMoodTimer) clearTimeout(petMoodTimer)
      setPetMood({ sessionID, state })
      petMoodTimer = setTimeout(() => clearPetMood(sessionID), duration)
      refresh()
    }
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
      context.data.on("session.reasoning.started", (event) => {
        if (petMoodTimer) clearTimeout(petMoodTimer)
        petMoodTimer = undefined
        setPetMood({ sessionID: event.data.sessionID, state: "thinking" })
        refresh()
      }),
      context.data.on("session.text.started", (event) => {
        if (petMood()?.sessionID === event.data.sessionID && petMood()?.state === "thinking") clearPetMood(event.data.sessionID)
      }),
      context.data.on("session.execution.succeeded", (event) => showPetMood(event.data.sessionID, "happy", 2_000)),
      context.data.on("session.execution.failed", (event) => showPetMood(event.data.sessionID, "error", 3_000)),
      context.data.on("session.execution.interrupted", (event) => clearPetMood(event.data.sessionID)),
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

      const agentLocation = session?.location?.directory ? session.location : location
      const agent = agentDisplay(session?.agent, context.data.location.agent.list(agentLocation) ?? [], context.theme)

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
        agent: agent.name, agentColor: agent.color, model: displayModelName, reasoning: variant, fast: fastMode,
        directory: directory ? context.ui.format.path(directory) : undefined,
        project: directory ? basename(directory) : undefined, branch, hostname: hostname(),
        runState: context.data.session.status(sessionID) === "running" ? "Working" : "Ready",
        petState: petMood()?.sessionID === sessionID ? petMood()?.state : undefined,
        sessionID, title: session?.title, cost: context.data.session.cost(sessionID), version: context.app.version,
        tokens: session?.tokens, latestTokens, contextLimit: modelInfo?.limit?.context,
      }, options().items, quota(), shouldShowQuota(options(), selectedProvider())) as StatusPart[]
    }

    const currentSession = () => {
      const route = context.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }

    const StatusLine = () => {
      let switchingModel = false
      const toggleFast = async () => {
        const sessionID = currentSession()
        if (!sessionID || !location || switchingModel) return
        switchingModel = true
        try {
          await context.data.location.model.sync(location)
          const selected = context.ui.model.current()
          const session = context.data.session.get(sessionID) as SessionRecord | undefined
          const modelID = selected?.modelID ?? session?.model?.id
          const providerID = selected?.providerID ?? session?.model?.providerID
          const variant = selected ? selected.variant : session?.model?.variant
          const models = context.data.location.model.list(location) ?? []
          const current = models.find((model) => model.providerID === providerID &&
            (model.id === modelID || model.modelID === modelID))
          const target = current && fastModelSwitchTarget(current, models, variant)
          if (!target) {
            context.ui.toast.show({
              message: `No matching Fast/non-Fast model found${variant ? `; keeping ${variant}` : ""}`,
              variant: "warning",
            })
            return
          }
          if (!modelID || !providerID) throw new Error("No selected model")
          await switchPromptModel(context, sessionID, { modelID, providerID, variant }, target)
          refresh()
        } catch {
          context.ui.toast.show({ message: "Could not switch fast mode", variant: "error" })
        } finally {
          switchingModel = false
        }
      }
      const line = createMemo(() => {
        const sessionID = currentSession()
        return sessionID ? buildLine(sessionID) : buildStatusParts({}, options().items, quota(), shouldShowQuota(options(), selectedProvider())) as StatusPart[]
      })
      return (
        <Show when={line().length ? line() : undefined}>
          {(parts) => (
            <box flexDirection="column" flexShrink={1} minWidth={0}>
              <box flexDirection="row" flexWrap="wrap" flexShrink={1} minWidth={0}>
                <For each={parts()}>
                  {(part, index) => {
                    const isQuota = QUOTA_ITEMS.includes(part.item)
                    const isEffort = ["effortLow", "effortMedium", "effortHigh", "effortXhigh", "effortMax"].includes(part.tone)
                    return (
                      <>
                        <Show when={index() > 0}>
                          <text fg={options().useThemeColors ? context.theme.text.muted : context.theme.text.base}>{part.separator ?? options().separator}</text>
                        </Show>
                        <text
                          wrapMode={options().wrapMode}
                          fg={options().useThemeColors ? part.color ?? toneColor(part.tone) : context.theme.text.base}
                          onMouseUp={isQuota ? () => showQuotaUsage(context, quota)
                            : part.item === "fast-mode" ? () => void toggleFast()
                            : part.item === "agent" ? () => context.keymap.dispatch("agent.list")
                            : isEffort ? () => context.keymap.dispatch("variant.list")
                              : ["model", "model-with-reasoning"].includes(part.item)
                              ? () => context.keymap.dispatch("model.list") : undefined}
                        >
                          <Show when={part.item === "pet"} fallback={
                            <Show when={part.item === "run-state" && part.text === "Working"} fallback={part.text}>
                              <WorkingIndicator />
                            </Show>
                          }>
                            <FooterPet state={part.petState ?? "idle"} sessionID={currentSession() ?? ""} />
                          </Show>
                        </text>
                      </>
                    )
                  }}
                </For>
              </box>
            </box>
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
      if (petMoodTimer) clearTimeout(petMoodTimer)
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
