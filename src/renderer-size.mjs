// Use the host's renderer directly, not a package-local OpenTUI context hook.
export function observeRendererSize(renderer, update) {
  const resize = (width, height) => update({ width, height })
  renderer.on("resize", resize)
  resize(renderer.width, renderer.height)
  return () => renderer.off("resize", resize)
}
