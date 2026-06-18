import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "node:crypto";

/**
 * Envelope encryption for stored API keys.
 *
 *   plaintext --(DEK)--> ciphertext        (DEK = random per key)
 *   DEK       --(master)--> wrappedDek      (master = from KeyWrapper)
 *
 * The master key never encrypts user data directly. Each API key gets its own
 * data-encryption key (DEK); only the DEK is wrapped by the master key. This keeps
 * blast radius small and makes master-key rotation a re-wrap of DEKs, not a full
 * re-encrypt of every secret.
 *
 * Cipher: XChaCha20-Poly1305 (authenticated). A tampered ciphertext or wrong key
 * fails the Poly1305 tag and THROWS — it never returns silent garbage.
 */

const NONCE_LEN = 24; // XChaCha20 uses 24-byte nonces
const KEY_LEN = 32;

export interface SealedKey {
  ciphertext: Uint8Array; // the API key, encrypted under the DEK
  nonce: Uint8Array; // nonce for the ciphertext
  wrappedDek: Uint8Array; // dekNonce(24) || (DEK encrypted under master key)
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function sealApiKey(plaintext: string, masterKey: Uint8Array): SealedKey {
  assertKeyLen(masterKey);
  const dek = randomBytes(KEY_LEN);
  const nonce = randomBytes(NONCE_LEN);
  const ciphertext = xchacha20poly1305(dek, nonce).encrypt(enc.encode(plaintext));

  const dekNonce = randomBytes(NONCE_LEN);
  const wrapped = xchacha20poly1305(masterKey, dekNonce).encrypt(dek);
  const wrappedDek = concat(dekNonce, wrapped);

  return { ciphertext, nonce, wrappedDek };
}

export function openApiKey(sealed: SealedKey, masterKey: Uint8Array): string {
  assertKeyLen(masterKey);
  const dekNonce = sealed.wrappedDek.subarray(0, NONCE_LEN);
  const wrapped = sealed.wrappedDek.subarray(NONCE_LEN);
  // Throws on tamper / wrong master key (Poly1305 auth tag failure).
  const dek = xchacha20poly1305(masterKey, dekNonce).decrypt(wrapped);
  const plain = xchacha20poly1305(dek, sealed.nonce).decrypt(sealed.ciphertext);
  return dec.decode(plain);
}

function assertKeyLen(key: Uint8Array): void {
  if (key.length !== KEY_LEN) {
    throw new Error(`master key must be ${KEY_LEN} bytes, got ${key.length}`);
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export const _internal = { NONCE_LEN, KEY_LEN };
