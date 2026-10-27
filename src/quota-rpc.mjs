// A portable RPC definition needs no runtime imports in the terminal plugin.
export const FooterQuota = {
  id: "opencode-footer.quota",
  methods: {
    read: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        properties: {
          account: { type: ["string", "null"] },
          windows: {
            type: ["array", "null"],
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                remaining: { type: "number" },
                resetsAt: { type: ["number", "null"] },
              },
              required: ["label", "remaining", "resetsAt"],
              additionalProperties: false,
            },
          },
        },
        required: ["account", "windows"],
        additionalProperties: false,
      },
    },
  },
  events: {},
}
