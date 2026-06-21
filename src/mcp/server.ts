/**
 * MCP server — the AGENT surface, and how you use KeyVault in any project.
 *
 * A thin client of the proxy. It holds grant tokens (never real keys) and exposes
 * tools so an agent can call your providers. One install can reach many keys via the
 * connections config (see config.ts). Everything the proxy enforces — scope, expiry,
 * revoke, spend, rate limit, audit — still applies.
 *
 * Configure once at ~/.keyvault/mcp.json:
 *   { "connections": { "qwen": { "baseUrl": "http://localhost:8787/qwen", "token": "gv_..." } } }
 * or single-connection via env (KEYVAULT_BASE_URL + KEYVAULT_GRANT_TOKEN).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildForward } from "./forward.js";
import { loadConnections, resolveConnection, type Connections } from "./config.js";

export function createMcpServer(connections: Connections): McpServer {
  const server = new McpServer({ name: "keyvault", version: "0.1.0" });
  const names = Object.keys(connections);

  server.tool(
    "list_connections",
    "List the KeyVault connections (granted providers) available to this project.",
    {},
    async () => ({
      content: [{ type: "text", text: names.length ? names.join("\n") : "(none configured)" }],
    }),
  );

  server.tool(
    "request",
    "Make an API call through KeyVault. The real API key is injected by the vault; " +
      "you only ever hold a revocable grant token. Scope, spend cap, rate limit, and " +
      "expiry are enforced by the vault.",
    {
      connection: z
        .string()
        .optional()
        .describe(`Which connection to use${names.length ? ` (one of: ${names.join(", ")})` : ""}`),
      path: z.string().describe("Upstream path, e.g. /v1/chat/completions"),
      method: z.string().optional().describe("HTTP method (default POST)"),
      body: z.any().optional().describe("Request body (an object is JSON-encoded)"),
      headers: z.record(z.string()).optional().describe("Extra headers"),
    },
    async (args) => {
      try {
        const { conn } = resolveConnection(connections, args.connection);
        const { url, init } = buildForward(conn.baseUrl, conn.token, args);
        const res = await fetch(url, init);
        const text = await res.text();
        return { content: [{ type: "text", text: `HTTP ${res.status}\n${text}` }], isError: !res.ok };
      } catch (err) {
        return { content: [{ type: "text", text: (err as Error).message }], isError: true };
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createMcpServer(loadConnections());
  await server.connect(new StdioServerTransport());
  console.error("keyvault MCP server ready (stdio)");
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
