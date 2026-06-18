import { getDb } from "./db.js";

// Touching getDb() creates the file and runs the DDL.
getDb();
console.log("keyvault: database initialized");
