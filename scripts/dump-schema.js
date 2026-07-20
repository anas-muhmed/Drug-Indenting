// Read-only: dumps the LIVE Oracle schema (tables, triggers, and any
// procedures/functions) exactly as it exists today, using Oracle's own
// DBMS_METADATA — so nothing is missed or hand-guessed.
//
// Run with: node scripts/dump-schema.js
// Output:   schema_dump.sql (in the project root)
//
// This makes no writes to the database. It only runs SELECTs and
// session-scoped DBMS_METADATA formatting calls.

import 'dotenv/config';
import oracledb from 'oracledb';
import fs from 'fs';

async function main() {
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  oracledb.fetchAsString = [oracledb.CLOB];

  const conn = await oracledb.getConnection({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING,
  });

  try {
    // Keep the DDL portable — strip out storage/tablespace clauses that
    // are specific to this one Oracle instance and not part of the
    // logical schema.
    await conn.execute(`BEGIN
      DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'STORAGE', false);
      DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'TABLESPACE', false);
      DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SEGMENT_ATTRIBUTES', false);
      DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SQLTERMINATOR', true);
    END;`);

    let out = `-- ============================================================\n`;
    out += `-- Live schema dump — generated ${new Date().toISOString()}\n`;
    out += `-- Source: DBMS_METADATA against the actual running database.\n`;
    out += `-- This replaces the stale hand-written create_tables.sql.\n`;
    out += `-- ============================================================\n\n`;

    // ── Tables ────────────────────────────────────────────────
    const tables = await conn.execute(
      `SELECT table_name FROM user_tables ORDER BY table_name`
    );
    out += `-- ==================== TABLES ====================\n\n`;
    for (const row of tables.rows) {
      const ddl = await conn.execute(
        `SELECT DBMS_METADATA.GET_DDL('TABLE', :name) AS ddl FROM dual`,
        { name: row.TABLE_NAME }
      );
      out += `-- ---- ${row.TABLE_NAME} ----\n`;
      out += ddl.rows[0].DDL + '\n\n';
    }

    // ── Triggers ──────────────────────────────────────────────
    const triggers = await conn.execute(
      `SELECT trigger_name FROM user_triggers ORDER BY trigger_name`
    );
    if (triggers.rows.length > 0) {
      out += `-- ==================== TRIGGERS ====================\n\n`;
      for (const row of triggers.rows) {
        const ddl = await conn.execute(
          `SELECT DBMS_METADATA.GET_DDL('TRIGGER', :name) AS ddl FROM dual`,
          { name: row.TRIGGER_NAME }
        );
        out += `-- ---- ${row.TRIGGER_NAME} ----\n`;
        out += ddl.rows[0].DDL + '\n\n';
      }
    }

    // ── Procedures / Functions / Packages (if any) ───────────
    const objs = await conn.execute(
      `SELECT object_name, object_type FROM user_objects
       WHERE object_type IN ('PROCEDURE','FUNCTION','PACKAGE')
       ORDER BY object_type, object_name`
    );
    if (objs.rows.length > 0) {
      out += `-- ==================== PROCEDURES / FUNCTIONS / PACKAGES ====================\n\n`;
      for (const row of objs.rows) {
        const ddl = await conn.execute(
          `SELECT DBMS_METADATA.GET_DDL(:type, :name) AS ddl FROM dual`,
          { type: row.OBJECT_TYPE, name: row.OBJECT_NAME }
        );
        out += `-- ---- ${row.OBJECT_TYPE} ${row.OBJECT_NAME} ----\n`;
        out += ddl.rows[0].DDL + '\n\n';
      }
    } else {
      out += `-- No stored procedures / functions / packages found.\n\n`;
    }

    fs.writeFileSync('schema_dump.sql', out, 'utf8');
    console.log(`✅ Wrote schema_dump.sql — ${tables.rows.length} tables, ${triggers.rows.length} triggers, ${objs.rows.length} procs/functions.`);
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error('❌ Schema dump failed:', err);
  process.exit(1);
});
