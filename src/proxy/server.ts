import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { getDb } from "../store/db.js";
import { defaultWrapper } from "../crypto/wrapper.js";

const port = Number(process.env.KEYVAULT_PORT ?? 8787);
const app = createApp(getDb(), defaultWrapper());

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`keyvault proxy listening on http://localhost:${info.port}`);
});
