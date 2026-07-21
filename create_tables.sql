-- ============================================================
-- Formulary Drug Addition Request System — Oracle Schema
-- ============================================================
-- Reconstructed from the application's own schema-provisioning code
-- (the disabled setupSchema() function in server.js, plus the two
-- still-live migrations in boot()), NOT from a live database
-- connection — we don't have direct DB access as of this writing.
-- Rohan confirmed setupSchema() is what created the current live
-- schema before being disabled (to avoid re-running metadata checks
-- on every boot), which is why this is trusted as the source of truth
-- over the previous version of this file, which had drifted years out
-- of date (missing entire tables and columns the live app requires).
--
-- This replaces the previous version of this file. Differences from
-- that version, for anyone comparing: this schema has 15 tables (was
-- 4), and users/drug_requests both have many more columns — the app
-- grew incrementally via inline ALTER TABLE statements in server.js
-- rather than by updating this file, which is exactly why it went
-- stale in the first place. See utils/workflow.js for the canonical
-- role/stage vocabulary these columns encode.
--
-- Known open questions (not resolved by reading code alone):
--   - Whether the CREATE OR REPLACE TRIGGER from the old version of
--     this file still exists live. The current application code sets
--     updated_at explicitly in every UPDATE statement rather than
--     relying on a trigger, so if the trigger still exists it is
--     likely redundant, not load-bearing.
--   - Whether any stored procedures/functions exist beyond what's
--     shown here (none were found in server.js's code, but that only
--     proves the app doesn't call any it doesn't already know about).
--   - drug_alternatives ends up with BOTH sale_quantity (original
--     column) and sale_qty (added later via ALTER) — almost certainly
--     an unintentional naming duplication introduced when new columns
--     were bolted on, not a deliberate design. Preserved here exactly
--     as the code produces it, not "fixed", since this file's job is
--     to describe reality, not correct it.
--
-- To regenerate this against the real live database once DB access
-- is available, run: node scripts/dump-schema.js
-- ============================================================


-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
  user_id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                 VARCHAR2(200)  NOT NULL,
  email                VARCHAR2(200)  NOT NULL UNIQUE,
  password             VARCHAR2(200)  NOT NULL,
  role                 VARCHAR2(50)   NOT NULL,
  department           VARCHAR2(200),
  is_active            NUMBER(1)      DEFAULT 1 NOT NULL,
  is_approved          NUMBER(1)      DEFAULT 1 NOT NULL,
  force_password_reset NUMBER(1)      DEFAULT 0,
  temp_password_issued NUMBER(1)      DEFAULT 0,
  -- Added later, live in boot() (not in the disabled setupSchema()
  -- snapshot) — backfilled for existing rows as "<role><user_id>"
  -- when this migration first ran.
  user_login_id        VARCHAR2(50)   NOT NULL
);

CREATE UNIQUE INDEX uk_users_login_id ON users(user_login_id);

-- Note: no CHECK constraint on role in the live schema (unlike the
-- previous version of this file) — the application itself doesn't
-- validate role against a fixed list at the database level either;
-- see utils/workflow.js's ROLES for the values the app actually uses.


-- ============================================================
-- DRUG_REQUESTS
-- ============================================================
CREATE TABLE drug_requests (
  request_id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id                   NUMBER         NOT NULL REFERENCES users(user_id),
  created_by_user_id          NUMBER         REFERENCES users(user_id),
  created_by_role             VARCHAR2(50)   DEFAULT 'Doctor',
  hod_id                      NUMBER         REFERENCES users(user_id),

  -- Medical Rep Info (nullable — required only for PROMOTIONAL requests,
  -- enforced in application code, not at the DB level)
  med_rep_name                VARCHAR2(200),
  med_rep_email               VARCHAR2(200),
  med_rep_phone               VARCHAR2(50),

  -- Drug Classification
  request_type                VARCHAR2(100)  NOT NULL,
  formulary_request_type      VARCHAR2(50),
  request_source_type         VARCHAR2(20)   DEFAULT 'PROMOTIONAL',
  category                    VARCHAR2(100)  NOT NULL,

  -- Drug Details
  brand_name                  VARCHAR2(200)  NOT NULL,
  generic_name                VARCHAR2(200)  NOT NULL,
  dose_strength                VARCHAR2(100)  NOT NULL,
  dosage_form                 VARCHAR2(100)  NOT NULL,
  manufacturer                VARCHAR2(200)  NOT NULL,
  marketer                    VARCHAR2(200)  NOT NULL,
  existing_brands              VARCHAR2(500),
  existing_generic_data        CLOB,
  ai_content                  CLOB,
  medicine_quantity           NUMBER,

  -- Clinical Info
  clinical_justification      CLOB           NOT NULL,
  expected_patients_pm        NUMBER,
  cost_reduction_benefit      NUMBER(1)      DEFAULT 0,

  -- Workflow status/stage
  status                      VARCHAR2(50)   DEFAULT 'Pending' NOT NULL,
  current_stage               VARCHAR2(50)   DEFAULT 'PharmacyHead' NOT NULL,
  is_emergency                NUMBER(1)      DEFAULT 0,
  is_reverted                 NUMBER(1)      DEFAULT 0,
  revert_count                NUMBER         DEFAULT 0,

  -- HOD stage
  approved_by_hod             NUMBER(1)      DEFAULT 0,
  hod_remarks                 VARCHAR2(1000),
  hod_action_timestamp        TIMESTAMP,

  -- Pharmacist stage(s)
  pharmacist_remarks          VARCHAR2(1000),
  pharmacist2_remarks         VARCHAR2(1000),
  ph_review_remarks           CLOB,

  -- Pharmacy Head stage(s)
  ph_remarks                  VARCHAR2(1000),
  ph_remarks2                 VARCHAR2(1000),
  ph_review2_remarks          VARCHAR2(2000),
  ph_final_recommendation     CLOB,

  -- DTC stage(s)
  dtc_remarks                 VARCHAR2(1000),
  dtc_final_remarks           VARCHAR2(1000),
  dtc_selected_brand          VARCHAR2(500),
  dtc_selected_category       VARCHAR2(100),
  dtc_selection_reasons       CLOB,
  dtc_recommendation_notes    CLOB,
  dtc_reviewed_by             NUMBER,
  dtc_reviewed_at             TIMESTAMP,
  dtc_reviewed_by_name        VARCHAR2(500),
  dtc_review_signature        VARCHAR2(1000),
  dtc_final_selection_notes   VARCHAR2(1000),
  dtc_final_recommendations   CLOB,

  -- CEO stage
  ceo_remarks                 VARCHAR2(1000),

  -- Final selection (after DTC final review)
  final_selected_alternative_id NUMBER,
  final_selected_brand         VARCHAR2(500),
  final_selected_category      VARCHAR2(100),
  final_selection_reasons      CLOB,
  final_recommendation_notes   CLOB,

  -- Revert-to-pharmacist / resubmission tracking
  revert_remarks               VARCHAR2(4000),
  reverted_by                  NUMBER,
  reverted_at                  TIMESTAMP,
  last_corrected_at            TIMESTAMP,
  last_corrected_by            NUMBER,

  -- Inventory / order tracking (post-CEO-approval)
  inventory_added              NUMBER(1)      DEFAULT 0,
  inventory_added_at           TIMESTAMP,
  inventory_added_by           NUMBER,
  inventory_item_name          VARCHAR2(500),
  inventory_received           NUMBER(1)      DEFAULT 0,
  inventory_received_at        TIMESTAMP,
  inventory_received_by        NUMBER,

  -- Timestamps
  created_at                   TIMESTAMP      DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at                   TIMESTAMP,
  effective_created_at         TIMESTAMP
);

-- Indexes carried over from the original schema design — not
-- confirmed still present on the live DB, but sensible given the
-- query patterns in server.js (quota checks filter by doctor_id +
-- created_at; most routes filter by current_stage/status).
CREATE INDEX idx_dreq_doctor_created ON drug_requests(doctor_id, created_at);
CREATE INDEX idx_dreq_stage ON drug_requests(current_stage, status);


-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  notification_id  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          NUMBER         NOT NULL REFERENCES users(user_id),
  request_id       NUMBER         REFERENCES drug_requests(request_id),
  message          VARCHAR2(1000) NOT NULL,
  is_read          NUMBER(1)      DEFAULT 0 NOT NULL,
  created_at       TIMESTAMP      DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_notif_user ON notifications(user_id, is_read);


-- ============================================================
-- AUDIT_LOGS
-- ============================================================
CREATE TABLE audit_logs (
  log_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id   NUMBER        NOT NULL REFERENCES drug_requests(request_id),
  action       VARCHAR2(50)  NOT NULL,
  performed_by NUMBER        NOT NULL REFERENCES users(user_id),
  from_stage   VARCHAR2(50),
  to_stage     VARCHAR2(50),
  remarks      VARCHAR2(1000),
  logged_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_audit_request ON audit_logs(request_id);


-- ============================================================
-- DRUG_ALTERNATIVES
-- ============================================================
CREATE TABLE drug_alternatives (
  alt_id                   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id               NUMBER NOT NULL REFERENCES drug_requests(request_id) ON DELETE CASCADE,

  brand_name               VARCHAR2(200) NOT NULL,
  manufacturer             VARCHAR2(200) NOT NULL,
  marketer                 VARCHAR2(200),
  consultant               VARCHAR2(300),
  introduced_on            VARCHAR2(100),

  consultant_present_stock NUMBER,
  purchase_quantity        NUMBER,
  sale_quantity             NUMBER,
  sale_qty                  NUMBER,  -- see file header note: likely duplicates sale_quantity
  pack                      VARCHAR2(100),

  mrp                      NUMBER(10,2),
  rate                     NUMBER(10,2),
  qty                      NUMBER(10,2),
  offer                    NUMBER(10,2),
  negotiated_rate          NUMBER(10,2),
  mrp_per_pack             NUMBER(10,2),
  rate_per_pack            NUMBER(10,2),
  gst_percent              NUMBER(5,2),

  markup_margin            NUMBER(10,2),
  scheme_qty               NUMBER,
  scheme_offer             VARCHAR2(200),
  net_rate                 NUMBER(10,2),
  total_margin             NUMBER(10,2),
  profit_margin            NUMBER(10,2),
  absolute_margin          NUMBER(10,2),

  stock                    VARCHAR2(100),
  existing_drug_details    VARCHAR2(500),
  transaction_history      VARCHAR2(500),
  margin_comparison        VARCHAR2(500),
  sales_data               VARCHAR2(500),
  stock_usage              VARCHAR2(500),

  comparison_type          VARCHAR2(20),
  is_final_selected        NUMBER(1) DEFAULT 0,

  remark                   VARCHAR2(500),
  refer                    VARCHAR2(500),

  submitted_by             NUMBER REFERENCES users(user_id),
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);


-- ============================================================
-- DRUG_ALTERNATIVE_NEGOTIATIONS
-- ============================================================
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
);


-- ============================================================
-- DRUG_EXISTING_DETAILS
-- ============================================================
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
);


-- ============================================================
-- DRUG_EFFECTIVE_ENTRIES
-- ============================================================
CREATE TABLE drug_effective_entries (
  entry_id             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id           NUMBER NOT NULL REFERENCES drug_requests(request_id) ON DELETE CASCADE,
  drug_name            VARCHAR2(500),
  effective_created_at TIMESTAMP,
  remarks              VARCHAR2(2000),
  created_by           NUMBER REFERENCES users(user_id),
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  entry_data           CLOB
);


-- ============================================================
-- ANALYSIS_DRAFTS
-- ============================================================
CREATE TABLE analysis_drafts (
  draft_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id    NUMBER NOT NULL REFERENCES drug_requests(request_id) ON DELETE CASCADE,
  pharmacist_id NUMBER NOT NULL REFERENCES users(user_id),
  draft_name    VARCHAR2(300),
  draft_data    CLOB,
  status        VARCHAR2(20) DEFAULT 'DRAFT',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);


-- ============================================================
-- BLACKLISTED_COMPANIES
-- ============================================================
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
);


-- ============================================================
-- REJECTION_REMARK_HISTORY
-- ============================================================
CREATE TABLE rejection_remark_history (
  history_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  remark_text     VARCHAR2(4000) NOT NULL,
  created_by      NUMBER,
  usage_count     NUMBER DEFAULT 1,
  last_used_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active       NUMBER(1) DEFAULT 1
);

CREATE INDEX idx_rejection_history_text ON rejection_remark_history(remark_text);


-- ============================================================
-- APPROVAL_REMARK_HISTORY
-- ============================================================
CREATE TABLE approval_remark_history (
  history_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_name       VARCHAR2(100),
  remark_text     VARCHAR2(4000) NOT NULL,
  created_by      NUMBER,
  usage_count     NUMBER DEFAULT 1,
  last_used_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active       NUMBER(1) DEFAULT 1
);

CREATE INDEX idx_approval_history_text ON approval_remark_history(remark_text);


-- ============================================================
-- ADMIN_USERS
-- ============================================================
CREATE TABLE admin_users (
  admin_id   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR2(200) NOT NULL,
  email      VARCHAR2(200) UNIQUE NOT NULL,
  password   VARCHAR2(200) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);


-- ============================================================
-- ADMIN_AUDIT_LOGS
-- ============================================================
CREATE TABLE admin_audit_logs (
  audit_id     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id     NUMBER        NOT NULL REFERENCES admin_users(admin_id),
  action       VARCHAR2(100) NOT NULL,
  target_user  NUMBER,
  details      VARCHAR2(2000),
  performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);


-- ============================================================
-- USER_REQUEST_QUOTAS
-- ============================================================
CREATE TABLE user_request_quotas (
  quota_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         NUMBER UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  quarterly_limit NUMBER DEFAULT 10 NOT NULL,
  updated_by      NUMBER REFERENCES users(user_id),
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
