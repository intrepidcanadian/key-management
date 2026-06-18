/**
 * MCP server — the AGENT surface (stub).
 *
 * Design: the MCP server is just another client of the proxy. It holds a grant
 * token internally and exposes the upstream API as MCP tools, so the agent calls
 * e.g. `openai.chat(...)` and never sees a token or a URL.
 *
 * Planned shape (see design doc), implemented in the agent-surface milestone:
 *
 *   const grantToken = process.env.KEYVAULT_GRANT_TOKEN
 *   const base       = process.env.KEYVAULT_BASE_URL   // e.g. http://localhost:8787/openai
 *   server.tool("chat", schema, async (args) => {
 *     const r = await fetch(`${base}/v1/chat/completions`, {
 *       method: "POST",
 *       headers: { authorization: `Bearer ${grantToken}`, "content-type": "application/json" },
 *       body: JSON.stringify(args),
 *     })
 *     return { content: [{ type: "text", text: await r.text() }] }
 *   })
 *
 * Everything the proxy already enforces (scope, expiry, revoke, spend, audit) applies
 * unchanged — the MCP server adds no new trust, it just speaks MCP instead of HTTP.
 */
export function notImplemented(): never {
  throw new Error(
    "MCP server not implemented yet. The proxy is the source of truth; the MCP server " +
      "will be a thin client of it (see src/mcp/server.ts header).",
  );
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  console.log("keyvault MCP server is a stub — see the agent-surface milestone in TODOS/design doc.");
}
