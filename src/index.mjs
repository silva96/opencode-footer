import { parseQuotaWindows } from "./codex-quota.mjs"
import { FooterQuota } from "./quota-rpc.mjs"

export default {
  id: "opencode-footer.server",
  async setup(context) {
    await context.rpc.register(FooterQuota, {
      read: async (_, { signal }) => {
        let account = null
        try {
          const connection = await context.integration.connection.active("openai")
          if (connection?.type !== "credential" || connection.method !== "oauth") {
            return { account, windows: [] }
          }
          account = connection.id
          // OpenCode resolves and refreshes its own OAuth credential.
          const credential = await context.integration.connection.resolve(connection)
          const accountID = credential?.metadata?.accountID
          if (credential?.type !== "oauth" || !credential.access || typeof accountID !== "string" || !accountID) {
            return { account, windows: [] }
          }
          const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
            headers: {
              Authorization: `Bearer ${credential.access}`,
              "ChatGPT-Account-Id": accountID,
              Accept: "application/json",
              Origin: "https://chatgpt.com",
              Referer: "https://chatgpt.com/",
              "User-Agent": "Mozilla/5.0",
            },
            signal,
          })
          if (!response.ok) return { account, windows: null }
          return { account, windows: parseQuotaWindows(await response.json()) }
        } catch {
          // Never send credentials or upstream error bodies to the terminal.
          return { account, windows: null }
        }
      },
    })
  },
}
