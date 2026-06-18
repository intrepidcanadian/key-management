import { describe, it, expect } from "vitest";
import { RestMatcher, normalizePath, type RestScope } from "./rest.js";

const m = new RestMatcher();
const scope: RestScope = {
  rules: [
    { method: "GET", path: "/v1/charges/*" },
    { method: "POST", path: "/v1/customers" },
  ],
};
const ok = (method: string, path: string, model?: string) =>
  m.matches({ method, path, model }, scope).allow;

describe("RestMatcher — allow / deny-by-default", () => {
  it("allows a listed method+path", () => {
    expect(ok("GET", "/v1/charges/ch_123")).toBe(true);
    expect(ok("POST", "/v1/customers")).toBe(true);
  });

  it("denies an unlisted path", () => {
    expect(ok("GET", "/v1/refunds")).toBe(false);
  });

  it("denies a listed path with the wrong method", () => {
    expect(ok("DELETE", "/v1/charges/ch_123")).toBe(false);
    expect(ok("GET", "/v1/customers")).toBe(false);
  });

  it("denies everything with an empty ruleset", () => {
    expect(new RestMatcher().matches({ method: "GET", path: "/" }, { rules: [] }).allow).toBe(
      false,
    );
  });
});

describe("RestMatcher — wildcard boundaries", () => {
  it("matches exactly one segment", () => {
    expect(ok("GET", "/v1/charges/ch_123")).toBe(true);
  });
  it("does NOT cross a slash boundary (prefix attack)", () => {
    expect(ok("GET", "/v1/charges-secret")).toBe(false);
  });
  it("does NOT match a deeper second segment", () => {
    expect(ok("GET", "/v1/charges/ch_123/refunds")).toBe(false);
  });
});

describe("RestMatcher — normalization bypass attempts (all denied)", () => {
  it("denies ../ traversal into a forbidden route", () => {
    expect(ok("GET", "/v1/charges/../refunds")).toBe(false);
  });
  it("denies percent-encoded traversal (%2e%2e)", () => {
    expect(ok("GET", "/v1/charges/%2e%2e/refunds")).toBe(false);
  });
  it("denies escaping above root", () => {
    expect(ok("GET", "/../../etc/passwd")).toBe(false);
  });
  it("normalizes double slashes and still matches the right rule", () => {
    expect(ok("GET", "/v1//charges/ch_123")).toBe(true);
  });
  it("ignores the query string when matching", () => {
    expect(ok("POST", "/v1/customers?expand=foo")).toBe(true);
  });
  it("denies malformed percent-encoding", () => {
    expect(ok("GET", "/v1/charges/%zz")).toBe(false);
  });
});

describe("normalizePath", () => {
  it("collapses . and resolves ..", () => {
    expect(normalizePath("/a/./b/../c")).toBe("/a/c");
  });
  it("returns null when climbing above root", () => {
    expect(normalizePath("/a/../../b")).toBeNull();
  });
  it("strips query and hash", () => {
    expect(normalizePath("/a/b?x=1#y")).toBe("/a/b");
  });
});
