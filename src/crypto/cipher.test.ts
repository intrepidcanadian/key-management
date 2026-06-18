import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { sealApiKey, openApiKey } from "./cipher.js";

const master = () => new Uint8Array(randomBytes(32));

describe("envelope cipher", () => {
  it("round-trips a secret", () => {
    const m = master();
    const sealed = sealApiKey("sk-test-123", m);
    expect(openApiKey(sealed, m)).toBe("sk-test-123");
  });

  it("never stores the plaintext in the ciphertext", () => {
    const sealed = sealApiKey("sk-secret-value", master());
    const asText = Buffer.from(sealed.ciphertext).toString("utf8");
    expect(asText).not.toContain("sk-secret-value");
  });

  it("fails closed with the wrong master key", () => {
    const sealed = sealApiKey("sk-test-123", master());
    expect(() => openApiKey(sealed, master())).toThrow();
  });

  it("rejects a tampered ciphertext (no silent garbage)", () => {
    const m = master();
    const sealed = sealApiKey("sk-test-123", m);
    sealed.ciphertext[0] ^= 0xff; // flip a byte
    expect(() => openApiKey(sealed, m)).toThrow();
  });

  it("rejects a tampered wrapped DEK", () => {
    const m = master();
    const sealed = sealApiKey("sk-test-123", m);
    sealed.wrappedDek[sealed.wrappedDek.length - 1] ^= 0xff;
    expect(() => openApiKey(sealed, m)).toThrow();
  });

  it("rejects a master key of the wrong length", () => {
    expect(() => sealApiKey("x", new Uint8Array(16))).toThrow();
  });
});
