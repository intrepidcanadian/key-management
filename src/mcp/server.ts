/**
 * MCP server — the AGENT surface.
 *
 * A thin client of the proxy. It holds a grant token internally (from env) and
 * exposes one tool, `request`, that forwards calls through the vault. The agent gets
 * capability; it never sees the real key or the token. Everything the proxy enforces
 * (scope, expiry, revoke, spend, audit) applies unchanged — this adds no new trust.
 *
 * Run it (after `keyvault share ... --as agent`):
 *   KEYVAULT_BASE_URL=http://localhost:8787/openai \
 *   KEYVAULT_GRANT_TOKEN=gv_... \
 *   npm run mcp
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildForward } from "./forward.js";

export interface McpConfig {
  baseUrl: string;
  grantToken: string;
}

export function createMcpServer(cfg: McpConfig): McpServer {
  const server = new McpServer({ name: "keyvault", version: "0.1.0" });

  server.tool(
    "request",
    "Make an API call through your granted KeyVault access. The real API key is " +
      "injected by the vault; you only ever hold a revocable grant token.",
    {
      path: z.string().describe("Upstream path, e.g. /v1/chat/completions"),
      method: z.string().optional().describe("HTTP method (default POST)"),
      body: z.any().optional().describe("Request body (object is JSON-encoded)"),
      headers: z.record(z.string()).optional().describe("Extra headers"),
    },
    async (args) => {
      const { url, init } = buildForward(cfg.baseUrl, cfg.grantToken, args);
      try {
        const res = await fetch(url, init);
        const text = await res.text();
        return {
          content: [{ type: "text", text: `HTTP ${res.status}\n${text}` }],
          isError: !res.ok,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `request failed: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

export function configFromEnv(): McpConfig {
  const baseUrl = process.env.KEYVAULT_BASE_URL;
  const grantToken = process.env.KEYVAULT_GRANT_TOKEN;
  if (!baseUrl || !grantToken) {
    throw new Error(
      "Set KEYVAULT_BASE_URL and KEYVAULT_GRANT_TOKEN (from `keyvault share ... --as agent`).",
    );
  }
  return { baseUrl, grantToken };
}

async function main(): Promise<void> {
  const server = createMcpServer(configFromEnv());
  await server.connect(new StdioServerTransport());
  console.error("keyvault MCP server ready (stdio)");
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
