import dotenv from "dotenv";

dotenv.config(); // load variables from .env file

export const config = {
    port: process.env.PORT ? Number(process.env.PORT) : 5000,
    env: process.env.NODE_ENV || "development",

    // PostgreSQL config
    dbUser: process.env.DB_USER || "devuser",
    dbPassword: process.env.DB_PASSWORD || "yourpassword",
    dbHost: process.env.DB_HOST || "localhost",
    dbPort: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    dbName: process.env.DB_NAME || "cfg_db",
};
