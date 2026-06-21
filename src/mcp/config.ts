import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * MCP connections — how one MCP install reaches many of your keys.
 *
 * Each connection is a (baseUrl, grant token) pair, i.e. one revocable, scoped grant
 * you minted for a provider. The MCP server never holds a real key; it holds these
 * grant tokens, so the capability model is unchanged — revoke a grant and that
 * connection stops working everywhere it's used.
 *
 * Resolution order:
 *   1. config file at $KEYVAULT_MCP_CONFIG or ~/.keyvault/mcp.json
 *   2. single-connection env vars (KEYVAULT_BASE_URL + KEYVAULT_GRANT_TOKEN)
 */
export interface Connection {
  baseUrl: string;
  token: string;
}
export type Connections = Record<string, Connection>;

export function configPath(): string {
  return process.env.KEYVAULT_MCP_CONFIG ?? join(homedir(), ".keyvault", "mcp.json");
}

export function loadConnections(): Connections {
  const path = configPath();
  if (existsSync(path)) {
    const parsed = parseConfig(readFileSync(path, "utf8"));
    if (Object.keys(parsed).length) return parsed;
  }

  const baseUrl = process.env.KEYVAULT_BASE_URL;
  const token = process.env.KEYVAULT_GRANT_TOKEN;
  if (baseUrl && token) {
    return { [process.env.KEYVAULT_CONNECTION_NAME ?? "default"]: { baseUrl, token } };
  }

  throw new Error(
    `No KeyVault connections. Create ${path} with a "connections" map, ` +
      "or set KEYVAULT_BASE_URL and KEYVAULT_GRANT_TOKEN.",
  );
}

/** Parse a config document into validated connections (ignores malformed entries). */
export function parseConfig(json: string): Connections {
  const raw = JSON.parse(json) as { connections?: Record<string, unknown> };
  const out: Connections = {};
  for (const [name, c] of Object.entries(raw.connections ?? {})) {
    const cc = c as Partial<Connection>;
    if (typeof cc?.baseUrl === "string" && typeof cc?.token === "string") {
      out[name] = { baseUrl: cc.baseUrl, token: cc.token };
    }
  }
  return out;
}

/** Pick a connection by name; auto-select when there's exactly one. */
export function resolveConnection(
  conns: Connections,
  name?: string,
): { name: string; conn: Connection } {
  const names = Object.keys(conns);
  if (name) {
    const conn = conns[name];
    if (!conn) throw new Error(`unknown connection "${name}". Available: ${names.join(", ") || "(none)"}`);
    return { name, conn };
  }
  if (names.length === 1) return { name: names[0]!, conn: conns[names[0]!]! };
  throw new Error(`multiple connections configured — specify one of: ${names.join(", ")}`);
}
