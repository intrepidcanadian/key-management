/**
 * Build the proxy request for an MCP tool call. Pure (no fetch) so it's testable.
 * The grant token goes in as a bearer credential — the agent never sees the real key.
 */
export interface RequestArgs {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export function buildForward(
  base: string,
  token: string,
  args: RequestArgs,
): { url: string; init: RequestInit } {
  const path = args.path.startsWith("/") ? args.path : "/" + args.path;
  const method = (args.method ?? "POST").toUpperCase();

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    ...(args.headers ?? {}),
  };

  let body: string | undefined;
  if (args.body !== undefined && method !== "GET" && method !== "HEAD") {
    if (typeof args.body === "string") {
      body = args.body;
    } else {
      body = JSON.stringify(args.body);
      if (!hasHeader(headers, "content-type")) headers["content-type"] = "application/json";
    }
  }

  return { url: base.replace(/\/$/, "") + path, init: { method, headers, body } };
}

function hasHeader(h: Record<string, string>, name: string): boolean {
  return Object.keys(h).some((k) => k.toLowerCase() === name.toLowerCase());
}
