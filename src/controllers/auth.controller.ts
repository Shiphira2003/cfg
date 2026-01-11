import { Request, Response } from "express";
import bcrypt from "bcrypt";
// @ts-ignore
import pool from "../db/db";
import { signToken } from "../utils/jwt";

export const login = async (req: Request, res: Response) => {
    const { email, password } = req.body;

    try {
        const result = await pool.query(
            `
      SELECT u.id, u.password_hash, u.is_active, r.name AS role
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.email = $1
      `,
            [email]
        );

        if (result.rowCount === 0) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const user = result.rows[0];

        if (!user.is_active) {
            return res.status(403).json({ message: "Account disabled" });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const token = signToken({
            userId: user.id,
            role: user.role,
        });

        res.json({
            token,
            user: {
                id: user.id,
                role: user.role,
                email,
            },
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Login failed" });
    }
};
