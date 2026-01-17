import { Router, Request, Response, NextFunction } from "express";
import pool from "../db/db";
import { upload } from "../middleware/upload";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { roleMiddleware } from "../middleware/role.middleware";

const router = Router();

/* =========================================================
   POST: Student submits application with documents
========================================================= */
router.post(
    "/",
    authMiddleware,
    roleMiddleware("student"),
    upload.array("documents", 10),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const { cycle_year, amount_requested } = req.body;
            const userId = req.user!.userId;

            if (!cycle_year || !amount_requested) {
                return res.status(400).json({
                    success: false,
                    message: "Missing required fields",
                });
            }

            // Get student ID
            const studentResult = await pool.query(
                "SELECT id FROM students WHERE user_id = $1",
                [userId]
            );

            if (studentResult.rowCount === 0) {
                return res.status(403).json({
                    success: false,
                    message: "Student profile not found",
                });
            }

            const student_id = studentResult.rows[0].id;

            // Handle uploaded files
            const files = (req.files as Express.Multer.File[]) || [];
            const documentUrls = files.map(f => f.path);

            // Insert application
            const insertResult = await pool.query(
                `
                INSERT INTO applications
                    (student_id, cycle_year, amount_requested, document_url)
                VALUES ($1, $2, $3, $4)
                RETURNING *
                `,
                [
                    student_id,
                    cycle_year,
                    amount_requested,
                    JSON.stringify(documentUrls),
                ]
            );

            const applicationId = insertResult.rows[0].id;

            // Set TAADA flag
            await pool.query(
                `
                UPDATE applications a
                SET taada_flag = CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM applications ap
                        JOIN disbursements d ON ap.id = d.allocation_id
                        WHERE ap.student_id = a.student_id AND d.status = 'APPROVED'
                    ) THEN 'ALREADY_FUNDED'
                    WHEN EXISTS (
                        SELECT 1
                        FROM applications ap
                        WHERE ap.student_id = a.student_id AND ap.status = 'REJECTED'
                    ) THEN 'REJECTED_BEFORE'
                    ELSE 'FIRST_TIME'
                END
                WHERE a.id = $1
                `,
                [applicationId]
            );

            res.status(201).json({
                success: true,
                message: "Application submitted successfully",
                data: insertResult.rows[0],
            });
        } catch (err) {
            next(err);
        }
    }
);

/* =========================================================
   GET: List My Applications (Student)
========================================================= */
router.get(
    "/my-applications",
    authMiddleware,
    roleMiddleware("student"),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const userId = req.user!.userId;

            const result = await pool.query(
                `
                SELECT
                    a.id,
                    a.cycle_year,
                    a.amount_requested,
                    a.amount_allocated,
                    a.status,
                    a.taada_flag,
                    a.created_at
                FROM applications a
                JOIN students s ON a.student_id = s.id
                WHERE s.user_id = $1
                ORDER BY a.created_at DESC
                `,
                [userId]
            );

            res.json(result.rows);
        } catch (err) {
            next(err);
        }
    }
);

/* =========================================================
   GET: List applications (Admin / Committee)
========================================================= */
router.get(
    "/",
    authMiddleware,
    roleMiddleware("admin", "committee"),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { status } = req.query;

            let query = `
                SELECT
                    a.id,
                    a.student_id,
                    s.full_name,
                    s.national_id,
                    s.institution,
                    s.course,
                    s.year_of_study,
                    a.cycle_year,
                    a.amount_requested,
                    a.amount_allocated,
                    a.status,
                    a.taada_flag,
                    a.document_url,
                    a.created_at
                FROM applications a
                JOIN students s ON a.student_id = s.id
            `;

            const values: any[] = [];

            if (status) {
                query += " WHERE a.status = $1";
                values.push(status);
            }

            query += `
                ORDER BY
                    CASE a.taada_flag
                        WHEN 'FIRST_TIME' THEN 1
                        WHEN 'REJECTED_BEFORE' THEN 2
                        WHEN 'ALREADY_FUNDED' THEN 3
                        ELSE 4
                    END,
                    a.created_at DESC
            `;

            const result = await pool.query(query, values);

            const rows = result.rows.map(row => {
                let documents: string[] = [];

                if (row.document_url) {
                    try {
                        documents =
                            typeof row.document_url === "string"
                                ? JSON.parse(row.document_url)
                                : row.document_url;
                    } catch (err) {
                        console.error(
                            `Invalid document_url for application ${row.id}`,
                            row.document_url
                        );
                    }
                }

                return {
                    ...row,
                    document_url: documents,
                };
            });

            res.json({ success: true, data: rows });
        } catch (err) {
            next(err);
        }
    }
);

/* =========================================================
   GET: Audit logs
========================================================= */
router.get(
    "/:id/audit-logs",
    authMiddleware,
    roleMiddleware("admin"),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;

            const appResult = await pool.query(
                "SELECT id FROM applications WHERE id = $1",
                [id]
            );

            if (appResult.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Application not found",
                });
            }

            const logs = await pool.query(
                `
                SELECT
                    al.id,
                    al.user_id,
                    u.email AS admin_email,
                    al.action,
                    al.old_value,
                    al.new_value,
                    al.created_at
                FROM audit_logs al
                LEFT JOIN users u ON al.user_id = u.id
                WHERE al.application_id = $1
                ORDER BY al.created_at DESC
                `,
                [id]
            );

            res.json({
                success: true,
                audit_logs: logs.rows,
            });
        } catch (err) {
            next(err);
        }
    }
);

/* =========================================================
   PATCH: Approve / Reject application
========================================================= */
router.patch(
    "/:id/status",
    authMiddleware,
    roleMiddleware("admin"),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;
            const { status, amount_allocated } = req.body;
            const admin_id = req.user!.userId;

            if (!["APPROVED", "REJECTED"].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid status",
                });
            }

            const appResult = await pool.query(
                "SELECT * FROM applications WHERE id = $1",
                [id]
            );

            if (appResult.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Application not found",
                });
            }

            if (status === "APPROVED" && (!amount_allocated || amount_allocated <= 0)) {
                return res.status(400).json({
                    success: false,
                    message: "amount_allocated must be greater than 0",
                });
            }

            const finalAmount = status === "APPROVED" ? amount_allocated : 0;

            const updateResult = await pool.query(
                `
                UPDATE applications
                SET status = $1, amount_allocated = $2
                WHERE id = $3
                RETURNING *
                `,
                [status, finalAmount, id]
            );

            await pool.query(
                `
                INSERT INTO audit_logs
                    (user_id, application_id, action, old_value, new_value)
                VALUES ($1, $2, $3, $4, $5)
                `,
                [
                    admin_id,
                    id,
                    status,
                    JSON.stringify({
                        status: appResult.rows[0].status,
                        amount_allocated: appResult.rows[0].amount_allocated,
                    }),
                    JSON.stringify({
                        status,
                        amount_allocated: finalAmount,
                    }),
                ]
            );

            res.json({
                success: true,
                message: "Application updated successfully",
                data: updateResult.rows[0],
            });
        } catch (err) {
            next(err);
        }
    }
);

export default router;
