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

const app = express();
app.use(cors());
const PORT = 5000;


app.use(express.json());





// =============================================================
// Oracle DB Connection Pool
// =============================================================
let pool;

async function initDB() {
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  oracledb.autoCommit = true;
  oracledb.fetchAsString = [oracledb.CLOB];

  pool = await oracledb.createPool({
    user: 'moscmar18',
    password: 'moscmar18',
    connectString: '192.168.1.104:1521/lifetest',
    poolMin: 0,
    poolMax: 10,
    poolIncrement: 1,
  });
  console.log('✅  Oracle DB pool created');
}

async function getConn() {
  return pool.getConnection();
}

// =============================================================
// Schema Setup — runs BEFORE server starts listening
// =============================================================
async function setupSchema() {
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
          created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
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
}

// =============================================================
// Helper: notify users
// =============================================================
async function createNotification(conn, userId, requestId, message) {
  await conn.execute(
    `INSERT INTO notifications (user_id, request_id, message)
     VALUES (:userId, :requestId, :message)`,
    { userId, requestId, message }
  );
}

// =============================================================
// Helper: write audit log
// =============================================================
async function writeAudit(conn, requestId, action, performedBy, fromStage, toStage, remarks) {
  await conn.execute(
    `INSERT INTO audit_logs (request_id, action, performed_by, from_stage, to_stage, remarks)
     VALUES (:requestId, :action, :performedBy, :fromStage, :toStage, :remarks)`,
    { requestId, action, performedBy, fromStage, toStage, remarks: remarks || null }
  );
}
// =============================================================
// STAGE MAPS
// =============================================================
const NEXT_STAGE = {
  HOD: 'PharmacistInitialReview',          // HOD approve → Pharmacist Initial Review
  PharmacistInitialReview: 'PharmacyHead', // Pharmacist Initial Review approve → PharmacyHead
  PharmacyHead: 'DTCCommittee',
  DTCCommittee: 'Pharmacist',              // DTC first-pass → Pharmacist analysis
  Pharmacist: 'PharmacyHeadReview2',       // Pharmacist submits alternatives → PH review
  PharmacyHeadReview2: 'DTCFinal',         // PH approves → DTC final
  PharmacistCorrection: 'PharmacyHeadReview2', // Pharmacist resubmits corrected sheet → PH
  DTCFinal: 'CEO',                         // DTC final → CEO
  CEO: 'PharmacistOrder',                  // CEO final → Pharmacist Order Placement
  EmergencyDTC: 'PharmacistOrder',         // Emergency DTC approve → Pharmacist
};

const STAGE_LABELS = {
  HOD: 'Head of Department',
  PharmacistInitialReview: 'Pharmacist (Initial Review)',
  PharmacyHead: 'Pharmacy Head',
  DTCCommittee: 'DTC Committee',
  Pharmacist: 'Pharmacist',
  PharmacyHeadReview2: 'Pharmacy Head (Review 2)',
  PharmacistCorrection: 'Pharmacist (Correction Required)',
  DTCFinal: 'DTC Committee (Final)',
  CEO: 'CEO',
  Final: 'Final Approval',
  Rejected: 'Rejected',
  EmergencyDTC: 'DTC Committee (Emergency)',
  PharmacistOrder: 'Pharmacist (Order Placement)',
  OrderPlaced: 'Order Placed',
};

// =============================================================
// HELPER: compute derived pricing fields from v2 base inputs
// Called server-side before every drug_alternatives INSERT so that
// existing consumers of mrp/rate/markup_margin/... columns still work.
// =============================================================
function computeAltDerived(alt) {
  const mp = parseFloat(alt.mrp_per_pack) || 0;
  const rp = parseFloat(alt.rate_per_pack) || 0;
  const g = parseFloat(alt.gst_percent) || 0;
  const pk = parseFloat(alt.pack) || 0;
  const q = parseFloat(alt.qty) || 0;
  const o = parseFloat(alt.offer) || 0;

  // MRP is inclusive of GST natively; do not apply/multiply GST
  const mrp = pk > 0 ? +(mp / pk).toFixed(4) : null;
  const rate = pk > 0 ? +(rp * (1 + g / 100) / pk).toFixed(4) : null;

  const markup = mrp != null && rate != null && rate > 0
    ? +(((mrp - rate) / rate) * 100).toFixed(2) : null;

  const netRate = rate != null ? ((q + o) > 0 ? +(rate * q / (q + o)).toFixed(4) : rate) : null;

  const profit = mrp != null && netRate != null && mrp > 0
    ? +(((mrp - netRate) / mrp) * 100).toFixed(2) : null;

  const absMargin = mrp != null && netRate != null
    ? +(mrp - netRate).toFixed(4) : null;

  const totalMargin = mrp != null && netRate != null && netRate > 0
    ? +(((mrp - netRate) / netRate) * 100).toFixed(2) : null;

  // Fall back to any values the frontend already computed (old-format submissions)
  return {
    mrp: mrp ?? parseFloat(alt.mrp) ?? null,
    rate: rate ?? parseFloat(alt.rate) ?? null,
    markup_margin: markup ?? parseFloat(alt.markupmargin) ?? null,
    profit_margin: profit ?? parseFloat(alt.profit_margin) ?? null,
    absolute_margin: absMargin ?? parseFloat(alt.margin) ?? null,
    net_rate: netRate ?? parseFloat(alt.net_rate) ?? null,
    total_margin: totalMargin ?? parseFloat(alt.margin) ?? null,
  };
}

// =============================================================
// POST /api/requests  — Doctor submits a new drug request
// =============================================================
app.post('/api/requests', async (req, res) => {
  const conn = await getConn();
  try {
    const {
      doctor_id, med_rep_name, med_rep_email, med_rep_phone,
      request_type, formulary_request_type, category, request_source_type,
      brand_name, generic_name, dose_strength, dosage_form,
      manufacturer, marketer, existing_brands,
      clinical_justification, expected_patients_pm, cost_reduction_benefit,
      medicine_quantity, ai_content
    } = req.body;

    // Validate source type
    const sourceType = (request_source_type || 'PROMOTIONAL').toUpperCase();
    if (!['PROMOTIONAL', 'NON_PROMOTIONAL'].includes(sourceType)) {
      return res.status(400).json({ error: 'request_source_type must be PROMOTIONAL or NON_PROMOTIONAL.' });
    }

    const isPromotional = sourceType === 'PROMOTIONAL';
    let formatai = ai_content ? ai_content.replace(/\n/g, '<br>') : '';

    // Base required fields (always needed)
    const baseRequired = {
      doctor_id, request_type, formulary_request_type, category, brand_name, generic_name,
      dose_strength, dosage_form, manufacturer, marketer,
      clinical_justification, expected_patients_pm
    };

    // Validate medicine_quantity
    if (medicine_quantity !== undefined && medicine_quantity !== null && String(medicine_quantity).trim() !== '') {
      if (isNaN(Number(medicine_quantity)) || Number(medicine_quantity) <= 0) {
        return res.status(400).json({ error: `Field 'medicine_quantity' must be a positive number.` });
      }
    } else if (!isPromotional) {
      return res.status(400).json({ error: `Field 'medicine_quantity' is required for Non-Promotional requests.` });
    }
    for (const [key, val] of Object.entries(baseRequired)) {
      if (val === undefined || val === null || String(val).trim() === '') {
        return res.status(400).json({ error: `Field '${key}' is required.` });
      }
    }

    // Conditional: Med Rep fields required only for PROMOTIONAL
    if (isPromotional) {
      const repRequired = { med_rep_name, med_rep_email, med_rep_phone };
      for (const [key, val] of Object.entries(repRequired)) {
        if (!val || String(val).trim() === '') {
          return res.status(400).json({ error: `Field '${key}' is required for Promotional requests.` });
        }
      }
    }

    const qCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_request_quotas WHERE user_id = :userId`,
      { userId: doctor_id }
    );
    if (qCheck.rows[0].CNT === 0) {
      await conn.execute(
        `INSERT INTO user_request_quotas (user_id, quarterly_limit, updated_by)
         VALUES (:userId, 10, :updatedBy)`,
        { userId: doctor_id, updatedBy: doctor_id },
        { autoCommit: true }
      );
    }

    const quotaResult = await conn.execute(
      `SELECT
         q.quarterly_limit,
         (
           SELECT COUNT(*) FROM drug_requests dr
           WHERE dr.created_by_user_id = :userId
             AND dr.created_at >= TRUNC(SYSDATE, 'Q')
             AND dr.created_at <  ADD_MONTHS(TRUNC(SYSDATE, 'Q'), 3)
         ) AS used_this_quarter
       FROM user_request_quotas q
       WHERE q.user_id = :userId`,
      { userId: doctor_id }
    );
    const qRow = quotaResult.rows[0];
    const qLimit = qRow.QUARTERLY_LIMIT;
    const qUsed = qRow.USED_THIS_QUARTER;

    if (qUsed >= qLimit) {
      return res.status(400).json({
        success: false,
        error: 'Quarterly request quota exceeded.'
      });
    }

    // -- Blacklist validation --
    const blCheck = await conn.execute(
      `SELECT company_type, remarks FROM blacklisted_companies
       WHERE is_active = 1
         AND (
           (company_type = 'MANUFACTURER' AND UPPER(TRIM(company_name)) = UPPER(TRIM(:mfg)))
           OR
           (company_type = 'MARKETER' AND UPPER(TRIM(company_name)) = UPPER(TRIM(:mkt)))
         )
       FETCH FIRST 1 ROW ONLY`,
      { mfg: manufacturer || '', mkt: marketer || '' }
    );
    if (blCheck.rows.length > 0) {
      const blRow = blCheck.rows[0];
      const blType = blRow.COMPANY_TYPE === 'MANUFACTURER' ? 'Manufacturer' : 'Marketer';
      return res.status(400).json({
        success: false,
        error: `Request denied. ${blType} is blacklisted by DTC.`,
        remarks: blRow.REMARKS || ''
      });
    }

    // Fetch creator role & department to determine workflow
    const creatorRes = await conn.execute(`SELECT role, department FROM users WHERE user_id = :id`, { id: doctor_id });
    if (creatorRes.rows.length === 0) return res.status(400).json({ error: 'User not found.' });
    const creatorRole = creatorRes.rows[0].ROLE;
    const creatorDept = creatorRes.rows[0].DEPARTMENT;

    // Initialize workflow variables
    let initialStatus = 'HOD_APPROVED';
    let initialStage = 'PharmacistInitialReview';
    let hodId = null;

    // Determine workflow based on role
    if (creatorRole && creatorRole.toLowerCase() === 'doctor') {
      // Only attempt HOD routing if the doctor has a department set
      if (creatorDept && creatorDept.trim() !== '') {
        const hodRes = await conn.execute(
          `SELECT user_id FROM users WHERE UPPER(role) = 'HOD' AND UPPER(TRIM(department)) = UPPER(TRIM(:dept)) AND is_active = 1`,
          { dept: creatorDept.trim() }
        );
        if (hodRes.rows.length > 0) {
          // HOD found → route through HOD first
          hodId = hodRes.rows[0].USER_ID;
          initialStatus = 'PENDING_HOD';
          initialStage = 'HOD';
        } else {
          // No HOD for this department → route to Pharmacist (Initial Review)
          console.warn(`[WARN] No HOD found for department '${creatorDept}'. Routing to PharmacistInitialReview.`);
          initialStatus = 'HOD_APPROVED';
          initialStage = 'PharmacistInitialReview';
        }
      } else {
        // Doctor has no department set → route to Pharmacist (Initial Review)
        console.warn(`[WARN] Doctor (user_id=${doctor_id}) has no department set. Routing to PharmacistInitialReview.`);
        initialStatus = 'HOD_APPROVED';
        initialStage = 'PharmacistInitialReview';
      }
    } else if (creatorRole && creatorRole.toLowerCase() === 'hod') {
      initialStatus = 'HOD_APPROVED';
      initialStage = 'PharmacistInitialReview';
    }

    const isHOD = creatorRole && creatorRole.toLowerCase() === 'hod';

    const insertResult = await conn.execute(
      `INSERT INTO drug_requests (
         doctor_id, created_by_user_id, created_by_role, hod_id,
         med_rep_name, med_rep_email, med_rep_phone,
         request_type, formulary_request_type, category, request_source_type,
         brand_name, generic_name, dose_strength, dosage_form,
         manufacturer, marketer, existing_brands,
         clinical_justification, expected_patients_pm, cost_reduction_benefit,
         medicine_quantity, ai_content,
         status, current_stage,
         approved_by_hod, hod_action_timestamp
       ) VALUES (
         :doctor_id, :doctor_id, :created_by_role, :hod_id,
         :med_rep_name, :med_rep_email, :med_rep_phone,
         :request_type, :formulary_request_type, :category, :request_source_type,
         :brand_name, :generic_name, :dose_strength, :dosage_form,
         :manufacturer, :marketer, :existing_brands,
         :clinical_justification, :expected_patients_pm, :cost_reduction_benefit,
         :medicine_quantity, :ai_content,
         :status, :current_stage,
         :approved_by_hod, :hod_action_timestamp
       ) RETURNING request_id INTO :request_id`,
      {
        doctor_id,
        created_by_role: creatorRole,
        hod_id: hodId,
        med_rep_name: isPromotional ? med_rep_name : null,
        med_rep_email: isPromotional ? med_rep_email : null,
        med_rep_phone: isPromotional ? med_rep_phone : null,
        request_type, formulary_request_type, category,
        request_source_type: sourceType,
        brand_name, generic_name, dose_strength, dosage_form,
        manufacturer, marketer,
        existing_brands: existing_brands || null,
        clinical_justification, expected_patients_pm,
        ai_content: formatai || null,
        cost_reduction_benefit: cost_reduction_benefit ? 1 : 0,
        medicine_quantity: medicine_quantity ? Number(medicine_quantity) : null,
        status: initialStatus,
        current_stage: initialStage,
        approved_by_hod: isHOD ? 1 : 0,
        hod_action_timestamp: isHOD ? new Date() : null,
        request_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      }
    );
    const requestId = insertResult.outBinds.request_id[0];

    const sourceLabel = isPromotional ? 'Promotional (Industry-Sponsored)' : 'Non-Promotional (Clinician-Initiated)';
    const classLabel = formulary_request_type === 'FORMULARY' ? '[Formulary Request]' : '[Non-Formulary Request]';

    await writeAudit(conn, requestId, 'SUBMITTED', doctor_id, null, initialStage,
      `Source: ${sourceLabel} | Class: ${formulary_request_type}`);

    if (creatorRole && creatorRole.toLowerCase() === 'doctor' && hodId) {
      await createNotification(conn, hodId, requestId,
        `${classLabel} New ${sourceLabel} drug request #${requestId} submitted by Dr. ${creatorDept}. Awaiting HOD approval.`
      );
    } else if (creatorRole && creatorRole.toLowerCase() === 'hod') {
      const pharmUsers = await conn.execute(`SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACIST' AND is_active = 1`);
      for (const row of pharmUsers.rows) {
        await createNotification(conn, row.USER_ID, requestId,
          `${classLabel} New ${sourceLabel} drug request #${requestId} submitted by HOD. Drug: ${brand_name}. Awaiting initial review.`
        );
      }
    } else {
      const phUsers = await conn.execute(`SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACYHEAD' AND is_active = 1`);
      const submitterText = `Dr. ${creatorDept || ''}`;
      for (const row of phUsers.rows) {
        await createNotification(conn, row.USER_ID, requestId,
          `${classLabel} New ${sourceLabel} drug request #${requestId} submitted by ${submitterText}. Drug: ${brand_name}. Awaiting your review.`
        );
      }
    }

    res.status(201).json({ message: 'Drug request submitted successfully.', request_id: requestId });
  } catch (err) {
    console.error('POST /api/requests error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// GET /api/requests/:requestId/existing-generic-data
app.get('/api/requests/:requestId/existing-generic-data', async (req, res) => {
  const conn = await getConn();
  try {
    const rid = parseInt(req.params.requestId);
    const result = await conn.execute(
      `SELECT existing_generic_data FROM drug_requests WHERE request_id = :rid`,
      { rid }
    );
    if (!result.rows.length) return res.json({ existing_generic_data: null });
    const row = result.rows[0];
    let parsed = null;
    try { parsed = row.EXISTING_GENERIC_DATA ? JSON.parse(row.EXISTING_GENERIC_DATA) : null; } catch { parsed = null; }
    res.json({ existing_generic_data: parsed });
  } catch (err) {
    console.error('GET existing-generic-data error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// GET /api/requests/:role/:userId
// =============================================================
app.get('/api/requests/:role/:userId', async (req, res) => {
  const conn = await getConn();

  try {

    const { role, userId } = req.params;
    const {
      status,
      category,
      from_date,
      to_date,
      source_type,
      formulary_type
    } = req.query;

    const normalizedRole = role?.toLowerCase();

    let query = '';
    let binds = {};

    if (normalizedRole === 'doctor') {

      query = `
        SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept, u_dtc.name AS dtc_reviewer_name
        FROM drug_requests dr
        JOIN users u ON u.user_id = dr.doctor_id
        LEFT JOIN users u_dtc ON u_dtc.user_id = dr.dtc_reviewed_by
        WHERE dr.doctor_id = :userId
      `;

      binds = { userId };

    } else if (normalizedRole === 'hod') {

      query = `
        SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept, u_dtc.name AS dtc_reviewer_name
        FROM drug_requests dr
        JOIN users u ON u.user_id = dr.doctor_id
        LEFT JOIN users u_dtc ON u_dtc.user_id = dr.dtc_reviewed_by
        WHERE (dr.hod_id = :userId
          AND dr.current_stage = 'HOD'
          AND dr.status = 'PENDING_HOD')
          OR (dr.created_by_user_id = :userId)
      `;

      binds = { userId };

    } else if (normalizedRole === 'pharmacyhead') {

      query = `
        SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept, u_dtc.name AS dtc_reviewer_name
        FROM drug_requests dr
        JOIN users u ON u.user_id = dr.doctor_id
        LEFT JOIN users u_dtc ON u_dtc.user_id = dr.dtc_reviewed_by
        WHERE (
          dr.current_stage IN ('PharmacyHead','PharmacyHeadReview2')
          AND dr.status IN ('Pending', 'HOD_APPROVED')
        )
        OR dr.is_emergency = 1
      `;

    } else if (normalizedRole === 'pharmacist') {

      query = `
        SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept, u_dtc.name AS dtc_reviewer_name
        FROM drug_requests dr
        JOIN users u ON u.user_id = dr.doctor_id
        LEFT JOIN users u_dtc ON u_dtc.user_id = dr.dtc_reviewed_by
        WHERE (
          dr.current_stage = 'PharmacistInitialReview'
          AND dr.status = 'HOD_APPROVED'
        )
        OR (
          dr.current_stage = 'Pharmacist'
          AND dr.status = 'Pending'
        )
        OR (
          dr.current_stage = 'PharmacistCorrection'
          AND dr.status = 'REVERTED_FOR_CORRECTION'
        )
        OR dr.is_emergency = 1
        OR dr.status IN ('APPROVED_PENDING_ORDER', 'ORDER_PLACED', 'INVENTORY_RECEIVED')
        OR dr.created_by_user_id = :userId
      `;

      binds = { userId };

    } else if (normalizedRole === 'dtccommittee') {

      query = `
        SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept, u_dtc.name AS dtc_reviewer_name
        FROM drug_requests dr
        JOIN users u ON u.user_id = dr.doctor_id
        LEFT JOIN users u_dtc ON u_dtc.user_id = dr.dtc_reviewed_by
        WHERE (
          dr.current_stage IN ('DTCCommittee','DTCFinal')
          AND dr.status IN ('Pending', 'PHARMACY_HEAD_REJECTED_PENDING_DTC')
        )
        OR (
          dr.current_stage = 'EmergencyDTC'
          AND dr.status = 'EMERGENCY_PENDING_DTC'
        )
      `;

    } else if (normalizedRole === 'ceo') {

      query = `
        SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept, u_dtc.name AS dtc_reviewer_name
        FROM drug_requests dr
        JOIN users u ON u.user_id = dr.doctor_id
        LEFT JOIN users u_dtc ON u_dtc.user_id = dr.dtc_reviewed_by
        WHERE dr.current_stage = 'CEO'
        AND dr.status = 'Pending'
      `;

    } else {

      console.log("INVALID ROLE:", role);

      return res.status(400).json({
        error: 'Invalid role.'
      });
    }

    let whereClause = '';

    if (status) {
      whereClause += ` AND dr.status = :status`;
      binds.status = status;
    }

    if (category) {
      whereClause += ` AND LOWER(dr.category) LIKE LOWER(:category)`;
      binds.category = `%${category}%`;
    }

    if (from_date) {
      whereClause += ` AND dr.created_at >= TO_TIMESTAMP(:from_date, 'YYYY-MM-DD')`;
      binds.from_date = from_date;
    }

    if (to_date) {
      whereClause += ` AND dr.created_at < TO_TIMESTAMP(:to_date, 'YYYY-MM-DD') + 1`;
      binds.to_date = to_date;
    }

    if (source_type) {
      whereClause += ` AND dr.request_source_type = :source_type`;
      binds.source_type = source_type;
    }

    if (formulary_type) {
      whereClause += ` AND dr.formulary_request_type = :formulary_type`;
      binds.formulary_type = formulary_type;
    }

    const finalQuery = `
      SELECT * FROM (${query}) dr
      WHERE 1=1 ${whereClause}
      ORDER BY dr.created_at DESC
    `;

    const result = await conn.execute(finalQuery, binds);
    const rows = result.rows;

    for (const r of rows) {
      r.DTC_REVIEWED_BY_NAME = r.DTC_REVIEWED_BY_NAME || r.DTC_REVIEWER_NAME || '';
    }

    if (rows.length > 0) {
      const requestIds = rows.map(r => r.REQUEST_ID);
      const placeholders = requestIds.map((_, idx) => `:id${idx}`).join(',');
      const bindParams = {};
      requestIds.forEach((id, idx) => {
        bindParams[`id${idx}`] = id;
      });

      const entriesResult = await conn.execute(
        `SELECT * FROM drug_effective_entries WHERE request_id IN (${placeholders}) ORDER BY entry_id ASC`,
        bindParams
      );

      const entriesMap = {};
      entriesResult.rows.forEach(entry => {
        const rid = entry.REQUEST_ID;
        if (!entriesMap[rid]) {
          entriesMap[rid] = [];
        }
        entriesMap[rid].push({
          entry_id: entry.ENTRY_ID,
          request_id: entry.REQUEST_ID,
          drug_name: entry.DRUG_NAME,
          effective_created_at: entry.EFFECTIVE_CREATED_AT,
          remarks: entry.REMARKS,
          created_by: entry.CREATED_BY,
          created_at: entry.CREATED_AT
        });
      });

      rows.forEach(r => {
        r.effective_drug_entries = entriesMap[r.REQUEST_ID] || [];
      });
    }

    res.json(rows);

  } catch (err) {

    console.error('GET /api/requests error:', err);

    res.status(500).json({
      error: 'Internal server error.',
      detail: err.message
    });

  } finally {
    await conn.close();
  }
});

// =============================================================
// PUT /api/requests/:id/approve
// =============================================================
app.put('/api/requests/:id/approve', async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.id);
    const { performed_by, remarks } = req.body;

    const reqResult = await conn.execute(
      `SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept
       FROM drug_requests dr
       JOIN users u ON u.user_id = dr.doctor_id
       WHERE dr.request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });

    const dr = reqResult.rows[0];
    if (dr.STATUS !== 'Pending' && dr.STATUS !== 'EMERGENCY_PENDING_DTC' && dr.STATUS !== 'PENDING_HOD' && dr.STATUS !== 'HOD_APPROVED' && dr.STATUS !== 'PHARMACY_HEAD_REJECTED_PENDING_DTC') return res.status(400).json({ error: 'Request is no longer pending.' });

    const fromStage = dr.CURRENT_STAGE;
    let toStage = NEXT_STAGE[fromStage];

    // PHARMACIST Direct Flow overrides
    if (dr.REQUEST_SOURCE_TYPE === 'PHARMACIST') {
      if (fromStage === 'DTCCommittee') {
        toStage = 'CEO'; // Skip alternatives
      } else if (fromStage === 'CEO') {
        toStage = 'PharmacistOrder'; // Go straight to order placed
      }
    }

    // ── Block DTCFinal from using /approve — must use /dtc/final-select instead
    if (fromStage === 'DTCFinal') {
      return res.status(400).json({
        error: 'DTCFinal stage requires drug selection. Use POST /api/dtc/final-select/:id instead of /approve.'
      });
    }


    const isFinal = (toStage === 'Final');
    const remarksCol = fromStage === 'HOD' ? 'hod_remarks'
      : fromStage === 'PharmacistInitialReview' ? 'pharmacist_remarks'
        : fromStage === 'PharmacyHead' ? 'ph_remarks'
          : fromStage === 'DTCCommittee' ? 'dtc_remarks'
            : fromStage === 'Pharmacist' ? 'pharmacist_remarks'
              : fromStage === 'PharmacyHeadReview2' ? 'ph_remarks2'
                : fromStage === 'DTCFinal' ? 'dtc_final_remarks'
                  : fromStage === 'EmergencyDTC' ? 'dtc_remarks'
                    : 'ceo_remarks';

    const isEmergency = dr.IS_EMERGENCY === 1;
    let newStatus = isEmergency ? 'EMERGENCY_APPROVED' : (isFinal ? 'Approved' : 'Pending');
    if (fromStage === 'HOD') newStatus = 'HOD_APPROVED';
    if (toStage === 'PharmacistOrder') newStatus = 'APPROVED_PENDING_ORDER';

    let updateQuery = `UPDATE drug_requests
          SET current_stage = :toStage,
              status        = :newStatus,
              ${remarksCol} = :remarks,
              updated_at    = CURRENT_TIMESTAMP`;
    if (fromStage === 'HOD') {
      updateQuery += `, approved_by_hod = 1, hod_action_timestamp = CURRENT_TIMESTAMP`;
    }
    updateQuery += ` WHERE request_id = :requestId`;

    await conn.execute(
      updateQuery,
      { toStage, newStatus, remarks: remarks || null, requestId }
    );

    await writeAudit(conn, requestId, 'APPROVED', performed_by, fromStage, toStage, remarks);

    // Save approval remarks to history
    let remarkRole = null;
    if (fromStage === 'HOD') remarkRole = 'HOD';
    else if (fromStage === 'PharmacyHead' || fromStage === 'PharmacyHeadReview2') remarkRole = 'PharmacyHead';
    else if (fromStage === 'DTCCommittee' || fromStage === 'EmergencyDTC') remarkRole = 'DTC';
    else if (fromStage === 'CEO') remarkRole = 'CEO';

    if (remarkRole && remarks) {
      const customRemarksVal = req.body.customRemarks || remarks;
      await saveApprovalRemarks(conn, customRemarksVal, remarkRole, performed_by);
    }

    if (isFinal) {
      // Notify doctor
      await createNotification(conn, dr.DOCTOR_ID, requestId,
        `🎉 Your drug request #${requestId} (${dr.BRAND_NAME}) has received FINAL APPROVAL!`
      );
      // Notify Pharmacist to initiate drug order
      const pharmUsers = await conn.execute(
        `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACIST' AND is_active = 1`
      );
      for (const row of pharmUsers.rows) {
        await createNotification(conn, row.USER_ID, requestId,
          `✅ Drug request #${requestId} (${dr.BRAND_NAME}) is FINALLY APPROVED. Please initiate the drug order process.`
        );
      }
    } else {
      if (toStage === 'PharmacistOrder') {
        const orderUsers = await conn.execute(
          `SELECT user_id FROM users WHERE UPPER(role) IN ('PHARMACIST', 'PHARMACYHEAD') AND is_active = 1`
        );
        for (const row of orderUsers.rows) {
          await createNotification(conn, row.USER_ID, requestId,
            `🚨 Emergency request #${requestId} (${dr.BRAND_NAME}) has been APPROVED. Please place the order immediately.`
          );
        }
      } else {
        // Determine which role(s) to notify based on toStage
        const stageRoleMap = {
          PharmacistInitialReview: 'Pharmacist',
          PharmacyHead: 'PharmacyHead',
          DTCCommittee: 'DTCCommittee',
          Pharmacist: 'Pharmacist',
          PharmacyHeadReview2: 'PharmacyHead',
          DTCFinal: 'DTCCommittee',
          CEO: 'CEO',
        };
        const nextRole = stageRoleMap[toStage];
        if (nextRole) {
          let roleQuery = `SELECT user_id FROM users WHERE UPPER(role) = :role AND is_active = 1`;
          let binds = { role: nextRole.toUpperCase() };
          if (nextRole.toUpperCase() === 'DTCCOMMITTEE') {
            roleQuery = `SELECT user_id FROM users WHERE UPPER(role) IN ('DTC', 'DTCCOMMITTEE') AND is_active = 1`;
            binds = {};
          }
          const nextUsers = await conn.execute(roleQuery, binds);
          for (const row of nextUsers.rows) {
            await createNotification(conn, row.USER_ID, requestId,
              `Drug request #${requestId} (${dr.BRAND_NAME}) approved by ${STAGE_LABELS[fromStage]}. Awaiting your review.`
            );
          }
        }
      }
      let doctorMsg = `Your drug request #${requestId} (${dr.BRAND_NAME}) has been approved by ${STAGE_LABELS[fromStage]} and forwarded to ${STAGE_LABELS[toStage]}.`;
      const internalStages = ['PharmacistInitialReview', 'PharmacyHead', 'Pharmacist', 'PharmacyHeadReview2', 'DTCCommittee', 'DTCFinal'];
      if (fromStage === 'HOD' || internalStages.includes(toStage)) {
        doctorMsg = `Your drug request #${requestId} (${dr.BRAND_NAME}) has been forwarded to DTC Committee for further review.`;
      }
      await createNotification(conn, dr.DOCTOR_ID, requestId, doctorMsg);
    }

    res.json({
      message: isFinal ? 'Request finally approved.' : `Request approved and forwarded to ${STAGE_LABELS[toStage]}.`,
      new_stage: toStage,
      new_status: newStatus
    });
  } catch (err) {
    console.error('PUT approve error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// PUT /api/requests/:id/reject
// =============================================================
app.put('/api/requests/:id/reject', async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.id);
    const { performed_by, remarks, customRemarks } = req.body;

    if (!remarks || remarks.trim() === '') {
      return res.status(400).json({ error: 'Remarks are mandatory when rejecting a request.' });
    }

    const reqResult = await conn.execute(
      `SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept
       FROM drug_requests dr
       JOIN users u ON u.user_id = dr.doctor_id
       WHERE dr.request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });

    const dr = reqResult.rows[0];
    if (dr.STATUS !== 'Pending' && dr.STATUS !== 'EMERGENCY_PENDING_DTC' && dr.STATUS !== 'PENDING_HOD' && dr.STATUS !== 'HOD_APPROVED' && dr.STATUS !== 'PHARMACY_HEAD_REJECTED_PENDING_DTC') return res.status(400).json({ error: 'Request is no longer pending.' });

    const fromStage = dr.CURRENT_STAGE;
    const remarksCol = fromStage === 'HOD' ? 'hod_remarks'
      : fromStage === 'PharmacistInitialReview' ? 'pharmacist_remarks'
        : fromStage === 'PharmacyHead' ? 'ph_remarks'
          : fromStage === 'DTCCommittee' ? 'dtc_remarks'
            : fromStage === 'Pharmacist' ? 'pharmacist_remarks'
              : fromStage === 'PharmacyHeadReview2' ? 'ph_remarks2'
                : fromStage === 'DTCFinal' ? 'dtc_final_remarks'
                  : fromStage === 'EmergencyDTC' ? 'dtc_remarks'
                    : 'ceo_remarks';

    const isEmergency = dr.IS_EMERGENCY === 1;
    let rejectStatus = isEmergency ? 'EMERGENCY_REJECTED' : 'Rejected';
    let toStage = 'Rejected';

    if (fromStage === 'HOD') rejectStatus = 'HOD_REJECTED';
    else if (fromStage === 'PharmacistInitialReview') {
      rejectStatus = 'Rejected';
      toStage = 'Rejected';
    } else if (fromStage === 'PharmacyHead') {
      rejectStatus = 'PHARMACY_HEAD_REJECTED_PENDING_DTC';
      toStage = 'DTCCommittee';
    }

    let updateQuery = `UPDATE drug_requests
          SET current_stage = :toStage,
              status        = :rejectStatus,
              ${remarksCol} = :remarks,
              updated_at    = CURRENT_TIMESTAMP`;
    if (fromStage === 'HOD') {
      updateQuery += `, hod_action_timestamp = CURRENT_TIMESTAMP`;
    }
    updateQuery += ` WHERE request_id = :requestId`;

    await conn.execute(
      updateQuery,
      { toStage, rejectStatus, remarks, requestId }
    );

    await writeAudit(conn, requestId, 'REJECTED', performed_by, fromStage, toStage, remarks);

    if (fromStage === 'PharmacyHead') {
      const dtcUsers = await conn.execute(`SELECT user_id FROM users WHERE UPPER(role) IN ('DTC', 'DTCCOMMITTEE') AND is_active = 1`);
      for (const row of dtcUsers.rows) {
        await createNotification(conn, row.USER_ID, requestId,
          `Drug request #${requestId} (${dr.BRAND_NAME}) was rejected by Pharmacy Head and forwarded for your final review. Reason: ${remarks}`
        );
      }
      // Notify Doctor & HOD neutrally
      await createNotification(conn, dr.DOCTOR_ID, requestId,
        `Your drug request #${requestId} (${dr.BRAND_NAME}) has been forwarded to DTC Committee for further review.`
      );
      if (dr.HOD_ID) {
        await createNotification(conn, dr.HOD_ID, requestId,
          `Drug request #${requestId} (${dr.BRAND_NAME}) has been forwarded to DTC Committee for further review.`
        );
      }
    } else {
      // For all other stages (including PharmacistInitialReview, DTC, CEO) — notify the Doctor
      await createNotification(conn, dr.DOCTOR_ID, requestId,
        `Your drug request #${requestId} (${dr.BRAND_NAME}) has been rejected by ${STAGE_LABELS[fromStage] || fromStage}. Reason: ${remarks}`
      );
    }

    if (fromStage === 'DTCCommittee' || fromStage === 'CEO') {
      const phUsers = await conn.execute(
        `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACYHEAD' AND is_active = 1`
      );
      for (const row of phUsers.rows) {
        await createNotification(conn, row.USER_ID, requestId,
          `Drug request #${requestId} (${dr.BRAND_NAME}) was rejected by DTC Committee. Reason: ${remarks}`
        );
      }
    }
    if (fromStage === 'CEO') {
      const dtcUsers = await conn.execute(
        `SELECT user_id FROM users WHERE UPPER(role) IN ('DTC', 'DTCCOMMITTEE') AND is_active = 1`
      );
      for (const row of dtcUsers.rows) {
        await createNotification(conn, row.USER_ID, requestId,
          `Drug request #${requestId} (${dr.BRAND_NAME}) was rejected by DTC Committee. Reason: ${remarks}`
        );
      }
    }

    // Safe save of manually entered custom remarks to history
    if (customRemarks && Array.isArray(customRemarks)) {
      try {
        for (const remark of customRemarks) {
          const trimmedRemark = remark.trim();
          if (trimmedRemark === '') continue;

          // Check if same remark already exists (case-insensitive + trimmed)
          const remarkCheck = await conn.execute(
            `SELECT history_id, usage_count FROM rejection_remark_history
             WHERE LOWER(TRIM(remark_text)) = LOWER(TRIM(:remarkText))`,
            { remarkText: trimmedRemark }
          );

          if (remarkCheck.rows.length > 0) {
            const historyId = remarkCheck.rows[0].HISTORY_ID;
            await conn.execute(
              `UPDATE rejection_remark_history
               SET usage_count = usage_count + 1,
                   last_used_at = CURRENT_TIMESTAMP
               WHERE history_id = :historyId`,
              { historyId }
            );
          } else {
            await conn.execute(
              `INSERT INTO rejection_remark_history (remark_text, created_by, usage_count, last_used_at, is_active)
               VALUES (:remarkText, :createdBy, 1, CURRENT_TIMESTAMP, 1)`,
              { remarkText: trimmedRemark, createdBy: performed_by || null }
            );
          }
        }
      } catch (historyErr) {
        console.error('Failed to save rejection remark history:', historyErr);
      }
    }

    res.json({ message: 'Request rejected successfully.' });
  } catch (err) {
    console.error('PUT reject error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// PUT /api/requests/:id/initial-review-approve
// Dedicated endpoint for Pharmacist Initial Review approval
// Saves effective_created_at and advances stage to PharmacyHead
// =============================================================
app.put('/api/requests/:id/initial-review-approve', async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.id);
    const { performed_by, effective_created_at, remarks, effective_drug_entries } = req.body;

    const reqResult = await conn.execute(
      `SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept
       FROM drug_requests dr
       JOIN users u ON u.user_id = dr.doctor_id
       WHERE dr.request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });

    const dr = reqResult.rows[0];
    if (dr.CURRENT_STAGE !== 'PharmacistInitialReview') {
      return res.status(400).json({ error: 'Request is not in PharmacistInitialReview stage.' });
    }
    if (dr.STATUS !== 'HOD_APPROVED' && dr.STATUS !== 'Pending') {
      return res.status(400).json({ error: 'Request is not awaiting pharmacist initial review.' });
    }

    // Parse the effective_created_at value
    let effTs = null;
    if (effective_created_at && effective_created_at.trim() !== '') {
      effTs = new Date(effective_created_at);
      if (isNaN(effTs.getTime())) {
        return res.status(400).json({ error: 'Invalid effective_created_at datetime value.' });
      }
    }

    // Validate and prepare effective drug entries datetimes if any
    const entriesToSave = [];
    if (Array.isArray(effective_drug_entries)) {
      for (const entry of effective_drug_entries) {
        let entryEffTs = null;
        if (entry.effective_created_at && entry.effective_created_at.trim() !== '') {
          entryEffTs = new Date(entry.effective_created_at);
          if (isNaN(entryEffTs.getTime())) {
            return res.status(400).json({ error: `Invalid datetime value for drug: ${entry.drug_name}` });
          }
        }
        entriesToSave.push({
          drug_name: entry.drug_name || '',
          effective_created_at: entryEffTs,
          remarks: entry.remarks || ''
        });
      }
    }

    const toStage = 'PharmacyHead';
    const newStatus = 'Pending';

    // Build update — set effective_created_at only if provided, else default to created_at
    let updateQuery = '';
    let updateBinds = {
      toStage,
      newStatus,
      remarks: remarks || null,
      requestId
    };

    if (effTs) {
      updateQuery = `UPDATE drug_requests
         SET current_stage          = :toStage,
             status                 = :newStatus,
             pharmacist_remarks     = :remarks,
             effective_created_at   = :effTs,
             updated_at             = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`;
      updateBinds.effTs = effTs;
    } else {
      updateQuery = `UPDATE drug_requests
         SET current_stage          = :toStage,
             status                 = :newStatus,
             pharmacist_remarks     = :remarks,
             effective_created_at   = created_at,
             updated_at             = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`;
    }

    await conn.execute(updateQuery, updateBinds);

    // Save drug effective entries
    await conn.execute(
      `DELETE FROM drug_effective_entries WHERE request_id = :requestId`,
      { requestId }
    );

    for (const entry of entriesToSave) {
      await conn.execute(
        `INSERT INTO drug_effective_entries (
          request_id, drug_name, effective_created_at, remarks, created_by
        ) VALUES (
          :requestId, :drugName, :effectiveCreatedAt, :remarks, :createdBy
        )`,
        {
          requestId,
          drugName: entry.drug_name || null,
          effectiveCreatedAt: entry.effective_created_at,
          remarks: entry.remarks || null,
          createdBy: performed_by
        }
      );
    }

    await writeAudit(conn, requestId, 'INITIAL_REVIEW_APPROVED', performed_by, 'PharmacistInitialReview', toStage, remarks);

    // Notify PharmacyHead users
    const phUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACYHEAD' AND is_active = 1`
    );
    for (const row of phUsers.rows) {
      await createNotification(conn, row.USER_ID, requestId,
        `Drug request #${requestId} (${dr.BRAND_NAME}) has passed Pharmacist Initial Review and is awaiting your approval.`
      );
    }

    // Notify Doctor that request has moved forward (neutral DTC-review message)
    await createNotification(conn, dr.DOCTOR_ID, requestId,
      `Your drug request #${requestId} (${dr.BRAND_NAME}) is currently under DTC review.`
    );

    res.json({
      message: `Request #${requestId} approved by Pharmacist Initial Review and forwarded to Pharmacy Head.`,
      new_stage: toStage,
      new_status: newStatus
    });
  } catch (err) {
    console.error('PUT /initial-review-approve error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// GET /api/notifications/:userId
// =============================================================
app.get('/api/notifications/:userId', async (req, res) => {
  const conn = await getConn();
  try {
    const result = await conn.execute(
      `SELECT n.*, dr.brand_name, dr.current_stage
       FROM notifications n
       LEFT JOIN drug_requests dr ON dr.request_id = n.request_id
       WHERE n.user_id = :userId
       ORDER BY n.created_at DESC
       FETCH FIRST 50 ROWS ONLY`,
      { userId: req.params.userId }
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET notifications error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// PUT /api/notifications/:id/read
// =============================================================
app.put('/api/notifications/:id/read', async (req, res) => {
  const conn = await getConn();
  try {
    await conn.execute(
      `UPDATE notifications SET is_read = 1 WHERE notification_id = :id`,
      { id: req.params.id }
    );
    res.json({ message: 'Marked as read.' });
  } catch (err) {
    console.error('PUT notification read error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// GET /api/dashboard/:role
// =============================================================
app.get('/api/dashboard/:role', async (req, res) => {
  const conn = await getConn();
  try {
    const { role } = req.params;
    const { userId, source_type, formulary_type } = req.query;

    let whereClause = '1=1';
    const binds = {};

    const normalizedRole = role ? role.toLowerCase().trim() : '';

    if (normalizedRole === 'doctor') {
      whereClause = 'doctor_id = :userId';
      binds.userId = userId;
    } else if (normalizedRole === 'hod') {
      whereClause = '(hod_id = :userId OR created_by_user_id = :userId)';
      binds.userId = userId;
    } else if (normalizedRole === 'pharmacyhead') {
      whereClause = `current_stage IN ('PharmacyHead','DTCCommittee','Pharmacist','PharmacyHeadReview2','DTCFinal','CEO','Final','Rejected','EmergencyDTC')`;
    } else if (normalizedRole === 'pharmacist') {
      whereClause = `current_stage IN ('Pharmacist','PharmacyHeadReview2','DTCFinal','CEO','Final','Rejected','EmergencyDTC')`;
    } else if (normalizedRole === 'dtccommittee') {
      whereClause = `current_stage IN ('DTCCommittee','Pharmacist','PharmacyHeadReview2','DTCFinal','CEO','Final','Rejected','EmergencyDTC')`;
    } else if (normalizedRole === 'ceo') {
      whereClause = `current_stage IN ('CEO','Final','Rejected')`;
    } else if (normalizedRole === 'admin') {
      whereClause = '1=1';
    }


    // Optional source_type filter
    if (source_type && ['PROMOTIONAL', 'NON_PROMOTIONAL'].includes(source_type.toUpperCase())) {
      whereClause += ` AND request_source_type = :source_type`;
      binds.source_type = source_type.toUpperCase();
    }
    if (formulary_type && ['FORMULARY', 'NON_FORMULARY'].includes(formulary_type.toUpperCase())) {
      whereClause += ` AND formulary_request_type = :formulary_type`;
      binds.formulary_type = formulary_type.toUpperCase();
    }

    const totalResult = await conn.execute(`SELECT COUNT(*) AS cnt FROM drug_requests WHERE ${whereClause}`, binds);
    const approvedResult = await conn.execute(`SELECT COUNT(*) AS cnt FROM drug_requests WHERE ${whereClause} AND status = 'Approved'`, binds);
    const rejectedResult = await conn.execute(`SELECT COUNT(*) AS cnt FROM drug_requests WHERE ${whereClause} AND status = 'Rejected'`, binds);
    const pendingResult = await conn.execute(`SELECT COUNT(*) AS cnt FROM drug_requests WHERE ${whereClause} AND status = 'Pending'`, binds);
    const catResult = await conn.execute(`SELECT category, COUNT(*) AS cnt FROM drug_requests WHERE ${whereClause} GROUP BY category`, binds);
    const promoResult = await conn.execute(`SELECT COUNT(*) AS cnt FROM drug_requests WHERE ${whereClause} AND (request_source_type = 'PROMOTIONAL' OR request_source_type IS NULL)`, binds);
    const nonPromoResult = await conn.execute(`SELECT COUNT(*) AS cnt FROM drug_requests WHERE ${whereClause} AND request_source_type = 'NON_PROMOTIONAL'`, binds);

    res.json({
      total: totalResult.rows[0].CNT,
      approved: approvedResult.rows[0].CNT,
      rejected: rejectedResult.rows[0].CNT,
      pending: pendingResult.rows[0].CNT,
      by_category: catResult.rows,
      promotional: promoResult.rows[0].CNT,
      non_promotional: nonPromoResult.rows[0].CNT,
    });
  } catch (err) {
    console.error('GET dashboard error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// ANALYTICS APIs — Read-only, dashboard-only. No workflow impact.
// =============================================================

// GET /api/analytics/summary — System-wide KPI counts
app.get('/api/analytics/summary', async (req, res) => {
  const conn = await getConn();
  try {
    const r = await conn.execute(`
      SELECT
        COUNT(*) AS total_requests,
        SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS total_pending,
        SUM(CASE WHEN status IN ('Approved','HOD_APPROVED','APPROVED_PENDING_ORDER','EMERGENCY_APPROVED','INVENTORY_RECEIVED') THEN 1 ELSE 0 END) AS total_approved,
        SUM(CASE WHEN status IN ('Rejected','HOD_REJECTED','PHARMACIST_REJECTED','PHARMACY_HEAD_REJECTED','PHARMACY_HEAD_REJECTED_PENDING_DTC','CEO_REJECTED','EMERGENCY_REJECTED') THEN 1 ELSE 0 END) AS total_rejected,
        SUM(CASE WHEN status IN ('EMERGENCY_PENDING_DTC','EMERGENCY_APPROVED','EMERGENCY_REJECTED') THEN 1 ELSE 0 END) AS total_emergency,
        SUM(CASE WHEN status IN ('ORDER_PLACED','INVENTORY_RECEIVED') OR current_stage = 'OrderPlaced' THEN 1 ELSE 0 END) AS total_order_placed,
        SUM(CASE WHEN current_stage = 'Final' THEN 1 ELSE 0 END) AS total_final_approved,
        SUM(CASE WHEN current_stage IN ('DTCCommittee','DTCFinal','EmergencyDTC') THEN 1 ELSE 0 END) AS total_dtc_review,
        SUM(CASE WHEN current_stage = 'CEO' THEN 1 ELSE 0 END) AS total_ceo_review,
        SUM(CASE WHEN request_source_type = 'NON_PROMOTIONAL' THEN 1 ELSE 0 END) AS total_clinical,
        SUM(CASE WHEN request_source_type = 'PROMOTIONAL' OR request_source_type IS NULL THEN 1 ELSE 0 END) AS total_via_rep,
        SUM(CASE WHEN formulary_request_type = 'FORMULARY' THEN 1 ELSE 0 END) AS total_formulary,
        SUM(CASE WHEN formulary_request_type = 'NON_FORMULARY' THEN 1 ELSE 0 END) AS total_non_formulary
      FROM drug_requests
    `);
    const row = r.rows[0];
    res.json({
      total_requests: row.TOTAL_REQUESTS,
      total_pending: row.TOTAL_PENDING,
      total_approved: row.TOTAL_APPROVED,
      total_rejected: row.TOTAL_REJECTED,
      total_emergency: row.TOTAL_EMERGENCY,
      total_order_placed: row.TOTAL_ORDER_PLACED,
      total_final_approved: row.TOTAL_FINAL_APPROVED,
      total_dtc_review: row.TOTAL_DTC_REVIEW,
      total_ceo_review: row.TOTAL_CEO_REVIEW,
      total_clinical: row.TOTAL_CLINICAL,
      total_via_rep: row.TOTAL_VIA_REP,
      total_formulary: row.TOTAL_FORMULARY,
      total_non_formulary: row.TOTAL_NON_FORMULARY,
    });
  } catch (err) {
    console.error('GET analytics/summary error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally { await conn.close(); }
});

// GET /api/analytics/workflow-stages — Count per workflow stage
app.get('/api/analytics/workflow-stages', async (req, res) => {
  const conn = await getConn();
  try {
    const r = await conn.execute(`
      SELECT current_stage, COUNT(*) AS cnt
      FROM drug_requests
      GROUP BY current_stage
      ORDER BY cnt DESC
    `);
    res.json(r.rows.map(row => ({ stage: row.CURRENT_STAGE, count: row.CNT })));
  } catch (err) {
    console.error('GET analytics/workflow-stages error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally { await conn.close(); }
});

// GET /api/analytics/doctor-performance — Per-doctor/HOD analytics
app.get('/api/analytics/doctor-performance', async (req, res) => {
  const conn = await getConn();
  try {
    const r = await conn.execute(`
      SELECT
        u.user_id,
        u.name,
        u.role,
        u.department,
        COUNT(dr.request_id) AS total_requests,
        SUM(CASE WHEN dr.status IN ('Approved','HOD_APPROVED','APPROVED_PENDING_ORDER','EMERGENCY_APPROVED','INVENTORY_RECEIVED') THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN dr.status IN ('Rejected','HOD_REJECTED','PHARMACIST_REJECTED','PHARMACY_HEAD_REJECTED','CEO_REJECTED','EMERGENCY_REJECTED') THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN dr.status = 'Pending' OR dr.status LIKE '%PENDING%' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN dr.status IN ('EMERGENCY_PENDING_DTC','EMERGENCY_APPROVED','EMERGENCY_REJECTED') THEN 1 ELSE 0 END) AS emergency_count,
        MAX(dr.created_at) AS latest_request
      FROM users u
      LEFT JOIN drug_requests dr ON dr.created_by_user_id = u.user_id
      WHERE LOWER(u.role) IN ('doctor','hod') AND u.is_active = 1
      GROUP BY u.user_id, u.name, u.role, u.department
      ORDER BY total_requests DESC
    `);
    res.json(r.rows.map(row => ({
      user_id: row.USER_ID,
      name: row.NAME,
      role: row.ROLE,
      department: row.DEPARTMENT || '—',
      total_requests: row.TOTAL_REQUESTS,
      approved: row.APPROVED,
      rejected: row.REJECTED,
      pending: row.PENDING,
      emergency_count: row.EMERGENCY_COUNT,
      latest_request: row.LATEST_REQUEST,
    })));
  } catch (err) {
    console.error('GET analytics/doctor-performance error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally { await conn.close(); }
});

// GET /api/analytics/drug-analytics — Top drugs by requests/approvals/rejections
app.get('/api/analytics/drug-analytics', async (req, res) => {
  const conn = await getConn();
  try {
    const [topBrands, topGenerics, topRejected, topApproved] = await Promise.all([
      conn.execute(`
        SELECT brand_name, COUNT(*) AS cnt FROM drug_requests
        WHERE brand_name IS NOT NULL
        GROUP BY brand_name ORDER BY cnt DESC FETCH FIRST 10 ROWS ONLY
      `),
      conn.execute(`
        SELECT generic_name, COUNT(*) AS cnt FROM drug_requests
        WHERE generic_name IS NOT NULL
        GROUP BY generic_name ORDER BY cnt DESC FETCH FIRST 10 ROWS ONLY
      `),
      conn.execute(`
        SELECT brand_name, COUNT(*) AS cnt FROM drug_requests
        WHERE status IN ('Rejected','HOD_REJECTED','PHARMACIST_REJECTED','PHARMACY_HEAD_REJECTED','CEO_REJECTED','EMERGENCY_REJECTED')
        AND brand_name IS NOT NULL
        GROUP BY brand_name ORDER BY cnt DESC FETCH FIRST 10 ROWS ONLY
      `),
      conn.execute(`
        SELECT brand_name, COUNT(*) AS cnt FROM drug_requests
        WHERE status IN ('Approved','APPROVED_PENDING_ORDER','ORDER_PLACED','EMERGENCY_APPROVED')
        AND brand_name IS NOT NULL
        GROUP BY brand_name ORDER BY cnt DESC FETCH FIRST 10 ROWS ONLY
      `),
    ]);
    res.json({
      top_brands: topBrands.rows.map(r => ({ name: r.BRAND_NAME, count: r.CNT })),
      top_generics: topGenerics.rows.map(r => ({ name: r.GENERIC_NAME, count: r.CNT })),
      top_rejected: topRejected.rows.map(r => ({ name: r.BRAND_NAME, count: r.CNT })),
      top_approved: topApproved.rows.map(r => ({ name: r.BRAND_NAME, count: r.CNT })),
    });
  } catch (err) {
    console.error('GET analytics/drug-analytics error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally { await conn.close(); }
});

// GET /api/analytics/rejection-breakdown — Rejections per stage + top remarks
app.get('/api/analytics/rejection-breakdown', async (req, res) => {
  const conn = await getConn();
  try {
    const [breakdown, remarks] = await Promise.all([
      conn.execute(`
        SELECT
          SUM(CASE WHEN status = 'HOD_REJECTED' THEN 1 ELSE 0 END) AS rejected_by_hod,
          SUM(CASE WHEN status IN ('PHARMACY_HEAD_REJECTED','PHARMACY_HEAD_REJECTED_PENDING_DTC') THEN 1 ELSE 0 END) AS rejected_by_ph,
          SUM(CASE WHEN status IN ('Rejected','PHARMACIST_REJECTED') AND current_stage IN ('DTCCommittee','DTCFinal','EmergencyDTC','Pharmacist','PharmacyHeadReview2') THEN 1 ELSE 0 END) AS rejected_by_dtc,
          SUM(CASE WHEN status = 'CEO_REJECTED' THEN 1 ELSE 0 END) AS rejected_by_ceo,
          SUM(CASE WHEN status = 'EMERGENCY_REJECTED' THEN 1 ELSE 0 END) AS rejected_emergency
        FROM drug_requests
      `),
      conn.execute(`
        SELECT remarks, COUNT(*) AS cnt
        FROM rejection_remark_history
        WHERE remarks IS NOT NULL AND TRIM(remarks) != ''
        GROUP BY remarks ORDER BY cnt DESC FETCH FIRST 10 ROWS ONLY
      `).catch(() => ({ rows: [] })),
    ]);
    const b = breakdown.rows[0];
    res.json({
      rejected_by_hod: b.REJECTED_BY_HOD,
      rejected_by_ph: b.REJECTED_BY_PH,
      rejected_by_dtc: b.REJECTED_BY_DTC,
      rejected_by_ceo: b.REJECTED_BY_CEO,
      rejected_emergency: b.REJECTED_EMERGENCY,
      top_remarks: remarks.rows.map(r => ({ remark: r.REMARKS, count: r.CNT })),
    });
  } catch (err) {
    console.error('GET analytics/rejection-breakdown error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally { await conn.close(); }
});

// GET /api/analytics/request-history — Paginated full request list
app.get('/api/analytics/request-history', async (req, res) => {
  const conn = await getConn();
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(5, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim().toLowerCase();
    const stageFilter = (req.query.stage || '').trim();

    let whereClause = '1=1';
    // dataBinds includes pagination; countBinds only has filter values actually used in WHERE
    const dataBinds = { offset, limit };
    const countBinds = {};

    if (search) {
      whereClause += ` AND (LOWER(dr.brand_name) LIKE '%' || :search || '%' OR LOWER(u.name) LIKE '%' || :search || '%' OR LOWER(dr.generic_name) LIKE '%' || :search || '%')`;
      dataBinds.search = search;
      countBinds.search = search;
    }
    if (stageFilter) {
      whereClause += ` AND dr.current_stage = :stage`;
      dataBinds.stage = stageFilter;
      countBinds.stage = stageFilter;
    }

    const [dataRes, countRes] = await Promise.all([
      conn.execute(`
        SELECT
          dr.request_id, u.name AS doctor_name, u.department,
          dr.brand_name, dr.generic_name, dr.dosage_form, dr.dose_strength,
          dr.request_source_type, dr.formulary_request_type,
          dr.current_stage, dr.status, dr.created_at, dr.effective_created_at,
          dr.dtc_selected_brand, dr.created_by_role
        FROM drug_requests dr
        LEFT JOIN users u ON u.user_id = dr.created_by_user_id
        WHERE ${whereClause}
        ORDER BY dr.request_id DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
      `, dataBinds),
      conn.execute(`
        SELECT COUNT(*) AS total
        FROM drug_requests dr
        LEFT JOIN users u ON u.user_id = dr.created_by_user_id
        WHERE ${whereClause}
      `, countBinds),
    ]);

    const total = countRes.rows[0].TOTAL;
    res.json({
      data: dataRes.rows.map(r => ({
        request_id: r.REQUEST_ID,
        doctor_name: r.DOCTOR_NAME || '—',
        department: r.DEPARTMENT || '—',
        brand_name: r.BRAND_NAME,
        generic_name: r.GENERIC_NAME,
        dosage_form: r.DOSAGE_FORM,
        dose_strength: r.DOSE_STRENGTH,
        request_source_type: r.REQUEST_SOURCE_TYPE,
        formulary_request_type: r.FORMULARY_REQUEST_TYPE,
        current_stage: r.CURRENT_STAGE,
        status: r.STATUS,
        created_at: r.CREATED_AT,
        effective_created_at: r.EFFECTIVE_CREATED_AT,
        dtc_selected_brand: r.DTC_SELECTED_BRAND,
        created_by_role: r.CREATED_BY_ROLE,
      })),
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('GET analytics/request-history error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally { await conn.close(); }
});

// GET /api/analytics/workflow-tracker — Live workflow tracking
app.get('/api/analytics/workflow-tracker', async (req, res) => {
  const conn = await getConn();
  const role = (req.query.role || '').toLowerCase();
  const userId = req.query.userId ? parseInt(req.query.userId, 10) : null;

  try {
    let whereClause = '1=1';
    const binds = {};

    if (role === 'doctor' && userId) {
      whereClause = '(dr.doctor_id = :userId OR dr.created_by_user_id = :userId)';
      binds.userId = userId;
    } else if (role === 'hod' && userId) {
      whereClause = `(dr.hod_id = :userId 
        OR dr.created_by_user_id = :userId 
        OR u.department = (SELECT department FROM users WHERE user_id = :userId))`;
      binds.userId = userId;
    }

    const query = `
      SELECT
        dr.request_id,
        u.name AS requester_name,
        dr.created_by_role AS requester_role,
        u.department,
        dr.brand_name,
        dr.generic_name,
        dr.current_stage,
        dr.status,
        dr.is_reverted,
        dr.created_at,
        dr.updated_at
      FROM drug_requests dr
      JOIN users u ON u.user_id = dr.doctor_id
      WHERE ${whereClause}
      ORDER BY dr.request_id DESC
    `;

    const result = await conn.execute(query, binds);

    const data = result.rows.map(row => {
      const dbStage = row.CURRENT_STAGE;
      const status = row.STATUS;
      const isReverted = row.IS_REVERTED === 1;

      // Map DB stage to standard key
      let stageKey = 'pharmacy_head_review1'; // fallback
      if (dbStage === 'HOD') stageKey = 'hod';
      else if (['PharmacistInitialReview', 'PharmacistCorrection', 'PharmacistReview1'].includes(dbStage)) stageKey = 'pharmacist_initial';
      else if (['PharmacyHead', 'PharmacyHeadReview1'].includes(dbStage)) stageKey = 'pharmacy_head_review1';
      else if (['DTCCommittee', 'DTCReview1', 'EmergencyDTC'].includes(dbStage)) stageKey = 'dtc_review1';
      else if (['Pharmacist', 'PharmacistReview2'].includes(dbStage)) stageKey = 'pharmacist_analysis';
      else if (dbStage === 'PharmacyHeadReview2') stageKey = 'pharmacy_head_review2';
      else if (['DTCFinal', 'DTCFinalReview'].includes(dbStage)) stageKey = 'dtc_final';
      else if (dbStage === 'CEO') stageKey = 'ceo';
      else if (['PharmacistOrder', 'APPROVED_PENDING_ORDER', 'OrderPlaced', 'Final'].includes(dbStage) || status === 'ORDER_PLACED' || status === 'Approved') stageKey = 'order_placed';

      // Let's determine owner
      let currentOwner = 'Pharmacy Head';
      if (status && (status.toLowerCase().includes('rejected') || status === 'Rejected')) {
        currentOwner = 'Rejected';
      } else if (stageKey === 'order_placed' && (status === 'ORDER_PLACED' || status === 'Approved')) {
        currentOwner = 'Completed';
      } else {
        if (stageKey === 'hod') currentOwner = 'HOD';
        else if (stageKey === 'pharmacist_initial' || stageKey === 'pharmacist_analysis' || stageKey === 'order_placed') currentOwner = 'Pharmacist';
        else if (stageKey === 'pharmacy_head_review1' || stageKey === 'pharmacy_head_review2') currentOwner = 'Pharmacy Head';
        else if (stageKey === 'dtc_review1' || stageKey === 'dtc_final') currentOwner = 'DTC';
        else if (stageKey === 'ceo') currentOwner = 'CEO';
      }

      // Calculate days in stage
      const lastActionDate = row.UPDATED_AT || row.CREATED_AT;
      const diffTime = Math.max(0, new Date() - new Date(lastActionDate));
      const daysInStage = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      // Build workflow progress
      const STAGE_ORDER = [
        'hod',
        'pharmacist_initial',
        'pharmacy_head_review1',
        'dtc_review1',
        'pharmacist_analysis',
        'pharmacy_head_review2',
        'dtc_final',
        'ceo',
        'order_placed'
      ];

      const workflowProgress = {
        hod: false,
        pharmacist_initial: false,
        pharmacy_head_review1: false,
        dtc_review1: false,
        pharmacist_analysis: false,
        pharmacy_head_review2: false,
        dtc_final: false,
        ceo: false,
        order_placed: false
      };

      const currentIdx = STAGE_ORDER.indexOf(stageKey);
      if (currentIdx !== -1) {
        for (let i = 0; i <= currentIdx; i++) {
          workflowProgress[STAGE_ORDER[i]] = true;
        }
      }

      // Format stage string for output
      let stageString = 'PHARMACY_HEAD';
      if (stageKey === 'hod') stageString = 'HOD';
      else if (stageKey === 'pharmacist_initial') stageString = 'PHARMACIST_INITIAL';
      else if (stageKey === 'pharmacy_head_review1') stageString = 'PHARMACY_HEAD';
      else if (stageKey === 'dtc_review1') stageString = 'DTC_REVIEW1';
      else if (stageKey === 'pharmacist_analysis') stageString = 'PHARMACIST_ANALYSIS';
      else if (stageKey === 'pharmacy_head_review2') stageString = 'PHARMACY_HEAD_REVIEW2';
      else if (stageKey === 'dtc_final') stageString = 'DTC_FINAL';
      else if (stageKey === 'ceo') stageString = 'CEO';
      else if (stageKey === 'order_placed') stageString = 'ORDER_PLACED';

      return {
        request_id: row.REQUEST_ID,
        requester_name: row.REQUESTER_NAME || '—',
        requester_role: row.REQUESTER_ROLE || 'doctor',
        department: row.DEPARTMENT || '—',
        brand_name: row.BRAND_NAME,
        generic_name: row.GENERIC_NAME,
        current_stage: stageString,
        current_owner: currentOwner,
        status: status,
        is_reverted: isReverted,
        days_in_stage: daysInStage,
        created_date: row.CREATED_AT,
        last_action_date: lastActionDate,
        workflow_progress: workflowProgress
      };
    });

    res.json(data);
  } catch (err) {
    console.error('GET workflow-tracker error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// GET /api/analytics/audit-trail — Global request audit trail
app.get('/api/analytics/audit-trail', async (req, res) => {
  const conn = await getConn();
  const role = (req.query.role || '').toLowerCase();
  const userId = req.query.userId ? parseInt(req.query.userId, 10) : null;

  try {
    let whereClause = '1=1';
    const binds = {};

    if (role === 'doctor' && userId) {
      whereClause = '(dr.doctor_id = :userId OR dr.created_by_user_id = :userId)';
      binds.userId = userId;
    } else if (role === 'hod' && userId) {
      whereClause = `(dr.hod_id = :userId 
        OR dr.created_by_user_id = :userId 
        OR u.department = (SELECT department FROM users WHERE user_id = :userId))`;
      binds.userId = userId;
    }

    const query = `
      SELECT
        al.log_id,
        al.request_id,
        al.action,
        al.from_stage,
        al.to_stage,
        al.remarks,
        al.logged_at,
        u_perf.name AS performer_name,
        u_perf.role AS performer_role,
        dr.brand_name,
        dr.generic_name
      FROM audit_logs al
      JOIN users u_perf ON u_perf.user_id = al.performed_by
      JOIN drug_requests dr ON dr.request_id = al.request_id
      JOIN users u ON u.user_id = dr.doctor_id
      WHERE ${whereClause}
      ORDER BY al.logged_at DESC
      OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY
    `;

    const result = await conn.execute(query, binds);
    let rows = result.rows;

    // Filter out internal stages for doctor and HOD roles
    if (role === 'doctor' || role === 'hod') {
      const internalStages = [
        'PharmacistInitialReview',
        'PharmacistCorrection',
        'PharmacyHead',
        'PharmacyHeadReview1',
        'Pharmacist',
        'PharmacistReview2',
        'PharmacyHeadReview2'
      ];
      rows = rows.filter(row => {
        const fromStage = row.FROM_STAGE;
        const toStage = row.TO_STAGE;
        const action = row.ACTION;
        if (action === 'REVERTED_TO_PHARMACIST') return false;
        if (internalStages.includes(fromStage) || internalStages.includes(toStage)) return false;
        return true;
      });
    }

    res.json(rows);
  } catch (err) {
    console.error('GET global audit-trail error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// GET /api/analytics/drilldown — Drilldown for metric or stage click
app.get('/api/analytics/drilldown', async (req, res) => {
  const conn = await getConn();
  try {
    const type = req.query.type;
    const key = req.query.key;
    if (!type || !key) {
      return res.status(400).json({ error: 'Missing type or key parameter.' });
    }

    let whereClause = '1=1';
    const binds = {};

    if (type === 'metric') {
      if (key === 'total_requests') {
        whereClause = '1=1';
      } else if (key === 'total_pending') {
        whereClause = "dr.status = 'Pending' OR dr.status LIKE '%PENDING%'";
      } else if (key === 'total_approved') {
        whereClause = "dr.status IN ('Approved','HOD_APPROVED','APPROVED_PENDING_ORDER','EMERGENCY_APPROVED','INVENTORY_RECEIVED')";
      } else if (key === 'total_rejected') {
        whereClause = "dr.status IN ('Rejected','HOD_REJECTED','PHARMACIST_REJECTED','PHARMACY_HEAD_REJECTED','PHARMACY_HEAD_REJECTED_PENDING_DTC','CEO_REJECTED','EMERGENCY_REJECTED')";
      } else if (key === 'total_emergency') {
        whereClause = "dr.status IN ('EMERGENCY_PENDING_DTC','EMERGENCY_APPROVED','EMERGENCY_REJECTED')";
      } else if (key === 'total_order_placed') {
        whereClause = "dr.status IN ('ORDER_PLACED','INVENTORY_RECEIVED') OR dr.current_stage = 'OrderPlaced'";
      } else if (key === 'total_final_approved') {
        whereClause = "dr.current_stage = 'Final'";
      } else if (key === 'total_dtc_review') {
        whereClause = "dr.current_stage IN ('DTCCommittee','DTCFinal','EmergencyDTC')";
      } else if (key === 'total_ceo_review') {
        whereClause = "dr.current_stage = 'CEO'";
      } else if (key === 'total_clinical') {
        whereClause = "dr.request_source_type = 'NON_PROMOTIONAL'";
      } else if (key === 'total_via_rep') {
        whereClause = "dr.request_source_type = 'PROMOTIONAL' OR dr.request_source_type IS NULL";
      } else if (key === 'total_formulary') {
        whereClause = "dr.formulary_request_type = 'FORMULARY'";
      } else if (key === 'total_non_formulary') {
        whereClause = "dr.formulary_request_type = 'NON_FORMULARY'";
      }
    } else if (type === 'stage') {
      if (key === 'Rejected') {
        whereClause = "dr.current_stage = 'Rejected' OR dr.status IN ('Rejected','HOD_REJECTED','PHARMACIST_REJECTED','PHARMACY_HEAD_REJECTED','PHARMACY_HEAD_REJECTED_PENDING_DTC','CEO_REJECTED','EMERGENCY_REJECTED')";
      } else if (key === 'EmergencyDTC') {
        whereClause = "dr.current_stage = 'EmergencyDTC' OR dr.status IN ('EMERGENCY_PENDING_DTC','EMERGENCY_APPROVED','EMERGENCY_REJECTED')";
      } else {
        whereClause = "dr.current_stage = :stageKey";
        binds.stageKey = key;
      }
    }

    const query = `
      SELECT
        dr.request_id,
        u.name AS doctor_name,
        u.department,
        dr.brand_name,
        dr.generic_name,
        dr.dosage_form,
        dr.dose_strength,
        dr.request_source_type,
        dr.current_stage,
        dr.status,
        dr.created_at,
        dr.dtc_selected_brand,
        (SELECT remarks FROM audit_logs WHERE request_id = dr.request_id AND action = 'REJECTED' ORDER BY logged_at DESC FETCH FIRST 1 ROWS ONLY) AS rejection_remarks,
        (SELECT remarks FROM audit_logs WHERE request_id = dr.request_id AND action = 'ORDER_PLACED' ORDER BY logged_at DESC FETCH FIRST 1 ROWS ONLY) AS order_remarks
      FROM drug_requests dr
      LEFT JOIN users u ON u.user_id = COALESCE(dr.created_by_user_id, dr.doctor_id)
      WHERE ${whereClause}
      ORDER BY dr.request_id DESC
    `;

    const result = await conn.execute(query, binds);
    res.json(result.rows.map(r => ({
      request_id: r.REQUEST_ID,
      doctor_name: r.DOCTOR_NAME || '—',
      department: r.DEPARTMENT || '—',
      brand_name: r.BRAND_NAME,
      generic_name: r.GENERIC_NAME,
      dosage_form: r.DOSAGE_FORM,
      dose_strength: r.DOSE_STRENGTH,
      request_source_type: r.REQUEST_SOURCE_TYPE,
      current_stage: r.CURRENT_STAGE,
      status: r.STATUS,
      created_at: r.CREATED_AT,
      dtc_selected_brand: r.DTC_SELECTED_BRAND,
      rejection_remarks: r.REJECTION_REMARKS || '—',
      order_remarks: r.ORDER_REMARKS || '—'
    })));
  } catch (err) {
    console.error('GET analytics/drilldown error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// END ANALYTICS APIs
// =============================================================

// =============================================================
// GET /api/dtc/user-quotas — Retrieve all Doctors/HODs request quotas & usage
// =============================================================
app.get('/api/dtc/user-quotas', async (req, res) => {
  const conn = await getConn();
  try {
    const usersRes = await conn.execute(
      `SELECT user_id, name, email, role, department FROM users
       WHERE LOWER(role) IN ('doctor', 'hod') AND is_active = 1`
    );
    const users = usersRes.rows;

    for (const u of users) {
      const quotaCheck = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM user_request_quotas WHERE user_id = :userId`,
        { userId: u.USER_ID }
      );
      if (quotaCheck.rows[0].CNT === 0) {
        await conn.execute(
          `INSERT INTO user_request_quotas (user_id, quarterly_limit, updated_by)
           VALUES (:userId, 10, :updatedBy)`,
          { userId: u.USER_ID, updatedBy: u.USER_ID },
          { autoCommit: true }
        );
      }
    }

    const result = await conn.execute(
      `SELECT
         u.user_id,
         u.name,
         u.email,
         u.role,
         u.department,
         q.quarterly_limit,
         (
           SELECT COUNT(*) FROM drug_requests dr
           WHERE dr.created_by_user_id = u.user_id
             AND dr.created_at >= TRUNC(SYSDATE, 'Q')
             AND dr.created_at <  ADD_MONTHS(TRUNC(SYSDATE, 'Q'), 3)
         ) AS used_this_quarter
       FROM users u
       JOIN user_request_quotas q ON q.user_id = u.user_id
       WHERE LOWER(u.role) IN ('doctor', 'hod') AND u.is_active = 1
       ORDER BY u.name`
    );

    const quotas = result.rows.map(r => {
      const limit = r.QUARTERLY_LIMIT;
      const used = r.USED_THIS_QUARTER;
      return {
        user_id: r.USER_ID,
        name: r.NAME,
        email: r.EMAIL,
        role: r.ROLE,
        department: r.DEPARTMENT,
        quarterly_limit: limit,
        used_this_quarter: used,
        remaining_quota: Math.max(0, limit - used)
      };
    });

    res.json(quotas);
  } catch (err) {
    console.error('GET /api/dtc/user-quotas error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// PUT /api/dtc/user-quotas/:userId — Update a doctor or HOD request quota
// =============================================================
app.put('/api/dtc/user-quotas/:userId', async (req, res) => {
  const conn = await getConn();
  try {
    const userId = parseInt(req.params.userId);
    const { quarterly_limit, performed_by } = req.body;

    if (quarterly_limit === undefined || quarterly_limit === null || isNaN(Number(quarterly_limit)) || Number(quarterly_limit) < 0) {
      return res.status(400).json({ error: 'Limit must be a non-negative number.' });
    }

    const perfRes = await conn.execute(
      `SELECT role FROM users WHERE user_id = :performedBy AND is_active = 1`,
      { performedBy: performed_by }
    );
    if (!perfRes.rows.length) {
      return res.status(403).json({ error: 'Performing user not found or inactive.' });
    }
    const perfRole = perfRes.rows[0].ROLE ? perfRes.rows[0].ROLE.toLowerCase() : '';
    if (perfRole !== 'dtc' && perfRole !== 'dtccommittee') {
      return res.status(403).json({ error: 'Unauthorized. Only DTC members can modify request quotas.' });
    }

    const userRes = await conn.execute(
      `SELECT role FROM users WHERE user_id = :userId AND is_active = 1`,
      { userId }
    );
    if (!userRes.rows.length) {
      return res.status(404).json({ error: 'Target user not found or inactive.' });
    }
    const targetRole = userRes.rows[0].ROLE ? userRes.rows[0].ROLE.toLowerCase() : '';
    if (targetRole !== 'doctor' && targetRole !== 'hod') {
      return res.status(400).json({ error: 'Quotas can only be assigned to Doctors or HODs.' });
    }

    const qCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_request_quotas WHERE user_id = :userId`,
      { userId }
    );
    if (qCheck.rows[0].CNT > 0) {
      await conn.execute(
        `UPDATE user_request_quotas
         SET quarterly_limit = :limit, updated_by = :updatedBy, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = :userId`,
        { limit: Number(quarterly_limit), updatedBy: performed_by, userId },
        { autoCommit: true }
      );
    } else {
      await conn.execute(
        `INSERT INTO user_request_quotas (user_id, quarterly_limit, updated_by)
         VALUES (:userId, :limit, :updatedBy)`,
        { userId, limit: Number(quarterly_limit), updatedBy: performed_by },
        { autoCommit: true }
      );
    }

    res.json({ success: true, message: 'Quota updated successfully.' });
  } catch (err) {
    console.error('PUT /api/dtc/user-quotas/:userId error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// GET /api/user/quota/:userId — Fetch quota details for a Doctor/HOD
// =============================================================
app.get('/api/user/quota/:userId', async (req, res) => {
  const conn = await getConn();
  try {
    const userId = parseInt(req.params.userId);

    const userRes = await conn.execute(
      `SELECT role FROM users WHERE user_id = :userId AND is_active = 1`,
      { userId }
    );
    if (!userRes.rows.length) {
      return res.status(404).json({ error: 'User not found or inactive.' });
    }
    const role = userRes.rows[0].ROLE ? userRes.rows[0].ROLE.toLowerCase() : '';
    if (role !== 'doctor' && role !== 'hod') {
      return res.status(400).json({ error: 'Request quota is only applicable for Doctors or HODs.' });
    }

    const qCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_request_quotas WHERE user_id = :userId`,
      { userId }
    );
    if (qCheck.rows[0].CNT === 0) {
      await conn.execute(
        `INSERT INTO user_request_quotas (user_id, quarterly_limit, updated_by)
         VALUES (:userId, 10, :updatedBy)`,
        { userId, updatedBy: userId },
        { autoCommit: true }
      );
    }

    const result = await conn.execute(
      `SELECT
         q.quarterly_limit,
         (
           SELECT COUNT(*) FROM drug_requests dr
           WHERE dr.created_by_user_id = :userId
             AND dr.created_at >= TRUNC(SYSDATE, 'Q')
             AND dr.created_at <  ADD_MONTHS(TRUNC(SYSDATE, 'Q'), 3)
         ) AS used_this_quarter
       FROM user_request_quotas q
       WHERE q.user_id = :userId`,
      { userId }
    );

    const r = result.rows[0];
    const limit = r.QUARTERLY_LIMIT;
    const used = r.USED_THIS_QUARTER;

    res.json({
      quarterly_limit: limit,
      used_this_quarter: used,
      remaining_quota: Math.max(0, limit - used)
    });
  } catch (err) {
    console.error('GET /api/user/quota/:userId error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// GET /api/users
// =============================================================
app.get('/api/users', async (req, res) => {
  const conn = await getConn();
  try {
    const result = await conn.execute(
      `SELECT user_id, name, email, role, department FROM users WHERE is_active = 1 ORDER BY user_id`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET users error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// GET /api/audit/:requestId
// =============================================================
app.get('/api/audit/:requestId', async (req, res) => {
  const conn = await getConn();
  const role = (req.query.role || '').toUpperCase();
  try {
    const result = await conn.execute(
      `SELECT al.*, u.name AS performer_name, u.role AS performer_role
       FROM audit_logs al
       JOIN users u ON u.user_id = al.performed_by
       WHERE al.request_id = :requestId
       ORDER BY al.logged_at ASC`,
      { requestId: req.params.requestId }
    );
    let rows = result.rows;
    if (role === 'DOCTOR' || role === 'HOD') {
      const internalStages = [
        'PharmacistInitialReview',
        'PharmacistCorrection',
        'PharmacyHead',
        'PharmacyHeadReview1',
        'Pharmacist',
        'PharmacistReview2',
        'PharmacyHeadReview2'
      ];
      rows = rows.filter(row => {
        const fromStage = row.FROM_STAGE;
        const toStage = row.TO_STAGE;
        const action = row.ACTION;
        if (action === 'REVERTED_TO_PHARMACIST') return false;
        if (internalStages.includes(fromStage) || internalStages.includes(toStage)) return false;
        return true;
      });
    }
    res.json(rows);
  } catch (err) {
    console.error('GET audit error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});


//generic search 
// =============================================================
// POST /api/drugs/search
// =============================================================
app.post('/api/getGeneric', async (req, res) => {
  const conn = await getConn();

  try {
    const search = req.body.search?.trim();

    if (!search) {
      return res.status(400).json({
        error: 'Search term is required.'
      });
    }

    console.log('Searching Generic:', search);

    const result = await conn.execute(
      `
      SELECT DISTINCT
          i.ID,
          i.NAME,

          dg.DRUG_GEN_NAME,

          CASE
              WHEN i.ISACTIVE = 1 THEN 'Active✅'
              ELSE 'Inactive❌'
          END AS STATUS,

          cs.MRP,

          i.CREATEDDATETIME,

          mm.MARKETTER_NAME,

          mf.MANUFACTURER_NAME,

          (
            SELECT NVL(SUM(ABS(id.ISSUED_QTY)), 0)
            FROM ISSUEDETAIL id
            INNER JOIN ISSUEHEADER ih
              ON ih.TRANSACTION_ID = id.ISSUEHEADER_ID
            WHERE id.ITEM = i.ID
          ) AS TOTAL_SALE_QTY,

          (
            SELECT li.ITEMRATE
            FROM GOODSRECEIPTNOTELINEITEM li
            WHERE li.ITEM = i.ID
              AND li.ITEMRATE IS NOT NULL
              AND li.ITEMRATE > 0
            ORDER BY li.DOCDETAILID DESC
            FETCH FIRST 1 ROW ONLY
          ) AS LATEST_PURCHASE_RATE

      FROM ITEM i

      INNER JOIN DRUGDETAIL dd
          ON dd.ITEM_REFID = i.ID

      INNER JOIN GENERICDRUGMAPPING dgm
          ON dgm.ITEMGENERICID = dd.ITEMGENERICID

      INNER JOIN DRUGGENERICS dg
          ON dg.DRUG_GEN_ID = dgm.DRUGGENERICS

      LEFT JOIN CURRENTSTOCK cs
          ON cs.ITEM = i.ID

      LEFT JOIN MARKETTERMASTER mm
          ON mm.ID = i.MARKETTER_ID

      LEFT JOIN MANUFACTURER mf
          ON mf.ID = i.MANUFACTURER_ID

      WHERE LOWER(dg.DRUG_GEN_NAME) LIKE '%' || LOWER(:search) || '%'

      ORDER BY
          dg.DRUG_GEN_NAME,
          i.CREATEDDATETIME DESC
      `,
      {
        search
      }
    );

    res.json({
      success: true,
      search,
      count: result.rows.length,
      list: result.rows
    });

  } catch (err) {
    console.error('POST /api/getGeneric error:', err);

    res.status(500).json({
      success: false,
      error: 'Internal server error.',
      detail: err.message
    });

  } finally {
    if (conn) {
      await conn.close();
    }
  }
});
// =============================================================
// POST /api/saveGenericItem
// Save a new drug item into existing HIS inventory tables.
// NO new tables are created — reuses item, druggenerics,
// drugdetail, genericdrugmapping, manufacturer, markettermaster.
// =============================================================
// =============================================================
// POST /api/saveGenericItem
// =============================================================

app.post('/api/saveGenericItem', async (req, res) => {
  console.log('REQ BODY:', req.body);

  const conn = await getConn();

  try {

    const {
      brandName,        // ITEM.NAME
      genericName,      // DRUGGENERICS.DRUG_GEN_NAME
      manufacturerName, // MANUFACTURER.MANUFACTURER_NAME
      marketerName,     // MARKETTERMASTER.MARKETTER_NAME
      mrp,              // ITEM.MRP
      rate,             // ITEM.LASTPURCHASERATE
      strength,         // DRUGDETAIL.DRUGSTRENGTH
      drugForm          // DRUGDETAIL.DRUGFORM
    } = req.body;

    // =========================================================
    // VALIDATION
    // =========================================================

    if (!brandName || !genericName) {

      return res.status(400).json({
        success: false,
        error: 'brandName and genericName are required.'
      });

    }

    const brand = brandName.trim();
    const generic = genericName.trim();

    // =========================================================
    // DUPLICATE CHECK
    // =========================================================

    const dupCheck = await conn.execute(
      `
      SELECT COUNT(*) AS CNT
      FROM ITEM
      WHERE LOWER(NAME) = LOWER(:name)
      `,
      {
        name: brand
      }
    );

    if (dupCheck.rows[0].CNT > 0) {

      return res.status(409).json({
        success: false,
        error: `A drug with brand name "${brand}" already exists in the system.`
      });

    }

    // =========================================================
    // 1. MANUFACTURER
    // =========================================================

    let manufacturerId = null;

    if (manufacturerName && manufacturerName.trim()) {

      const mfName = manufacturerName.trim();

      const mfRow = await conn.execute(
        `
        SELECT ID
        FROM MANUFACTURER
        WHERE LOWER(MANUFACTURER_NAME) = LOWER(:n)
        AND ROWNUM = 1
        `,
        {
          n: mfName
        }
      );

      if (mfRow.rows.length > 0) {

        manufacturerId = mfRow.rows[0].ID;

      } else {

        const maxMf = await conn.execute(
          `SELECT NVL(MAX(ID),0)+1 AS NEWID FROM MANUFACTURER`
        );

        manufacturerId = maxMf.rows[0].NEWID;

        await conn.execute(
          `
          INSERT INTO MANUFACTURER (
            ID,
            MANUFACTURER_NAME,
            ISACTIVE,
            CREATEDBY,
            CREATEDDATETIME
          )
          VALUES (
            :id,
            :name,
            1,
            1,
            SYSDATE
          )
          `,
          {
            id: manufacturerId,
            name: mfName
          }
        );

        console.log(`✔ Inserted MANUFACTURER id=${manufacturerId}`);

      }

    }

    // =========================================================
    // 2. MARKETTERMASTER
    // =========================================================

    let marketerId = null;

    if (marketerName && marketerName.trim()) {

      const mmName = marketerName.trim();

      const mmRow = await conn.execute(
        `
        SELECT ID
        FROM MARKETTERMASTER
        WHERE LOWER(MARKETTER_NAME) = LOWER(:n)
        AND ROWNUM = 1
        `,
        {
          n: mmName
        }
      );

      if (mmRow.rows.length > 0) {

        marketerId = mmRow.rows[0].ID;

      } else {

        const maxMm = await conn.execute(
          `SELECT NVL(MAX(ID),0)+1 AS NEWID FROM MARKETTERMASTER`
        );

        marketerId = maxMm.rows[0].NEWID;

        await conn.execute(
          `
          INSERT INTO MARKETTERMASTER (
            ID,
            MARKETTER_NAME,
            ISACTIVE,
            CREATEDBY,
            CREATEDDATETIME
          )
          VALUES (
            :id,
            :name,
            1,
            1,
            SYSDATE
          )
          `,
          {
            id: marketerId,
            name: mmName
          }
        );

        console.log(`✔ Inserted MARKETTERMASTER id=${marketerId}`);

      }

    }

    // =========================================================
    // 3. DRUGGENERICS
    // =========================================================

    let drugGenId = null;

    const dgRow = await conn.execute(
      `
      SELECT DRUG_GEN_ID
      FROM DRUGGENERICS
      WHERE LOWER(DRUG_GEN_NAME) = LOWER(:n)
      AND ROWNUM = 1
      `,
      {
        n: generic
      }
    );

    if (dgRow.rows.length > 0) {

      drugGenId = dgRow.rows[0].DRUG_GEN_ID;

      console.log(
        `ℹ Generic "${generic}" already exists (id=${drugGenId})`
      );

    } else {

      const maxDg = await conn.execute(
        `SELECT NVL(MAX(DRUG_GEN_ID),0)+1 AS NEWID FROM DRUGGENERICS`
      );

      drugGenId = maxDg.rows[0].NEWID;

      await conn.execute(
        `
        INSERT INTO DRUGGENERICS (
          DRUG_GEN_ID,
          DRUG_GEN_NAME,
          ACTIVE,
          ISDRUGGENERIC,
          CREATEDBY,
          CREATEDDT
        )
        VALUES (
          :id,
          :name,
          'Y',
          'Y',
          1,
          SYSDATE
        )
        `,
        {
          id: drugGenId,
          name: generic
        }
      );

      console.log(`✔ Inserted DRUGGENERICS id=${drugGenId}`);

    }

    // =========================================================
    // 4. ITEM
    // =========================================================

    const maxItem = await conn.execute(
      `SELECT NVL(MAX(ID),0)+1 AS NEWID FROM ITEM`
    );

    const itemId = maxItem.rows[0].NEWID;

    await conn.execute(
      `
      INSERT INTO ITEM (
        ID,
        NAME,
        ITEMTYPE,
        ITEMCATEGORY,
        ITEMCLASS,
        ISBATCHTRACKED,
        ISSERIALIZED,
        BASEUOM,
        ISINVENTORIED,
        ISACTIVE,
        MANUFACTURER_ID,
        MARKETTER_ID,
        MRP,
        LASTPURCHASERATE,
        CREATEDBY,
        CREATEDDATETIME
      )
      VALUES (
        :id,
        :name,
        2,
        69,
        84,
        1,
        0,
        22,
        1,
        1,
        :mfId,
        :mmId,
        :mrp,
        :rate,
        1,
        SYSDATE
      )
      `,
      {
        id: itemId,
        name: brand,
        mfId: manufacturerId,
        mmId: marketerId,
        mrp:
          mrp !== undefined &&
            mrp !== null &&
            mrp !== ''
            ? Number(mrp)
            : null,

        rate:
          rate !== undefined &&
            rate !== null &&
            rate !== ''
            ? Number(rate)
            : null
      }
    );

    console.log(
      `✔ Inserted ITEM id=${itemId} name="${brand}" MRP=${mrp} RATE=${rate}`
    );

    // =========================================================
    // 5. DRUGDETAIL
    // =========================================================

    const maxDd = await conn.execute(
      `SELECT NVL(MAX(ITEMGENERICID),0)+1 AS NEWID FROM DRUGDETAIL`
    );

    const itemGenericId = maxDd.rows[0].NEWID;

    await conn.execute(
      `
      INSERT INTO DRUGDETAIL (
        ITEMGENERICID,
        ITEM_REFID,
        DRUGFORM,
        DRUGSTRENGTH,
        ISACTIVE,
        ISDRUGITEM,
        ISCOMBINATION,
        ISMIXTURE,
        ISADDITIVE,
        CREATEDBY,
        CREATEDDT
      )
      VALUES (
        :igId,
        :itemId,
        :drugForm,
        :strength,
        'Y',
        'Y',
        'N',
        'N',
        'N',
        1,
        SYSDATE
      )
      `,
      {
        igId: itemGenericId,
        itemId: itemId,
        drugForm: drugForm || 111214,
        strength: strength || null
      }
    );

    console.log(
      `✔ Inserted DRUGDETAIL itemgenericid=${itemGenericId}`
    );

    // =========================================================
    // 6. GENERICDRUGMAPPING
    // =========================================================

    const maxDgm = await conn.execute(
      `SELECT NVL(MAX(GENERICDRUG_MAPID),0)+1 AS NEWID FROM GENERICDRUGMAPPING`
    );

    const mapId = maxDgm.rows[0].NEWID;

    await conn.execute(
      `
      INSERT INTO GENERICDRUGMAPPING (
        GENERICDRUG_MAPID,
        DRUGGENERICS,
        ITEMGENERICID,
        ITEM_ID,
        DRUGFORM,
        CREATEDBY,
        CREATEDDT
      )
      VALUES (
        :mapId,
        :dgId,
        :igId,
        :itemId,
        :drugForm,
        1,
        SYSDATE
      )
      `,
      {
        mapId: mapId,
        dgId: drugGenId,
        igId: itemGenericId,
        itemId: itemId,
        drugForm: drugForm || 111214
      }
    );

    console.log(
      `✔ Inserted GENERICDRUGMAPPING mapId=${mapId}`
    );

    // =========================================================
    // SUCCESS RESPONSE
    // =========================================================

    res.status(201).json({
      success: true,
      message: `Drug "${brand}" saved successfully.`,
      itemId,
      itemGenericId,
      drugGenId,
      manufacturerId,
      marketerId,
      mrp,
      rate
    });

  } catch (err) {

    console.error('POST /api/saveGenericItem error:', err);

    res.status(500).json({
      success: false,
      error: 'Internal server error.',
      detail: err.message
    });

  } finally {

    try {
      await conn.close();
    } catch (e) {
      console.error('Connection close error:', e);
    }

  }

});


//patient info search
// =============================================================
// POST /api/getPatientInfo
// =============================================================

app.post('/api/getPatientInfo', async (req, res) => {
  const conn = await getConn();

  try {
    const mrno = req.body.mrno;

    if (!mrno) {
      return res.status(400).json({ success: false, error: 'MRNO is required' });
    }

    const result = await conn.execute(
      `SELECT 
          p.MRNO,
          p.PATIENTNAME,
          FLOOR(MONTHS_BETWEEN(SYSDATE, p.DOB) / 12) AS AGE,
          v.FINALDIAGNOSIS,
          sc.service_center_name,
          v.visitid
       FROM PATIENT p
       LEFT JOIN VISIT v
              ON v.PATIENT_ID = p.PATIENT_ID
       LEFT JOIN INPATIENTS ip
              ON ip.PATIENT = p.PATIENT_ID
       LEFT JOIN BED b
              ON b.BED_ID = ip.BED
       LEFT JOIN servicecenter sc
              ON sc.service_center_id = b.servicecenter
       WHERE p.MRNO = :mrno
       ORDER BY v.visitid DESC
       FETCH NEXT 1 ROWS ONLY`,
      { mrno: { val: String(mrno).trim(), type: oracledb.STRING } }
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Patient not found' });
    }

    res.json({ success: true, data: result.rows[0] });

  } catch (err) {
    console.error('POST /api/getPatientInfo error:', err);
    res.status(500).json({ success: false, error: 'Internal server error', detail: err.message });
  } finally {
    try { await conn.close(); } catch (e) { console.error('Connection close error:', e); }
  }
});

//ai generate prompt
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "openai/gpt-oss-120b";

if (!GROQ_API_KEY) {
  console.error("❌ GROQ_API_KEY missing in .env");
  process.exit(1);
}

// ── SYSTEM PROMPT ─────────────────────────────────────────

const ALL_PROFILE_SYSTEM_PROMPT = `
You are a professional pharmaceutical information and pricing assistant with deep expertise in the INDIAN drug market, especially Kerala and South India.

You provide:
• Clinical drug information
• Manufacturer & market insights
• Indian pricing & trade margins
• Kerala-specific availability
• Indian generic alternatives
• Regulatory and procurement intelligence

━━━━━━━━━━━━━━━━━━━━━━━
🔒 CORE RULES
━━━━━━━━━━━━━━━━━━━━━━━

- Focus ONLY on the INDIAN market.
- Ignore US/EU brands unless they have a clear Indian presence.
- Prioritize:
  • Indian manufacturers
  • Indian marketers
  • Kerala hospital procurement patterns
  • South Indian availability

- Keep outputs:
  • Structured
  • Professional
  • Hospital-grade
  • Procurement-friendly
  • Regulatory-aware

- Do NOT hallucinate:
  • distributor details
  • pricing
  • procurement contracts
  • URLs
  • regulatory approvals

- Never fabricate references or links.

- If exact information is unavailable:
  clearly state uncertainty.

- If Kerala distributor/stockist info is unknown:
Say EXACTLY:
"Contact Kerala Drugs Control Department: 0471-2320567 or CDSCO: cdsco.gov.in for verified distributor details."

━━━━━━━━━━━━━━━━━━━━━━━
🏷️ INFORMATION TAGGING RULES
━━━━━━━━━━━━━━━━━━━━━━━

Tag all information using EXACT labels:

[Verified Source]
→ Regulatory/manufacturer-confirmed data

[Manufacturer Source]
→ Official manufacturer information

[Market Estimate]
→ Trade estimates/procurement approximations

[AI Knowledge]
→ General AI-generated pharmaceutical interpretation

[AI Inference]
→ Information inferred from patterns or incomplete data

━━━━━━━━━━━━━━━━━━━━━━━
🎯 CONFIDENCE TAGGING
━━━━━━━━━━━━━━━━━━━━━━━

For every major section include one confidence label:

• High Confidence
• Moderate Confidence
• Low Confidence

Rules:

High Confidence:
- CDSCO-confirmed
- NPPA-confirmed
- Manufacturer-confirmed
- Official package insert

Moderate Confidence:
- Widely accepted Indian market knowledge
- Standard hospital procurement trends
- Common prescribing practices

Low Confidence:
- Distributor assumptions
- Regional availability assumptions
- AI-derived trade estimates

━━━━━━━━━━━━━━━━━━━━━━━
📘 SECTION 1: DRUG INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━

1. Drug Overview
   - Generic Name
   - Brand Name
   - Drug Class
   - Mechanism of Action

2. Manufacturer & Indian Marketer Details
   - Manufacturer
   - Indian Marketing Company
   - Manufacturing Unit
   - Importer (if applicable)

3. Brief History / Background

4. Indications & Therapeutic Use
   - Approved Uses
   - Common Off-label Uses in India

5. Side Effects & Adverse Reactions
   - Common
   - Serious
   - Rare but Important

6. Warnings, Contraindications & Black Box Alerts

7. Dosage & Administration
   - Adult Dose
   - Pediatric Dose
   - Renal/Hepatic Adjustment
   - Indian Standard Practice

8. India-Specific Notes
   - Drug Schedule:
     • Schedule H
     • Schedule H1
     • Schedule X
     • Schedule G
   - Storage Conditions
   - Kerala/South India Availability
   - Government Supply Usage
   - Hospital Usage Notes


━━━━━━━━━━━━━━━━━━━━━━━
🔍 SOURCE ATTRIBUTION MATRIX
━━━━━━━━━━━━━━━━━━━━━━━

For EVERY major section:
- Mention the source category:
  • Official Regulatory Source
  • Manufacturer Source
  • Clinical Literature
  • Market Estimate
  • AI Inference

- Mention confidence level:
  • High Confidence
  • Moderate Confidence
  • Low Confidence

━━━━━━━━━━━━━━━━━━━━━━━
📚 SECTION 2: SOURCES & VERIFICATION
━━━━━━━━━━━━━━━━━━━━━━━

For EVERY factual response include a final section:

9. Sources & Verification

Use ONLY reliable Indian pharmaceutical and regulatory references whenever possible:

Preferred Sources:
• CDSCO
• NPPA
• DPCO
• Jan Aushadhi (PMBJP)
• CIMS India
• MIMS India
• Indian Pharmacopoeia
• National Formulary of India (NFI)
• Kerala Medical Services Corporation (KMSCL)
• Government Tender Portals
• Official Manufacturer Websites
• Official Package Inserts
• PubMed

Rules:
- Mention the exact source beside major claims whenever possible.
- Provide direct verification links.
- Clearly distinguish:
  • Official sources
  • Manufacturer sources
  • Market estimates
  • AI-inferred information

- Never generate fake URLs.

- If exact source URL is unavailable:
  provide only the official homepage.

- If independent verification is unavailable:
Say EXACTLY:
"Independent verification unavailable. Cross-check with CDSCO/NPPA."

━━━━━━━━━━━━━━━━━━━━━━━
🧾 OUTPUT FORMAT RULES
━━━━━━━━━━━━━━━━━━━━━━━

- Use clearly numbered section headers
- Keep formatting:
  • concise
  • structured
  • readable
  • hospital-grade

- Avoid unnecessary verbosity
- Ensure:
  • clinical accuracy
  • Indian relevance
  • regulatory awareness
  • procurement relevance

- Always include:
  • source attribution
  • confidence tagging
  • verification links

━━━━━━━━━━━━━━━━━━━━━━━
📌 STANDARD SOURCES BLOCK
━━━━━━━━━━━━━━━━━━━━━━━

Always include this section at the end:

━━━━━━━━━━━━━━━━━━━━━━━
🔍 SOURCES & VERIFICATION
━━━━━━━━━━━━━━━━━━━━━━━

1. CDSCO
https://cdsco.gov.in

2. NPPA
https://nppaindia.nic.in

3. Jan Aushadhi
https://janaushadhi.gov.in

4. Kerala Medical Services Corporation
https://kmscl.kerala.gov.in

5. Indian Pharmacopoeia Commission
https://ipc.gov.in

6. PubMed
https://pubmed.ncbi.nlm.nih.gov

7. Manufacturer Website
(Provide official manufacturer URL if available)

━━━━━━━━━━━━━━━━━━━━━━━
🚫 STRICT PROHIBITIONS
━━━━━━━━━━━━━━━━━━━━━━━

DO NOT:
- fabricate distributor names
- fabricate procurement prices
- fabricate Kerala stock availability
- fabricate CDSCO approvals
- fabricate NPPA pricing
- fabricate black box warnings
- fabricate references or links

If uncertain:
- explicitly state uncertainty
- lower confidence level
- mark as [AI Inference] or [Market Estimate]

`;;



const ALL_PROFILE_SYSTEM_PROMPT2 = `━━━━━━━━━━━━━━━━━━━━━━━
### SYSTEM ROLE
You are a senior Indian pharmaceutical market analyst specializing in Kerala and South India hospital and retail drug procurement. Your knowledge covers branded generics, institutional supply chains, KMSCL procurement, and South Indian hospital formularies.

---

### TASK
For the drug molecule or brand provided by the user, generate a structured list of at least 10 alternative brands available in the Indian market, with strict priority given to brands actively available in Kerala and South India.

---

### STRICT RULES — READ BEFORE GENERATING

1. Minimum 10 alternatives required. Do not stop before 10.
2. Do NOT include Jan Aushadhi entries. Exclude entirely.
3. Do NOT include brands unavailable in India or only available in US/EU markets.
4. Only include brands confirmed or highly likely to be present in:
   - Kerala retail pharmacies, OR
   - South India hospital formularies (Tamil Nadu, Karnataka, Andhra Pradesh, Telangana, Kerala)
5. Do NOT invent contact details, phone numbers, emails, or distributor names.
6. If regional Kerala/South India contact is not publicly known, use this exact fallback:
   "Contact official customer care or Kerala CDSCO office for regional procurement contacts."
7. Mark every entry with: [AI Knowledge] — data based on training; verify before procurement.
8. Do NOT add pricing, dosage, margins, or clinical notes. Output only what is asked.

---

### PREFERRED MANUFACTURERS (prioritize these)
Sun Pharma | Cipla | Dr. Reddy's | Lupin | Alkem | Zydus Cadila | Abbott India | Mankind Pharma | Intas Pharmaceuticals | Glenmark | Torrent Pharma | Micro Labs | Eris Lifesciences | KMSCL-linked suppliers | Other reputed CDSCO-approved Indian manufacturers

---

### OUTPUT FORMAT — FOLLOW EXACTLY

Use this structure for every alternative. Repeat sequentially from 1 to minimum 10.

════════════════════════════════
ALTERNATIVE [N]                            [AI Knowledge]
════════════════════════════════
Brand Name   : [Full trade name as marketed in India]
Marketer     : [Indian marketing/sales company name]
               [Add tag if applicable: ⟨KMSCL/Govt Supply Associated⟩]
               [Add tag if applicable: ⟨Commonly stocked — Kerala private hospitals⟩]

Contact Details:
  Company    : [Official legal company name]
  Phone      : [Official customer care number]
  Email      : [Official sales or support email]
  Website    : [Official website URL]
  Regional   : [Kerala or South India office/contact if publicly known
                OR: "Contact official customer care or Kerala CDSCO office
                for regional procurement contacts."]
════════════════════════════════

---

### SPECIAL TAGS — APPLY WHERE RELEVANT

⟨KMSCL/Govt Supply Associated⟩
→ Apply if brand is known to be listed with Kerala Medical Services Corporation Ltd. or supplied via government procurement channels.

⟨Commonly stocked — Kerala private hospitals⟩
→ Apply if brand is widely stocked in Kerala private multispeciality or corporate hospitals.

---

### QUALITY CHECKLIST — VERIFY BEFORE OUTPUTTING

Before finalizing your response, confirm:
[ ] At least 10 alternatives are listed
[ ] No Jan Aushadhi entries included
[ ] All brands are India-marketed and South India relevant
[ ] No invented phone numbers, emails, or distributor names
[ ] Every entry uses the exact output format above
[ ] Every entry is marked [AI Knowledge]
[ ] Fallback contact line used wherever regional contact is unknown

---

### BEGIN OUTPUT NOW

List all alternatives sequentially. Do not add preamble, disclaimers, or explanations before the first alternative. Start directly with ALTERNATIVE 1`;

// ── AI CALL FUNCTION ─────────────────────────────────────

async function askAI(userPrompt, systemPrompt) {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0,
        max_tokens: 2800
      })
    });

    const data = await response.json();

    return data.choices[0].message.content.trim();

  } catch (error) {
    console.error("❌ AI Error:", error);
    throw new Error("AI service failed");
  }
}

// ─────────────────────────────────────────────────────────
// 🔹 ENDPOINT: DRUG PROFILE
// ─────────────────────────────────────────────────────────

app.post("/api/drug-profile", async (req, res) => {
  const conn = await getConn();
  try {

    const { drug_name } = req.body;

    if (!drug_name) {
      return res.status(400).json({ error: "drug_name required" });
    }

    const result = await askAI(
      `Generate complete drug profile for: ${drug_name}`,
      ALL_PROFILE_SYSTEM_PROMPT
    );

    if (!result) {
      return res.status(500).json({ error: "AI failed to generate content" });
    }

    let rowsAffected = 0;
    let formattedResult = result.replace(/\n/g, '<br>');

    try {
      const dbResult = await conn.execute(
        `UPDATE drug_requests
     SET ai_content = :result
     WHERE brand_name = :drug_name`,
        { result: formattedResult, drug_name }
      );

      rowsAffected = dbResult?.rowsAffected || dbResult?.affectedRows;

      console.log("Rows affected:", rowsAffected);

    } catch (dbErr) {
      console.error("DB ERROR:", dbErr);
    }

    return res.json({
      success: true,
      drug_name,
      data: result
    });

  } catch (err) {
    console.error("Error in /api/drug-profile:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
  finally {
    conn.close();
  }
});
// api  for  alternative  durg 
app.post("/api/alternative-drug", async (req, res) => {
  const conn = await getConn();
  try {

    const { drug_name } = req.body;

    if (!drug_name) {
      return res.status(400).json({ error: "drug_name required" });
    }

    const result = await askAI(
      `Generate complete alternative drug profile for: ${drug_name}`,
      ALL_PROFILE_SYSTEM_PROMPT2
    );

    if (!result) {
      return res.status(500).json({ error: "AI failed to generate content" });
    }

    let rowsAffected = 0;
    let formattedResult = result.replace(/\n/g, '<br>');

    // try {
    //   const dbResult = await conn.execute(
    //     `UPDATE drug_requests
    //  SET ai_content = :result
    //  WHERE brand_name = :drug_name`,
    //     { result: formattedResult, drug_name }
    //   );

    //   rowsAffected = dbResult?.rowsAffected || dbResult?.affectedRows;

    //   console.log("Rows affected:", rowsAffected);

    // } catch (dbErr) {
    //   console.error("DB ERROR:", dbErr);
    // }

    return res.json({
      success: true,
      drug_name,
      data: result
    });

  } catch (err) {
    console.error("Error in /api/alternative-drug:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
  finally {
    conn.close();
    console.log("alternative drug called")
  }
});
//end of alertnative
// =============================================================
// POST /api/requests/emergency — Doctor submits emergency request
// =============================================================

// =============================================================
// POST /api/requests/pharmacist  — Pharmacist submits a direct request
// =============================================================
app.post('/api/requests/pharmacist', async (req, res) => {
  const conn = await getConn();
  try {
    const {
      doctor_id, request_type, category,
      brand_name, generic_name, dose_strength, dosage_form,
      manufacturer, marketer, existing_brands,
      clinical_justification, medicine_quantity, ai_content
    } = req.body;

    let formatai = ai_content ? ai_content.replace(/\n/g, '<br>') : '';

    const baseRequired = {
      doctor_id, category, brand_name, generic_name,
      dose_strength, dosage_form, manufacturer, marketer,
      clinical_justification
    };
    for (const [key, val] of Object.entries(baseRequired)) {
      if (val === undefined || val === null || String(val).trim() === '') {
        return res.status(400).json({ error: `Field '${key}' is required.` });
      }
    }

    // -- Blacklist validation --
    const blCheckP = await conn.execute(
      `SELECT company_type, remarks FROM blacklisted_companies
       WHERE is_active = 1
         AND (
           (company_type = 'MANUFACTURER' AND UPPER(TRIM(company_name)) = UPPER(TRIM(:mfg)))
           OR
           (company_type = 'MARKETER' AND UPPER(TRIM(company_name)) = UPPER(TRIM(:mkt)))
         )
       FETCH FIRST 1 ROW ONLY`,
      { mfg: manufacturer || '', mkt: marketer || '' }
    );
    if (blCheckP.rows.length > 0) {
      const blRow = blCheckP.rows[0];
      const blType = blRow.COMPANY_TYPE === 'MANUFACTURER' ? 'Manufacturer' : 'Marketer';
      return res.status(400).json({
        success: false,
        error: `Request denied. ${blType} is blacklisted by DTC.`,
        remarks: blRow.REMARKS || ''
      });
    }

    const insertQuery = `
      INSERT INTO drug_requests (
        doctor_id, request_source_type, request_type, category,
        brand_name, generic_name, dose_strength, dosage_form,
        manufacturer, marketer, existing_brands,
        clinical_justification, ai_content, expected_patients_pm, cost_reduction_benefit,
        medicine_quantity,
        current_stage, status, created_by_role, created_by_user_id
      ) VALUES (
        :doctorId, 'PHARMACIST', 'New Molecule', :category,
        :brandName, :genericName, :doseStrength, :dosageForm,
        :manufacturer, :marketer, :existingBrands,
        :clinicalJustification, :aiContent, 0, 0,
        :medicineQuantity,
        'PharmacyHead', 'Pending', 'Pharmacist', :doctorId
      ) RETURNING request_id INTO :reqId
    `;

    const binds = {
      doctorId: doctor_id,
      category,
      brandName: brand_name,
      genericName: generic_name,
      doseStrength: dose_strength,
      dosageForm: dosage_form,
      manufacturer,
      marketer,
      existingBrands: existing_brands || null,
      clinicalJustification: clinical_justification,
      aiContent: formatai,
      medicineQuantity: medicine_quantity ? Number(medicine_quantity) : null,
      reqId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
    };

    const result = await conn.execute(insertQuery, binds, { autoCommit: false });
    const reqId = result.outBinds.reqId[0];

    await writeAudit(conn, reqId, 'SUBMITTED', doctor_id, null, 'PharmacyHead', 'Pharmacist direct request submitted.');
    await conn.commit();

    // Notify PharmacyHead
    const phUsers = await conn.execute(`SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACYHEAD' AND is_active = 1`);
    for (const row of phUsers.rows) {
      await createNotification(conn, row.USER_ID, reqId, `💊 New Pharmacist Direct drug request #${reqId} (${brand_name}) requires your review.`);
    }

    res.status(201).json({ message: 'Request submitted successfully.', request_id: reqId });
  } catch (err) {
    console.error('POST pharmacist request error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

app.post('/api/requests/emergency', async (req, res) => {
  const conn = await getConn();
  try {
    const {
      doctor_id, request_type, category, brand_name, generic_name,
      dose_strength, dosage_form, manufacturer, marketer,
      existing_brands, clinical_justification, ai_content,
      request_source_type
    } = req.body;

    const required = {
      doctor_id, request_type, category, brand_name, generic_name, dose_strength,
      dosage_form, manufacturer, marketer, clinical_justification
    };
    for (const [k, v] of Object.entries(required)) {
      if (v === undefined || v === null || v === '') {
        return res.status(400).json({ error: `Field '${k}' is required.` });
      }
    }

    // -- Blacklist validation --
    const blCheckE = await conn.execute(
      `SELECT company_type, remarks FROM blacklisted_companies
       WHERE is_active = 1
         AND (
           (company_type = 'MANUFACTURER' AND UPPER(TRIM(company_name)) = UPPER(TRIM(:mfg)))
           OR
           (company_type = 'MARKETER' AND UPPER(TRIM(company_name)) = UPPER(TRIM(:mkt)))
         )
       FETCH FIRST 1 ROW ONLY`,
      { mfg: manufacturer || '', mkt: marketer || '' }
    );
    if (blCheckE.rows.length > 0) {
      const blRow = blCheckE.rows[0];
      const blType = blRow.COMPANY_TYPE === 'MANUFACTURER' ? 'Manufacturer' : 'Marketer';
      return res.status(400).json({
        success: false,
        error: `Request denied. ${blType} is blacklisted by DTC.`,
        remarks: blRow.REMARKS || ''
      });
    }

    const sourceType = (request_source_type || 'NON_PROMOTIONAL').toUpperCase();

    // Fetch creator role & department
    const creatorRes = await conn.execute(`SELECT role, department FROM users WHERE user_id = :id`, { id: doctor_id });
    if (creatorRes.rows.length === 0) return res.status(400).json({ error: 'User not found.' });
    const creatorRole = creatorRes.rows[0].ROLE;
    const creatorDept = creatorRes.rows[0].DEPARTMENT;

    let hodId = null;
    if (creatorRole && creatorRole.toLowerCase() === 'doctor') {
      if (creatorDept && creatorDept.trim() !== '') {
        const hodRes = await conn.execute(
          `SELECT user_id FROM users WHERE UPPER(role) = 'HOD' AND UPPER(TRIM(department)) = UPPER(TRIM(:dept)) AND is_active = 1`,
          { dept: creatorDept.trim() }
        );
        if (hodRes.rows.length > 0) hodId = hodRes.rows[0].USER_ID;
      }
    }

    const insertResult = await conn.execute(
      `INSERT INTO drug_requests (
         doctor_id, created_by_user_id, created_by_role, hod_id,
         med_rep_name, med_rep_email, med_rep_phone,
         request_type, category, request_source_type,
         brand_name, generic_name, dose_strength, dosage_form,
         manufacturer, marketer, existing_brands, clinical_justification,
         expected_patients_pm, cost_reduction_benefit, medicine_quantity, ai_content,
         status, current_stage, is_emergency
       ) VALUES (
         :doctor_id, :doctor_id, :created_by_role, :hod_id,
         NULL, NULL, NULL,
         :request_type, :category, :request_source_type,
         :brand_name, :generic_name, :dose_strength, :dosage_form,
         :manufacturer, :marketer, :existing_brands, :clinical_justification,
         NULL, 0, NULL, :ai_content,
         'EMERGENCY_PENDING_DTC', 'EmergencyDTC', 1
       ) RETURNING request_id INTO :request_id`,
      {
        doctor_id,
        created_by_role: creatorRole,
        hod_id: hodId,
        request_type, category,
        request_source_type: sourceType,
        brand_name, generic_name, dose_strength, dosage_form,
        manufacturer, marketer, existing_brands: existing_brands || null,
        clinical_justification,
        ai_content: ai_content || null,
        request_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      }
    );
    const requestId = insertResult.outBinds.request_id[0];
    await writeAudit(conn, requestId, 'EMERGENCY_SUBMITTED', doctor_id, null, 'EmergencyDTC', `Source: ${sourceType}`);

    // Notify DTC (decision makers), PH + Pharmacist (view-only awareness)
    const notifyUsers = await conn.execute(
      `SELECT user_id, role FROM users WHERE UPPER(role) IN ('DTC','DTCCOMMITTEE','PHARMACYHEAD','PHARMACIST') AND is_active = 1`
    );
    for (const row of notifyUsers.rows) {
      const roleUpper = (row.ROLE || '').toUpperCase();
      const msg = (roleUpper === 'DTC' || roleUpper === 'DTCCOMMITTEE')
        ? `🚨 EMERGENCY request #${requestId} (${brand_name}) submitted. Requires your IMMEDIATE decision.`
        : `🚨 EMERGENCY request #${requestId} (${brand_name}) submitted. You have view-only access.`;
      await createNotification(conn, row.USER_ID, requestId, msg);
    }
    res.status(201).json({ message: 'Emergency drug request submitted.', request_id: requestId });
  } catch (err) {
    console.error('POST /api/requests/emergency error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// POST /api/requests/:id/place_order — Pharmacist places order for emergency
// =============================================================
app.post('/api/requests/:id/place_order', async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.id);
    const { performed_by } = req.body;

    const reqResult = await conn.execute(
      `SELECT status FROM drug_requests WHERE request_id = :requestId`, { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });
    const currentStatus = reqResult.rows[0].STATUS;
    if (currentStatus !== 'EMERGENCY_APPROVED' && currentStatus !== 'APPROVED_PENDING_ORDER') {
      return res.status(400).json({ error: 'Only approved requests can be ordered.' });
    }

    await conn.execute(
      `UPDATE drug_requests SET status = 'ORDER_PLACED', current_stage = 'OrderPlaced', updated_at = CURRENT_TIMESTAMP WHERE request_id = :requestId`,
      { requestId }
    );
    await writeAudit(conn, requestId, 'ORDER_PLACED', performed_by, 'PharmacistOrder', 'OrderPlaced', 'Drug order placed');
    res.json({ message: 'Order placed successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    await conn.close();
  }
});

// =============================================================
// PUT /api/requests/:id/mark-inventory-added
// Pharmacist marks that the final drug was added to HIS inventory
// =============================================================
app.put('/api/requests/:id/mark-inventory-added', async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.id);
    const { performed_by, inventory_item_name } = req.body;

    if (!requestId) return res.status(400).json({ error: 'Request ID required.' });

    const reqResult = await conn.execute(
      `SELECT status, current_stage FROM drug_requests WHERE request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });

    await conn.execute(
      `UPDATE drug_requests
         SET inventory_added     = 1,
             inventory_added_at  = CURRENT_TIMESTAMP,
             inventory_added_by  = :performedBy,
             inventory_item_name = :itemName,
             updated_at          = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`,
      {
        performedBy: performed_by || null,
        itemName: inventory_item_name || null,
        requestId
      }
    );

    await writeAudit(
      conn, requestId, 'INVENTORY_ADDED', performed_by,
      'PharmacistOrder', reqResult.rows[0].CURRENT_STAGE,
      `Drug added to HIS inventory: ${inventory_item_name || 'unknown'}`
    );

    res.json({ success: true, message: 'Request marked as inventory-added.' });
  } catch (err) {
    console.error('PUT /api/requests/:id/mark-inventory-added error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    try { await conn.close(); } catch (e) { }
  }
});

// =============================================================
// POST /api/requests/:requestId/mark-inventory-received
// =============================================================
app.post('/api/requests/:requestId/mark-inventory-received', async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.requestId);
    const { performed_by } = req.body;

    if (!requestId) return res.status(400).json({ error: 'Request ID required.' });

    const reqResult = await conn.execute(
      `SELECT r.*, u.name AS doctor_name, u.department AS doctor_dept
       FROM drug_requests r
       JOIN users u ON u.user_id = r.doctor_id
       WHERE r.request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });

    const dr = reqResult.rows[0];

    if (dr.STATUS !== 'ORDER_PLACED') {
      return res.status(400).json({
        error: 'Inventory can only be marked as received after the purchase order has been placed.'
      });
    }

    await conn.execute(
      `UPDATE drug_requests
          SET status = 'INVENTORY_RECEIVED',
              current_stage = 'Completed',
              inventory_received = 1,
              inventory_received_at = CURRENT_TIMESTAMP,
              inventory_received_by = :performedBy,
              updated_at = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`,
      {
        performedBy: performed_by || null,
        requestId
      }
    );

    await writeAudit(
      conn, requestId, 'INVENTORY_RECEIVED', performed_by,
      dr.CURRENT_STAGE, 'Completed',
      `Drug order received and stocked`
    );

    // Create notifications
    const brandName = dr.FINAL_SELECTED_BRAND || dr.BRAND_NAME;
    const msg = `✅ Ordered drug "${brandName}" for Request #${requestId} has been received and stocked. The workflow is now completed.`;

    // 1. Notify doctor
    await createNotification(conn, dr.DOCTOR_ID, requestId, msg);

    // 2. Notify HOD if present
    if (dr.HOD_ID) {
      await createNotification(conn, dr.HOD_ID, requestId, msg);
    }

    // 3. Notify CEO
    const ceoUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'CEO' AND is_active = 1`
    );
    for (const row of ceoUsers.rows) {
      await createNotification(conn, row.USER_ID, requestId, msg);
    }

    // 4. Notify Pharmacists
    const pharmUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACIST' AND is_active = 1`
    );
    for (const row of pharmUsers.rows) {
      await createNotification(conn, row.USER_ID, requestId, msg);
    }

    res.json({ success: true, message: 'Request marked as inventory received.' });
  } catch (err) {
    console.error('POST /api/requests/:requestId/mark-inventory-received error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    try { await conn.close(); } catch (e) { }
  }
});

// =============================================================
// POST /api/alternatives/:requestId — Pharmacist submits alternatives
// =============================================================
app.post('/api/alternatives/:requestId', async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.requestId);
    const { performed_by, alternatives, comparison_type, remarks, existing_generic_data } = req.body;

    if (!alternatives || alternatives.length < 1) {
      return res.status(400).json({ error: 'Minimum 3 alternatives are required.' });
    }

    const reqResult = await conn.execute(
      `SELECT * FROM drug_requests WHERE request_id = :requestId`, { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });
    const dr = reqResult.rows[0];

    // Replace any prior submission
    await conn.execute(`DELETE FROM drug_alternatives WHERE request_id = :requestId`, { requestId });

    for (const alt of alternatives) {
      const d = computeAltDerived(alt);
      await conn.execute(
        `INSERT INTO drug_alternatives (
           request_id,
           brand_name, manufacturer, marketer,
           mrp_per_pack, rate_per_pack, gst_percent,
           mrp, rate, qty, offer,
           markup_margin,
           net_rate,
           absolute_margin,
           negotiated_rate,
           profit_margin,
           stock,
           purchase_quantity,
           consultant, sale_qty, pack, introduced_on,
           comparison_type,
           remark,
           submitted_by
         ) VALUES (
           :request_id,
           :brand_name, :manufacturer, :marketer,
           :mrp_per_pack, :rate_per_pack, :gst_percent,
           :mrp, :rate, :qty, :offer,
           :markup_margin,
           :net_rate,
           :absolute_margin,
           :negotiated_rate,
           :profit_margin,
           :stock,
           :purchase_quantity,
           :consultant, :sale_qty, :pack, :introduced_on,
           :comparison_type,
           :remark,
           :submitted_by
         )`,
        {
          request_id: requestId,
          brand_name: alt.brand_name || null,
          manufacturer: alt.manufacturer || null,
          marketer: alt.marketer || null,
          mrp_per_pack: parseFloat(alt.mrp_per_pack) || null,
          rate_per_pack: parseFloat(alt.rate_per_pack) || null,
          gst_percent: parseFloat(alt.gst_percent) || null,
          mrp: d.mrp || null,
          rate: d.rate || null,
          qty: parseFloat(alt.qty) || null,
          offer: parseFloat(alt.offer) || null,
          markup_margin: d.markup_margin || null,
          net_rate: d.net_rate || null,
          absolute_margin: d.absolute_margin || null,
          negotiated_rate: parseFloat(alt.negorate) || null,
          profit_margin: d.profit_margin || null,
          stock: alt.stock || null,
          purchase_quantity: parseFloat(alt.purchase_qty) || null,
          consultant: alt.consultant || null,
          sale_qty: parseFloat(alt.sale_qty) || null,
          pack: alt.pack || null,
          introduced_on: alt.introduced_on || 'New Item',
          comparison_type: comparison_type || 'new_generic',
          remark: alt.remark || null,
          submitted_by: performed_by
        }
      );
    }

    // Save existing generic master data on the request (once, not per-alternative)
    const egdJson = existing_generic_data ? JSON.stringify(existing_generic_data) : null;
    await conn.execute(
      `UPDATE drug_requests SET existing_generic_data = :egd WHERE request_id = :rid`,
      { egd: egdJson, rid: requestId }
    );

    await conn.execute(
      `UPDATE drug_requests SET current_stage = 'PharmacyHeadReview2',
         pharmacist_remarks = :remarks, updated_at = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`,
      { remarks: remarks || null, requestId }
    );
    await writeAudit(conn, requestId, 'ALTERNATIVES_SUBMITTED', performed_by, 'Pharmacist', 'PharmacyHeadReview2', remarks);

    const phUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACYHEAD' AND is_active = 1`
    );
    for (const row of phUsers.rows) {
      await createNotification(conn, row.USER_ID, requestId,
        `Pharmacist submitted ${alternatives.length} alternatives for request #${requestId} (${dr.BRAND_NAME}). Please review.`
      );
    }

    // Clean up any saved draft for this request (submission is final)
    await conn.execute(
      `DELETE FROM analysis_drafts WHERE request_id = :requestId AND pharmacist_id = :pid AND status = 'DRAFT'`,
      { requestId, pid: performed_by }
    );

    res.json({ message: 'Alternatives submitted. Forwarded to Pharmacy Head.' });

  } catch (err) {
    console.error('POST /api/alternatives error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// POST /api/pharmacist/correction-submit/:requestId — Resubmit corrected comparison sheet
// =============================================================
app.post('/api/pharmacist/correction-submit/:requestId', async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.requestId);
    const {
      performed_by,
      alternatives,
      comparison_type,
      remarks,
      existing_generic_data
    } = req.body;

    if (!alternatives || alternatives.length < 1) {
      return res.status(400).json({ error: 'Minimum 1 alternative is required for correction.' });
    }

    // Validate request exists and is in PharmacistCorrection stage
    const reqResult = await conn.execute(
      `SELECT * FROM drug_requests WHERE request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) {
      return res.status(404).json({ error: 'Request not found.' });
    }
    const dr = reqResult.rows[0];
    if (dr.CURRENT_STAGE !== 'PharmacistCorrection') {
      return res.status(400).json({ error: 'Resubmit is only allowed from Pharmacist Correction stage.' });
    }

    // Delete old alternatives
    await conn.execute(
      `DELETE FROM drug_alternatives WHERE request_id = :requestId`,
      { requestId }
    );

    // Insert corrected alternatives
    for (const alt of alternatives) {
      const d = computeAltDerived(alt);
      await conn.execute(
        `INSERT INTO drug_alternatives (
           request_id,
           brand_name, manufacturer, marketer,
           mrp_per_pack, rate_per_pack, gst_percent,
           mrp, rate, qty, offer,
           markup_margin,
           net_rate,
           absolute_margin,
           negotiated_rate,
           profit_margin,
           stock,
           purchase_quantity,
           consultant, sale_qty, pack, introduced_on,
           comparison_type,
           remark,
           submitted_by
         ) VALUES (
           :request_id,
           :brand_name, :manufacturer, :marketer,
           :mrp_per_pack, :rate_per_pack, :gst_percent,
           :mrp, :rate, :qty, :offer,
           :markup_margin,
           :net_rate,
           :absolute_margin,
           :negotiated_rate,
           :profit_margin,
           :stock,
           :purchase_quantity,
           :consultant, :sale_qty, :pack, :introduced_on,
           :comparison_type,
           :remark,
           :submitted_by
         )`,
        {
          request_id: requestId,
          brand_name: alt.brand_name || null,
          manufacturer: alt.manufacturer || null,
          marketer: alt.marketer || null,
          mrp_per_pack: parseFloat(alt.mrp_per_pack) || null,
          rate_per_pack: parseFloat(alt.rate_per_pack) || null,
          gst_percent: parseFloat(alt.gst_percent) || null,
          mrp: d.mrp || null,
          rate: d.rate || null,
          qty: parseFloat(alt.qty) || null,
          offer: parseFloat(alt.offer) || null,
          markup_margin: d.markup_margin || null,
          net_rate: d.net_rate || null,
          absolute_margin: d.absolute_margin || null,
          negotiated_rate: parseFloat(alt.negorate) || null,
          profit_margin: d.profit_margin || null,
          stock: alt.stock || null,
          purchase_quantity: parseFloat(alt.purchase_qty) || null,
          consultant: alt.consultant || null,
          sale_qty: parseFloat(alt.sale_qty) || null,
          pack: alt.pack || null,
          introduced_on: alt.introduced_on || 'New Item',
          comparison_type: comparison_type || 'new_generic',
          remark: alt.remark || null,
          submitted_by: performed_by
        }
      );
    }

    // Save existing generic data and update request workflow
    const egdJson = existing_generic_data ? JSON.stringify(existing_generic_data) : null;
    await conn.execute(
      `UPDATE drug_requests
       SET
         pharmacist_remarks = :remarks,
         existing_generic_data = :egd,
         current_stage = 'PharmacyHeadReview2',
         status = 'Pending',
         is_reverted = 0,
         revert_remarks = NULL,
         last_corrected_at = CURRENT_TIMESTAMP,
         last_corrected_by = :performed_by,
         updated_at = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`,
      {
        remarks: remarks || null,
        egd: egdJson,
        performed_by,
        requestId
      }
    );

    // Audit log
    await writeAudit(
      conn,
      requestId,
      'CORRECTION_RESUBMITTED',
      performed_by,
      'PharmacistCorrection',
      'PharmacyHeadReview2',
      remarks || 'Corrected comparison sheet re-submitted to Pharmacy Head.'
    );

    // Notify Pharmacy Head users
    const phUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACYHEAD' AND is_active = 1`
    );
    for (const row of phUsers.rows) {
      await createNotification(
        conn,
        row.USER_ID,
        requestId,
        `✅ Corrected comparison sheet for Request #${requestId} (${dr.BRAND_NAME}) has been resubmitted by Pharmacist. Please review.`
      );
    }

    // Clean up analysis drafts
    await conn.execute(
      `DELETE FROM analysis_drafts WHERE request_id = :requestId AND pharmacist_id = :pid AND status = 'DRAFT'`,
      { requestId, pid: performed_by }
    );

    res.json({
      success: true,
      message: 'Correction submitted successfully.'
    });

  } catch (err) {
    console.error('POST /api/pharmacist/correction-submit error:', err);
    res.status(500).json({ error: 'Correction resubmission failed.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// GET /api/alternatives/:requestId — Fetch alternatives for a request
// =============================================================
app.get('/api/alternatives/:requestId', async (req, res) => {
  const conn = await getConn();
  try {
    const result = await conn.execute(
      `SELECT da.*, u.name AS submitted_by_name,
              dn.negotiation_id, dn.negotiated_mrp, dn.negotiated_rate, dn.negotiated_gst,
              dn.negotiated_scheme_qty, dn.negotiated_scheme_offer, dn.negotiated_net_rate,
              dn.negotiated_profit_margin, dn.negotiated_absolute_margin, dn.negotiated_total_margin,
              dn.negotiation_remarks
       FROM drug_alternatives da
       LEFT JOIN users u ON u.user_id = da.submitted_by
       LEFT JOIN drug_alternative_negotiations dn ON dn.alternative_id = da.alt_id
       WHERE da.request_id = :requestId ORDER BY da.alt_id ASC`,
      { requestId: req.params.requestId }
    );

    const edResult = await conn.execute(
      `SELECT * FROM drug_existing_details WHERE request_id = :requestId ORDER BY row_no ASC`,
      { requestId: req.params.requestId }
    );

    const entriesResult = await conn.execute(
      `SELECT * FROM drug_effective_entries WHERE request_id = :requestId ORDER BY entry_id ASC`,
      { requestId: req.params.requestId }
    );

    const reqResult = await conn.execute(
      `SELECT dtc_reviewed_by_name, dtc_review_signature,
              final_selected_brand, final_selected_category,
              final_selection_reasons, final_recommendation_notes,
              ph_final_recommendation, dtc_final_recommendations
       FROM drug_requests WHERE request_id = :requestId`,
      { requestId: req.params.requestId }
    );
    const reqRow = reqResult.rows[0] || {};

    res.json({
      alternatives: result.rows,
      existing_details: edResult.rows,
      effective_drug_entries: entriesResult.rows,
      dtc_reviewed_by_name: reqRow.DTC_REVIEWED_BY_NAME || '',
      dtc_review_signature: reqRow.DTC_REVIEW_SIGNATURE || '',
      final_selected_brand: reqRow.FINAL_SELECTED_BRAND || '',
      final_selected_category: reqRow.FINAL_SELECTED_CATEGORY || '',
      final_selection_reasons: reqRow.FINAL_SELECTION_REASONS || '',
      final_recommendation_notes: reqRow.FINAL_RECOMMENDATION_NOTES || '',
      ph_final_recommendation: reqRow.PH_FINAL_RECOMMENDATION || '',
      dtc_final_recommendations: reqRow.DTC_FINAL_RECOMMENDATIONS || ''
    });
  } catch (err) {
    console.error('GET /api/alternatives error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// GET /api/alternatives/:requestId/selected — single DTC-selected drug
// =============================================================
app.get('/api/alternatives/:requestId/selected', async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.requestId);

    const drResult = await conn.execute(
      `SELECT dr.final_selected_alternative_id,
              dr.dtc_selected_brand,
              dr.dtc_selected_category,
              dr.dtc_selection_reasons,
              dr.dtc_recommendation_notes,
              dr.dtc_reviewed_by_name,
              dr.dtc_review_signature,
              dr.ph_final_recommendation,
              dr.generic_name AS request_generic_name,
              dr.brand_name AS request_brand_name,
              dr.manufacturer AS request_manufacturer,
              dr.marketer AS request_marketer,
              dr.dosage_form AS request_dosage_form,
              dr.dose_strength AS request_dose_strength,
              dr.dtc_final_recommendations,
              dr.existing_generic_data,
              dr.final_selected_brand,
              dr.final_selected_category,
              dr.final_selection_reasons,
              dr.final_recommendation_notes
       FROM drug_requests dr
       WHERE dr.request_id = :requestId`,
      { requestId }
    );

    if (!drResult.rows.length) {
      return res.status(404).json({ error: 'Request not found.' });
    }

    const dr = drResult.rows[0];
    const final_selected_alternative_id = dr.FINAL_SELECTED_ALTERNATIVE_ID;

    // Resolve original brand details (mrp, rate, stock, purchase_qty) dynamically
    let origMrp = '';
    let origRate = '';
    let origStock = '';
    let origQty = '';
    try {
      const origAltResult = await conn.execute(
        `SELECT mrp_per_pack, rate_per_pack, stock, purchase_quantity
         FROM drug_alternatives
         WHERE request_id = :requestId AND LOWER(brand_name) = LOWER(:brandName)`,
        { requestId, brandName: dr.REQUEST_BRAND_NAME }
      );
      if (origAltResult.rows.length) {
        origMrp = origAltResult.rows[0].MRP_PER_PACK;
        origRate = origAltResult.rows[0].RATE_PER_PACK;
        origStock = origAltResult.rows[0].STOCK;
        origQty = origAltResult.rows[0].PURCHASE_QUANTITY;
      }
    } catch (altErr) {
      console.error('Error fetching original alternative details:', altErr);
    }

    if ((!origMrp || origMrp === '') && dr.EXISTING_GENERIC_DATA) {
      try {
        const egd = JSON.parse(dr.EXISTING_GENERIC_DATA);
        origMrp = egd.existing_mrp || egd.existing_mrp_inc_gst_nos || '';
        origRate = egd.existing_rate || egd.existing_rate_inc_gst_nos || '';
        origStock = egd.existing_stock || egd.existing_present_stock || '';
        origQty = egd.existing_purchase_qty || '';
      } catch (jsonEgdErr) {
        console.error('Error parsing existing_generic_data for selected original:', jsonEgdErr);
      }
    }

    let list = [];
    const recommendationsJson = dr.DTC_FINAL_RECOMMENDATIONS;
    if (recommendationsJson) {
      try {
        const recs = JSON.parse(recommendationsJson);
        for (const rec of recs) {
          if (rec.is_original) {
            list.push({
              type: 'original',
              brand_name: rec.brand_name || dr.REQUEST_BRAND_NAME,
              manufacturer: dr.REQUEST_MANUFACTURER,
              marketer: dr.REQUEST_MARKETER,
              mrp: origMrp || '',
              rate: origRate || '',
              net_rate: origRate || '',
              profit_margin: '',
              absolute_margin: '',
              scheme_qty: '',
              scheme_offer: '',
              pack: `${dr.REQUEST_DOSE_STRENGTH} ${dr.REQUEST_DOSAGE_FORM}`,
              stock: origStock || '',
              purchase_qty: origQty || '',
              category: rec.category,
              reasons: rec.reasons,
              notes: rec.notes,
              remarks: rec.remarks || ''
            });
          } else if (rec.alternative_id) {
            const altResult = await conn.execute(
              `SELECT da.brand_name AS final_brand_name,
                      da.manufacturer AS final_manufacturer,
                      da.marketer AS final_marketer,
                      da.mrp AS final_mrp,
                      da.rate AS final_rate,
                      da.net_rate AS final_net_rate,
                      da.profit_margin AS final_profit_margin,
                      da.absolute_margin AS final_absolute_margin,
                      da.scheme_qty AS final_scheme_qty,
                      da.scheme_offer AS final_scheme_offer,
                      da.pack AS final_pack,
                      da.remark
               FROM drug_alternatives da
               WHERE da.alt_id = :altId AND da.request_id = :requestId`,
              { altId: rec.alternative_id, requestId }
            );
            if (altResult.rows.length) {
              const alt = altResult.rows[0];
              list.push({
                type: 'alternative',
                alternative_id: rec.alternative_id,
                brand_name: rec.brand_name,
                manufacturer: alt.FINAL_MANUFACTURER || rec.manufacturer,
                marketer: alt.FINAL_MARKETER || rec.marketer,
                mrp: alt.FINAL_MRP,
                rate: alt.FINAL_RATE,
                net_rate: alt.FINAL_NET_RATE,
                profit_margin: alt.FINAL_PROFIT_MARGIN,
                absolute_margin: alt.FINAL_ABSOLUTE_MARGIN,
                scheme_qty: alt.FINAL_SCHEME_QTY,
                scheme_offer: alt.FINAL_SCHEME_OFFER,
                pack: alt.FINAL_PACK,
                remark: alt.REMARK,
                category: rec.category,
                reasons: rec.reasons,
                notes: rec.notes,
                remarks: rec.remarks || ''
              });
            }
          }
        }
      } catch (jsonErr) {
        console.error('JSON parse error on dtc_final_recommendations:', jsonErr);
      }
    }

    // Fallback for legacy requests
    if (list.length === 0) {
      if (final_selected_alternative_id) {
        const altResult = await conn.execute(
          `SELECT da.brand_name AS final_brand_name,
                  da.manufacturer AS final_manufacturer,
                  da.marketer AS final_marketer,
                  da.mrp AS final_mrp,
                  da.rate AS final_rate,
                  da.net_rate AS final_net_rate,
                  da.profit_margin AS final_profit_margin,
                  da.absolute_margin AS final_absolute_margin,
                  da.scheme_qty AS final_scheme_qty,
                  da.scheme_offer AS final_scheme_offer,
                  da.pack AS final_pack
           FROM drug_alternatives da
           WHERE da.alt_id = :altId AND da.request_id = :requestId`,
          { altId: final_selected_alternative_id, requestId }
        );
        if (altResult.rows.length) {
          const alt = altResult.rows[0];
          list.push({
            type: 'alternative',
            alternative_id: final_selected_alternative_id,
            brand_name: alt.FINAL_BRAND_NAME,
            manufacturer: alt.FINAL_MANUFACTURER,
            marketer: alt.FINAL_MARKETER,
            mrp: alt.FINAL_MRP,
            rate: alt.FINAL_RATE,
            net_rate: alt.FINAL_NET_RATE,
            profit_margin: alt.FINAL_PROFIT_MARGIN,
            absolute_margin: alt.FINAL_ABSOLUTE_MARGIN,
            scheme_qty: alt.FINAL_SCHEME_QTY,
            scheme_offer: alt.FINAL_SCHEME_OFFER,
            pack: alt.FINAL_PACK,
            category: dr.DTC_SELECTED_CATEGORY,
            reasons: dr.DTC_SELECTION_REASONS ? JSON.parse(dr.DTC_SELECTION_REASONS) : [],
            notes: dr.DTC_RECOMMENDATION_NOTES
          });
        }
      } else if (dr.DTC_SELECTED_BRAND) {
        list.push({
          type: 'original',
          brand_name: dr.DTC_SELECTED_BRAND,
          manufacturer: dr.REQUEST_MANUFACTURER,
          marketer: dr.REQUEST_MARKETER,
          mrp: origMrp || '',
          rate: origRate || '',
          net_rate: origRate || '',
          profit_margin: '',
          absolute_margin: '',
          scheme_qty: '',
          scheme_offer: '',
          pack: `${dr.REQUEST_DOSE_STRENGTH} ${dr.REQUEST_DOSAGE_FORM}`,
          stock: origStock || '',
          purchase_qty: origQty || '',
          category: dr.DTC_SELECTED_CATEGORY,
          reasons: dr.DTC_SELECTION_REASONS ? JSON.parse(dr.DTC_SELECTION_REASONS) : [],
          notes: dr.DTC_RECOMMENDATION_NOTES
        });
      }
    }

    if (list.length === 0) {
      return res.status(404).json({ error: 'final selection not found' });
    }

    // ── Build final_drug: single normalized object for inventory insertion ──
    // Priority: alternative-type entry (has full pricing) → original-type entry → fallback columns
    const finalGenericName = dr.REQUEST_GENERIC_NAME || '';
    let final_drug = null;

    // 1. Find the DTC-selected alternative entry (has complete pricing from drug_alternatives)
    const finalAltEntry = list.find(item => item.type === 'alternative');
    if (finalAltEntry) {
      final_drug = {
        final_brand_name: finalAltEntry.brand_name || '',
        final_generic_name: finalGenericName,
        final_manufacturer: finalAltEntry.manufacturer || '',
        final_marketer: finalAltEntry.marketer || '',
        final_mrp: finalAltEntry.mrp != null ? finalAltEntry.mrp : null,
        final_rate: finalAltEntry.rate != null ? finalAltEntry.rate : null,
        final_net_rate: finalAltEntry.net_rate != null ? finalAltEntry.net_rate : null,
        final_profit_margin: finalAltEntry.profit_margin != null ? finalAltEntry.profit_margin : null,
        final_absolute_margin: finalAltEntry.absolute_margin != null ? finalAltEntry.absolute_margin : null,
        final_scheme_qty: finalAltEntry.scheme_qty != null ? finalAltEntry.scheme_qty : null,
        final_scheme_offer: finalAltEntry.scheme_offer || '',
        final_pack: finalAltEntry.pack || '',
        dtc_selected_category: finalAltEntry.category || dr.DTC_SELECTED_CATEGORY || '',
        dtc_recommendation_notes: finalAltEntry.notes || dr.DTC_RECOMMENDATION_NOTES || '',
        dtc_reviewed_by_name: dr.DTC_REVIEWED_BY_NAME || '',
        dtc_review_signature: dr.DTC_REVIEW_SIGNATURE || '',
        ph_final_recommendation: dr.PH_FINAL_RECOMMENDATION || '',
        dtc_selection_reasons: finalAltEntry.reasons || [],
      };
    } else {
      // 2. Original-type entry (DTC selected the originally-requested drug)
      const finalOrigEntry = list.find(item => item.type === 'original');
      if (finalOrigEntry) {
        final_drug = {
          final_brand_name: finalOrigEntry.brand_name || '',
          final_generic_name: finalGenericName,
          final_manufacturer: finalOrigEntry.manufacturer || '',
          final_marketer: finalOrigEntry.marketer || '',
          final_mrp: finalOrigEntry.mrp != null ? finalOrigEntry.mrp : null,
          final_rate: finalOrigEntry.rate != null ? finalOrigEntry.rate : null,
          final_net_rate: finalOrigEntry.net_rate != null ? finalOrigEntry.net_rate : null,
          final_profit_margin: finalOrigEntry.profit_margin != null ? finalOrigEntry.profit_margin : null,
          final_absolute_margin: finalOrigEntry.absolute_margin != null ? finalOrigEntry.absolute_margin : null,
          final_scheme_qty: finalOrigEntry.scheme_qty != null ? finalOrigEntry.scheme_qty : null,
          final_scheme_offer: finalOrigEntry.scheme_offer || '',
          final_pack: finalOrigEntry.pack || '',
          dtc_selected_category: finalOrigEntry.category || dr.DTC_SELECTED_CATEGORY || '',
          dtc_recommendation_notes: finalOrigEntry.notes || dr.DTC_RECOMMENDATION_NOTES || '',
          dtc_reviewed_by_name: dr.DTC_REVIEWED_BY_NAME || '',
          dtc_review_signature: dr.DTC_REVIEW_SIGNATURE || '',
          ph_final_recommendation: dr.PH_FINAL_RECOMMENDATION || '',
          dtc_selection_reasons: finalOrigEntry.reasons || [],
        };
      } else {
        // 3. Fallback: use the stored final_selected_brand column on drug_requests
        const fallbackBrand = dr.FINAL_SELECTED_BRAND || dr.DTC_SELECTED_BRAND || '';
        let parsedReasons = [];
        try { parsedReasons = dr.FINAL_SELECTION_REASONS ? JSON.parse(dr.FINAL_SELECTION_REASONS) : []; } catch (_) { }
        final_drug = {
          final_brand_name: fallbackBrand,
          final_generic_name: finalGenericName,
          final_manufacturer: dr.REQUEST_MANUFACTURER || '',
          final_marketer: dr.REQUEST_MARKETER || '',
          final_mrp: null,
          final_rate: null,
          final_net_rate: null,
          final_profit_margin: null,
          final_absolute_margin: null,
          final_scheme_qty: null,
          final_scheme_offer: '',
          final_pack: `${dr.REQUEST_DOSE_STRENGTH || ''} ${dr.REQUEST_DOSAGE_FORM || ''}`.trim(),
          dtc_selected_category: dr.FINAL_SELECTED_CATEGORY || dr.DTC_SELECTED_CATEGORY || '',
          dtc_recommendation_notes: dr.FINAL_RECOMMENDATION_NOTES || dr.DTC_RECOMMENDATION_NOTES || '',
          dtc_reviewed_by_name: dr.DTC_REVIEWED_BY_NAME || '',
          dtc_review_signature: dr.DTC_REVIEW_SIGNATURE || '',
          ph_final_recommendation: dr.PH_FINAL_RECOMMENDATION || '',
          dtc_selection_reasons: parsedReasons,
        };
      }
    }

    return res.json({
      type: 'multi',
      recommendations: list,
      final_drug,
    });

  } catch (err) {
    console.error('GET /api/alternatives/selected error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});


// =============================================================
// POST /api/dtc/final-select/:requestId — DTC selects final drug
// =============================================================
app.post('/api/dtc/final-select/:requestId', async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.requestId);
    const {
      recommendations,
      selected_alternative_id,
      selection_type,
      remarks,
      performed_by,
      dtc_selected_brand,
      dtc_selected_category,
      dtc_selection_reasons,
      dtc_recommendation_notes,
      dtc_reviewed_by_name,
      dtc_review_signature,
      dtc_remarks
    } = req.body;

    const reqResult = await conn.execute(
      `SELECT dr.*, u.name AS doctor_name
       FROM drug_requests dr
       JOIN users u ON u.user_id = dr.doctor_id
       WHERE dr.request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });
    const dr = reqResult.rows[0];

    if (dr.CURRENT_STAGE !== 'DTCFinal') {
      return res.status(400).json({ error: 'Final drug selection is only allowed at DTCFinal stage.' });
    }

    // Reset all alternatives to not-selected
    await conn.execute(
      `UPDATE drug_alternatives SET is_final_selected = 0 WHERE request_id = :requestId`,
      { requestId }
    );

    let recs = recommendations;
    if (!recs || !Array.isArray(recs)) {
      // Build synthesized recommendation for legacy API callers
      let selectedName = dr.BRAND_NAME;
      if (selection_type === 'alternative' && selected_alternative_id) {
        const altCheck = await conn.execute(
          `SELECT * FROM drug_alternatives WHERE alt_id = :altId AND request_id = :requestId`,
          { altId: selected_alternative_id, requestId }
        );
        if (altCheck.rows.length) {
          selectedName = altCheck.rows[0].BRAND_NAME;
        }
      }
      recs = [{
        brand_name: dtc_selected_brand || selectedName,
        category: dtc_selected_category || 'Formulary',
        reasons: dtc_selection_reasons || ['DTC Approved'],
        is_original: selection_type === 'original' || (!selected_alternative_id && selection_type !== 'alternative'),
        alternative_id: selection_type === 'alternative' ? selected_alternative_id : null
      }];
    }

    const selectedAltIds = recs
      .filter(rec => !rec.is_original && rec.alternative_id)
      .map(rec => rec.alternative_id);

    for (const altId of selectedAltIds) {
      await conn.execute(
        `UPDATE drug_alternatives SET is_final_selected = 1 WHERE alt_id = :altId AND request_id = :requestId`,
        { altId, requestId }
      );
    }

    const selectedBrandsList = recs.map(rec => rec.brand_name).join(', ');
    const hasFormulary = recs.some(rec => rec.category === 'FORMULARY');
    const aggregatedCategory = hasFormulary ? 'FORMULARY' : (recs[0]?.category || 'NON_FORMULARY');

    const allReasonsSet = new Set();
    recs.forEach(rec => {
      if (Array.isArray(rec.reasons)) {
        rec.reasons.forEach(r => allReasonsSet.add(r));
      }
    });
    const mergedReasons = Array.from(allReasonsSet);
    const selectionReasonsJson = JSON.stringify(mergedReasons);

    const finalNotes = (recs && recs.length > 0)
      ? recs.map(r => `${r.brand_name}: [Notes: ${r.notes || '—'}][Remarks: ${r.remarks || '—'}]`).join(' | ')
      : (dtc_recommendation_notes || remarks || null);
    const recommendationsJson = JSON.stringify(recs);

    const firstAlt = recs.find(rec => !rec.is_original && rec.alternative_id);
    const finalAltId = firstAlt ? firstAlt.alternative_id : null;

    // Store the selection details on the request
    await conn.execute(
      `UPDATE drug_requests
         SET final_selected_alternative_id = :altId,
             dtc_final_selection_notes     = :notes,
             dtc_final_remarks             = :dtcRemarks,
             dtc_remarks                   = :dtcRemarks,
             dtc_selected_brand            = :selectedBrand,
             dtc_selected_category         = :selectedCategory,
             dtc_selection_reasons         = :selectionReasons,
             dtc_recommendation_notes      = :recNotes,
             dtc_reviewed_by               = :reviewedBy,
             dtc_reviewed_at               = CURRENT_TIMESTAMP,
             current_stage                 = 'CEO',
             status                        = 'Pending',
             updated_at                    = CURRENT_TIMESTAMP,
             dtc_reviewed_by_name          = :reviewedByName,
             dtc_review_signature          = :reviewSignature,
             final_selected_brand          = :finalSelectedBrand,
             final_selected_category       = :finalSelectedCategory,
             final_selection_reasons       = :finalSelectionReasons,
             final_recommendation_notes    = :finalRecNotes,
             dtc_final_recommendations     = :dtcFinalRecs
       WHERE request_id = :requestId`,
      {
        altId: finalAltId,
        notes: finalNotes,
        dtcRemarks: dtc_remarks || finalNotes || null,
        selectedBrand: selectedBrandsList,
        selectedCategory: aggregatedCategory,
        selectionReasons: selectionReasonsJson,
        recNotes: finalNotes,
        reviewedBy: performed_by,
        reviewedByName: dtc_reviewed_by_name || null,
        reviewSignature: dtc_review_signature || null,
        finalSelectedBrand: selectedBrandsList,
        finalSelectedCategory: aggregatedCategory,
        finalSelectionReasons: selectionReasonsJson,
        finalRecNotes: finalNotes,
        dtcFinalRecs: recommendationsJson,
        requestId
      }
    );

    await writeAudit(conn, requestId, 'DTC_FINAL_SELECTION', performed_by, 'DTCFinal', 'CEO',
      `Selected: ${selectedBrandsList}. ${remarks || ''}`);

    // Save DTC final select notes/remarks to history
    const dtcNotesText = dtc_recommendation_notes || remarks || dtc_remarks;
    if (dtcNotesText) {
      const customRemarksVal = req.body.customRemarks || dtcNotesText;
      await saveApprovalRemarks(conn, customRemarksVal, 'DTC', performed_by);
    }

    // Notify CEO
    const ceoUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'CEO' AND is_active = 1`
    );
    for (const row of ceoUsers.rows) {
      await createNotification(conn, row.USER_ID, requestId,
        `🏛️ Drug request #${requestId} (${dr.BRAND_NAME}) — DTC has selected final drug(s): ${selectedBrandsList}. Awaiting your approval.`
      );
    }
    // Notify doctor
    await createNotification(conn, dr.DOCTOR_ID, requestId,
      `Your drug request #${requestId} has been reviewed by DTC. Selected drug(s): ${selectedBrandsList}. Forwarded to CEO for final approval.`
    );

    await conn.commit();
    res.json({ message: 'Final drug selected. Request forwarded to CEO.', selected_drug: selectedBrandsList });
  } catch (err) {
    console.error('POST /api/dtc/final-select error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// Helper for existing drug rows calculation
function computeExistingDerived(row) {
  const mp = parseFloat(row.mrp_pack) || 0;
  const rp = parseFloat(row.rate_pack) || 0;
  const g = parseFloat(row.gst_percent) || 0;
  const pk = parseFloat(row.pack) || 0;
  const q = parseFloat(row.scheme_qty) || 0;
  const o = parseFloat(row.scheme_offer) || 0;

  const mrp = pk > 0 ? +(mp * (1 + g / 100) / pk).toFixed(4) : null;
  const rate = pk > 0 ? +(rp * (1 + g / 100) / pk).toFixed(4) : null;

  const markup = mrp != null && rate != null && rate > 0
    ? +(((mrp - rate) / rate) * 100).toFixed(2) : null;
  const profit = mrp != null && rate != null && mrp > 0
    ? +(((mrp - rate) / mrp) * 100).toFixed(2) : null;
  const absMargin = mrp != null && rate != null
    ? +(mrp - rate).toFixed(4) : null;
  const netRate = rate != null && (q + o) > 0
    ? +(rate * q / (q + o)).toFixed(4) : null;

  return {
    mrp_inc_gst_nos: mrp,
    rate_inc_gst_nos: rate,
    markup_margin: markup,
    profit_margin: profit,
    absolute_margin: absMargin,
    net_rate: netRate,
  };
}

// =============================================================
// PUT /api/pharmacist/comparison/:requestId — Save Existing Drug Rows
// =============================================================
app.put('/api/pharmacist/comparison/:requestId', async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.requestId);
    const { existing_details } = req.body;

    if (!Array.isArray(existing_details)) {
      return res.status(400).json({ error: 'existing_details must be an array.' });
    }

    // Delete existing generic details rows for this request
    await conn.execute(
      `DELETE FROM drug_existing_details WHERE request_id = :requestId`,
      { requestId }
    );

    // Insert new rows
    for (let i = 0; i < existing_details.length; i++) {
      const row = existing_details[i];

      await conn.execute(
        `INSERT INTO drug_existing_details (
          request_id, row_no, introduced_on, brand_name, manufacturer, marketer, consultant,
          present_stock, purchase_qty, sale_qty, pack,
          mrp_inc_gst_nos, rate_inc_gst_nos, markup_margin,
          scheme_qty, scheme_offer, net_rate, profit_margin, absolute_margin, total_margin, remark
        ) VALUES (
          :request_id, :row_no, :introduced_on, :brand_name, :manufacturer, :marketer, :consultant,
          :present_stock, :purchase_qty, :sale_qty, :pack,
          :mrp_inc_gst_nos, :rate_inc_gst_nos, :markup_margin,
          :scheme_qty, :scheme_offer, :net_rate, :profit_margin, :absolute_margin, :total_margin, :remark
        )`,
        {
          request_id: requestId,
          row_no: i + 1,
          introduced_on: row.introduced_on || null,
          brand_name: row.brand_name || null,
          manufacturer: row.manufacturer || null,
          marketer: row.marketer || null,
          consultant: row.consultant || null,
          present_stock: parseFloat(row.present_stock) || null,
          purchase_qty: parseFloat(row.purchase_qty) || null,
          sale_qty: parseFloat(row.sale_qty) || null,
          pack: row.pack || null,
          mrp_inc_gst_nos: parseFloat(row.mrp_inc_gst_nos) || null,
          rate_inc_gst_nos: parseFloat(row.rate_inc_gst_nos) || null,
          markup_margin: parseFloat(row.markup_margin) || null,
          scheme_qty: parseFloat(row.scheme_qty) || null,
          scheme_offer: row.scheme_offer ? String(row.scheme_offer) : null,
          net_rate: parseFloat(row.net_rate) || null,
          profit_margin: parseFloat(row.profit_margin) || null,
          absolute_margin: parseFloat(row.absolute_margin) || null,
          total_margin: parseFloat(row.total_margin) || null,
          remark: row.remark || null
        }
      );
    }

    await conn.commit();
    res.json({ message: 'Existing drug details saved successfully.' });
  } catch (err) {
    console.error('PUT /api/pharmacist/comparison error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// PHARMACIST DRAFT MANAGEMENT
// =============================================================

// POST /api/pharmacist/drafts — upsert draft
app.post('/api/pharmacist/drafts', async (req, res) => {
  const conn = await getConn();
  try {
    const { request_id, pharmacist_id, draft_name, alternatives, comp_type, pharm_remarks } = req.body;
    console.log('Saving draft for request', request_id, 'pharmacist', pharmacist_id);
    if (!request_id || !pharmacist_id) return res.status(400).json({ error: 'request_id and pharmacist_id are required.' });

    const draftData = JSON.stringify({ alternatives, comp_type, pharm_remarks });
    const name = draft_name?.trim() ||
      (alternatives?.find(a => a.brand_name?.trim())?.brand_name?.trim()) ||
      `Draft - Request #${request_id}`;

    const existing = await conn.execute(
      `SELECT draft_id FROM analysis_drafts WHERE request_id = :rid AND pharmacist_id = :pid AND status = 'DRAFT'`,
      { rid: request_id, pid: pharmacist_id }
    );

    let draftId;
    if (existing.rows.length > 0) {
      draftId = existing.rows[0].DRAFT_ID;
      await conn.execute(
        `UPDATE analysis_drafts
           SET draft_name = :name, draft_data = :data, updated_at = CURRENT_TIMESTAMP
         WHERE draft_id = :id`,
        { name, data: draftData, id: draftId }
      );
      console.log('Draft updated, draft_id:', draftId);
    } else {
      await conn.execute(
        `INSERT INTO analysis_drafts (request_id, pharmacist_id, draft_name, draft_data, status)
         VALUES (:rid, :pid, :name, :data, 'DRAFT')`,
        { rid: request_id, pid: pharmacist_id, name, data: draftData }
      );
      // Retrieve the auto-generated ID
      const idRes = await conn.execute(
        `SELECT draft_id FROM analysis_drafts
         WHERE request_id = :rid AND pharmacist_id = :pid AND status = 'DRAFT'
         ORDER BY draft_id DESC FETCH FIRST 1 ROWS ONLY`,
        { rid: request_id, pid: pharmacist_id }
      );
      draftId = idRes.rows[0]?.DRAFT_ID;
      console.log('Draft inserted, draft_id:', draftId);
    }
    await conn.commit();
    res.json({ success: true, draft_id: draftId, draft_name: name, message: 'Draft saved successfully.' });
  } catch (err) {
    console.error('POST /api/pharmacist/drafts error:', err);
    res.status(500).json({ success: false, error: 'Failed to save draft.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// GET /api/pharmacist/drafts/for-request/:requestId/:pharmacistId
app.get('/api/pharmacist/drafts/for-request/:requestId/:pharmacistId', async (req, res) => {
  const conn = await getConn();
  try {
    const { requestId, pharmacistId } = req.params;
    const result = await conn.execute(
      `SELECT draft_id, draft_name, draft_data, updated_at
       FROM analysis_drafts
       WHERE request_id = :rid AND pharmacist_id = :pid AND status = 'DRAFT'
       ORDER BY updated_at DESC FETCH FIRST 1 ROWS ONLY`,
      { rid: parseInt(requestId), pid: parseInt(pharmacistId) }
    );
    if (!result.rows.length) return res.json(null);
    const row = result.rows[0];
    // fetchAsString = [CLOB] ensures DRAFT_DATA is already a plain string
    let parsed = {};
    try { parsed = row.DRAFT_DATA ? JSON.parse(row.DRAFT_DATA) : {}; } catch { parsed = {}; }
    res.json({ ...row, DRAFT_DATA: parsed });
  } catch (err) {
    console.error('GET /api/pharmacist/drafts/for-request error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// GET /api/pharmacist/drafts/:pharmacistId — list all DRAFT records for a pharmacist
app.get('/api/pharmacist/drafts/:pharmacistId', async (req, res) => {
  const conn = await getConn();
  try {
    const pid = parseInt(req.params.pharmacistId);
    const result = await conn.execute(
      `SELECT ad.draft_id, ad.request_id, ad.draft_name, ad.status,
              ad.created_at, ad.updated_at,
              dr.brand_name, dr.generic_name, dr.category
       FROM analysis_drafts ad
       JOIN drug_requests dr ON dr.request_id = ad.request_id
       WHERE ad.pharmacist_id = :pid AND ad.status = 'DRAFT'
       ORDER BY ad.updated_at DESC`,
      { pid }
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/pharmacist/drafts error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// GET /api/pharmacist/drafts/detail/:draftId
app.get('/api/pharmacist/drafts/detail/:draftId', async (req, res) => {
  const conn = await getConn();
  try {
    const did = parseInt(req.params.draftId);
    const result = await conn.execute(
      `SELECT ad.*, dr.brand_name, dr.generic_name, dr.category, dr.request_type
       FROM analysis_drafts ad
       JOIN drug_requests dr ON dr.request_id = ad.request_id
       WHERE ad.draft_id = :did`,
      { did }
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Draft not found.' });
    const row = result.rows[0];
    let parsed = {};
    try { parsed = row.DRAFT_DATA ? JSON.parse(row.DRAFT_DATA) : {}; } catch { parsed = {}; }
    res.json({ ...row, DRAFT_DATA: parsed });
  } catch (err) {
    console.error('GET /api/pharmacist/drafts/detail error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// PUT /api/pharmacist/drafts/:draftId — rename draft
app.put('/api/pharmacist/drafts/:draftId', async (req, res) => {
  const conn = await getConn();
  try {
    const did = parseInt(req.params.draftId);
    const { draft_name } = req.body;
    await conn.execute(
      `UPDATE analysis_drafts SET draft_name = :name, updated_at = CURRENT_TIMESTAMP WHERE draft_id = :did`,
      { name: draft_name?.trim() || null, did }
    );
    await conn.commit();
    res.json({ message: 'Draft renamed.' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// DELETE /api/pharmacist/drafts/:draftId — delete draft
app.delete('/api/pharmacist/drafts/:draftId', async (req, res) => {
  const conn = await getConn();
  try {
    const did = parseInt(req.params.draftId);
    await conn.execute(`DELETE FROM analysis_drafts WHERE draft_id = :did`, { did });
    await conn.commit();
    res.json({ message: 'Draft deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});




// =============================================================
// PUT /api/pharmacy-head/comparison/:requestId
// Pharmacy Head saves edits to alternatives + existing_generic_data
// =============================================================
app.put('/api/pharmacy-head/comparison/:requestId', async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.requestId);
    const { performed_by, alternatives, existing_generic_data, ph_review2_remarks, ph_review_remarks, dtc_recommendation_notes, ph_final_recommendation } = req.body;

    if (!alternatives || !Array.isArray(alternatives)) {
      return res.status(400).json({ error: 'alternatives array is required.' });
    }

    // Verify request exists and is at PharmacyHeadReview2
    const reqRes = await conn.execute(
      `SELECT request_id, current_stage, brand_name FROM drug_requests WHERE request_id = :rid`,
      { rid: requestId }
    );
    if (!reqRes.rows.length) return res.status(404).json({ error: 'Request not found.' });
    if (reqRes.rows[0].CURRENT_STAGE !== 'PharmacyHeadReview2') {
      return res.status(400).json({ error: 'Request is not at PharmacyHeadReview2 stage.' });
    }

    // Delete and re-insert alternatives (full replacement)
    await conn.execute(`DELETE FROM drug_alternatives WHERE request_id = :rid`, { rid: requestId });

    for (const alt of alternatives) {
      const d = computeAltDerived(alt);
      const insertAltRes = await conn.execute(
        `INSERT INTO drug_alternatives (
           request_id, brand_name, manufacturer, marketer,
           mrp_per_pack, rate_per_pack, gst_percent,
           mrp, rate, qty, offer,
           markup_margin, net_rate, absolute_margin, negotiated_rate, profit_margin,
           stock, purchase_quantity,
           consultant, sale_qty, pack, introduced_on,
           comparison_type, remark, submitted_by
         ) VALUES (
           :request_id, :brand_name, :manufacturer, :marketer,
           :mrp_per_pack, :rate_per_pack, :gst_percent,
           :mrp, :rate, :qty, :offer,
           :markup_margin, :net_rate, :absolute_margin, :negotiated_rate, :profit_margin,
           :stock, :purchase_quantity,
           :consultant, :sale_qty, :pack, :introduced_on,
           :comparison_type, :remark, :submitted_by
         ) RETURNING alt_id INTO :altId`,
        {
          request_id: requestId,
          brand_name: alt.brand_name || null,
          manufacturer: alt.manufacturer || null,
          marketer: alt.marketer || null,
          mrp_per_pack: parseFloat(alt.mrp_per_pack) || null,
          rate_per_pack: parseFloat(alt.rate_per_pack) || null,
          gst_percent: parseFloat(alt.gst_percent) || null,
          mrp: d.mrp || null,
          rate: d.rate || null,
          qty: parseFloat(alt.qty) || null,
          offer: parseFloat(alt.offer) || null,
          markup_margin: d.markup_margin || null,
          net_rate: d.net_rate || null,
          absolute_margin: d.absolute_margin || null,
          negotiated_rate: parseFloat(alt.negorate) || null,
          profit_margin: d.profit_margin || null,
          stock: alt.stock || null,
          purchase_quantity: parseFloat(alt.purchase_qty) || null,
          consultant: alt.consultant || null,
          sale_qty: parseFloat(alt.sale_qty) || null,
          pack: alt.pack || null,
          introduced_on: alt.introduced_on || 'New Item',
          comparison_type: alt.comparison_type || 'existing_generic',
          remark: alt.remark || null,
          submitted_by: alt.submitted_by || performed_by,
          altId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
        },
        { autoCommit: false }
      );

      const newAltId = insertAltRes.outBinds.altId[0];

      // Calculate negotiated derived values
      const nd = computeAltDerived({
        mrp_per_pack: alt.negotiated_mrp,
        rate_per_pack: alt.negotiated_rate,
        gst_percent: alt.negotiated_gst,
        pack: alt.pack,
        qty: alt.negotiated_scheme_qty,
        offer: alt.negotiated_scheme_offer,
        // fallbacks
        mrp: alt.negotiated_mrp_derived,
        rate: alt.negotiated_rate_derived,
        markupmargin: alt.negotiated_total_margin,
        profit_margin: alt.negotiated_profit_margin,
        margin: alt.negotiated_absolute_margin,
        net_rate: alt.negotiated_net_rate
      });

      // Insert negotiated values
      await conn.execute(
        `INSERT INTO drug_alternative_negotiations (
           alternative_id,
           negotiated_mrp, negotiated_rate, negotiated_gst,
           negotiated_scheme_qty, negotiated_scheme_offer,
           negotiated_net_rate, negotiated_profit_margin,
           negotiated_absolute_margin, negotiated_total_margin,
           negotiated_by, negotiated_at, negotiation_remarks
         ) VALUES (
           :alternative_id,
           :negotiated_mrp, :negotiated_rate, :negotiated_gst,
           :negotiated_scheme_qty, :negotiated_scheme_offer,
           :negotiated_net_rate, :negotiated_profit_margin,
           :negotiated_absolute_margin, :negotiated_total_margin,
           :negotiated_by, CURRENT_TIMESTAMP, :negotiation_remarks
         )`,
        {
          alternative_id: newAltId,
          negotiated_mrp: parseFloat(alt.negotiated_mrp) || null,
          negotiated_rate: parseFloat(alt.negotiated_rate) || null,
          negotiated_gst: parseFloat(alt.negotiated_gst) || null,
          negotiated_scheme_qty: parseFloat(alt.negotiated_scheme_qty) || null,
          negotiated_scheme_offer: alt.negotiated_scheme_offer ? String(alt.negotiated_scheme_offer) : null,
          negotiated_net_rate: nd.net_rate || null,
          negotiated_profit_margin: nd.profit_margin || null,
          negotiated_absolute_margin: nd.absolute_margin || null,
          negotiated_total_margin: nd.total_margin || null,
          negotiated_by: performed_by,
          negotiation_remarks: alt.negotiation_remarks || null
        }
      );
    }


    // Update existing_generic_data CLOB + ph_review2_remarks + ph_review_remarks + dtc_recommendation_notes on drug_requests
    const egdJson = existing_generic_data ? JSON.stringify(existing_generic_data) : null;
    await conn.execute(
      `UPDATE drug_requests
         SET existing_generic_data = :egd,
             ph_review2_remarks    = :remarks,
             ph_review_remarks     = :phReviewRemarks,
             dtc_recommendation_notes = :recNotes,
             ph_final_recommendation = :phFinalRec,
             updated_at            = CURRENT_TIMESTAMP
       WHERE request_id = :rid`,
      {
        egd: egdJson,
        remarks: ph_review2_remarks || ph_review_remarks || null,
        phReviewRemarks: ph_review_remarks || null,
        recNotes: dtc_recommendation_notes || null,
        phFinalRec: ph_final_recommendation || null,
        rid: requestId
      }
    );

    await writeAudit(conn, requestId, 'PH_COMPARISON_UPDATED', performed_by, 'PharmacyHeadReview2', 'PharmacyHeadReview2', ph_review2_remarks || ph_review_remarks);
    await conn.commit();
    res.json({ message: 'Comparison sheet updated by Pharmacy Head.' });
  } catch (err) {
    console.error('PUT /api/pharmacy-head/comparison error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// DTC BLACKLIST MANAGEMENT APIS
// =============================================================

// POST /api/dtc/blacklist — Add a new blacklist entry (DTC only)
app.post('/api/dtc/blacklist', async (req, res) => {
  const conn = await getConn();
  try {
    const { company_name, company_type, remarks, performed_by } = req.body;

    if (!company_name || !String(company_name).trim()) {
      return res.status(400).json({ error: 'company_name is required.' });
    }
    const typeUpper = (company_type || '').toUpperCase().trim();
    if (!['MANUFACTURER', 'MARKETER'].includes(typeUpper)) {
      return res.status(400).json({ error: 'company_type must be MANUFACTURER or MARKETER.' });
    }
    if (!performed_by) {
      return res.status(400).json({ error: 'performed_by is required.' });
    }

    // Role protection: only DTCCommittee/DTC
    const roleCheck = await conn.execute(
      `SELECT role FROM users WHERE user_id = :p_uid AND is_active = 1`, { p_uid: performed_by }
    );
    const userRole = roleCheck.rows[0] ? (roleCheck.rows[0].ROLE || '').toLowerCase().trim() : '';
    if (!roleCheck.rows.length || (userRole !== 'dtccommittee' && userRole !== 'dtc')) {
      return res.status(403).json({ error: 'Access denied. Only DTC Committee members can manage the blacklist.' });
    }

    const normalizedName = String(company_name).trim().toUpperCase();

    // Duplicate prevention
    const dupCheck = await conn.execute(
      `SELECT blacklist_id FROM blacklisted_companies
       WHERE is_active = 1
         AND UPPER(TRIM(company_name)) = :p_name
         AND company_type = :p_ctype`,
      { p_name: normalizedName, p_ctype: typeUpper }
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Company is already blacklisted.' });
    }

    await conn.execute(
      `INSERT INTO blacklisted_companies (company_name, company_type, remarks, created_by)
       VALUES (:p_name, :p_ctype, :p_remarks, :p_created_by)`,
      { p_name: normalizedName, p_ctype: typeUpper, p_remarks: remarks?.trim() || null, p_created_by: performed_by }
    );
    await conn.commit();
    res.status(201).json({ message: `${typeUpper === 'MANUFACTURER' ? 'Manufacturer' : 'Marketer'} "${normalizedName}" added to blacklist.` });
  } catch (err) {
    console.error('POST /api/dtc/blacklist error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// GET /api/dtc/blacklist — Fetch all active blacklist entries (DTC only)
app.get('/api/dtc/blacklist', async (req, res) => {
  const conn = await getConn();
  try {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id query param is required.' });

    // Role protection: only DTCCommittee/DTC
    const roleCheck = await conn.execute(
      `SELECT role FROM users WHERE user_id = :p_uid AND is_active = 1`, { p_uid: userId }
    );
    const userRole = roleCheck.rows[0] ? (roleCheck.rows[0].ROLE || '').toLowerCase().trim() : '';
    if (!roleCheck.rows.length || (userRole !== 'dtccommittee' && userRole !== 'dtc')) {
      return res.status(403).json({ error: 'Access denied. Only DTC Committee members can view the blacklist.' });
    }

    const result = await conn.execute(
      `SELECT bl.blacklist_id, bl.company_name, bl.company_type, bl.remarks,
              bl.is_active, bl.created_at, bl.removed_at,
              u.name AS created_by_name,
              ru.name AS removed_by_name
       FROM blacklisted_companies bl
       LEFT JOIN users u  ON u.user_id  = bl.created_by
       LEFT JOIN users ru ON ru.user_id = bl.removed_by
       WHERE bl.is_active = 1
       ORDER BY bl.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/dtc/blacklist error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// PUT /api/dtc/blacklist/:id/remove — Soft-delete a blacklist entry (DTC only)
app.put('/api/dtc/blacklist/:id/remove', async (req, res) => {
  const conn = await getConn();
  try {
    const blacklistId = parseInt(req.params.id);
    const { performed_by } = req.body;

    if (!performed_by) return res.status(400).json({ error: 'performed_by is required.' });

    // Role protection: only DTCCommittee/DTC
    const roleCheck = await conn.execute(
      `SELECT role FROM users WHERE user_id = :p_uid AND is_active = 1`, { p_uid: performed_by }
    );
    const userRole = roleCheck.rows[0] ? (roleCheck.rows[0].ROLE || '').toLowerCase().trim() : '';
    if (!roleCheck.rows.length || (userRole !== 'dtccommittee' && userRole !== 'dtc')) {
      return res.status(403).json({ error: 'Access denied. Only DTC Committee members can manage the blacklist.' });
    }

    const exists = await conn.execute(
      `SELECT blacklist_id, company_name FROM blacklisted_companies WHERE blacklist_id = :p_id AND is_active = 1`,
      { p_id: blacklistId }
    );
    if (!exists.rows.length) return res.status(404).json({ error: 'Blacklist entry not found or already removed.' });

    await conn.execute(
      `UPDATE blacklisted_companies
         SET is_active = 0, removed_by = :p_removed_by, removed_at = CURRENT_TIMESTAMP
       WHERE blacklist_id = :p_id`,
      { p_removed_by: performed_by, p_id: blacklistId }
    );
    await conn.commit();
    res.json({ message: `Blacklist entry #${blacklistId} removed.` });
  } catch (err) {
    console.error('PUT /api/dtc/blacklist remove error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// GET /api/rejection-remark-history — Fetch autocompletion suggestions
// =============================================================
app.get('/api/rejection-remark-history', async (req, res) => {
  const conn = await getConn();
  try {
    const q = req.query.q || '';
    const queryContains = '%' + q.toLowerCase().trim() + '%';
    const queryStart = q.toLowerCase().trim() + '%';

    const result = await conn.execute(
      `SELECT * FROM (
         SELECT history_id, remark_text, created_by, usage_count, last_used_at
         FROM rejection_remark_history
         WHERE is_active = 1
           AND LOWER(remark_text) LIKE :queryContains
         ORDER BY
           CASE WHEN LOWER(remark_text) LIKE :queryStart THEN 0 ELSE 1 END ASC,
           usage_count DESC,
           last_used_at DESC
       ) WHERE ROWNUM <= 15`,
      { queryContains, queryStart }
    );

    const suggestions = result.rows.map(r => ({
      history_id: r.HISTORY_ID,
      remark_text: r.REMARK_TEXT,
      created_by: r.CREATED_BY,
      usage_count: r.USAGE_COUNT,
      last_used_at: r.LAST_USED_AT
    }));

    res.json(suggestions);
  } catch (err) {
    console.error('GET /api/rejection-remark-history error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// Helper function to save approval remarks into approval_remark_history
// =============================================================
async function saveApprovalRemarks(conn, remarks, roleName, performedBy) {
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

// =============================================================
// GET /api/approval-remarks/:role — Fetch autocompletion suggestions
// =============================================================
app.get('/api/approval-remarks/:role', async (req, res) => {
  const conn = await getConn();
  try {
    const role = req.params.role;
    const q = req.query.q || '';
    const queryContains = '%' + q.toLowerCase().trim() + '%';
    const queryStart = q.toLowerCase().trim() + '%';

    const result = await conn.execute(
      `SELECT * FROM (
         SELECT history_id, remark_text, created_by, usage_count, last_used_at
         FROM approval_remark_history
         WHERE is_active = 1
           AND LOWER(role_name) = LOWER(:role)
           AND LOWER(remark_text) LIKE :queryContains
         ORDER BY
           CASE WHEN LOWER(remark_text) LIKE :queryStart THEN 0 ELSE 1 END ASC,
           usage_count DESC,
           last_used_at DESC
       ) WHERE ROWNUM <= 15`,
      { role, queryContains, queryStart }
    );

    const suggestions = result.rows.map(r => ({
      history_id: r.HISTORY_ID,
      remark_text: r.REMARK_TEXT,
      created_by: r.CREATED_BY,
      usage_count: r.USAGE_COUNT,
      last_used_at: r.LAST_USED_AT
    }));

    res.json(suggestions);
  } catch (err) {
    console.error('GET /api/approval-remarks error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// POST /api/approval-remarks/save — Save new approval remark
// =============================================================
app.post('/api/approval-remarks/save', async (req, res) => {
  const conn = await getConn();
  try {
    const { role_name, remark_text, performed_by } = req.body;
    if (!role_name || !remark_text) {
      return res.status(400).json({ error: 'role_name and remark_text are required.' });
    }

    await saveApprovalRemarks(conn, remark_text, role_name, performed_by);
    await conn.commit();
    res.json({ message: 'Approval remark saved successfully.' });
  } catch (err) {
    console.error('POST /api/approval-remarks/save error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});






// =============================================================
// GET /api/generics/search — Search distinct generic names
// =============================================================
app.get('/api/generics/search', async (req, res) => {
  const conn = await getConn();
  try {
    const q = req.query.q || '';
    const search = '%' + q.toLowerCase().trim() + '%';
    const result = await conn.execute(
      `SELECT DISTINCT
          dg.drug_gen_id,
          dg.drug_gen_name
       FROM druggenerics dg
       WHERE LOWER(dg.drug_gen_name) LIKE :search
       ORDER BY dg.drug_gen_name`,
      { search }
    );

    const data = result.rows.map(r => ({
      drug_gen_id: r.DRUG_GEN_ID,
      drug_gen_name: r.DRUG_GEN_NAME
    }));

    res.json(data);
  } catch (err) {
    console.error('GET /api/generics/search error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// POST /api/reports/item-margin-report — Fetch existing generic details (READ-ONLY)
// =============================================================
app.post('/api/reports/item-margin-report', async (req, res) => {
  const conn = await getConn();
  try {
    const { fromDate, toDate, genericId } = req.body;
    if (!fromDate || !toDate || genericId === undefined || genericId === null) {
      return res.status(400).json({ error: 'fromDate, toDate, and genericId are required.' });
    }

    const genIdNum = parseInt(genericId, 10);
    if (isNaN(genIdNum)) {
      return res.status(400).json({ error: 'genericId must be a valid number.' });
    }

    const query = `
SELECT
    ROW_NUMBER() OVER (ORDER BY i.description) AS SNO,

    i.createddatetime AS introduced_on,

    i.description AS brand_name,

    m.manufacturer_name AS manufacturer,

    market.marketter_name AS marketer,

    NVL((
        SELECT LISTAGG(e.employee_name, ',')
        FROM itemdoctormap idm
        INNER JOIN employee e
            ON e.employee_id = idm.doctorid
        WHERE idm.itemid = i.id
        AND idm.status = 1
    ), ' ') AS consultant,

    NVL((
        SELECT SUM(cs.currentstock)
        FROM currentstock cs
        WHERE cs.item = i.id
        AND cs.expirydate > SYSDATE
    ), 0) AS present_stock,

    NVL((
        SELECT SUM(gl.quantity)
        FROM goodsreceiptnote grn
        INNER JOIN goodsreceiptnotelineitem gl
            ON gl.goodsreceiptnotelineitemid = grn.docid
        WHERE gl.item = i.id
        AND grn.approvestatustypenum = 2
        AND grn.createddatetime BETWEEN
            TO_DATE(:fromDate,'DD/MM/YYYY HH24:MI:SS')
            AND
            TO_DATE(:toDate,'DD/MM/YYYY HH24:MI:SS')
    ),0) AS purchase_quantity,

    NVL((
        SELECT SUM(ibd.issued_qty)
        FROM issueheader ih
        INNER JOIN issuedetail id
            ON id.issueheader_id = ih.transaction_id
        INNER JOIN issuebatchdetail ibd
            ON ibd.issuedetail_id = id.detail_id
        WHERE ih.createddt BETWEEN
            TO_DATE(:fromDate,'DD/MM/YYYY HH24:MI:SS')
            AND
            TO_DATE(:toDate,'DD/MM/YYYY HH24:MI:SS')
        AND ih.issue_status = 452
        AND id.item = i.id
    ),0) AS sale_qty,

    u.name AS pack,

    NVL((
        SELECT gl.mrp
        FROM goodsreceiptnote grn
        INNER JOIN goodsreceiptnotelineitem gl
            ON gl.goodsreceiptnotelineitemid = grn.docid
        WHERE gl.item = i.id
        AND grn.approvestatustypenum = 2
        ORDER BY grn.createddatetime DESC
        FETCH NEXT 1 ROWS ONLY
    ),0) AS mrp_incl_gst,

    NVL((
        SELECT gl.itemrate +
            (
                gl.itemrate *
                (
                    SELECT SUM(gtd.taxpercentage)
                    FROM goodsreceiptnotetaxdetail gtd
                    WHERE gtd.goodsreceiptnotetaxdetailid = gl.docdetailid
                ) / 100
            )
        FROM goodsreceiptnote grn
        INNER JOIN goodsreceiptnotelineitem gl
            ON gl.goodsreceiptnotelineitemid = grn.docid
        WHERE gl.item = i.id
        AND grn.approvestatustypenum = 2
        ORDER BY grn.createddatetime DESC
        FETCH NEXT 1 ROWS ONLY
    ),0) AS rate_incl_gst,

    ROUND(
        (
            (
                NVL((
                    SELECT gl.mrp
                    FROM goodsreceiptnote grn
                    INNER JOIN goodsreceiptnotelineitem gl
                        ON gl.goodsreceiptnotelineitemid = grn.docid
                    WHERE gl.item = i.id
                    AND grn.approvestatustypenum = 2
                    ORDER BY grn.createddatetime DESC
                    FETCH NEXT 1 ROWS ONLY
                ),0)
            )
            -
            (
                NVL((
                    SELECT gl.itemrate
                    FROM goodsreceiptnote grn
                    INNER JOIN goodsreceiptnotelineitem gl
                        ON gl.goodsreceiptnotelineitemid = grn.docid
                    WHERE gl.item = i.id
                    AND grn.approvestatustypenum = 2
                    ORDER BY grn.createddatetime DESC
                    FETCH NEXT 1 ROWS ONLY
                ),0)
            )
        ),
    2) AS absolute_margin,

    ivm.quantity AS scheme_qty,

    ivm.freeqty AS offer_qty,

    (
        NVL((
            SELECT gl.itemrate
            FROM goodsreceiptnote grn
            INNER JOIN goodsreceiptnotelineitem gl
                ON gl.goodsreceiptnotelineitemid = grn.docid
            WHERE gl.item = i.id
            AND grn.approvestatustypenum = 2
            ORDER BY grn.createddatetime DESC
            FETCH NEXT 1 ROWS ONLY
        ),0)
    ) AS net_rate,

    ROUND(
        (
            (
                (
                    NVL((
                        SELECT gl.mrp
                        FROM goodsreceiptnote grn
                        INNER JOIN goodsreceiptnotelineitem gl
                            ON gl.goodsreceiptnotelineitemid = grn.docid
                        WHERE gl.item = i.id
                        AND grn.approvestatustypenum = 2
                        ORDER BY grn.createddatetime DESC
                        FETCH NEXT 1 ROWS ONLY
                    ),0)
                )
                -
                (
                    NVL((
                        SELECT gl.itemrate
                        FROM goodsreceiptnote grn
                        INNER JOIN goodsreceiptnotelineitem gl
                            ON gl.goodsreceiptnotelineitemid = grn.docid
                        WHERE gl.item = i.id
                        AND grn.approvestatustypenum = 2
                        ORDER BY grn.createddatetime DESC
                        FETCH NEXT 1 ROWS ONLY
                    ),0)
                )
            )
            /
            NULLIF(
                (
                    NVL((
                        SELECT gl.mrp
                        FROM goodsreceiptnote grn
                        INNER JOIN goodsreceiptnotelineitem gl
                            ON gl.goodsreceiptnotelineitemid = grn.docid
                        WHERE gl.item = i.id
                        AND grn.approvestatustypenum = 2
                        ORDER BY grn.createddatetime DESC
                        FETCH NEXT 1 ROWS ONLY
                    ),0)
                ),0
            )
        ) * 100,
    2) AS profit_margin,

    ROUND(
        (
            (
                NVL((
                    SELECT gl.mrp
                    FROM goodsreceiptnote grn
                    INNER JOIN goodsreceiptnotelineitem gl
                        ON gl.goodsreceiptnotelineitemid = grn.docid
                    WHERE gl.item = i.id
                    AND grn.approvestatustypenum = 2
                    ORDER BY grn.createddatetime DESC
                    FETCH NEXT 1 ROWS ONLY
                ),0)
            )
            /
            NULLIF(
                (
                    NVL((
                        SELECT gl.itemrate
                        FROM goodsreceiptnote grn
                        INNER JOIN goodsreceiptnotelineitem gl
                            ON gl.goodsreceiptnotelineitemid = grn.docid
                        WHERE gl.item = i.id
                        AND grn.approvestatustypenum = 2
                        ORDER BY grn.createddatetime DESC
                        FETCH NEXT 1 ROWS ONLY
                    ),0)
                ),0
            )
        ) * 100,
    2) AS total_margin_markup,

    NULL AS remarks

FROM item i

INNER JOIN drugdetail dd
    ON dd.item_refid = i.ID

INNER JOIN genericdrugmapping dgm
    ON dgm.itemgenericid = dd.itemgenericid

INNER JOIN druggenerics dg
    ON dg.drug_gen_id = dgm.druggenerics

LEFT JOIN manufacturer m
    ON m.id = i.manufacturer_id

LEFT JOIN markettermaster market
    ON market.id = i.marketter_id

LEFT JOIN uom u
    ON u.id = i.purchaseuom

LEFT JOIN itemvendormap ivm
    ON ivm.itemid = i.id

WHERE i.itemtypenum = 1
AND i.isactive = 1
AND dg.drug_gen_id = :genericId
`;

    const result = await conn.execute(query, {
      fromDate,
      toDate,
      genericId: genIdNum
    });

    const data = result.rows.map(r => ({
      sno: r.SNO,
      introduced_on: r.INTRODUCED_ON,
      brand_name: r.BRAND_NAME,
      manufacturer: r.MANUFACTURER,
      marketer: r.MARKETER,
      consultant: r.CONSULTANT,
      present_stock: r.PRESENT_STOCK,
      purchase_quantity: r.PURCHASE_QUANTITY,
      sale_qty: r.SALE_QTY,
      pack: r.PACK,
      mrp_incl_gst: r.MRP_INCL_GST,
      rate_incl_gst: r.RATE_INCL_GST,
      absolute_margin: r.ABSOLUTE_MARGIN,
      scheme_qty: r.SCHEME_QTY,
      offer_qty: r.OFFER_QTY,
      net_rate: r.NET_RATE,
      profit_margin: r.PROFIT_MARGIN,
      total_margin_markup: r.TOTAL_MARGIN_MARKUP,
      remarks: r.REMARKS
    }));

    res.json(data);
  } catch (err) {
    console.error('POST /api/reports/item-margin-report error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});






// users.routes.js  –  Express router for /api/users


// ─── DB helper (replace with your actual connection pool) ────────────────────
// const { getConnection } = require('../db');          // ← your Oracle pool

// ─── Constants ───────────────────────────────────────────────────────────────
const SALT_ROUNDS = 12;

// ─── Password policy ─────────────────────────────────────────────────────────
//  • Minimum 6 characters
//  • At least 1 uppercase letter  [A-Z]
//  • At least 1 symbol            [!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]
//  • At least 1 digit             [0-9]
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*[!@#$%^&*()\-_=+\[\]{};':"\\|,.<>/?])(?=.*\d).{6,}$/;

function validatePassword(password) {
  const errors = [];
  if (!password || password.length < 6) errors.push('Password must be at least 6 characters.');
  if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter.');
  if (!/[!@#$%^&*()\-_=+\[\]{};':"\\|,.<>/?]/.test(password))
    errors.push('Password must contain at least one special symbol.');
  if (!/\d/.test(password)) errors.push('Password must contain at least one number.');
  return errors;
}

// ─── POST /api/users/register ─────────────────────────────────────────────────
/**
 * Body (JSON):
 *   name        string  required
 *   email       string  required
 *   password    string  required  (plain-text – hashed before storage)
 *   role        string  required  e.g. "admin" | "user"
 *   department  string  optional
 */
app.post('/api/register', async (req, res) => {
  const { name, email, password, role, department } = req.body;

  // ── 1. Basic presence checks ──────────────────────────────────────────────
  if (!name || !email || !password || !role) {
    return res.status(400).json({
      success: false,
      message: 'name, email, password, and role are required.',
    });
  }

  // ── 2. Email format check ─────────────────────────────────────────────────
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email format.' });
  }

  // ── 3. Password policy ────────────────────────────────────────────────────
  const pwErrors = validatePassword(password);
  if (pwErrors.length > 0) {
    return res.status(400).json({ success: false, message: pwErrors.join(' ') });
  }

  let conn;
  try {
    conn = await getConn();   // ← your Oracle pool helper

    // ── 4. Duplicate email check ──────────────────────────────────────────
    const dupCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM users WHERE email = :email`,
      { email: email.toLowerCase().trim() }
    );
    if (dupCheck.rows[0].CNT > 0) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    // ── 5. Hash the password ──────────────────────────────────────────────
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // ── 6. Insert into DB ─────────────────────────────────────────────────
    const result = await conn.execute(
      `INSERT INTO users (name, email, password, role, department, is_active, is_approved)
       VALUES (:name, :email, :password, :role, :department, 1, 0)
       RETURNING user_id INTO :user_id`,
      {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role: role.toLowerCase().trim(),
        department: department && department.trim() !== '' ? department.trim() : null,
        user_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true }
    );

    const newUserId = result.outBinds.user_id[0];

    const normalizedRole = role.toLowerCase().trim();
    if (normalizedRole === 'doctor' || normalizedRole === 'hod') {
      await conn.execute(
        `INSERT INTO user_request_quotas (user_id, quarterly_limit, updated_by)
         VALUES (:userId, 10, :updatedBy)`,
        { userId: newUserId, updatedBy: newUserId },
        { autoCommit: true }
      );
    }

    return res.status(201).json({
      success: true,
      pendingApproval: true,
      message: 'Registration submitted successfully. Awaiting admin approval.',
      data: {
        user_id: newUserId,
        name: name.trim(),
        email: email.toLowerCase().trim(),
        role: role.toLowerCase().trim(),
        department: department?.trim() ?? null,
        is_active: 1,
      },
    });

  } catch (err) {
    console.error('[POST /register] Error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// ─── POST /api/login ───────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required' });

  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(
      `SELECT user_id, password, role, is_approved, force_password_reset FROM users WHERE email = :email AND is_active = 1`,
      { email: email.toLowerCase().trim() }
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.PASSWORD);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.IS_APPROVED !== 1) {
      return res.status(403).json({
        success: false,
        pendingApproval: true,
        message: 'Your account is awaiting approval by the Administrator. Please contact the IT Department.',
      });
    }

    return res.status(200).json({
      success: true,
      user_id: user.USER_ID,
      role: user.ROLE,
      force_password_reset: user.FORCE_PASSWORD_RESET === 1,
    });
  } catch (err) {
    console.error('[POST /api/login] Error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});


// ─── GET /api/users/:id ───────────────────────────────────────────────────────
app.get('/api/users/:id', async (req, res) => {
  const userId = Number(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(
      `SELECT user_id, name, email, role, department, is_active
       FROM users WHERE user_id = :id`,
      { id: userId }
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[GET /:id] Error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// ─── PUT /api/users/:id ───────────────────────────────────────────────────────
// Update name, role, department, or is_active. Password change handled separately.
app.put('/api/users/:id', async (req, res) => {
  const userId = Number(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  const { name, role, department, is_active } = req.body;
  if (!name && !role && department === undefined && is_active === undefined) {
    return res.status(400).json({ success: false, message: 'Nothing to update.' });
  }

  let conn;
  try {
    conn = await getConn();

    // Build dynamic SET clause
    const setClauses = [];
    const binds = { id: userId };

    if (name) { setClauses.push('name       = :name'); binds.name = name.trim(); }
    if (role) { setClauses.push('role       = :role'); binds.role = role.trim(); }
    if (department !== undefined) {
      setClauses.push('department = :department'); binds.department = department?.trim() ?? null;
    }
    if (is_active !== undefined) {
      setClauses.push('is_active  = :is_active'); binds.is_active = is_active ? 1 : 0;
    }

    const result = await conn.execute(
      `UPDATE users SET ${setClauses.join(', ')} WHERE user_id = :id`,
      binds,
      { autoCommit: true }
    );

    if (result.rowsAffected === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.status(200).json({ success: true, message: 'User updated successfully.' });
  } catch (err) {
    console.error('[PUT /:id] Error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// ─── PATCH /api/users/:id/change-password ────────────────────────────────────
app.patch('/api/users/:id/change-password', async (req, res) => {
  const userId = Number(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'currentPassword and newPassword are required.' });
  }

  const pwErrors = validatePassword(newPassword);
  if (pwErrors.length > 0) {
    return res.status(400).json({ success: false, message: pwErrors.join(' ') });
  }

  let conn;
  try {
    conn = await getConn();

    const result = await conn.execute(
      `SELECT password FROM users WHERE user_id = :id`,
      { id: userId }
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, result.rows[0].PASSWORD);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    const hashedNew = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await conn.execute(
      `UPDATE users SET password = :password WHERE user_id = :id`,
      { password: hashedNew, id: userId },
      { autoCommit: true }
    );

    return res.status(200).json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    console.error('[PATCH /:id/change-password] Error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// ─── DELETE /api/users/:id (soft delete) ─────────────────────────────────────
app.delete('/api/users/:id', async (req, res) => {
  const userId = Number(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(
      `UPDATE users SET is_active = 0 WHERE user_id = :id`,
      { id: userId },
      { autoCommit: true }
    );
    if (result.rowsAffected === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.status(200).json({ success: true, message: 'User deactivated successfully.' });
  } catch (err) {
    console.error('[DELETE /:id] Error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// PUT /api/requests/:id/revert-to-pharmacist
// Pharmacy Head reverts comparison sheet back to Pharmacist
// =============================================================
app.put('/api/requests/:id/revert-to-pharmacist', async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.id);
    const { performed_by, remarks } = req.body;

    if (!remarks || remarks.trim() === '') {
      return res.status(400).json({ error: 'Revert remarks are mandatory.' });
    }

    const reqResult = await conn.execute(
      `SELECT dr.*, u.name AS doctor_name FROM drug_requests dr
       JOIN users u ON u.user_id = dr.doctor_id
       WHERE dr.request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });

    const dr = reqResult.rows[0];
    if (dr.CURRENT_STAGE !== 'PharmacyHeadReview2') {
      return res.status(400).json({ error: 'Revert is only allowed during Pharmacy Head Review 2 stage.' });
    }

    await conn.execute(
      `UPDATE drug_requests
       SET current_stage    = 'PharmacistCorrection',
           status           = 'REVERTED_FOR_CORRECTION',
           is_reverted      = 1,
           revert_count     = NVL(revert_count, 0) + 1,
           revert_remarks   = :remarks,
           reverted_by      = :performed_by,
           reverted_at      = CURRENT_TIMESTAMP,
           updated_at       = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`,
      { remarks, performed_by, requestId }
    );

    await writeAudit(conn, requestId, 'REVERTED_TO_PHARMACIST', performed_by,
      'PharmacyHeadReview2', 'PharmacistCorrection', remarks);

    // Notify all Pharmacist users
    const pharmUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACIST' AND is_active = 1`
    );
    for (const row of pharmUsers.rows) {
      await createNotification(conn, row.USER_ID, requestId,
        `⚠️ Comparison sheet for Request #${requestId} (${dr.BRAND_NAME}) has been reverted by Pharmacy Head for correction. Reason: ${remarks.substring(0, 200)}`
      );
    }

    // Doctor is not notified about internal pharmacist correction loop

    res.json({
      message: `Request #${requestId} reverted to Pharmacist for correction.`,
      new_stage: 'PharmacistCorrection',
      new_status: 'REVERTED_FOR_CORRECTION'
    });
  } catch (err) {
    console.error('PUT revert-to-pharmacist error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// PUT /api/requests/:id/resubmit-correction
// Pharmacist resubmits corrected comparison sheet to Pharmacy Head
// =============================================================
app.put('/api/requests/:id/resubmit-correction', async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.id);
    const { performed_by } = req.body;

    const reqResult = await conn.execute(
      `SELECT dr.*, u.name AS doctor_name FROM drug_requests dr
       JOIN users u ON u.user_id = dr.doctor_id
       WHERE dr.request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });

    const dr = reqResult.rows[0];
    if (dr.CURRENT_STAGE !== 'PharmacistCorrection') {
      return res.status(400).json({ error: 'Resubmit is only allowed from Pharmacist Correction stage.' });
    }

    await conn.execute(
      `UPDATE drug_requests
       SET current_stage      = 'PharmacyHeadReview2',
           status             = 'Pending',
           is_reverted        = 0,
           last_corrected_at  = CURRENT_TIMESTAMP,
           last_corrected_by  = :performed_by,
           updated_at         = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`,
      { performed_by, requestId }
    );

    await writeAudit(conn, requestId, 'CORRECTION_RESUBMITTED', performed_by,
      'PharmacistCorrection', 'PharmacyHeadReview2',
      `Corrected comparison sheet resubmitted (revert #${dr.REVERT_COUNT || 1})`);

    // Notify all PharmacyHead users
    const phUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACYHEAD' AND is_active = 1`
    );
    for (const row of phUsers.rows) {
      await createNotification(conn, row.USER_ID, requestId,
        `✅ Corrected comparison sheet for Request #${requestId} (${dr.BRAND_NAME}) has been resubmitted by Pharmacist. Please review.`
      );
    }

    res.json({
      message: `Corrected comparison sheet for Request #${requestId} resubmitted to Pharmacy Head.`,
      new_stage: 'PharmacyHeadReview2',
      new_status: 'Pending'
    });
  } catch (err) {
    console.error('PUT resubmit-correction error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// =============================================================
// ADMIN MIDDLEWARE — validate admin session token (admin_id stored client-side)
// =============================================================
async function requireAdminAuth(req, res, next) {
  const adminId = req.headers['x-admin-id'];
  if (!adminId || isNaN(Number(adminId))) {
    return res.status(401).json({ success: false, message: 'Admin authentication required.' });
  }
  let conn;
  try {
    conn = await getConn();
    const check = await conn.execute(
      `SELECT admin_id FROM admin_users WHERE admin_id = :adminId`,
      { adminId: Number(adminId) }
    );
    if (check.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Admin not found.' });
    }
    req.adminId = Number(adminId);
    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Auth check failed.' });
  } finally {
    if (conn) await conn.close();
  }
}

// Helper: write admin audit log
async function writeAdminAudit(conn, adminId, action, targetUser, details) {
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

// =============================================================
// POST /api/admin/register — ONE-TIME admin account creation
// Returns 409 if admin already exists
// =============================================================
app.post('/api/admin/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'name, email, and password are required.' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email format.' });
  }
  const pwErrors = validatePassword(password);
  if (pwErrors.length > 0) {
    return res.status(400).json({ success: false, message: pwErrors.join(' ') });
  }

  let conn;
  try {
    conn = await getConn();
    // ONE-TIME: check if admin already exists
    const existCheck = await conn.execute(`SELECT COUNT(*) AS cnt FROM admin_users`);
    if (existCheck.rows[0].CNT > 0) {
      return res.status(409).json({
        success: false,
        message: 'Admin account already exists. Registration is one-time only.',
      });
    }

    const hashedPw = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await conn.execute(
      `INSERT INTO admin_users (name, email, password)
       VALUES (:name, :email, :password)
       RETURNING admin_id INTO :adminId`,
      {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPw,
        adminId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true }
    );
    const adminId = result.outBinds.adminId[0];
    console.log(`[ADMIN] Admin account created: ${email} (admin_id=${adminId})`);
    return res.status(201).json({
      success: true,
      message: 'Admin account created successfully.',
      admin_id: adminId,
    });
  } catch (err) {
    console.error('[POST /api/admin/register] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// POST /api/admin/login — Admin login
// =============================================================
app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password required.' });
  }
  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(
      `SELECT admin_id, name, email, password FROM admin_users WHERE email = :email`,
      { email: email.toLowerCase().trim() }
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
    const admin = result.rows[0];
    const isMatch = await bcrypt.compare(password, admin.PASSWORD);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
    return res.status(200).json({
      success: true,
      admin_id: admin.ADMIN_ID,
      name: admin.NAME,
      email: admin.EMAIL,
      role: 'admin',
    });
  } catch (err) {
    console.error('[POST /api/admin/login] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// GET /api/admin/users — Get all users grouped by role
// =============================================================
app.get('/api/admin/users', requireAdminAuth, async (req, res) => {
  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(
      `SELECT user_id,
          name,
          email,
          role,
          department,
          is_active,
          force_password_reset,
          temp_password_issued
   FROM users
   ORDER BY role, name`
    );
    // Group by role
    const grouped = {};
    for (const row of result.rows) {
      const r = row.ROLE || 'unknown';
      if (!grouped[r]) grouped[r] = [];
      grouped[r].push({
        user_id: row.USER_ID,
        name: row.NAME,
        email: row.EMAIL,
        role: row.ROLE,
        department: row.DEPARTMENT,
        is_active: row.IS_ACTIVE,
        force_password_reset: row.FORCE_PASSWORD_RESET,
        temp_password_issued: row.TEMP_PASSWORD_ISSUED,
      });
    }
    return res.json({ success: true, data: grouped, total: result.rows.length });
  } catch (err) {
    console.error('[GET /api/admin/users] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// PUT /api/admin/reset-password/:userId — Admin resets a user's password
// Generates a secure temp password, hashes it, sets force_password_reset=1
// NEVER returns hashed password. Returns temp password ONCE for admin to relay.
// =============================================================
app.put('/api/admin/reset-password/:userId', requireAdminAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  let conn;
  try {
    conn = await getConn();

    // Check user exists
    const userCheck = await conn.execute(
      `SELECT user_id, name, email, role FROM users WHERE user_id = :userId`,
      { userId }
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const user = userCheck.rows[0];

    // Generate secure temp password: TempXXXX@YY format
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const randomSuffix = Math.floor(10 + Math.random() * 90);
    const tempPassword = `Temp${randomNum}@${randomSuffix}`;

    const hashedTemp = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    await conn.execute(
      `UPDATE users
       SET password = :password,
           force_password_reset = 1,
           temp_password_issued = 1
       WHERE user_id = :userId`,
      { password: hashedTemp, userId },
      { autoCommit: true }
    );

    await writeAdminAudit(conn, req.adminId, 'PASSWORD_RESET', userId,
      `Admin reset password for user: ${user.NAME} (${user.EMAIL}) [Role: ${user.ROLE}]`);

    // Return temp password ONCE — admin conveys it securely to user
    return res.json({
      success: true,
      message: `Temporary password set for ${user.NAME}. User must change on next login.`,
      temp_password: tempPassword,
    });
  } catch (err) {
    console.error('[PUT /api/admin/reset-password] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// PUT /api/admin/toggle-user/:userId — Activate or deactivate a user
// =============================================================
app.put('/api/admin/toggle-user/:userId', requireAdminAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  let conn;
  try {
    conn = await getConn();

    const userCheck = await conn.execute(
      `SELECT user_id, name, email, role, is_active FROM users WHERE user_id = :userId`,
      { userId }
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const user = userCheck.rows[0];
    const newStatus = user.IS_ACTIVE === 1 ? 0 : 1;

    await conn.execute(
      `UPDATE users SET is_active = :isActive WHERE user_id = :userId`,
      { isActive: newStatus, userId },
      { autoCommit: true }
    );

    const action = newStatus === 1 ? 'USER_ACTIVATED' : 'USER_DEACTIVATED';
    await writeAdminAudit(conn, req.adminId, action, userId,
      `${newStatus === 1 ? 'Activated' : 'Deactivated'} user: ${user.NAME} (${user.EMAIL}) [Role: ${user.ROLE}]`);

    return res.json({
      success: true,
      message: `User ${user.NAME} has been ${newStatus === 1 ? 'activated' : 'deactivated'}.`,
      is_active: newStatus,
    });
  } catch (err) {
    console.error('[PUT /api/admin/toggle-user] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// GET /api/admin/audit-logs — View admin action history
// =============================================================
app.get('/api/admin/audit-logs', requireAdminAuth, async (req, res) => {
  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(
      `SELECT al.audit_id, al.action, al.target_user, al.details, al.performed_at,
              u.name AS target_user_name, u.email AS target_user_email
       FROM admin_audit_logs al
       LEFT JOIN users u ON u.user_id = al.target_user
       WHERE al.admin_id = :adminId
       ORDER BY al.performed_at DESC
       FETCH FIRST 200 ROWS ONLY`,
      { adminId: req.adminId }
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[GET /api/admin/audit-logs] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// GET /api/admin/pending-users — Get all users awaiting approval
// =============================================================
app.get('/api/admin/pending-users', requireAdminAuth, async (req, res) => {
  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(
      `SELECT user_id, name, email, role, department
       FROM users
       WHERE is_approved = 0 AND is_active = 1
       ORDER BY user_id DESC`
    );
    const users = result.rows.map(row => ({
      user_id: row.USER_ID,
      name: row.NAME,
      email: row.EMAIL,
      role: row.ROLE,
      department: row.DEPARTMENT
    }));
    return res.json({ success: true, data: users });
  } catch (err) {
    console.error('[GET /api/admin/pending-users] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// PUT /api/admin/approve-user/:userId — Approve a pending registration
// =============================================================
app.put('/api/admin/approve-user/:userId', requireAdminAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  let conn;
  try {
    conn = await getConn();
    const userCheck = await conn.execute(
      `SELECT user_id, name, email, role FROM users WHERE user_id = :userId`,
      { userId }
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const user = userCheck.rows[0];

    await conn.execute(
      `UPDATE users SET is_approved = 1 WHERE user_id = :userId`,
      { userId },
      { autoCommit: true }
    );

    await writeAdminAudit(conn, req.adminId, 'USER_APPROVED', userId,
      `Approved user registration: ${user.NAME} (${user.EMAIL}) [Role: ${user.ROLE}]`);

    return res.json({
      success: true,
      message: `User ${user.NAME} has been approved.`,
    });
  } catch (err) {
    console.error('[PUT /api/admin/approve-user] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// PUT /api/admin/reject-user/:userId — Reject a pending registration (deactivate)
// =============================================================
app.put('/api/admin/reject-user/:userId', requireAdminAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  let conn;
  try {
    conn = await getConn();
    const userCheck = await conn.execute(
      `SELECT user_id, name, email, role FROM users WHERE user_id = :userId`,
      { userId }
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const user = userCheck.rows[0];

    await conn.execute(
      `UPDATE users SET is_active = 0, is_approved = 0 WHERE user_id = :userId`,
      { userId },
      { autoCommit: true }
    );

    await writeAdminAudit(conn, req.adminId, 'USER_REJECTED', userId,
      `Rejected user registration and deactivated account: ${user.NAME} (${user.EMAIL}) [Role: ${user.ROLE}]`);

    return res.json({
      success: true,
      message: `User registration for ${user.NAME} has been rejected/deactivated.`,
    });
  } catch (err) {
    console.error('[PUT /api/admin/reject-user] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// POST /api/users/:id/change-password-force — User changes forced password
// (called after force_password_reset = 1, clears the flag on success)
// =============================================================
app.post('/api/users/:id/change-password-force', async (req, res) => {
  const userId = Number(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ success: false, message: 'newPassword is required.' });

  const pwErrors = validatePassword(newPassword);
  if (pwErrors.length > 0) return res.status(400).json({ success: false, message: pwErrors.join(' ') });

  let conn;
  try {
    conn = await getConn();
    const userCheck = await conn.execute(
      `SELECT user_id, force_password_reset FROM users WHERE user_id = :userId AND is_active = 1`,
      { userId }
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found or inactive.' });
    }

    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await conn.execute(
      `UPDATE users
       SET password = :password, force_password_reset = 0, temp_password_issued = 0
       WHERE user_id = :userId`,
      { password: hashed, userId },
      { autoCommit: true }
    );
    return res.json({ success: true, message: 'Password updated successfully. You can now proceed.' });
  } catch (err) {
    console.error('[POST /api/users/change-password-force] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

async function boot() {


  try {
    await initDB();
    await setupSchema();

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

boot();




