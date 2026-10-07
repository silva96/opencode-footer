import assert from "node:assert/strict"
import test from "node:test"
import { ADVANCED_SETTINGS, configFile, parseSetting, settingsFromOptions, settingsKey } from "./settings.mjs"

test("settings use portable defaults and normalize supplied plugin options", () => {
  const defaults = settingsFromOptions()
  assert.equal(defaults.codexHome.endsWith("/.codex"), true)
  assert.equal(defaults.wrapMode, "word")
  assert.ok(defaults.items.includes("model-with-reasoning"))

  const configured = settingsFromOptions({ codexHome: "~/.codex-profe", items: ["agent"], useThemeColors: false })
  assert.equal(configured.codexHome.endsWith("/.codex-profe"), true)
  assert.deepEqual(configured.items, ["agent"])
  assert.equal(configured.useThemeColors, false)
})

test("settings keys isolate configuration paths and inline plugin registrations", () => {
  assert.notEqual(settingsKey("/a/cli.json", {}), settingsKey("/b/cli.json", {}))
  assert.equal(settingsKey("/a/cli.json", {}), settingsKey("/a/cli.json", { OPENCODE_CLI_CONFIG_CONTENT: '{"theme":{"name":"other"}}' }))
  assert.notEqual(settingsKey("/a/cli.json", {}), settingsKey("/a/cli.json", { OPENCODE_CLI_CONFIG_CONTENT: '{"plugins":["opencode-footer"]}' }))
  assert.equal(configFile({}, "/example"), "/example/.config/opencode/cli.json")
  assert.equal(configFile({ XDG_CONFIG_HOME: "/xdg" }, "/example"), "/xdg/opencode/cli.json")
  assert.equal(configFile({ OPENCODE_CONFIG_DIR: "/profile", XDG_CONFIG_HOME: "/xdg" }), "/profile/cli.json")
})

test("advanced edits validate values and preserve other saved settings", () => {
  const settings = settingsFromOptions({ items: ["model-with-reasoning"] })
  assert.deepEqual(parseSetting(settings, "quotaProviders", " custom, openai ").quotaProviders, ["custom", "openai"])
  assert.deepEqual(parseSetting(settings, "quotaProviders", "").quotaProviders, [])
  assert.equal(parseSetting(settings, "separator", "").separator, "")
  assert.deepEqual(parseSetting(settings, "wrapMode", "char").items, settings.items)
  assert.ok(ADVANCED_SETTINGS.some((setting) => setting.id === "useThemeColors"))
  assert.equal(parseSetting(settings, "useThemeColors", "false").useThemeColors, false)
  assert.equal(parseSetting(settings, "useThemeColors", "true").useThemeColors, true)
  assert.deepEqual(parseSetting(settings, "useThemeColors", "false").items, settings.items)
  assert.throws(() => parseSetting(settings, "useThemeColors", "invalid"), TypeError)
  for (const [id, value] of [["refreshIntervalMs", "999"], ["requestTimeoutMs", "bad"], ["wrapMode", "invalid"], ["codexHome", "relative"], ["codexCommand", ""], ["unknown", "x"]]) assert.throws(() => parseSetting(settings, id, value), TypeError)
})
