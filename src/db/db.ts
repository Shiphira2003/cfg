// db.ts
import { Pool } from "pg";
// @ts-ignore
import { config } from "../config/config";

// Create pool
const pool = new Pool({
    user: config().dbUser,
    host: config().dbHost,
    database: config().dbName,
    password: config().dbPassword,
    port: config().dbPort,
});

// Test connection
(async () => {
    try {
        const client = await pool.connect();
        console.log("✅ Connected to PostgreSQL successfully!");
        client.release();
    } catch (err) {
        console.error("❌ Error connecting to PostgreSQL:", err);
    }
})();

export default pool;
