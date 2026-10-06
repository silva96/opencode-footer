/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, onMount } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import {
  createDraft, draftOptions, draftPreferences, moveDraft, searchDraftOptions, toggleDraft,
} from "./statusline-config.mjs"
import type { Context } from "@opencode/plugin/tui/context"
import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core"
import { ADVANCED_SETTINGS, parseSetting } from "./settings.mjs"

type Preferences = { items: string[]; useThemeColors: boolean }

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
      const [query, setQuery] = createSignal("")
      const [selected, setSelected] = createSignal("use-theme-colors")
      const [saving, setSaving] = createSignal(false)
      const dimensions = useTerminalDimensions()
      const options = createMemo(() => searchDraftOptions(query(), draftOptions(draft())))
      const index = createMemo(() => Math.max(0, options().findIndex((option) => option.value === selected())))
      const current = () => options()[index()]?.value
      const [input, setInput] = createSignal<InputRenderable>()
      const [list, setList] = createSignal<ScrollBoxRenderable>()
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
          { bind: "space", run: () => { if (current()) setDraft((value) => toggleDraft(value, current())) } },
          { bind: "left", run: () => { if (current()) setDraft((value) => moveDraft(value, current(), -1)) } },
          { bind: "right", run: () => { if (current()) setDraft((value) => moveDraft(value, current(), 1)) } },
          { bind: "escape", run: () => { if (!saving()) context.ui.dialog.clear() } },
          { bind: "ctrl+s", run: () => { if (!saving()) void advanced() } },
          { bind: "return", run: async () => {
            if (saving()) return
            setSaving(true)
            try {
              await save(draftPreferences(draft()))
              context.ui.dialog.clear()
              context.ui.toast.show({ message: "Status line saved", variant: "success" })
            } catch {
              setSaving(false)
              context.ui.toast.show({ message: "Could not save status line settings", variant: "error" })
            }
          } },
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
                onMouseUp={() => { setSelected(option.value); setDraft((value) => toggleDraft(value, option.value)) }}>
                <span style={{ fg: option.value === current() ? context.theme.text.feedback.info.base : context.theme.text.base }}>
                  {option.value === current() ? "› " : "  "}{option.title}
                </span>
                <span style={{ fg: context.theme.text.muted }}>  {option.description}</span>
              </text>
            )}</For>
          </scrollbox>
          <text fg={context.theme.text.muted}>{options().length ? `${index() + 1}/${options().length}` : "No matching items"}</text>
          <text fg={context.theme.text.muted}>space toggle · ←/→ reorder</text>
          <text fg={context.theme.text.muted}>enter save · esc cancel · ctrl+s settings</text>
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
