// =server.js=========================================================
// Formulary Drug Addition Request System — Backend Server
// =============================================================
// Tech: Node.js + Express + oracledb (Oracle)
// =============================================================

import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import oracledb from "oracledb";
import fetch from "node-fetch";
import bcrypt from 'bcrypt';
import path from "path";
import { fileURLToPath } from "url";
import { normalizeGenericCombo, computeAltDerived, computeExistingDerived, validatePassword, formatEffectiveEntryRow } from './utils/pureHelpers.js';
import { signToken, normalizeRole } from './utils/auth.js';
import { requireAuth, requireAdminAuth, requireRole } from './middleware/requireAuth.js';
import { extractBearerToken, verifyToken, SALT_ROUNDS } from './utils/auth.js';
import { getApproverRoleForStage, NEXT_STAGE, STAGE_LABELS } from './utils/workflow.js';
import { initDB, getConn } from './db/pool.js';
import { createNotification, writeAudit, saveApprovalRemarks, writeAdminAudit } from './utils/auditHelpers.js';
import notificationsRouter from './routes/notifications.js';
import pharmacistDraftsRouter from './routes/pharmacistDrafts.js';
import dashboardRouter from './routes/dashboard.js';
import analyticsRouter from './routes/analytics.js';
import quotaRouter from './routes/quota.js';
import usersRouter from './routes/users.js';
import dtcRouter from './routes/dtc.js';
import adminRouter from './routes/admin.js';
import authRouter from './routes/auth.js';
import aiRouter from './routes/ai.js';
import alternativesRouter from './routes/alternatives.js';
import requestsRouter from './routes/requests.js';
import miscRouter from './routes/misc.js';

const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;


app.use(express.json());





// =============================================================
// Schema Setup — runs BEFORE server starts listening
// =============================================================
async function setupSchema() {
  /*
  =====================================================
  SCHEMA SETUP

  Disabled for production.

  Reason:
  The production database schema is already fully created
  and migrated.

  Running schema verification, ALTER TABLE statements,
  CREATE TABLE statements, index creation, seed-user logic,
  and migration checks during every server startup causes
  unnecessary Oracle metadata queries and increases startup
  time.

  This code is intentionally preserved for future schema
  migration or fresh installations.

  To enable again, simply uncomment this block.
  =====================================================
  const conn = await getConn();
  console.log('🔧  Running schema setup...');

  try {

    // ----------------------------------------------------------
    // USERS
    // ----------------------------------------------------------
    const usersExists = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name = 'USERS'`
    );
    if (usersExists.rows[0].CNT === 0) {
      await conn.execute(`
        CREATE TABLE users (
          user_id    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          name       VARCHAR2(200)  NOT NULL,
          email      VARCHAR2(200)  UNIQUE NOT NULL,
          password   VARCHAR2(200) NOT NULL,
          role       VARCHAR2(50)   NOT NULL,
          department VARCHAR2(200),
          is_active  NUMBER(1)      DEFAULT 1 NOT NULL,
          is_approved NUMBER(1)     DEFAULT 1 NOT NULL
        )
      `);
      console.log('   ✔ Table USERS created.');
    } else {
      console.log('   – Table USERS already exists.');

      // NEW: Add password column to existing USERS table if missing
      const pwdColCheck = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM user_tab_columns WHERE table_name = 'USERS' AND column_name = 'PASSWORD'`
      );
      if (pwdColCheck.rows[0].CNT === 0) {
        await conn.execute(`ALTER TABLE users ADD password VARCHAR2(200) DEFAULT 'unhashed_placeholder' NOT NULL`);
        console.log('   ✔ Password column added to USERS table.');
      }

      // Check IS_APPROVED column
      const approvedColCheck = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM user_tab_columns WHERE table_name = 'USERS' AND column_name = 'IS_APPROVED'`
      );
      if (approvedColCheck.rows[0].CNT === 0) {
        await conn.execute(`ALTER TABLE users ADD is_approved NUMBER(1) DEFAULT 1`);
        await conn.execute(`UPDATE users SET is_approved = 1 WHERE is_approved IS NULL`, {}, { autoCommit: true });
        console.log('   ✔ IS_APPROVED column added, existing users backfilled as approved.');
      }
    }

    // ----------------------------------------------------------
    // DRUG_REQUESTS
    // ----------------------------------------------------------
    const drExists = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name = 'DRUG_REQUESTS'`
    );
    if (drExists.rows[0].CNT === 0) {
      await conn.execute(`
        CREATE TABLE drug_requests (
          request_id             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          doctor_id              NUMBER        NOT NULL REFERENCES users(user_id),
          med_rep_name           VARCHAR2(200) NOT NULL,
          med_rep_email          VARCHAR2(200) NOT NULL,
          med_rep_phone          VARCHAR2(50)  NOT NULL,
          request_type           VARCHAR2(100) NOT NULL,
          formulary_request_type VARCHAR2(50),
          category               VARCHAR2(100) NOT NULL,
          brand_name             VARCHAR2(200) NOT NULL,
          ai_content             CLOB,
          generic_name           VARCHAR2(200) NOT NULL,
          dose_strength          VARCHAR2(100) NOT NULL,
          dosage_form            VARCHAR2(100) NOT NULL,
          manufacturer           VARCHAR2(200) NOT NULL,
          marketer               VARCHAR2(200) NOT NULL,
          existing_brands        VARCHAR2(500),
          clinical_justification CLOB          NOT NULL,
          expected_patients_pm   NUMBER        NOT NULL,
          cost_reduction_benefit NUMBER(1)     DEFAULT 0,
          status                 VARCHAR2(50)  DEFAULT 'Pending'      NOT NULL,
          current_stage          VARCHAR2(50)  DEFAULT 'PharmacyHead' NOT NULL,
          ph_remarks             VARCHAR2(1000),
          dtc_remarks            VARCHAR2(1000),
          ceo_remarks            VARCHAR2(1000),
          created_at             TIMESTAMP     DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at             TIMESTAMP
        )
      `);
      console.log('   ✔ Table DRUG_REQUESTS created.');
    } else {
      console.log('   – Table DRUG_REQUESTS already exists.');
    }


    // ----------------------------------------------------------
    // NOTIFICATIONS
    // ----------------------------------------------------------
    const notifExists = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name = 'NOTIFICATIONS'`
    );
    if (notifExists.rows[0].CNT === 0) {
      await conn.execute(`
        CREATE TABLE notifications (
          notification_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          user_id         NUMBER         NOT NULL REFERENCES users(user_id),
          request_id      NUMBER         REFERENCES drug_requests(request_id),
          message         VARCHAR2(1000) NOT NULL,
          is_read         NUMBER(1)      DEFAULT 0 NOT NULL,
          created_at      TIMESTAMP      DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);
      console.log('   ✔ Table NOTIFICATIONS created.');
    } else {
      console.log('   – Table NOTIFICATIONS already exists.');
    }

    // ----------------------------------------------------------
    // AUDIT_LOGS
    // ----------------------------------------------------------
    const auditExists = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name = 'AUDIT_LOGS'`
    );
    if (auditExists.rows[0].CNT === 0) {
      await conn.execute(`
        CREATE TABLE audit_logs (
          log_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          request_id   NUMBER        NOT NULL REFERENCES drug_requests(request_id),
          action       VARCHAR2(50)  NOT NULL,
          performed_by NUMBER        NOT NULL REFERENCES users(user_id),
          from_stage   VARCHAR2(50),
          to_stage     VARCHAR2(50),
          remarks      VARCHAR2(1000),
          logged_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);
      console.log('   ✔ Table AUDIT_LOGS created.');
    } else {
      console.log('   – Table AUDIT_LOGS already exists.');
    }

    // ----------------------------------------------------------
    // SEED USERS (only if table is empty)
    // ----------------------------------------------------------
    // const userCount = await conn.execute(`SELECT COUNT(*) AS cnt FROM users`);
    // if (userCount.rows[0].CNT === 0) {
    //   console.log('   🌱 Seeding initial users...');
    //   const seeds = [
    //     { name: 'Dr. Ahmed', email: 'doctor@hospital.com', role: 'Doctor', dept: 'General Medicine' },
    //     { name: 'Pharm Head', email: 'pharmhead@hospital.com', role: 'PharmacyHead', dept: 'Pharmacy' },
    //     { name: 'DTC Member', email: 'dtc@hospital.com', role: 'DTCCommittee', dept: 'DTC' },
    //     { name: 'CEO', email: 'ceo@hospital.com', role: 'CEO', dept: 'Administration' },
    //     { name: 'Dr. Sarah (HOD)', email: 'hod@hospital.com', role: 'HOD', dept: 'General Medicine' },
    //   ];
    //   for (const u of seeds) {
    //     await conn.execute(
    //       `INSERT INTO users (name, email, role, department) VALUES (:name, :email, :role, :dept)`,
    //       { name: u.name, email: u.email, role: u.role, dept: u.dept }
    //     );
    //   }
    //   console.log('   ✔ Seed users inserted.');
    // } else {
    //   console.log(`   – Users already seeded (${userCount.rows[0].CNT} rows), skipping.`);
    // }

    // ----------------------------------------------------------
    // NEW: Add pharmacist/emergency columns to DRUG_REQUESTS
    // ----------------------------------------------------------
    const colCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tab_columns
       WHERE table_name = 'DRUG_REQUESTS' AND column_name = 'PHARMACIST_REMARKS'`
    );
    if (colCheck.rows[0].CNT === 0) {
      await conn.execute(`ALTER TABLE drug_requests ADD pharmacist_remarks  VARCHAR2(1000)`);
      await conn.execute(`ALTER TABLE drug_requests ADD ph_remarks2          VARCHAR2(1000)`);
      await conn.execute(`ALTER TABLE drug_requests ADD dtc_final_remarks    VARCHAR2(1000)`);
      await conn.execute(`ALTER TABLE drug_requests ADD is_emergency         NUMBER(1) DEFAULT 0`);
      await conn.execute(`ALTER TABLE drug_requests ADD pharmacist2_remarks  VARCHAR2(1000)`);
      console.log('   ✔ New workflow columns added to DRUG_REQUESTS.');
    } else {
      console.log('   – New workflow columns already exist.');
    }

    // ----------------------------------------------------------
    // NEW: DRUG_ALTERNATIVES table
    // ----------------------------------------------------------
    const altExists = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name = 'DRUG_ALTERNATIVES'`
    );
    if (altExists.rows[0].CNT === 0) {
      await conn.execute(`
        CREATE TABLE drug_alternatives (
   alt_id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

   request_id              NUMBER NOT NULL
                              REFERENCES drug_requests(request_id)
                              ON DELETE CASCADE,

   brand_name              VARCHAR2(200) NOT NULL,
   manufacturer            VARCHAR2(200) NOT NULL,
   marketer                VARCHAR2(200),

   consultant_present_stock NUMBER,
   purchase_quantity       NUMBER,
   sale_quantity           NUMBER,

   pack                    VARCHAR2(100),

   mrp                     NUMBER(10,2),
   rate                    NUMBER(10,2),
   qty                     NUMBER(10,2),          -- NEW: Quantity field
   offer                   NUMBER(10,2),          -- NEW: Offer field
   negotiated_rate         NUMBER(10,2),          -- NEW: Negotiated Rate (negorate)

   markup_margin           NUMBER(10,2),

   scheme_qty              NUMBER,
   scheme_offer            VARCHAR2(200),

   net_rate                NUMBER(10,2),
   total_margin            NUMBER(10,2),
   profit_margin           NUMBER(10,2),
   absolute_margin         NUMBER(10,2),          -- maps to alt.margin in UI

   stock                   VARCHAR2(100),

   existing_drug_details   VARCHAR2(500),
   transaction_history     VARCHAR2(500),
   margin_comparison       VARCHAR2(500),
   sales_data              VARCHAR2(500),
   stock_usage             VARCHAR2(500),

   comparison_type         VARCHAR2(20),

   remark                  VARCHAR2(500),
   refer                   VARCHAR2(500),

   submitted_by            NUMBER
                              REFERENCES users(user_id),

   created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)
      `);
      console.log('   ✔ Table DRUG_ALTERNATIVES created.');
    } else {
      console.log('   – Table DRUG_ALTERNATIVES already exists.');
    }

    // ----------------------------------------------------------
    // NEW: DRUG_ALTERNATIVE_NEGOTIATIONS table
    // ----------------------------------------------------------
    const negExists = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name = 'DRUG_ALTERNATIVE_NEGOTIATIONS'`
    );
    if (negExists.rows[0].CNT === 0) {
      await conn.execute(`
        CREATE TABLE drug_alternative_negotiations (
          negotiation_id             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          alternative_id             NUMBER NOT NULL REFERENCES drug_alternatives(alt_id) ON DELETE CASCADE,
          negotiated_mrp             NUMBER(10,2),
          negotiated_rate            NUMBER(10,2),
          negotiated_gst             NUMBER(5,2),
          negotiated_scheme_qty      NUMBER,
          negotiated_scheme_offer    VARCHAR2(200),
          negotiated_net_rate        NUMBER(10,2),
          negotiated_profit_margin   NUMBER(10,2),
          negotiated_absolute_margin NUMBER(10,2),
          negotiated_total_margin    NUMBER(10,2),
          negotiated_by              NUMBER REFERENCES users(user_id),
          negotiated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          negotiation_remarks        VARCHAR2(1000)
        )
      `);
      console.log('   ✔ Table DRUG_ALTERNATIVE_NEGOTIATIONS created.');
    } else {
      console.log('   – Table DRUG_ALTERNATIVE_NEGOTIATIONS already exists.');
    }

    // ----------------------------------------------------------
    // NEW: DRUG_EXISTING_DETAILS table
    // ----------------------------------------------------------
    const dedExists = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name = 'DRUG_EXISTING_DETAILS'`
    );
    if (dedExists.rows[0].CNT === 0) {
      await conn.execute(`
        CREATE TABLE drug_existing_details (
          id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          request_id        NUMBER NOT NULL REFERENCES drug_requests(request_id) ON DELETE CASCADE,
          row_no            NUMBER NOT NULL,
          introduced_on     VARCHAR2(100),
          brand_name        VARCHAR2(200),
          manufacturer      VARCHAR2(200),
          marketer          VARCHAR2(200),
          consultant        VARCHAR2(300),
          present_stock     NUMBER,
          purchase_qty      NUMBER,
          sale_qty          NUMBER,
          pack              VARCHAR2(100),
          mrp_inc_gst_nos   NUMBER(10,4),
          rate_inc_gst_nos  NUMBER(10,4),
          markup_margin     NUMBER(10,2),
          scheme_qty        NUMBER,
          scheme_offer      VARCHAR2(200),
          net_rate          NUMBER(10,4),
          profit_margin     NUMBER(10,2),
          absolute_margin   NUMBER(10,4),
          total_margin      NUMBER(10,2),
          remark            VARCHAR2(1000),
          created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);
      console.log('   ✔ Table DRUG_EXISTING_DETAILS created.');
    } else {
      console.log('   – Table DRUG_EXISTING_DETAILS already exists.');

      // Schema migration: check and add new columns to drug_existing_details
      const colsToAdd = [
        { name: 'PRESENT_STOCK', type: 'NUMBER' },
        { name: 'PURCHASE_QTY', type: 'NUMBER' },
        { name: 'SALE_QTY', type: 'NUMBER' },
        { name: 'TOTAL_MARGIN', type: 'NUMBER(10,2)' },
        { name: 'REMARK', type: 'VARCHAR2(1000)' }
      ];
      for (const col of colsToAdd) {
        const colCheck = await conn.execute(
          `SELECT COUNT(*) AS cnt FROM user_tab_columns WHERE table_name = 'DRUG_EXISTING_DETAILS' AND column_name = :colName`,
          { colName: col.name }
        );
        if (colCheck.rows[0].CNT === 0) {
          await conn.execute(`ALTER TABLE drug_existing_details ADD ${col.name.toLowerCase()} ${col.type}`);
          console.log(`   ✔ Column ${col.name} added to DRUG_EXISTING_DETAILS.`);
        }
      }
    }

    // ----------------------------------------------------------
    // NEW: DRUG_EFFECTIVE_ENTRIES table
    // ----------------------------------------------------------
    const deeExists = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name = 'DRUG_EFFECTIVE_ENTRIES'`
    );
    if (deeExists.rows[0].CNT === 0) {
      await conn.execute(`
        CREATE TABLE drug_effective_entries (
          entry_id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          request_id             NUMBER NOT NULL REFERENCES drug_requests(request_id) ON DELETE CASCADE,
          drug_name              VARCHAR2(500),
          effective_created_at   TIMESTAMP,
          remarks                VARCHAR2(2000),
          created_by             NUMBER REFERENCES users(user_id),
          created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          entry_data             CLOB
        )
      `);
      console.log('   ✔ Table DRUG_EFFECTIVE_ENTRIES created.');
    } else {
      console.log('   – Table DRUG_EFFECTIVE_ENTRIES already exists.');
    }

    // ----------------------------------------------------------
    // NEW: Seed Pharmacist user
    // ----------------------------------------------------------
    const pharmCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM users WHERE role = 'Pharmacist'`
    );
    if (pharmCheck.rows[0].CNT === 0) {
      const defaultHash = await bcrypt.hash('Hospital@123', 12);
      await conn.execute(
        `INSERT INTO users (name, email, password, role, department) VALUES (:name, :email, :password, :role, :dept)`,
        { name: 'Pharmacist Staff', email: 'pharmacist@hospital.com', password: defaultHash, role: 'Pharmacist', dept: 'Pharmacy' }
      );
      console.log('   ✔ Pharmacist user seeded.');
    } else {
      console.log('   – Pharmacist user already exists.');
    }

    // ----------------------------------------------------------
    // NEW: Seed HOD user if missing
    // ----------------------------------------------------------
    const hodUserCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM users WHERE role = 'HOD'`
    );
    if (hodUserCheck.rows[0].CNT === 0) {
      const defaultHash = await bcrypt.hash('Hospital@123', 12);
      await conn.execute(
        `INSERT INTO users (name, email, password, role, department) VALUES (:name, :email, :password, :role, :dept)`,
        { name: 'Dr. Sarah (HOD)', email: 'hod@hospital.com', password: defaultHash, role: 'HOD', dept: 'General Medicine' }
      );
      console.log('   ✔ HOD user seeded.');
    } else {
      console.log('   – HOD user already exists.');
    }

    // ----------------------------------------------------------
    // NEW: Allow NULLs for Emergency Request Fields
    // ----------------------------------------------------------
    try {
      await conn.execute(`ALTER TABLE drug_requests MODIFY (med_rep_name NULL, med_rep_email NULL, med_rep_phone NULL, expected_patients_pm NULL)`);
      console.log('   ✔ Allowed NULLs for emergency fields in DRUG_REQUESTS.');
    } catch (err) {
      // Ignore if already nullable or other errors (like unsupported DB version for this syntax)
      console.log('   – Skipped ALTER TABLE MODIFY NULL (already nullable or error).');
    }

    // ----------------------------------------------------------
    // NEW: request_source_type column (PROMOTIONAL / NON_PROMOTIONAL)
    // ----------------------------------------------------------
    const srcTypeCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tab_columns
       WHERE table_name = 'DRUG_REQUESTS' AND column_name = 'REQUEST_SOURCE_TYPE'`
    );
    if (srcTypeCheck.rows[0].CNT === 0) {
      await conn.execute(`ALTER TABLE drug_requests ADD request_source_type VARCHAR2(20) DEFAULT 'PROMOTIONAL'`);
      console.log('   ✔ request_source_type column added to DRUG_REQUESTS.');
    } else {
      console.log('   – request_source_type column already exists.');
    }

    // ----------------------------------------------------------
    // NEW: HOD Workflow Fields
    // ----------------------------------------------------------
    const hodCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tab_columns
       WHERE table_name = 'DRUG_REQUESTS' AND column_name = 'HOD_ID'`
    );
    if (hodCheck.rows[0].CNT === 0) {
      await conn.execute(`ALTER TABLE drug_requests ADD hod_id NUMBER REFERENCES users(user_id)`);
      await conn.execute(`ALTER TABLE drug_requests ADD approved_by_hod NUMBER(1) DEFAULT 0`);
      await conn.execute(`ALTER TABLE drug_requests ADD hod_remarks VARCHAR2(1000)`);
      await conn.execute(`ALTER TABLE drug_requests ADD hod_action_timestamp TIMESTAMP`);
      await conn.execute(`ALTER TABLE drug_requests ADD created_by_role VARCHAR2(50) DEFAULT 'Doctor'`);
      await conn.execute(`ALTER TABLE drug_requests ADD created_by_user_id NUMBER REFERENCES users(user_id)`);

      // Migrate existing requests: Set created_by_user_id = doctor_id
      await conn.execute(`UPDATE drug_requests SET created_by_user_id = doctor_id WHERE created_by_user_id IS NULL`);
      await conn.commit();

      console.log('   ✔ HOD workflow columns added to DRUG_REQUESTS.');
    } else {
      console.log('   – HOD workflow columns already exist.');
    }

    // ----------------------------------------------------------
    // NEW: Final DTC Drug Selection columns
    // ----------------------------------------------------------
    const finalSelCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tab_columns
       WHERE table_name = 'DRUG_REQUESTS' AND column_name = 'FINAL_SELECTED_ALTERNATIVE_ID'`
    );
    if (finalSelCheck.rows[0].CNT === 0) {
      await conn.execute(`ALTER TABLE drug_requests ADD final_selected_alternative_id NUMBER`);
      await conn.execute(`ALTER TABLE drug_requests ADD dtc_final_selection_notes VARCHAR2(1000)`);
      console.log('   ✔ Final DTC selection columns added to DRUG_REQUESTS.');
    } else {
      console.log('   – Final DTC selection columns already exist.');
    }

    const isFinSelAltCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tab_columns
       WHERE table_name = 'DRUG_ALTERNATIVES' AND column_name = 'IS_FINAL_SELECTED'`
    );
    if (isFinSelAltCheck.rows[0].CNT === 0) {
      await conn.execute(`ALTER TABLE drug_alternatives ADD is_final_selected NUMBER(1) DEFAULT 0`);
      console.log('   ✔ is_final_selected column added to DRUG_ALTERNATIVES.');
    } else {
      console.log('   – is_final_selected column already exists.');
    }

    // ----------------------------------------------------------
    // NEW: Analysis Drafts table
    // ----------------------------------------------------------
    const draftTblCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name = 'ANALYSIS_DRAFTS'`
    );
    if (draftTblCheck.rows[0].CNT === 0) {
      await conn.execute(`
        CREATE TABLE analysis_drafts (
          draft_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          request_id    NUMBER NOT NULL REFERENCES drug_requests(request_id) ON DELETE CASCADE,
          pharmacist_id NUMBER NOT NULL REFERENCES users(user_id),
          draft_name    VARCHAR2(300),
          draft_data    CLOB,
          status        VARCHAR2(20) DEFAULT 'DRAFT',
          created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);
      console.log('   ✔ Table ANALYSIS_DRAFTS created.');
    } else {
      console.log('   – Table ANALYSIS_DRAFTS already exists.');
    }

    // ----------------------------------------------------------
    // NEW: existing_generic_data CLOB on drug_requests
    // ----------------------------------------------------------
    const egdCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tab_columns
       WHERE table_name = 'DRUG_REQUESTS' AND column_name = 'EXISTING_GENERIC_DATA'`
    );
    if (egdCheck.rows[0].CNT === 0) {
      await conn.execute(`ALTER TABLE drug_requests ADD existing_generic_data CLOB`);
      console.log('   ✔ existing_generic_data CLOB added to DRUG_REQUESTS.');
    } else {
      console.log('   – existing_generic_data column already exists.');
    }

    // ----------------------------------------------------------
    // NEW: comparison-sheet columns on drug_alternatives
    // ----------------------------------------------------------
    const newAltCols = [
      { col: 'CONSULTANT', sql: `ALTER TABLE drug_alternatives ADD consultant VARCHAR2(300)` },
      { col: 'SALE_QTY', sql: `ALTER TABLE drug_alternatives ADD sale_qty NUMBER` },
      { col: 'PACK', sql: `ALTER TABLE drug_alternatives ADD pack VARCHAR2(100)` },
      { col: 'INTRODUCED_ON', sql: `ALTER TABLE drug_alternatives ADD introduced_on VARCHAR2(100)` },
      // NEW: formula-basis columns for v2 comparison sheet
      { col: 'MRP_PER_PACK', sql: `ALTER TABLE drug_alternatives ADD mrp_per_pack NUMBER(10,2)` },
      { col: 'RATE_PER_PACK', sql: `ALTER TABLE drug_alternatives ADD rate_per_pack NUMBER(10,2)` },
      { col: 'GST_PERCENT', sql: `ALTER TABLE drug_alternatives ADD gst_percent NUMBER(5,2)` },
    ];
    for (const c of newAltCols) {
      const chk = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM user_tab_columns WHERE table_name='DRUG_ALTERNATIVES' AND column_name=:col`,
        { col: c.col }
      );
      if (chk.rows[0].CNT === 0) {
        await conn.execute(c.sql);
        console.log(`   ✔ ${c.col} added to DRUG_ALTERNATIVES.`);
      }
    }

    // ----------------------------------------------------------
    // NEW: Pharmacy Head review-2 remarks column
    // ----------------------------------------------------------
    const phRmk2Check = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tab_columns
       WHERE table_name = 'DRUG_REQUESTS' AND column_name = 'PH_REVIEW2_REMARKS'`
    );
    if (phRmk2Check.rows[0].CNT === 0) {
      await conn.execute(`ALTER TABLE drug_requests ADD ph_review2_remarks VARCHAR2(2000)`);
      console.log('   ✔ ph_review2_remarks column added to DRUG_REQUESTS.');
    }

    // ----------------------------------------------------------
    // NEW: BLACKLISTED_COMPANIES table
    // ----------------------------------------------------------
    const blExists = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name = 'BLACKLISTED_COMPANIES'`
    );
    if (blExists.rows[0].CNT === 0) {
      await conn.execute(`
        CREATE TABLE blacklisted_companies (
          blacklist_id   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          company_name   VARCHAR2(300) NOT NULL,
          company_type   VARCHAR2(50)  NOT NULL,
          remarks        VARCHAR2(2000),
          created_by     NUMBER,
          is_active      NUMBER(1) DEFAULT 1,
          created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          removed_by     NUMBER,
          removed_at     TIMESTAMP
        )
      `);
      console.log('   ✔ Table BLACKLISTED_COMPANIES created.');
    } else {
      console.log('   – Table BLACKLISTED_COMPANIES already exists.');
    }

    // ----------------------------------------------------------
    // REJECTION_REMARK_HISTORY table
    // ----------------------------------------------------------
    const rrhExists = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name = 'REJECTION_REMARK_HISTORY'`
    );
    if (rrhExists.rows[0].CNT === 0) {
      await conn.execute(`
        CREATE TABLE rejection_remark_history (
          history_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          remark_text     VARCHAR2(4000) NOT NULL,
          created_by      NUMBER,
          usage_count     NUMBER DEFAULT 1,
          last_used_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_active       NUMBER(1) DEFAULT 1
        )
      `);
      console.log('   ✔ Table REJECTION_REMARK_HISTORY created.');

      try {
        await conn.execute(`
          CREATE INDEX idx_rejection_history_text ON rejection_remark_history (remark_text)
        `);
        console.log('   ✔ Index idx_rejection_history_text created.');
      } catch (idxErr) {
        console.log('   – Index idx_rejection_history_text could not be created or already exists:', idxErr.message);
      }
    } else {
      console.log('   – Table REJECTION_REMARK_HISTORY already exists.');
    }

    // ----------------------------------------------------------
    // APPROVAL_REMARK_HISTORY table
    // ----------------------------------------------------------
    const arhExists = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name = 'APPROVAL_REMARK_HISTORY'`
    );
    if (arhExists.rows[0].CNT === 0) {
      await conn.execute(`
        CREATE TABLE approval_remark_history (
          history_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          role_name       VARCHAR2(100),
          remark_text     VARCHAR2(4000) NOT NULL,
          created_by      NUMBER,
          usage_count     NUMBER DEFAULT 1,
          last_used_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_active       NUMBER(1) DEFAULT 1
        )
      `);
      console.log('   ✔ Table APPROVAL_REMARK_HISTORY created.');

      try {
        await conn.execute(`
          CREATE INDEX idx_approval_history_text ON approval_remark_history (remark_text)
        `);
        console.log('   ✔ Index idx_approval_history_text created.');
      } catch (idxErr) {
        console.log('   – Index idx_approval_history_text could not be created or already exists:', idxErr.message);
      }
    } else {
      console.log('   – Table APPROVAL_REMARK_HISTORY already exists.');
    }

    // ----------------------------------------------------------
    // NEW: EFFECTIVE_CREATED_AT column for pharmacist-adjusted datetime
    // ----------------------------------------------------------
    const effDateCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tab_columns
       WHERE table_name = 'DRUG_REQUESTS' AND column_name = 'EFFECTIVE_CREATED_AT'`
    );
    if (effDateCheck.rows[0].CNT === 0) {
      await conn.execute(`ALTER TABLE drug_requests ADD effective_created_at TIMESTAMP NULL`);
      // Backfill existing rows with their original created_at
      await conn.execute(`UPDATE drug_requests SET effective_created_at = created_at WHERE effective_created_at IS NULL`);
      console.log('   ✔ effective_created_at column added and backfilled to DRUG_REQUESTS.');
    } else {
      console.log('   – effective_created_at column already exists.');
    }

    // ----------------------------------------------------------
    // NEW: Revert-to-Pharmacist tracking columns
    // ----------------------------------------------------------
    const revertCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tab_columns
       WHERE table_name = 'DRUG_REQUESTS' AND column_name = 'IS_REVERTED'`
    );
    if (revertCheck.rows[0].CNT === 0) {
      await conn.execute(`ALTER TABLE drug_requests ADD revert_remarks    VARCHAR2(4000)`);
      await conn.execute(`ALTER TABLE drug_requests ADD reverted_by       NUMBER`);
      await conn.execute(`ALTER TABLE drug_requests ADD reverted_at       TIMESTAMP`);
      await conn.execute(`ALTER TABLE drug_requests ADD revert_count      NUMBER DEFAULT 0`);
      await conn.execute(`ALTER TABLE drug_requests ADD is_reverted       NUMBER(1) DEFAULT 0`);
      await conn.execute(`ALTER TABLE drug_requests ADD last_corrected_at TIMESTAMP`);
      await conn.execute(`ALTER TABLE drug_requests ADD last_corrected_by NUMBER`);
      console.log('   ✔ Revert tracking columns added to DRUG_REQUESTS.');
    } else {
      console.log('   – Revert tracking columns already exist.');
    }

    // ----------------------------------------------------------
    // NEW: MEDICINE_QUANTITY column
    // ----------------------------------------------------------
    const mqCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tab_columns
       WHERE table_name = 'DRUG_REQUESTS' AND column_name = 'MEDICINE_QUANTITY'`
    );
    if (mqCheck.rows[0].CNT === 0) {
      await conn.execute(`ALTER TABLE drug_requests ADD medicine_quantity NUMBER NULL`);
      console.log('   ✔ medicine_quantity column added to DRUG_REQUESTS.');
    } else {
      console.log('   – medicine_quantity column already exists.');
    }

    // ----------------------------------------------------------
    // NEW: DTC Recommendation & PH Review columns
    // ----------------------------------------------------------
    const newReqCols = [
      { col: 'PH_REVIEW_REMARKS', sql: `ALTER TABLE drug_requests ADD ph_review_remarks CLOB` },
      { col: 'DTC_SELECTED_BRAND', sql: `ALTER TABLE drug_requests ADD dtc_selected_brand VARCHAR2(500)` },
      { col: 'DTC_SELECTED_CATEGORY', sql: `ALTER TABLE drug_requests ADD dtc_selected_category VARCHAR2(100)` },
      { col: 'DTC_SELECTION_REASONS', sql: `ALTER TABLE drug_requests ADD dtc_selection_reasons CLOB` },
      { col: 'DTC_RECOMMENDATION_NOTES', sql: `ALTER TABLE drug_requests ADD dtc_recommendation_notes CLOB` },
      { col: 'DTC_REVIEWED_BY', sql: `ALTER TABLE drug_requests ADD dtc_reviewed_by NUMBER` },
      { col: 'DTC_REVIEWED_AT', sql: `ALTER TABLE drug_requests ADD dtc_reviewed_at TIMESTAMP` }
    ];
    for (const c of newReqCols) {
      const chk = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM user_tab_columns WHERE table_name='DRUG_REQUESTS' AND column_name=:col`,
        { col: c.col }
      );
      if (chk.rows[0].CNT === 0) {
        await conn.execute(c.sql);
        console.log(`   ✔ ${c.col} added to DRUG_REQUESTS.`);
      }
    }

    // ----------------------------------------------------------
    // NEW: Bottom section editability & final selection columns
    // ----------------------------------------------------------
    const botReqCols = [
      { col: 'DTC_REVIEWED_BY_NAME', sql: `ALTER TABLE drug_requests ADD dtc_reviewed_by_name VARCHAR2(500)` },
      { col: 'DTC_REVIEW_SIGNATURE', sql: `ALTER TABLE drug_requests ADD dtc_review_signature VARCHAR2(1000)` },
      { col: 'PH_FINAL_RECOMMENDATION', sql: `ALTER TABLE drug_requests ADD ph_final_recommendation CLOB` },
      { col: 'FINAL_RECOMMENDATION_NOTES', sql: `ALTER TABLE drug_requests ADD final_recommendation_notes CLOB` },
      { col: 'FINAL_SELECTED_BRAND', sql: `ALTER TABLE drug_requests ADD final_selected_brand VARCHAR2(500)` },
      { col: 'FINAL_SELECTED_CATEGORY', sql: `ALTER TABLE drug_requests ADD final_selected_category VARCHAR2(100)` },
      { col: 'FINAL_SELECTION_REASONS', sql: `ALTER TABLE drug_requests ADD final_selection_reasons CLOB` },
      { col: 'DTC_FINAL_RECOMMENDATIONS', sql: `ALTER TABLE drug_requests ADD dtc_final_recommendations CLOB` }
    ];
    for (const c of botReqCols) {
      const chk = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM user_tab_columns WHERE table_name='DRUG_REQUESTS' AND column_name=:col`,
        { col: c.col }
      );
      if (chk.rows[0].CNT === 0) {
        await conn.execute(c.sql);
        console.log(`   ✔ ${c.col} added to DRUG_REQUESTS.`);
      }
    }

    // ----------------------------------------------------------
    // ADMIN: Security columns on USERS (force_password_reset, temp_password_issued)
    // ----------------------------------------------------------
    const adminUserCols = [
      { col: 'FORCE_PASSWORD_RESET', sql: `ALTER TABLE users ADD force_password_reset NUMBER(1) DEFAULT 0` },
      { col: 'TEMP_PASSWORD_ISSUED', sql: `ALTER TABLE users ADD temp_password_issued NUMBER(1) DEFAULT 0` },
    ];
    for (const c of adminUserCols) {
      const chk = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM user_tab_columns WHERE table_name='USERS' AND column_name=:col`,
        { col: c.col }
      );
      if (chk.rows[0].CNT === 0) {
        await conn.execute(c.sql);
        console.log(`   ✔ ${c.col} added to USERS.`);
      }
    }

    // ----------------------------------------------------------
    // ADMIN_USERS table — stores the single admin account
    // ----------------------------------------------------------
    const adminTblCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name = 'ADMIN_USERS'`
    );
    if (adminTblCheck.rows[0].CNT === 0) {
      await conn.execute(`
        CREATE TABLE admin_users (
          admin_id   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          name       VARCHAR2(200) NOT NULL,
          email      VARCHAR2(200) UNIQUE NOT NULL,
          password   VARCHAR2(200) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);
      console.log('   ✔ Table ADMIN_USERS created.');
    } else {
      console.log('   – Table ADMIN_USERS already exists.');
    }

    // ----------------------------------------------------------
    // ADMIN_AUDIT_LOGS table
    // ----------------------------------------------------------
    const adminAuditCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name = 'ADMIN_AUDIT_LOGS'`
    );
    if (adminAuditCheck.rows[0].CNT === 0) {
      await conn.execute(`
        CREATE TABLE admin_audit_logs (
          audit_id    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          admin_id    NUMBER        NOT NULL REFERENCES admin_users(admin_id),
          action      VARCHAR2(100) NOT NULL,
          target_user NUMBER,
          details     VARCHAR2(2000),
          performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);
      console.log('   ✔ Table ADMIN_AUDIT_LOGS created.');
    } else {
      console.log('   – Table ADMIN_AUDIT_LOGS already exists.');
    }

    // ----------------------------------------------------------
    // USER_REQUEST_QUOTAS
    // ----------------------------------------------------------
    const quotasExists = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name = 'USER_REQUEST_QUOTAS'`
    );
    if (quotasExists.rows[0].CNT === 0) {
      await conn.execute(`
        CREATE TABLE user_request_quotas (
          quota_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          user_id         NUMBER UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
          quarterly_limit NUMBER DEFAULT 10 NOT NULL,
          updated_by      NUMBER REFERENCES users(user_id),
          updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);
      console.log('   ✔ Table USER_REQUEST_QUOTAS created.');
    } else {
      console.log('   – Table USER_REQUEST_QUOTAS already exists.');
    }

    // ----------------------------------------------------------
    // INVENTORY TRACKING columns on DRUG_REQUESTS
    // ----------------------------------------------------------
    const invCols = [
      { col: 'INVENTORY_ADDED', sql: `ALTER TABLE drug_requests ADD inventory_added NUMBER(1) DEFAULT 0` },
      { col: 'INVENTORY_ADDED_AT', sql: `ALTER TABLE drug_requests ADD inventory_added_at TIMESTAMP` },
      { col: 'INVENTORY_ADDED_BY', sql: `ALTER TABLE drug_requests ADD inventory_added_by NUMBER` },
      { col: 'INVENTORY_ITEM_NAME', sql: `ALTER TABLE drug_requests ADD inventory_item_name VARCHAR2(500)` },
      { col: 'INVENTORY_RECEIVED', sql: `ALTER TABLE drug_requests ADD inventory_received NUMBER(1) DEFAULT 0` },
      { col: 'INVENTORY_RECEIVED_AT', sql: `ALTER TABLE drug_requests ADD inventory_received_at TIMESTAMP` },
      { col: 'INVENTORY_RECEIVED_BY', sql: `ALTER TABLE drug_requests ADD inventory_received_by NUMBER` },
    ];
    for (const c of invCols) {
      const chk = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM user_tab_columns WHERE table_name='DRUG_REQUESTS' AND column_name=:col`,
        { col: c.col }
      );
      if (chk.rows[0].CNT === 0) {
        await conn.execute(c.sql);
        console.log(`   ✔ ${c.col} added to DRUG_REQUESTS.`);
      } else {
        console.log(`   – ${c.col} (inventory) column already exists.`);
      }
    }

    console.log('✅  Schema setup complete.');

  } catch (err) {
    console.error('❌  Schema setup FAILED:', err.message);
    throw err;
  } finally {
    await conn.close();
  }
  */
}

// Core drug-request workflow routes — see routes/requests.js
app.use('/api/requests', requestsRouter);

app.use('/api/notifications', notificationsRouter);

// Dashboard route — see routes/dashboard.js
app.use('/api/dashboard', dashboardRouter);

// Analytics routes — see routes/analytics.js
app.use('/api/analytics', analyticsRouter);

// DTC management routes — see routes/dtc.js
app.use('/api/dtc', dtcRouter);

// User profile + quota routes — see routes/users.js and routes/quota.js
app.use('/api/user/quota', quotaRouter);
app.use('/api/users', usersRouter);

// Remaining utility routes — see routes/misc.js
app.use('/api', miscRouter);

// AI drug-profile routes — see routes/ai.js and prompts/drugProfilePrompts.js
app.use('/api', aiRouter);

// Alternatives + comparison-sheet routes — see routes/alternatives.js
app.use('/api', alternativesRouter);

// Pharmacist draft management — see routes/pharmacistDrafts.js
app.use('/api/pharmacist/drafts', pharmacistDraftsRouter);

//old  item-margin-report api
// app.post('/api/reports/item-margin-report', async (req, res) => {
//   const conn = await getConn();

//   try {
//     const { fromDate, toDate, genericId, genericName } = req.body;

//     if (!fromDate || !toDate) {
//       return res.status(400).json({
//         error: 'fromDate and toDate are required.'
//       });
//     }

//     // ── Resolve genericId(s) ────────────────────────────────────────────────
//     // Caller may supply either a numeric genericId (existing behaviour)
//     // or a combo string genericName (e.g. "Aspirin + Clopidogrel").
//     // Both paths produce resolvedIds — an array of numeric DRUG_GEN_IDs.
//     let resolvedIds;

//     if (genericId !== undefined && genericId !== null) {
//       // ── Path A: numeric genericId (backward-compatible) ──────────────────
//       const genIdNum = parseInt(genericId, 10);
//       if (isNaN(genIdNum)) {
//         return res.status(400).json({ error: 'genericId must be a valid number.' });
//       }
//       resolvedIds = [genIdNum];

//     } else if (genericName) {
//       // ── Path B: combo name string → resolve to DRUG_GEN_ID(s) ───────────
//       // Tokenise so "Aspirin + Clopidogrel" and "Clopidogrel + Aspirin"
//       // resolve identically (each token must appear in DRUG_GEN_NAME).
//       const tokens = normalizeGenericCombo(String(genericName));
//       if (tokens.length === 0) {
//         return res.status(400).json({ error: 'genericName is empty after normalisation.' });
//       }

//       // Build AND-of-LIKE bind params: { gnTok0: 'aspirin', gnTok1: 'clopidogrel', ... }
//       const gnBinds = Object.fromEntries(tokens.map((t, i) => [`gnTok${i}`, t]));
//       const gnWhere = tokens
//         .map((_, i) => `LOWER(dg.DRUG_GEN_NAME) LIKE '%' || :gnTok${i} || '%'`)
//         .join(' AND ');

//       const gnResult = await conn.execute(
//         `SELECT dg.DRUG_GEN_ID FROM DRUGGENERICS dg WHERE ${gnWhere}`,
//         gnBinds
//       );

//       if (!gnResult.rows || gnResult.rows.length === 0) {
//         return res.status(404).json({ error: `No generic found matching '${genericName}'.` });
//       }

//       // Collect all matching IDs (there may be more than one row)
//       resolvedIds = gnResult.rows.map(r => r.DRUG_GEN_ID);

//     } else {
//       return res.status(400).json({
//         error: 'Either genericId or genericName is required.'
//       });
//     }
//     // ────────────────────────────────────────────────────────────────────────

//     // Build IN-clause bind params: { gid0: 1, gid1: 2, ... }
//     // Named params avoid string-concatenation of user-supplied values into SQL.
//     const idBinds = Object.fromEntries(resolvedIds.map((id, i) => [`gid${i}`, id]));
//     const inClause = resolvedIds.map((_, i) => `:gid${i}`).join(', ');

//     const query = `
//       WITH latest_purchase_rate AS (
//         SELECT
//             li.item,
//             MAX(li.itemrate) KEEP (DENSE_RANK LAST ORDER BY li.docdetailid) AS latest_rate
//         FROM goodsreceiptnotelineitem li
//         WHERE li.itemrate IS NOT NULL
//           AND li.itemrate > 0
//         GROUP BY li.item
//       ),
//       base_data AS (
//         SELECT
//             ROW_NUMBER() OVER (ORDER BY i.description) AS sno,

//             i.createddatetime AS introduced_on,
//             i.description AS brand_name,
//             CASE
//     WHEN i.ISACTIVE = 1 THEN 'Active✅'
//     ELSE 'Inactive❌'
// END AS status,
//             m.manufacturer_name AS manufacturer,
//             market.marketter_name AS marketer,

//             NVL((
//                 SELECT LISTAGG(e.employee_name, ',')
//                 FROM itemdoctormap idm
//                 INNER JOIN employee e
//                     ON e.employee_id = idm.doctorid
//                 WHERE idm.itemid = i.id
//                   AND idm.status = 1
//             ), ' ') AS consultant,

//             NVL((
//                 SELECT SUM(cs.currentstock)
//                 FROM currentstock cs
//                 WHERE cs.item = i.id
//                   AND cs.expirydate > SYSDATE
//             ), 0) AS present_stock,

//             NVL((
//                 SELECT SUM(gl.quantity)
//                 FROM goodsreceiptnote grn
//                 INNER JOIN goodsreceiptnotelineitem gl
//                     ON gl.goodsreceiptnotelineitemid = grn.docid
//                 WHERE gl.item = i.id
//                   AND grn.approvestatustypenum = 2
//                   AND grn.createddatetime BETWEEN
//                       TO_DATE(:fromDate,'DD/MM/YYYY HH24:MI:SS')
//                       AND TO_DATE(:toDate,'DD/MM/YYYY HH24:MI:SS')
//             ), 0) AS purchase_quantity,

//             NVL((
//                 SELECT SUM(ibd.issued_qty)
//                 FROM issueheader ih
//                 INNER JOIN issuedetail id
//                     ON id.issueheader_id = ih.transaction_id
//                 INNER JOIN issuebatchdetail ibd
//                     ON ibd.issuedetail_id = id.detail_id
//                 WHERE ih.createddt BETWEEN
//                       TO_DATE(:fromDate,'DD/MM/YYYY HH24:MI:SS')
//                       AND TO_DATE(:toDate,'DD/MM/YYYY HH24:MI:SS')
//                   AND ih.issue_status = 452
//                   AND id.item = i.id
//             ), 0) AS sale_qty,

//             u.name AS pack,
//             TO_NUMBER(REGEXP_SUBSTR(u.name, '^[0-9]+')) AS pack_qty,

//             ROUND(
//                 NVL(i.mrp, 0) /
//                 NULLIF(TO_NUMBER(REGEXP_SUBSTR(u.name, '^[0-9]+')), 0),
//             4) AS mrp_incl_gst,

//             ROUND(
//                 NVL(lpr.latest_rate, 0) /
//                 NULLIF(TO_NUMBER(REGEXP_SUBSTR(u.name, '^[0-9]+')), 0),
//             4) AS rate_incl_gst,

//             NVL(ivm.quantity, 0) AS scheme_qty,
//             NVL(ivm.freeqty, 0) AS offer_qty,

//             ROUND(
//                 NVL(i.mrp, 0) /
//                 NULLIF(TO_NUMBER(REGEXP_SUBSTR(u.name, '^[0-9]+')), 0),
//             4) AS base_mrp_per_unit,

//             ROUND(
//                 NVL(lpr.latest_rate, 0) /
//                 NULLIF(TO_NUMBER(REGEXP_SUBSTR(u.name, '^[0-9]+')), 0),
//             4) AS base_rate_per_unit

//         FROM item i
//         INNER JOIN drugdetail dd
//             ON dd.item_refid = i.id
//         INNER JOIN genericdrugmapping dgm
//             ON dgm.itemgenericid = dd.itemgenericid
//         INNER JOIN druggenerics dg
//             ON dg.drug_gen_id = dgm.druggenerics
//         LEFT JOIN manufacturer m
//             ON m.id = i.manufacturer_id
//         LEFT JOIN markettermaster market
//             ON market.id = i.marketter_id
//         LEFT JOIN uom u
//             ON u.id = i.purchaseuom
//         LEFT JOIN itemvendormap ivm
//             ON ivm.itemid = i.id
//         LEFT JOIN latest_purchase_rate lpr
//             ON lpr.item = i.id
//         WHERE i.itemtypenum = 1
//           AND i.isactive = 1
//           AND dg.drug_gen_id IN (${inClause})
//       )
//       SELECT
//           sno,
//           introduced_on,
//           brand_name,
//           status,
//           manufacturer,
//           marketer,
//           consultant,
//           present_stock,
//           purchase_quantity,
//           sale_qty,
//           pack,
//           pack_qty,
//           mrp_incl_gst,
//           rate_incl_gst,

//           ROUND(
//               ((base_mrp_per_unit - base_rate_per_unit) /
//                NULLIF(base_rate_per_unit, 0)) * 100,
//           2) AS markup_margin,

//           scheme_qty,
//           offer_qty,

//           ROUND(
//               (base_rate_per_unit * scheme_qty) /
//               NULLIF((scheme_qty + offer_qty), 0),
//           4) AS net_rate,

//           ROUND(
//               (
//                 base_mrp_per_unit -
//                 (
//                   (base_rate_per_unit * scheme_qty) /
//                   NULLIF((scheme_qty + offer_qty), 0)
//                 )
//               ) /
//               NULLIF(base_mrp_per_unit, 0) * 100,
//           2) AS profit_margin,

//           ROUND(
//               base_mrp_per_unit -
//               (
//                 (base_rate_per_unit * scheme_qty) /
//                 NULLIF((scheme_qty + offer_qty), 0)
//               ),
//           4) AS absolute_margin,

//           ROUND(
//               (
//                 (
//                   base_mrp_per_unit -
//                   (
//                     (base_rate_per_unit * scheme_qty) /
//                     NULLIF((scheme_qty + offer_qty), 0)
//                   )
//                 ) /
//                 NULLIF(
//                   (
//                     (base_rate_per_unit * scheme_qty) /
//                     NULLIF((scheme_qty + offer_qty), 0)
//                   ),
//                   0
//                 )
//               ) * 100,
//           2) AS total_margin_markup,

//           NULL AS remarks
//       FROM base_data
//       ORDER BY brand_name
//     `;

//     const result = await conn.execute(query, {
//       fromDate,
//       toDate,
//       ...idBinds   // gid0, gid1, … — one named bind per resolved ID
//     });

//     const data = result.rows.map(r => ({
//       sno: r.SNO,
//       introduced_on: r.INTRODUCED_ON,
//       brand_name: r.BRAND_NAME,
//       status: r.STATUS,
//       manufacturer: r.MANUFACTURER,
//       marketer: r.MARKETER,
//       consultant: r.CONSULTANT,
//       present_stock: r.PRESENT_STOCK,
//       purchase_quantity: r.PURCHASE_QUANTITY,
//       sale_qty: r.SALE_QTY,
//       pack: r.PACK,
//       pack_qty: r.PACK_QTY,
//       mrp_incl_gst: r.MRP_INCL_GST,
//       rate_incl_gst: r.RATE_INCL_GST,
//       markup_margin: r.MARKUP_MARGIN,
//       absolute_margin: r.ABSOLUTE_MARGIN,
//       scheme_qty: r.SCHEME_QTY,
//       offer_qty: r.OFFER_QTY,
//       net_rate: r.NET_RATE,
//       profit_margin: r.PROFIT_MARGIN,
//       total_margin_markup: r.TOTAL_MARGIN_MARKUP,
//       remarks: r.REMARKS
//     }));

//     res.json(data);
//   } catch (err) {
//     console.error('POST /api/reports/item-margin-report error:', err);
//     res.status(500).json({
//       error: 'Internal server error.',
//       detail: err.message
//     });
//   } finally {
//     await conn.close();
//   }
// });
// Core register/login routes — see routes/auth.js
app.use('/api', authRouter);

// Admin portal routes — see routes/admin.js
app.use('/api/admin', adminRouter);

async function boot() {


  try {
    await initDB();

    // Column migration check for ENTRY_DATA CLOB in DRUG_EFFECTIVE_ENTRIES
    const conn = await getConn();
    try {
      const checkCol = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM user_tab_columns 
         WHERE table_name = 'DRUG_EFFECTIVE_ENTRIES' AND column_name = 'ENTRY_DATA'`
      );
      if (checkCol.rows[0].CNT === 0) {
        await conn.execute(
          `ALTER TABLE drug_effective_entries ADD (entry_data CLOB)`
        );
        console.log('   ✔ Column ENTRY_DATA CLOB added to drug_effective_entries.');
      } else {
        console.log('   – Column ENTRY_DATA already exists.');
      }
    } catch (migErr) {
      console.error('Migration error adding column ENTRY_DATA:', migErr.message);
    } finally {
      await conn.close();
    }

    // Column migration check for USER_LOGIN_ID in USERS
    try {
      const connUsers = await getConn();
      try {
        // 1. Try to add column
        try {
          await connUsers.execute(`ALTER TABLE users ADD (user_login_id VARCHAR2(50))`);
          console.log('   ✔ Column USER_LOGIN_ID added as nullable.');
        } catch (addErr) {
          if (addErr.message.includes('ORA-01430')) {
            console.log('   – Column USER_LOGIN_ID already exists.');
          } else {
            throw addErr;
          }
        }

        // 2. Fetch and backfill existing users (only if any null exists)
        const checkNull = await connUsers.execute(
          `SELECT COUNT(*) AS cnt FROM users WHERE user_login_id IS NULL`
        );
        if (checkNull.rows[0].CNT > 0) {
          console.log('   🔧 Backfilling null User IDs...');
          const existing = await connUsers.execute(
            `SELECT user_id, role, name FROM users WHERE user_login_id IS NULL`
          );
          for (const row of existing.rows) {
            const roleBase = (row.ROLE || 'user').toLowerCase().trim();
            const loginId = `${roleBase}${row.USER_ID}`;
            await connUsers.execute(
              `UPDATE users SET user_login_id = :loginId WHERE user_id = :userId`,
              { loginId, userId: row.USER_ID }
            );
          }
          console.log(`   ✔ Backfilled ${existing.rows.length} existing users.`);
        }

        // 3. Make column NOT NULL
        try {
          await connUsers.execute(
            `ALTER TABLE users MODIFY (user_login_id VARCHAR2(50) NOT NULL)`
          );
          console.log('   ✔ Column USER_LOGIN_ID modified to NOT NULL.');
        } catch (nnErr) {
          if (nnErr.message.includes('ORA-01442') || nnErr.message.includes('already NOT NULL') || nnErr.message.includes('already null') || nnErr.message.includes('already NOT NULL')) {
            console.log('   – Column USER_LOGIN_ID is already NOT NULL.');
          } else {
            throw nnErr;
          }
        }

        // 4. Create unique index
        try {
          await connUsers.execute(
            `CREATE UNIQUE INDEX UK_USERS_LOGIN_ID ON users (user_login_id)`
          );
          console.log('   ✔ Unique index UK_USERS_LOGIN_ID created.');
        } catch (idxErr) {
          if (idxErr.message.includes('ORA-00955') || idxErr.message.includes('already exists')) {
            console.log('   – Unique index UK_USERS_LOGIN_ID already exists.');
          } else {
            throw idxErr;
          }
        }

      } finally {
        await connUsers.close();
      }
    } catch (migErr) {
      console.error('Migration error on USERS table:', migErr.message);
    }

    // Serve React frontend
    app.use(express.static(path.join(process.cwd(), "client/build")));

    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "client/build", "index.html"));
    });

    app.listen(PORT, () => {
      console.log(`🚀  Drug Indenting Server running on http://localhost:${PORT}`);
    });

  } catch (err) {
    console.error('❌  Boot failed:', err.message);
    process.exit(1);
  }
}

// Only auto-start when run directly (`node server.js`) — not when imported
// by tests, so importing this file never tries to reach Oracle on its own.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  boot();
}

export default app;




