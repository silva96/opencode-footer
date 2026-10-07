/** Match OpenCode's agent names and categorical color assignment. */
export function agentDisplay(agentID, agents, theme) {
  if (!agentID) return {}
  const agent = agents.find((value) => value.id === agentID)
  const name = (agent?.name ?? agentID)
    .replace(/(^|[-_\s])([a-z])/g, (_, separator, letter) => `${separator}${letter.toUpperCase()}`)
  const visible = agents.filter((value) => !value.hidden)
  const index = visible.findIndex((value) => value.id === agentID)
  const colors = []
  for (const scale of theme.categorical ?? []) {
    const color = scale[200]
    if (color !== undefined && !colors.some((value) => value === color || value.equals?.(color))) colors.push(color)
  }
  const color = index < 0 ? colors[0] : agent?.color ?? (colors.length ? colors[index % colors.length] : undefined)
  return { name, color: color ?? theme.syntax.type }
}
