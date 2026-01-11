import { File } from "multer";

declare global {
    namespace Express {
        interface Request {
            files?: File[]; // Multer files
        }
    }
}
