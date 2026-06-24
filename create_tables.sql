-- ============================================================
-- Formulary Drug Addition Request System — Oracle Schema
-- ============================================================

-- Drop existing tables (safe order: children first)
BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE audit_logs CASCADE CONSTRAINTS';
EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE notifications CASCADE CONSTRAINTS';
EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE drug_requests CASCADE CONSTRAINTS';
EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE users CASCADE CONSTRAINTS';
EXCEPTION WHEN OTHERS THEN NULL; END;
/

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE TABLE users (
    user_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          VARCHAR2(200)  NOT NULL,
    email         VARCHAR2(200)  NOT NULL UNIQUE,
    phone         VARCHAR2(20),
    role          VARCHAR2(50)   NOT NULL
                    CHECK (role IN ('Doctor','PharmacyHead','DTCCommittee','CEO')),
    department    VARCHAR2(200),
    is_active     NUMBER(1)      DEFAULT 1 NOT NULL,
    created_at    TIMESTAMP      DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ============================================================
-- DRUG REQUESTS TABLE
-- ============================================================
CREATE TABLE drug_requests (
    request_id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doctor_id             NUMBER         NOT NULL REFERENCES users(user_id),

    -- Medical Rep Info
    med_rep_name          VARCHAR2(200)  NOT NULL,
    med_rep_email         VARCHAR2(200)  NOT NULL,
    med_rep_phone         VARCHAR2(20)   NOT NULL,

    -- Drug Classification
    request_type          VARCHAR2(50)   NOT NULL
                            CHECK (request_type IN ('New Brand','New Molecule','Combination','Other')),
    category              VARCHAR2(100)  NOT NULL,

    -- Drug Details
    brand_name            VARCHAR2(200)  NOT NULL,
    generic_name          VARCHAR2(200)  NOT NULL,
    dose_strength         VARCHAR2(100)  NOT NULL,
    dosage_form           VARCHAR2(100)  NOT NULL,
    manufacturer          VARCHAR2(200)  NOT NULL,
    marketer              VARCHAR2(200)  NOT NULL,
    existing_brands       CLOB,

    -- Clinical Info
    clinical_justification CLOB         NOT NULL,
    expected_patients_pm   NUMBER        NOT NULL,
    cost_reduction_benefit NUMBER(1)     DEFAULT 0 NOT NULL,

    -- Workflow Fields
    status                VARCHAR2(20)   DEFAULT 'Pending'
                            CHECK (status IN ('Pending','Approved','Rejected')),
    current_stage         VARCHAR2(50)   DEFAULT 'PharmacyHead'
                            CHECK (current_stage IN ('PharmacyHead','DTCCommittee','CEO','Final','Rejected')),
    ph_remarks            CLOB,
    dtc_remarks           CLOB,
    ceo_remarks           CLOB,

    created_at            TIMESTAMP      DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at            TIMESTAMP      DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Index for quarterly quota check
CREATE INDEX idx_dreq_doctor_created ON drug_requests(doctor_id, created_at);
-- Index for stage-based queries
CREATE INDEX idx_dreq_stage ON drug_requests(current_stage, status);

-- ============================================================
-- NOTIFICATIONS TABLE
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
-- AUDIT LOGS TABLE
-- ============================================================
CREATE TABLE audit_logs (
    log_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id    NUMBER         NOT NULL REFERENCES drug_requests(request_id),
    action        VARCHAR2(50)   NOT NULL,   -- e.g. SUBMITTED, APPROVED, REJECTED
    performed_by  NUMBER         NOT NULL REFERENCES users(user_id),
    from_stage    VARCHAR2(50),
    to_stage      VARCHAR2(50),
    remarks       CLOB,
    logged_at     TIMESTAMP      DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_audit_request ON audit_logs(request_id);

-- ============================================================
-- SEED DATA — Sample Users
-- ============================================================
INSERT INTO users (name, email, phone, role, department) VALUES
  ('Dr. Aarav Singh',      'doctor1@hospital.com',    '9000000001', 'Doctor',        'Internal Medicine');
INSERT INTO users (name, email, phone, role, department) VALUES
  ('Dr. Priya Mehta',      'doctor2@hospital.com',    '9000000002', 'Doctor',        'Cardiology');
INSERT INTO users (name, email, phone, role, department) VALUES
  ('Ravi Kumar',           'ph@hospital.com',         '9000000010', 'PharmacyHead',  'Pharmacy');
INSERT INTO users (name, email, phone, role, department) VALUES
  ('Dr. Sunita Rao',       'dtc@hospital.com',        '9000000020', 'DTCCommittee',  'DTC');
INSERT INTO users (name, email, phone, role, department) VALUES
  ('Mr. Vikram Nair',      'ceo@hospital.com',        '9000000030', 'CEO',           'Administration');

COMMIT;

-- ============================================================
-- TRIGGER: auto-update updated_at on drug_requests
-- ============================================================
CREATE OR REPLACE TRIGGER trg_drug_requests_upd
  BEFORE UPDATE ON drug_requests
  FOR EACH ROW
BEGIN
  :NEW.updated_at := CURRENT_TIMESTAMP;
END;
/
