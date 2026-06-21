import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

/**
 * KeyWrapper supplies the 32-byte master key used to wrap data-encryption keys.
 *
 * The whole point of this interface is that WHERE the master key lives is a swap,
 * not a rewrite. Local uses the OS keychain (hardware-backed on macOS). Hosted will
 * implement KmsWrapper so the key material is never resident in the process.
 */
export interface KeyWrapper {
  /** Returns the 32-byte master key, creating it on first use if appropriate. */
  getMasterKey(): Promise<Uint8Array>;
  readonly name: string;
}

const KEY_LEN = 32;
const KEYCHAIN_SERVICE = "keyvault";
const KEYCHAIN_ACCOUNT = "master-key";

/**
 * macOS Keychain (via the `security` CLI). The master key is stored as a
 * base64 generic-password item, created on first run.
 */
export class KeychainWrapper implements KeyWrapper {
  readonly name = "keychain";

  async getMasterKey(): Promise<Uint8Array> {
    const existing = this.read();
    if (existing) return existing;
    const fresh = randomBytes(KEY_LEN);
    this.write(fresh);
    return fresh;
  }

  private read(): Uint8Array | null {
    try {
      const out = execFileSync(
        "security",
        ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      const buf = Buffer.from(out, "base64");
      if (buf.length !== KEY_LEN) throw new Error("stored master key has wrong length");
      return new Uint8Array(buf);
    } catch {
      return null; // not found
    }
  }

  private write(key: Uint8Array): void {
    const b64 = Buffer.from(key).toString("base64");
    execFileSync(
      "security",
      [
        "add-generic-password",
        "-s", KEYCHAIN_SERVICE,
        "-a", KEYCHAIN_ACCOUNT,
        "-w", b64,
        "-U", // update if exists
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
  }
}

/**
 * Portable fallback: master key from KEYVAULT_MASTER_KEY (base64, 32 bytes).
 * Weaker than the keychain (readable via env/process inspection) — intended for
 * CI, Linux dev, and tests. Not recommended for a real local vault.
 */
export class EnvMasterKey implements KeyWrapper {
  readonly name = "env";

  async getMasterKey(): Promise<Uint8Array> {
    const raw = process.env.KEYVAULT_MASTER_KEY;
    if (!raw) {
      throw new Error(
        "KEYVAULT_MASTER_KEY is not set. Set a base64-encoded 32-byte key, " +
          "or run on macOS to use the keychain.",
      );
    }
    const buf = Buffer.from(raw, "base64");
    if (buf.length !== KEY_LEN) {
      throw new Error("KEYVAULT_MASTER_KEY must decode to 32 bytes");
    }
    return new Uint8Array(buf);
  }
}

/**
 * Hosted master-key source. Stub until the hosted phase — the interface exists so
 * adding KMS is additive (see design doc: "hosted-ready").
 */
export class KmsWrapper implements KeyWrapper {
  readonly name = "kms";
  async getMasterKey(): Promise<Uint8Array> {
    throw new Error("KmsWrapper not implemented yet (hosted phase)");
  }
}

export interface MasterKeyStatus {
  source: "env" | "keychain" | "none";
  location: string;
  present: boolean;
}

/** Where the master key would come from, and whether it exists yet (no prompt). */
export function masterKeyStatus(): MasterKeyStatus {
  if (process.env.KEYVAULT_MASTER_KEY) {
    return { source: "env", location: "KEYVAULT_MASTER_KEY", present: true };
  }
  if (process.platform === "darwin") {
    let present = false;
    try {
      // Attribute lookup only (no -w) → no secret read, no keychain prompt.
      execFileSync(
        "security",
        ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT],
        { stdio: ["ignore", "ignore", "ignore"] },
      );
      present = true;
    } catch {
      present = false;
    }
    return {
      source: "keychain",
      location: `macOS Keychain (service=${KEYCHAIN_SERVICE}, account=${KEYCHAIN_ACCOUNT})`,
      present,
    };
  }
  return { source: "none", location: "set KEYVAULT_MASTER_KEY", present: false };
}

/** Pick a wrapper: explicit env override wins, else keychain on macOS. */
export function defaultWrapper(): KeyWrapper {
  if (process.env.KEYVAULT_MASTER_KEY) return new EnvMasterKey();
  if (process.platform === "darwin") return new KeychainWrapper();
  throw new Error(
    "No master-key source: set KEYVAULT_MASTER_KEY, or run on macOS for keychain support.",
  );
}
