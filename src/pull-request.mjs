import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)
let ghAvailable = true

export async function readPullRequest(directory, branch, signal) {
  if (!ghAvailable) return
  try {
    const { stdout } = await run("gh", ["pr", "view", branch, "--json", "number,url,state"], {
      cwd: directory, encoding: "utf8", timeout: 10_000, signal,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    })
    const pr = JSON.parse(stdout)
    if (pr.state === "OPEN") return { number: pr.number, url: pr.url }
  } catch (error) {
    if (error.code === "ENOENT") ghAvailable = false
  }
}
