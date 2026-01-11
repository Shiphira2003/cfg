import dotenv from "dotenv";
import app from "./app";
import { config } from "./config";

dotenv.config();

app.listen(config.port, () => {
    console.log(`CFG Backend running in ${config.env} mode on port ${config.port}`);
});
