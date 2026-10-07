/** Switch the server model without leaving the prompt's old local draft active. */
export async function switchPromptModel(context, sessionID, selected, target) {
  const sync = async () => {
    context.data.session.invalidate(sessionID)
    await context.data.session.sync(sessionID)
  }
  const active = () => {
    const route = context.ui.router.current()
    if (route.type !== "session" || route.sessionID !== sessionID) throw new Error("Session changed during model switch")
  }
  active()
  await sync()
  active()
  const committed = context.data.session.get(sessionID)?.model
  if (committed?.id !== selected.modelID || committed?.providerID !== selected.providerID ||
    committed?.variant !== selected.variant) {
    await context.client.session.switchModel({ sessionID, model: {
      id: selected.modelID, providerID: selected.providerID, variant: selected.variant,
    } })
    await sync()
    active()
  }
  // In OpenCode V2, setting the same variant as the committed selection clears
  // its local model draft. Otherwise that draft wins over server model changes.
  if (!context.ui.model.variant.set(selected.variant)) throw new Error("Could not release prompt model draft")
  await context.client.session.switchModel({ sessionID, model: target })
  await sync()
  active()
  const actual = context.ui.model.current()
  if (actual?.modelID !== target.id || actual?.providerID !== target.providerID || actual?.variant !== target.variant) {
    throw new Error("Prompt model selection did not change")
  }
}
