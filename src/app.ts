// app.ts
import express from "express";
import cors from "cors";
import { errorHandler } from "./middleware/errorHandler";
import usersRouter from "./routes/users";
import studentsRouter from "./routes/students";
import registerRouter from "./routes/register";
import applicationsRouter from "./routes/applications";
import authRouter from "./routes/auth.routes";

const app = express();

// ✅ CORS configuration
app.use(cors({
    origin: "http://localhost:5173", // your frontend URL
    credentials: true,               // allow cookies/auth headers
}));

app.use(express.json());
app.use(errorHandler);

app.use("/api/users", usersRouter);
app.use("/api/students", studentsRouter);
app.use("/api/register", registerRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/auth", authRouter);

app.get("/", (req, res) => {
    res.json({ message: "County Financial Gateway API running" });
});

export default app;
