import {
  type ScopeMatcher,
  type ScopeRequest,
  type ScopeDecision,
  allow,
  deny,
} from "./matcher.js";

/**
 * REST scope: an allowlist of {method, path} rules. Deny by default.
 *
 * Path patterns support `*` = exactly one path segment ([^/]*). So:
 *   /v1/charges/*  matches  /v1/charges/ch_123
 *   /v1/charges/*  does NOT match  /v1/charges-secret   (no slash boundary)
 *   /v1/charges/*  does NOT match  /v1/charges/ch_1/refunds  (second segment)
 *
 * SECURITY: the requested path is normalized BEFORE matching, so encoded/relative
 * tricks can't slip past the allowlist:
 *   - percent-decode once
 *   - collapse repeated slashes
 *   - resolve `.` and `..` segments; any escape above root => hard deny
 * This is the bypass surface. The test suite hammers it.
 */
export interface RestRule {
  method: string; // case-insensitive; "*" allows any method
  path: string; // normalized-path pattern, `*` = one segment
}
export interface RestScope {
  rules: RestRule[];
}

export class RestMatcher implements ScopeMatcher<RestScope> {
  readonly kind = "rest" as const;

  matches(req: ScopeRequest, scope: RestScope): ScopeDecision {
    const norm = normalizePath(req.path);
    if (norm === null) return deny("path escapes root after normalization");

    const method = req.method.toUpperCase();
    for (const rule of scope.rules ?? []) {
      const methodOk = rule.method === "*" || rule.method.toUpperCase() === method;
      if (methodOk && pathMatches(rule.path, norm)) {
        return allow(`matched ${rule.method} ${rule.path}`);
      }
    }
    return deny(`no rule allows ${method} ${norm}`);
  }
}

/**
 * Returns the canonical absolute path, or null if it tries to climb above root.
 * Query string is stripped (scope is on path only).
 */
export function normalizePath(raw: string): string | null {
  let path = raw;

  const q = path.indexOf("?");
  if (q !== -1) path = path.slice(0, q);
  const h = path.indexOf("#");
  if (h !== -1) path = path.slice(0, h);

  // Percent-decode once. Malformed encoding => deny.
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }

  if (!path.startsWith("/")) path = "/" + path;

  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null; // escaped above root
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return "/" + out.join("/");
}

function pathMatches(pattern: string, path: string): boolean {
  const re = new RegExp("^" + patternToRegex(pattern) + "$");
  return re.test(path);
}

function patternToRegex(pattern: string): string {
  // Escape everything, then turn the escaped `*` back into a single-segment match.
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.replace(/\\\*/g, "[^/]*");
}
