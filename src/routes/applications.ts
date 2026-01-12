import { Router, Request, Response, NextFunction } from "express";
import pool from "../db/db";
import { upload } from "../middleware/upload";
import { authMiddleware } from "../middleware/auth.middleware";
import { roleMiddleware } from "../middleware/role.middleware";
import { AuthRequest } from "../middleware/auth.middleware";

const router = Router();

// ----------------------------
// POST: Student applies with multiple files
// ----------------------------
router.post(
    "/",
    authMiddleware,
    roleMiddleware("student"),
    upload.array("documents", 10),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const { cycle_year, amount_requested } = req.body;
            const userId = req.user!.userId;

            // 1️⃣ Get student_id for the logged-in user
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

            // 2️⃣ Validate input
            if (!cycle_year || !amount_requested) {
                return res.status(400).json({
                    success: false,
                    message: "Missing required fields",
                });
            }

            // 3️⃣ Handle uploaded files
            const files = (req.files as Express.Multer.File[]) || [];
            const documentUrls = files.map(file => file.path);

            // 4️⃣ Insert new application
            const result = await pool.query(
                `
                INSERT INTO applications
                    (student_id, cycle_year, amount_requested, document_url)
                VALUES ($1, $2, $3, $4)
                RETURNING *
                `,
                [student_id, cycle_year, amount_requested, JSON.stringify(documentUrls)]
            );

            const newApplicationId = result.rows[0].id;

            // 5️⃣ Update TAADA flag immediately after submission
            await pool.query(`
                UPDATE applications a
                SET taada_flag = CASE
                    -- Already funded before
                    WHEN EXISTS (
                        SELECT 1
                        FROM applications ap
                        JOIN disbursements d ON ap.id = d.allocation_id
                        WHERE ap.student_id = a.student_id AND d.status = 'APPROVED'
                    ) THEN 'ALREADY_FUNDED'

                    -- Rejected before
                    WHEN EXISTS (
                        SELECT 1
                        FROM applications ap
                        WHERE ap.student_id = a.student_id AND ap.status = 'REJECTED'
                    ) THEN 'REJECTED_BEFORE'

                    -- First-time applicant
                    ELSE 'FIRST_TIME'
                END
                WHERE a.id = $1
            `, [newApplicationId]);

            // 6️⃣ Return response to student
            res.status(201).json({
                success: true,
                message: "Application submitted successfully",
                data: result.rows[0],
            });

        } catch (err) {
            next(err);
        }
    }
);

// ----------------------------
// GET: List applications (admin view)
// Optional filter: ?status=PENDING
// ----------------------------
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

            // ✅ Sort by TAADA priority first, then newest applications
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

            res.json({ success: true, data: result.rows });
        } catch (err) {
            next(err);
        }
    }
);

// ----------------------------
// GET: Audit logs for a specific application (Admin)
// ----------------------------
// ----------------------------
// GET: Audit logs for a specific application (Admin)
// ----------------------------
router.get(
    "/:id/audit-logs",
    authMiddleware,
    roleMiddleware("admin"),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;

            // 1️⃣ Check if application exists
            const appResult = await pool.query(
                "SELECT id, student_id, status FROM applications WHERE id = $1",
                [id]
            );

            if (appResult.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Application not found",
                });
            }

            // 2️⃣ Fetch audit logs for this application
            const logsResult = await pool.query(
                `
                    SELECT al.id,
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
                application: appResult.rows[0],
                audit_logs: logsResult.rows,
            });
        } catch (err) {
            next(err);
        }
    }
);

// ----------------------------
// PATCH: Approve or Reject application (Admin) + Audit log
// ----------------------------
router.patch(
    "/:id/status",
    authMiddleware,
    roleMiddleware("admin"),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;
            const { status, amount_allocated } = req.body;
            const admin_id = req.user!.userId;

            // 1️⃣ Validate status
            if (!["APPROVED", "REJECTED"].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid status value",
                });
            }

            // 2️⃣ Check if application exists
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

            const application = appResult.rows[0];

            // 3️⃣ Check if score exists
            const scoreResult = await pool.query(
                "SELECT * FROM application_scores WHERE application_id = $1",
                [id]
            );

            if (scoreResult.rowCount === 0) {
                return res.status(400).json({
                    success: false,
                    message: "Application must be scored before approval",
                });
            }

            // 4️⃣ If approved, amount_allocated is mandatory
            if (status === "APPROVED" && (!amount_allocated || amount_allocated <= 0)) {
                return res.status(400).json({
                    success: false,
                    message: "amount_allocated is required and must be greater than 0",
                });
            }

            const finalAmount = status === "APPROVED" ? amount_allocated : 0;

            // 5️⃣ Store old and new values for audit log
            const old_value = {
                status: application.status,
                amount_allocated: application.amount_allocated,
            };

            const new_value = {
                status,
                amount_allocated: finalAmount,
            };

            // 6️⃣ Update application
            const updateResult = await pool.query(
                `
                    UPDATE applications
                    SET
                        status = $1,
                        amount_allocated = $2
                    WHERE id = $3
                        RETURNING *
                `,
                [status, finalAmount, id]
            );

            // 7️⃣ Insert audit log
            await pool.query(
                `
                    INSERT INTO audit_logs (user_id, application_id, action, old_value, new_value)
                    VALUES ($1, $2, $3, $4, $5)
                `,
                [
                    admin_id,
                    id,
                    status,
                    JSON.stringify(old_value),
                    JSON.stringify(new_value),
                ]
            );

            // 8️⃣ Update TAADA flag based on new status
            await pool.query(`
                UPDATE applications
                SET taada_flag = CASE
                    WHEN $1 = 'APPROVED' THEN 'ALREADY_FUNDED'
                    WHEN $1 = 'REJECTED' AND NOT EXISTS (
                        SELECT 1
                        FROM applications ap
                        JOIN disbursements d ON ap.id = d.allocation_id
                        WHERE ap.student_id = applications.student_id AND d.status = 'APPROVED'
                    ) THEN 'REJECTED_BEFORE'
                    ELSE taada_flag
                END
                WHERE id = $2
            `, [status, id]);

            res.json({
                success: true,
                message: "Application updated, audit logged, and TAADA flag set successfully",
                data: updateResult.rows[0],
            });

        } catch (err) {
            next(err);
        }
    }
);

router.post(
    "/:id/score",
    authMiddleware,
    roleMiddleware("admin", "committee"),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;

            // 1️⃣ Check application exists
            const appResult = await pool.query(
                "SELECT a.*, s.year_of_study, s.institution, s.course FROM applications a JOIN students s ON a.student_id = s.id WHERE a.id = $1",
                [id]
            );

            if (appResult.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Application not found",
                });
            }

            const application = appResult.rows[0];

            // 2️⃣ Check if score already exists
            const scoreCheck = await pool.query(
                "SELECT * FROM application_scores WHERE application_id = $1",
                [id]
            );

            if (scoreCheck.rowCount! > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Score already exists for this application",
                });
            }

            // 3️⃣ Calculate score
            let score = 0;

            // Year of study
            const year = application.year_of_study;
            if (year === 4) score += 40;
            else if (year === 3) score += 30;
            else if (year === 2) score += 20;
            else if (year === 1) score += 10;

            // Amount requested
            const amount = parseFloat(application.amount_requested);
            if (amount <= 20000) score += 30;
            else if (amount <= 40000) score += 20;
            else score += 10;

            // Institution present
            if (application.institution) score += 15;

            // Course present
            if (application.course) score += 15;

            // 4️⃣ Store in application_scores
            const insertResult = await pool.query(
                "INSERT INTO application_scores (application_id, need_score) VALUES ($1, $2) RETURNING *",
                [id, score]
            );

            res.json({
                success: true,
                message: "Score calculated successfully",
                data: insertResult.rows[0],
            });
        } catch (err) {
            next(err);
        }
    }
);

export default router;
