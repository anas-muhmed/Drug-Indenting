// Shared DB-write helpers used across many route groups (notifications,
// audit logging, approval-remark history, admin audit logging). Each
// takes an already-open `conn` rather than acquiring its own — callers
// are responsible for connection lifecycle.

export async function createNotification(conn, userId, requestId, message) {
  await conn.execute(
    `INSERT INTO notifications (user_id, request_id, message)
     VALUES (:userId, :requestId, :message)`,
    { userId, requestId, message }
  );
}

export async function writeAudit(conn, requestId, action, performedBy, fromStage, toStage, remarks) {
  await conn.execute(
    `INSERT INTO audit_logs (request_id, action, performed_by, from_stage, to_stage, remarks)
     VALUES (:requestId, :action, :performedBy, :fromStage, :toStage, :remarks)`,
    { requestId, action, performedBy, fromStage, toStage, remarks: remarks || null }
  );
}

export async function saveApprovalRemarks(conn, remarks, roleName, performedBy) {
  if (!remarks || !roleName) return;

  const remarksToProcess = [];
  if (Array.isArray(remarks)) {
    remarksToProcess.push(...remarks);
  } else if (typeof remarks === 'string') {
    remarksToProcess.push(remarks);
  }

  for (const remark of remarksToProcess) {
    const trimmedRemark = remark.trim();
    if (trimmedRemark === '') continue;

    // Check if the remark already exists for this role (case-insensitive + trimmed)
    const remarkCheck = await conn.execute(
      `SELECT history_id, usage_count FROM approval_remark_history
       WHERE LOWER(role_name) = LOWER(:roleName)
         AND LOWER(TRIM(remark_text)) = LOWER(TRIM(:remarkText))`,
      { roleName, remarkText: trimmedRemark }
    );

    if (remarkCheck.rows.length > 0) {
      const historyId = remarkCheck.rows[0].HISTORY_ID;
      await conn.execute(
        `UPDATE approval_remark_history
         SET usage_count = usage_count + 1,
             last_used_at = CURRENT_TIMESTAMP
         WHERE history_id = :historyId`,
        { historyId }
      );
    } else {
      await conn.execute(
        `INSERT INTO approval_remark_history (role_name, remark_text, created_by, usage_count, last_used_at, is_active)
         VALUES (:roleName, :remarkText, :createdBy, 1, CURRENT_TIMESTAMP, 1)`,
        { roleName, remarkText: trimmedRemark, createdBy: performedBy || null }
      );
    }
  }
}

export async function writeAdminAudit(conn, adminId, action, targetUser, details) {
  try {
    await conn.execute(
      `INSERT INTO admin_audit_logs (admin_id, action, target_user, details)
       VALUES (:adminId, :action, :targetUser, :details)`,
      { adminId, action, targetUser: targetUser || null, details: details || null }
    );
  } catch (err) {
    console.error('[writeAdminAudit] Failed:', err.message);
  }
}
