// routes/register.ts
import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import pool from "../db/db";
import { roleMiddleware } from "../middleware/role.middleware";

const router = Router();

// -------------------- POST: Admin registers user --------------------
router.post("/", roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
        const { email, password, role, full_name, national_id, institution, course, year_of_study } = req.body;

        if (!email || !password || !role) {
            return res.status(400).json({ error: "Email, password, and role are required" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const userResult = await pool.query(
            `INSERT INTO users (email, password_hash, role_id)
             SELECT $1, $2, id FROM roles WHERE name = $3
                 RETURNING id, email, role_id`,
            [email, hashedPassword, role.toUpperCase()]
        );

        const user = userResult.rows[0];

        let student = null;
        if (role.toUpperCase() === "STUDENT") {
            if (!full_name || !national_id || !institution || !course || !year_of_study) {
                return res.status(400).json({ error: "Missing student fields for STUDENT role" });
            }

            const studentResult = await pool.query(
                `INSERT INTO students
                 (user_id, full_name, national_id, institution, course, year_of_study)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id, user_id, full_name, national_id, institution, course, year_of_study, created_at`,
                [user.id, full_name, national_id, institution, course, year_of_study]
            );

            student = studentResult.rows[0];
        }

        res.status(201).json({
            message: "User registered successfully",
            user,
            student,
        });

    } catch (err: any) {
        console.error(err);
        if (err.code === "23505") {
            return res.status(400).json({ error: "Email or National ID already exists" });
        }
        res.status(500).json({ error: "Server error" });
    }
});

export default router;
