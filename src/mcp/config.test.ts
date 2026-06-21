import { describe, it, expect } from "vitest";
import { parseConfig, resolveConnection } from "./config.js";

describe("parseConfig", () => {
  it("reads valid connections", () => {
    const c = parseConfig(
      JSON.stringify({ connections: { qwen: { baseUrl: "http://x/qwen", token: "gv_1" } } }),
    );
    expect(c).toEqual({ qwen: { baseUrl: "http://x/qwen", token: "gv_1" } });
  });
  it("drops malformed entries", () => {
    const c = parseConfig(
      JSON.stringify({ connections: { ok: { baseUrl: "u", token: "t" }, bad: { baseUrl: "u" } } }),
    );
    expect(Object.keys(c)).toEqual(["ok"]);
  });
  it("handles a missing connections map", () => {
    expect(parseConfig("{}")).toEqual({});
  });
});

describe("resolveConnection", () => {
  const conns = {
    qwen: { baseUrl: "http://x/qwen", token: "gv_q" },
    openai: { baseUrl: "http://x/openai", token: "gv_o" },
  };
  it("selects by name", () => {
    expect(resolveConnection(conns, "qwen").conn.token).toBe("gv_q");
  });
  it("auto-selects the only connection", () => {
    expect(resolveConnection({ solo: conns.qwen }).name).toBe("solo");
  });
  it("requires a name when several exist", () => {
    expect(() => resolveConnection(conns)).toThrow(/specify one/);
  });
  it("errors on an unknown name", () => {
    expect(() => resolveConnection(conns, "nope")).toThrow(/unknown connection/);
  });
});
