// routes/users.ts
import { Router, Request, Response } from "express";
import bcrypt from "bcrypt"
// @ts-ignore
import pool from "../db/db";

const router = Router();

// -------------------- GET all users --------------------
router.get("/", async (req: Request, res: Response) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.email, u.role_id, u.is_active, u.created_at, r.name as role_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id`
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

// -------------------- GET single user by id --------------------
router.get("/:id", async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT u.id, u.email, u.role_id, u.is_active, u.created_at, r.name as role_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).send("User not found");
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

// -------------------- POST create a new user --------------------
router.post("/", async (req: Request, res: Response) => {
    try {
        const { email, password_hash, role_id, is_active } = req.body;

        // Hash the password
        const hashedPassword = await bcrypt.hash(password_hash, 10); // 10 salt rounds

        const result = await pool.query(
            `INSERT INTO users (email, password_hash, role_id, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, role_id, is_active, created_at`,
            [email, hashedPassword, role_id || null, is_active ?? true]
        );

        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        console.error(err);
        if (err.code === "23505") { // unique violation
            return res.status(400).send("Email already exists");
        }
        res.status(500).send("Server error");
    }
});

// -------------------- PUT update a user --------------------
router.put("/:id", async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { email, password_hash, role_id, is_active } = req.body;

        // Hash password if provided
        const hashedPassword = password_hash ? await bcrypt.hash(password_hash, 10) : null;

        const result = await pool.query(
            `UPDATE users
       SET email = COALESCE($1, email),
           password_hash = COALESCE($2, password_hash),
           role_id = COALESCE($3, role_id),
           is_active = COALESCE($4, is_active)
       WHERE id = $5
       RETURNING id, email, role_id, is_active, created_at`,
            [email, hashedPassword, role_id, is_active, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).send("User not found");
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});


// -------------------- DELETE a user --------------------
router.delete("/:id", async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `DELETE FROM users WHERE id = $1 RETURNING id`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).send("User not found");
        }

        res.json({ message: "User deleted successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

export default router;
