import jwt from "jsonwebtoken";
import { config } from "../config/config";

const JWT_SECRET = config().jwtSecret;

export interface JwtPayload {
    userId: number;
    role: string;
}

export const signToken = (payload: JwtPayload) => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
};

export const verifyToken = (token: string) => {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
};
