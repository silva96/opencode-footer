/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, untrack } from "solid-js"
import {
  createDraft, draftOptions, draftPreferences, moveDraft, searchDraftOptions, toggleDraft,
} from "./statusline-config.mjs"
import type { Context } from "@opencode/plugin/tui/context"
import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core"
import { ADVANCED_SETTINGS, parseSetting } from "./settings.mjs"
import { quotaDetails } from "./codex-quota.mjs"
import { observeRendererSize } from "./renderer-size.mjs"

type Preferences = { items: string[] }

export function showQuotaUsage(context: Context, quota: () => Parameters<typeof quotaDetails>[0]) {
  context.ui.dialog.show(() => {
    onMount(() => context.ui.dialog.set({ size: "large", centered: true }))
    const rows = createMemo(() => quotaDetails(quota()))
    const labelWidth = createMemo(() => Math.max(0, ...rows().map((row) => row.label.length)) + 3)
    context.keymap.layer(() => ({
      mode: "global", priority: 100,
      commands: [
        { bind: "escape", run: () => context.ui.dialog.clear() },
        { bind: "return", run: () => context.ui.dialog.clear() },
      ],
    }))
    return (
      <box padding={1} gap={1}>
        <text fg={context.theme.text.base}>Codex Usage</text>
        <box>
          <For each={rows()} fallback={<text fg={context.theme.text.muted}>Quota data unavailable</text>}>
            {(row) => (
              <text wrapMode="word">
                <span style={{ fg: context.theme.text.muted }}>{row.label.padEnd(labelWidth())}</span>
                <span style={{ fg: context.theme.text.base }}>{row.remaining === null ? "—" : "["}</span>
                <span style={{ fg: context.theme.text.base }}>{row.filled}</span>
                <span style={{ fg: context.theme.text.muted }}>{row.empty}</span>
                <span style={{ fg: context.theme.text.base }}>{row.remaining === null ? "" : `] ${row.remaining}% left`}</span>
                <span style={{ fg: context.theme.text.muted }}>{row.reset}{row.stale ? " (stale)" : ""}</span>
              </text>
            )}
          </For>
        </box>
        <text fg={context.theme.text.muted} onMouseUp={() => context.ui.dialog.clear()}>enter/esc close</text>
      </box>
    )
  })
}

export async function configureStatusLine(
  context: Context,
  preferences: Preferences,
  save: (preferences: Preferences) => Promise<void>,
  advanced: () => Promise<void>,
) {
  await new Promise<void>((closed) => {
    context.ui.dialog.show(() => {
      // show() resets dialog sizing, so set it after the dialog is mounted.
      onMount(() => context.ui.dialog.set({ size: "large", centered: true }))
      const [draft, setDraft] = createSignal(createDraft(preferences))
      // Don't subscribe the dialog's render factory to its editable draft.
      let committed = untrack(draft)
      let writes = Promise.resolve()
      let pendingWrites = 0
      const [query, setQuery] = createSignal("")
      const [selected, setSelected] = createSignal(preferences.items[0] ?? "agent")
      const [saving, setSaving] = createSignal(false)
      // Installed OpenTUI peers can have a different RendererContext from the host.
      const [dimensions, setDimensions] = createSignal({ width: context.renderer.width, height: context.renderer.height })
      onCleanup(observeRendererSize(context.renderer, setDimensions))
      const options = createMemo(() => searchDraftOptions(query(), draftOptions(draft())))
      const index = createMemo(() => Math.max(0, options().findIndex((option) => option.value === selected())))
      const current = () => options()[index()]?.value
      const [input, setInput] = createSignal<InputRenderable>()
      const [list, setList] = createSignal<ScrollBoxRenderable>()
      const apply = (next: ReturnType<typeof createDraft>) => {
        if (next === draft()) return
        setDraft(next)
        pendingWrites += 1
        setSaving(true)
        writes = writes.then(async () => {
          try {
            await save(draftPreferences(next))
            committed = next
          } catch {
            if (draft() === next) setDraft(committed)
            context.ui.toast.show({ message: "Could not save status line settings", variant: "error" })
          }
        }).finally(() => {
          pendingWrites -= 1
          if (!pendingWrites) setSaving(false)
        })
      }
      const toggleSelected = () => {
        const id = current()
        if (id) void apply(toggleDraft(draft(), id))
      }
      const moveSelected = (direction: number) => {
        const id = current()
        if (id) void apply(moveDraft(draft(), id, direction))
      }
      const revealSelection = () => {
        const id = current()
        const viewport = list()
        if (id && viewport) queueMicrotask(() => {
          if (!viewport.isDestroyed) viewport.scrollChildIntoView(`footer-item.${id}`)
        })
      }
      createEffect(() => {
        dimensions()
        revealSelection()
      })
      const navigate = (direction: number) => {
        const next = options()[Math.max(0, Math.min(options().length - 1, index() + direction))]
        if (next) setSelected(next.value)
      }
      context.keymap.layer(() => ({
        mode: "global",
        target: input,
        priority: 100,
        commands: [
          { bind: "up", run: () => navigate(-1) },
          { bind: "down", run: () => navigate(1) },
          { bind: "space", run: toggleSelected },
          { bind: "left", run: () => moveSelected(-1) },
          { bind: "right", run: () => moveSelected(1) },
          { bind: "escape", run: () => { if (!saving()) context.ui.dialog.clear() } },
          { bind: "ctrl+s", run: () => { if (!saving()) void advanced() } },
          { bind: "return", run: toggleSelected },
        ],
      }))
      return (
        <box padding={1} gap={1}>
          <text fg={context.theme.text.base}>Footer Items</text>
          <text fg={context.theme.text.muted}>Select which items to display in the footer.</text>
          <input ref={setInput} focused placeholder="Type to search"
            onInput={(value) => { setQuery(value); setSelected("") }} />
          <scrollbox ref={setList} height={Math.max(3, Math.min(20, dimensions().height - 16))} scrollX={false} scrollY>
            <For each={options()}>{(option) => (
              <text id={`footer-item.${option.value}`} wrapMode="word" flexShrink={0}
                onSizeChange={() => { if (option.value === current()) revealSelection() }}
                onMouseUp={() => { setSelected(option.value); void apply(toggleDraft(draft(), option.value)) }}>
                <span style={{ fg: option.value === current() ? context.theme.text.feedback.info.base : context.theme.text.base }}>
                  {option.value === current() ? "› " : "  "}{option.title}
                </span>
                <span style={{ fg: context.theme.text.muted }}>  {option.description}</span>
              </text>
            )}</For>
          </scrollbox>
          <text fg={context.theme.text.muted}>{options().length ? `${index() + 1}/${options().length}` : "No matching items"}</text>
          <text fg={context.theme.text.muted}>enter/space toggle · ←/→ reorder</text>
          <text fg={context.theme.text.muted}>changes apply immediately · esc close · ctrl+s settings</text>
        </box>
      )
    }, closed)
  })
}

export async function configureSettings(context: Context, current: () => Record<string, any>, save: (settings: Record<string, any>) => Promise<void>) {
  while (true) {
    const id = await context.ui.dialog.select<string>({
      title: "Footer Settings",
      options: ADVANCED_SETTINGS.map((setting) => ({
        value: setting.id, title: setting.title, description: setting.description,
        footer: Array.isArray(current()[setting.id]) ? current()[setting.id].join(", ") : String(current()[setting.id]),
      })),
    })
    if (id === undefined) return
    if (id === "useThemeColors") {
      try {
        await save({ useThemeColors: !current().useThemeColors })
      } catch {
        context.ui.toast.show({ message: "Could not save status line settings", variant: "error" })
      }
      continue
    }
    const existing = current()[id]
    const value = await context.ui.dialog.prompt({
      title: ADVANCED_SETTINGS.find((setting) => setting.id === id)!.title,
      description: ADVANCED_SETTINGS.find((setting) => setting.id === id)!.description,
      value: Array.isArray(existing) ? existing.join(", ") : String(existing),
    })
    if (value === undefined) continue
    try {
      const next = parseSetting(current(), id, value)
      // Save only this field so simultaneous changes in another TUI are retained.
      await save({ [id]: next[id] })
      context.ui.toast.show({ message: "Status line setting saved", variant: "success" })
    } catch (error) {
      context.ui.toast.show({ message: error instanceof TypeError ? error.message : "Could not save status line settings", variant: "error" })
    }
  }
}
