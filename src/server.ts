import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./proxy/app.js";
import { createAdminApp } from "./admin/app.js";
import { getDb } from "./store/db.js";
import { defaultWrapper } from "./crypto/wrapper.js";

/**
 * One process, two servers:
 *   - proxy (8787): grantees send requests here (token -> real key)
 *   - admin (8788): the dashboard + management API (localhost only)
 */
const db = getDb();
const wrapper = defaultWrapper();

const proxyPort = Number(process.env.KEYVAULT_PORT ?? 8787);
const adminPort = Number(process.env.KEYVAULT_ADMIN_PORT ?? 8788);

serve({ fetch: createApp(db, wrapper).fetch, port: proxyPort }, (i) =>
  console.log(`keyvault proxy  → http://localhost:${i.port}`),
);

const admin = createAdminApp(db, wrapper);
// Serve the built dashboard (web/dist) with SPA fallback.
admin.use("/*", serveStatic({ root: "./web/dist" }));
admin.get("*", serveStatic({ path: "./web/dist/index.html" }));

serve({ fetch: admin.fetch, port: adminPort }, (i) =>
  console.log(`keyvault admin  → http://localhost:${i.port}  (open this)`),
);
