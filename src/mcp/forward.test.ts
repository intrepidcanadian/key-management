import { describe, it, expect } from "vitest";
import { buildForward } from "./forward.js";

const base = "http://localhost:8787/openai";
const token = "gv_abc";

describe("buildForward", () => {
  it("joins base + path and attaches the bearer token", () => {
    const { url, init } = buildForward(base, token, { path: "/v1/chat/completions" });
    expect(url).toBe("http://localhost:8787/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer gv_abc");
  });

  it("adds a leading slash and trims a trailing one on base", () => {
    const { url } = buildForward(base + "/", token, { path: "v1/models" });
    expect(url).toBe("http://localhost:8787/openai/v1/models");
  });

  it("serializes an object body and sets content-type", () => {
    const { init } = buildForward(base, token, { path: "/x", body: { model: "gpt-5" } });
    expect(init.body).toBe('{"model":"gpt-5"}');
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("passes a string body through unchanged", () => {
    const { init } = buildForward(base, token, { path: "/x", body: "raw" });
    expect(init.body).toBe("raw");
  });

  it("never sends a body on GET", () => {
    const { init } = buildForward(base, token, { method: "GET", path: "/v1/models", body: { a: 1 } });
    expect(init.body).toBeUndefined();
    expect(init.method).toBe("GET");
  });

  it("defaults to POST", () => {
    expect(buildForward(base, token, { path: "/x" }).init.method).toBe("POST");
  });
});
