import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "./auth.middleware"; // adjust path if needed

export const roleMiddleware = (...allowedRoles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        // Convert both sides to uppercase for case-insensitive match
        const normalizedUserRole = req.user.role.toUpperCase();
        const normalizedAllowed = allowedRoles.map(r => r.toUpperCase());

        if (!normalizedAllowed.includes(normalizedUserRole)) {
            return res.status(403).json({ message: "Access denied" });
        }

        next();
    };
};
