# 💊 Formulary Drug Addition Request System

A full-stack hospital drug indenting workflow system with a 4-stage approval chain:
**Doctor → Pharmacy Head → DTC Committee → CEO**

---

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | React 18 (SPA, Create React App)    |
| Backend  | Node.js + Express                   |
| Database | Oracle DB (oracledb npm package)    |

---

## Project Structure

```
Drug Indenting/
├── .env                    ← Oracle credentials (edit before running)
├── create_tables.sql       ← Full Oracle schema + seed data
├── server.js               ← Express REST API (all routes)
├── package.json            ← Backend dependencies
├── README.md
└── client/
    ├── package.json        ← React dependencies (proxy → port 5000)
    └── src/
        ├── index.js
        ├── index.css       ← Global dark-theme design system
        ├── App.js          ← Tab nav + role switcher
        └── components/
            ├── DoctorTab.js
            ├── PharmacyHeadTab.js
            ├── DTCCommitteeTab.js
            ├── CEOTab.js
            ├── Dashboard.js
            └── Notifications.js
```

---

## Prerequisites

- **Node.js** ≥ 18
- **Oracle Database** (XE or higher) running locally
- **Oracle Instant Client** installed and in PATH (required by `oracledb`)

### Oracle Instant Client Setup (Windows)

1. Download from: https://www.oracle.com/database/technologies/instant-client/winx64-64-downloads.html
2. Extract to e.g. `C:\oracle\instantclient_21_3`
3. Add that folder to your **System PATH**

---

## Setup & Run

### Step 1 — Oracle Database

Connect to Oracle as SYSDBA or system user, then run:

```sql
-- In SQL*Plus or SQL Developer:
@"C:\Drug Indenting\create_tables.sql"
```

This creates 4 tables (`users`, `drug_requests`, `notifications`, `audit_logs`) and seeds 5 sample users.

### Step 2 — Configure Environment

Edit `c:\Drug Indenting\.env`:

```env
DB_USER=system
DB_PASSWORD=your_oracle_password
DB_CONNECT=localhost/XE
PORT=5000
```

> For Oracle 21c+, `DB_CONNECT` may be `localhost:1521/XE` or `localhost/XEPDB1`

### Step 3 — Install Backend Dependencies

```powershell
cd "C:\Drug Indenting"
npm install
```

### Step 4 — Install Frontend Dependencies

```powershell
cd "C:\Drug Indenting\client"
npm install
```

### Step 5 — Run the Application

**Terminal 1 — Backend:**
```powershell
cd "C:\Drug Indenting"
npm run dev
```

**Terminal 2 — Frontend:**
```powershell
cd "C:\Drug Indenting\client"
npm start
```

Open **http://localhost:3000** in your browser.

---

## Seeded Users

Use the **role switcher** in the top-right to switch between these users:

| Name             | Role           | Email                     |
|------------------|----------------|---------------------------|
| Dr. Aarav Singh  | Doctor         | doctor1@hospital.com      |
| Dr. Priya Mehta  | Doctor         | doctor2@hospital.com      |
| Ravi Kumar       | Pharmacy Head  | ph@hospital.com           |
| Dr. Sunita Rao   | DTC Committee  | dtc@hospital.com          |
| Mr. Vikram Nair  | CEO            | ceo@hospital.com          |

---

## API Endpoints

| Method | Endpoint                            | Description                              |
|--------|-------------------------------------|------------------------------------------|
| POST   | `/api/requests`                     | Submit new drug request                  |
| GET    | `/api/requests/:role/:userId`       | Get requests filtered by role            |
| PUT    | `/api/requests/:id/approve`         | Approve → advance to next stage          |
| PUT    | `/api/requests/:id/reject`          | Reject with mandatory remarks            |
| GET    | `/api/notifications/:userId`        | Get user notifications                   |
| PUT    | `/api/notifications/:id/read`       | Mark notification as read                |
| GET    | `/api/dashboard/:role`              | Get metric counts for dashboard          |
| GET    | `/api/users`                        | List all users                           |
| GET    | `/api/audit/:requestId`             | Get full audit trail for a request       |

---

## Approval Workflow

```
Doctor submits
    └─→ Pharmacy Head reviews
            ├─ Approve → DTC Committee reviews
            │       ├─ Approve → CEO reviews
            │       │       ├─ Approve → ✅ FINAL APPROVAL
            │       │       └─ Reject  → Notify Doctor + PH + DTC
            │       └─ Reject → Notify Doctor + PH
            └─ Reject → Notify Doctor
```

- **Max 5 submissions per doctor per quarter** (enforced server-side)
- **All rejections require mandatory remarks**
- **Complete audit log** on every state change
- **In-app notifications** for every action

---

## Features by Role

### 🩺 Doctor
- 16-field drug request form with full validation
- Quarterly submission quota progress bar (max 5)
- Real-time status tracking with visual progress bar per request
- In-app notification panel

### 💊 Pharmacy Head
- View all incoming pending requests
- View full drug details before deciding
- Approve (→ DTC) or Reject (with mandatory remarks)
- Dashboard with metric cards + filterable history

### 🏛️ DTC Committee
- View PH-approved requests with PH remarks visible
- Approve (→ CEO) or Reject (notifies Doctor + PH)
- Dashboard with metric cards + filterable history

### 👔 CEO
- View DTC-approved requests with full prior-stage remarks
- Grant Final Approval or Reject (notifies all 3 prior roles)
- Dashboard with metric cards + filterable history

---

## Status Colour Codes

| Status   | Colour    |
|----------|-----------|
| Pending  | 🟡 Yellow |
| Approved | 🟢 Green  |
| Rejected | 🔴 Red    |
