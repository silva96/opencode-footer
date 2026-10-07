import { transformAsync } from "@babel/core"
import typescript from "@babel/preset-typescript"
import solid from "babel-preset-solid"
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)
const runtime = (specifier) => `opentui:runtime-module:${encodeURIComponent(specifier)}`
const shared = new Set(["solid-js", "@opencode/plugin/tui", "@opentui/solid"])

// OpenCode's runtime JSX transform skips node_modules. Compile JSX before
// publishing, and resolve both Solid and generated render helpers to the host.
const hostImports = () => ({
  visitor: {
    ImportDeclaration(path) {
      const source = path.node.source
      if (shared.has(source.value)) source.value = runtime(source.value)
      if (source.value === "./configurator") source.value = "./configurator.js"
    },
  },
})

await mkdir(new URL("dist/", root), { recursive: true })
for (const name of await readdir(new URL("src/", root))) {
  if (name.endsWith(".test.mjs")) continue
  const source = new URL(`src/${name}`, root)
  if (name.endsWith(".mjs")) {
    await copyFile(source, new URL(`dist/${name}`, root))
  } else if (name.endsWith(".tsx")) {
    const result = await transformAsync(await readFile(source, "utf8"), {
      filename: fileURLToPath(source),
      configFile: false,
      babelrc: false,
      plugins: [hostImports],
      presets: [
        [solid, { generate: "universal", moduleName: runtime("@opentui/solid") }],
        [typescript, { onlyRemoveTypeImports: true }],
      ],
    })
    await writeFile(new URL(`dist/${name.replace(/\.tsx$/, ".js")}`, root), `${result.code}\n`)
  }
}
