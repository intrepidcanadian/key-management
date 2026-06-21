#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, existsSync } from "node:fs";
import { getDb, vaultDbPath } from "../store/db.js";
import { defaultWrapper, masterKeyStatus } from "../crypto/wrapper.js";
import { configPath } from "../mcp/config.js";
import {
  addKey,
  listKeys,
  createGrant,
  listGrants,
  revokeGrant,
  listAudit,
  getKey,
  rotateKey,
} from "../store/repo.js";
import { getProvider, PROVIDERS } from "../providers.js";

const program = new Command();
program.name("keyvault").description("Revocable, shareable API-key access").version("0.1.0");

program
  .command("add-key")
  .description("Store an API key (encrypted at rest)")
  .argument("<provider>", `one of: ${Object.keys(PROVIDERS).join(", ")}`)
  .requiredOption("-l, --label <label>", "a name for this key")
  .option("-k, --key <value>", "the secret (omit to read from stdin — safer)")
  .action(async (provider: string, opts: { label: string; key?: string }) => {
    if (!getProvider(provider)) fail(`unknown provider: ${provider}`);
    const plaintext = opts.key ?? readFileSync(0, "utf8").trim();
    if (!plaintext) fail("no key provided");
    const master = await defaultWrapper().getMasterKey();
    const row = addKey(getDb(), { provider, label: opts.label, plaintext, masterKey: master });
    console.log(`stored key ${row.id}  (${provider} / ${opts.label})`);
  });

program
  .command("share")
  .description("Mint a revocable, scoped, expiring grant")
  .argument("<keyId>", "id of the key to share")
  .requiredOption("-t, --to <label>", "who/what gets access")
  .option("-a, --as <type>", "grantee type: agent | human", "agent")
  .option("--models <list>", "LLM: comma-separated model allowlist (or '*')")
  .option("--cap <cents>", "LLM: spend cap in cents")
  .option("--allow <rule...>", 'REST: "METHOD /path/*" (repeatable)')
  .option("--rate <n>", "max requests per minute (omit = unlimited)")
  .option("-e, --expires <dur>", "e.g. 1h, 30m, 7d (omit = no expiry)")
  .action((keyId: string, opts) => {
    const db = getDb();
    const key = getKey(db, keyId);
    if (!key) fail(`no key with id ${keyId}`);
    const provider = getProvider(key.provider)!;

    const scope =
      provider.kind === "llm"
        ? {
            models: (opts.models ?? "*").split(",").map((s: string) => s.trim()),
            ...(opts.cap ? { spendCapCents: Number(opts.cap) } : {}),
          }
        : { rules: (opts.allow ?? []).map(parseRule) };

    const { grant, token } = createGrant(db, {
      keyId,
      granteeLabel: opts.to,
      granteeType: opts.as === "human" ? "human" : "agent",
      scope,
      spendCapCents: opts.cap ? Number(opts.cap) : undefined,
      rateLimitPerMin: opts.rate ? Number(opts.rate) : undefined,
      expiresAt: opts.expires ? Date.now() + parseDuration(opts.expires) : null,
    });

    const base = `http://localhost:${process.env.KEYVAULT_PORT ?? 8787}/${key.provider}`;
    console.log(`grant ${grant.id} created for ${opts.to}`);
    console.log(`\n  token (shown ONCE): ${token}`);
    console.log(`  base url:           ${base}\n`);
    if (provider.kind === "llm") {
      console.log(`  e.g. OPENAI_BASE_URL=${base}  OPENAI_API_KEY=${token}`);
    }
    if (opts.as !== "human") {
      console.log(`\n  add to ~/.keyvault/mcp.json under "connections":`);
      console.log(`    "${key.provider}": { "baseUrl": "${base}", "token": "${token}" }`);
    }
  });

program
  .command("rotate")
  .description("Replace a key's secret in place — live grants keep working")
  .argument("<keyId>", "id of the key to rotate")
  .option("-k, --key <value>", "the new secret (omit to read from stdin — safer)")
  .action(async (keyId: string, opts: { key?: string }) => {
    const plaintext = opts.key ?? readFileSync(0, "utf8").trim();
    if (!plaintext) fail("no key provided");
    const master = await defaultWrapper().getMasterKey();
    const ok = rotateKey(getDb(), keyId, plaintext, master);
    console.log(ok ? "rotated (grants unchanged)" : `no key with id ${keyId}`);
  });

program
  .command("revoke")
  .description("Revoke a grant by id or token")
  .argument("<idOrToken>")
  .action((idOrToken: string) => {
    const ok = revokeGrant(getDb(), idOrToken);
    console.log(ok ? "revoked" : "no matching grant");
  });

program
  .command("list")
  .description("List keys and grants")
  .action(() => {
    const db = getDb();
    console.log("KEYS:");
    for (const k of listKeys(db)) console.log(`  ${k.id}  ${k.provider}/${k.label}`);
    console.log("\nGRANTS:");
    for (const g of listGrants(db)) {
      const state = g.revokedAt ? "revoked" : g.expiresAt && g.expiresAt < Date.now() ? "expired" : "live";
      console.log(`  ${g.id}  →${g.granteeLabel} (${g.granteeType}) [${state}] spent=${g.spentCents}c`);
    }
  });

program
  .command("audit")
  .description("Show request history (metadata only)")
  .argument("[grantId]")
  .action((grantId?: string) => {
    for (const a of listAudit(getDb(), grantId)) {
      console.log(`  ${new Date(a.ts).toISOString()}  ${a.method} ${a.path}  -> ${a.upstreamStatus ?? "-"}`);
    }
  });

program
  .command("where")
  .description("Show where the vault, master key, and MCP config live")
  .action(() => {
    const db = vaultDbPath();
    const cfg = configPath();
    const mk = masterKeyStatus();
    const mark = (p: string) => (existsSync(p) ? "exists" : "not created yet");

    console.log(`vault db:    ${db}  (${mark(db)})`);
    console.log(`master key:  ${mk.location}  (${mk.present ? "present" : "missing"})`);
    console.log(`mcp config:  ${cfg}  (${mark(cfg)})`);

    if (existsSync(db)) {
      const d = getDb();
      console.log(`stored:      ${listKeys(d).length} keys, ${listGrants(d).length} grants`);
    } else {
      console.log("stored:      nothing yet — add a key to create the vault");
    }
  });

program.parseAsync();

function fail(msg: string): never {
  console.error("error: " + msg);
  process.exit(1);
}

function parseRule(rule: string): { method: string; path: string } {
  const [method, path] = rule.trim().split(/\s+/, 2);
  if (!method || !path) throw new Error(`bad --allow rule: "${rule}" (want "METHOD /path")`);
  return { method, path };
}

function parseDuration(s: string): number {
  const m = /^(\d+)([smhd])$/.exec(s.trim());
  if (!m) throw new Error(`bad duration: ${s} (use e.g. 30m, 1h, 7d)`);
  const n = Number(m[1]);
  const unit = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as "s" | "m" | "h" | "d"];
  return n * unit;
}
