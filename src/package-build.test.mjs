import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import test from "node:test"

test("published JSX and imports use the host runtime instead of installed peers", async () => {
  execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: new URL("../", import.meta.url) })
  const packageJSON = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  assert.equal(packageJSON.exports["./tui"], "./dist/tui.js")
  assert.ok(packageJSON.files.includes("dist"))
  for (const file of ["tui.js", "configurator.js"]) {
    const code = await readFile(new URL(`../dist/${file}`, import.meta.url), "utf8")
    assert.match(code, /from "opentui:runtime-module:solid-js"/)
    assert.match(code, /from "opentui:runtime-module:%40opentui%2Fsolid"/)
    assert.doesNotMatch(code, /from ["'](?:solid-js|@opentui\/solid|@opencode\/plugin\/tui)["']/)
    assert.doesNotMatch(code, /<\/?(?:box|text|span|For|Show)\b/)
    assert.doesNotMatch(code, /useTerminalDimensions/)
  }
  const entrypoint = await readFile(new URL("../dist/tui.js", import.meta.url), "utf8")
  assert.match(entrypoint, /from "opentui:runtime-module:%40opencode%2Fplugin%2Ftui"/)
  assert.match(entrypoint, /from "\.\/configurator\.js"/)
  for (const name of await readdir(new URL("./", import.meta.url))) {
    if (!name.endsWith(".mjs") || name.endsWith(".test.mjs")) continue
    const source = await readFile(new URL(name, import.meta.url), "utf8")
    const packed = await readFile(new URL(`../dist/${name}`, import.meta.url), "utf8")
    assert.equal(packed, source, `${name} must be shipped alongside the compiled entrypoint`)
  }
})
