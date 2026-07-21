// Remaining utility routes — moved out of server.js unchanged, mounted
// at the API root (/api). Grouped together because they don't share one
// clean prefix (audit trail, generic-drug search/save, patient lookup,
// remark history, margin reports).

import express from 'express';
import oracledb from 'oracledb';
import { getConn } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { normalizeGenericCombo } from '../utils/pureHelpers.js';
import { saveApprovalRemarks } from '../utils/auditHelpers.js';

const router = express.Router();

router.get('/audit/:requestId', requireAuth, async (req, res) => {
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

router.post('/getGeneric', requireAuth, async (req, res) => {
  const conn = await getConn();

  try {
    const search = req.body.search?.trim();

    if (!search) {
      return res.status(400).json({
        error: 'Search term is required.'
      });
    }

    console.log('Searching Generic:', search);

    // Tokenise the search string for order-independent matching.
    // Single-word queries produce one token → behaviour identical to the old single LIKE.
    const tokens = normalizeGenericCombo(search);
    // Build bind object: { tok0: 'aspirin', tok1: 'clopidogrel', ... }
    const tokenBinds = Object.fromEntries(tokens.map((t, i) => [`tok${i}`, t]));

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

      WHERE
          -- One LIKE clause per token; ALL must appear in DRUG_GEN_NAME (AND-joined)
          -- This makes "Aspirin + Clopidogrel" and "Clopidogrel + Aspirin" equivalent.
          ${tokens.map((_, i) => `LOWER(dg.DRUG_GEN_NAME) LIKE '%' || :tok${i} || '%'`).join('\n          AND ')}

      ORDER BY
          dg.DRUG_GEN_NAME,
          i.CREATEDDATETIME DESC
      `,
      tokenBinds
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

router.post('/saveGenericItem', requireAuth, async (req, res) => {
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

router.post('/getPatientInfo', requireRole('doctor'), async (req, res) => {
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

router.get('/rejection-remark-history', requireAuth, async (req, res) => {
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

router.get('/approval-remarks/:role', requireAuth, async (req, res) => {
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

router.post('/approval-remarks/save', requireAuth, async (req, res) => {
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

router.get('/generics/search', requireAuth, async (req, res) => {
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

router.post('/reports/item-margin-report', requireAuth, async (req, res) => {
  const conn = await getConn();

  try {
    const { fromDate, toDate, genericId, genericName } = req.body;

    if (!fromDate || !toDate) {
      return res.status(400).json({
        error: 'fromDate and toDate are required.'
      });
    }

    // ── Resolve genericId(s) ────────────────────────────────────────────────
    // Caller may supply either a numeric genericId (existing behaviour)
    // or a combo string genericName (e.g. "Aspirin + Clopidogrel").
    // Both paths produce resolvedIds — an array of numeric DRUG_GEN_IDs.
    let resolvedIds;

    if (genericId !== undefined && genericId !== null) {
      // ── Path A: numeric genericId (backward-compatible) ──────────────────
      const genIdNum = parseInt(genericId, 10);
      if (isNaN(genIdNum)) {
        return res.status(400).json({ error: 'genericId must be a valid number.' });
      }
      resolvedIds = [genIdNum];

    } else if (genericName) {
      // ── Path B: combo name string → resolve to DRUG_GEN_ID(s) ───────────
      // Tokenise so "Aspirin + Clopidogrel" and "Clopidogrel + Aspirin"
      // resolve identically (each token must appear in DRUG_GEN_NAME).
      const tokens = normalizeGenericCombo(String(genericName));
      if (tokens.length === 0) {
        return res.status(400).json({ error: 'genericName is empty after normalisation.' });
      }

      // Build AND-of-LIKE bind params: { gnTok0: 'aspirin', gnTok1: 'clopidogrel', ... }
      const gnBinds = Object.fromEntries(tokens.map((t, i) => [`gnTok${i}`, t]));
      const gnWhere = tokens
        .map((_, i) => `LOWER(dg.DRUG_GEN_NAME) LIKE '%' || :gnTok${i} || '%'`)
        .join(' AND ');

      const gnResult = await conn.execute(
        `SELECT dg.DRUG_GEN_ID FROM DRUGGENERICS dg WHERE ${gnWhere}`,
        gnBinds
      );

      if (!gnResult.rows || gnResult.rows.length === 0) {
        return res.status(404).json({ error: `No generic found matching '${genericName}'.` });
      }

      // Collect all matching IDs (there may be more than one row)
      resolvedIds = gnResult.rows.map(r => r.DRUG_GEN_ID);

    } else {
      return res.status(400).json({
        error: 'Either genericId or genericName is required.'
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    // Build IN-clause bind params: { gid0: 1, gid1: 2, ... }
    // Named params avoid string-concatenation of user-supplied values into SQL.
    const idBinds = Object.fromEntries(resolvedIds.map((id, i) => [`gid${i}`, id]));
    const inClause = resolvedIds.map((_, i) => `:gid${i}`).join(', ');

    const query = `
  WITH latest_purchase_rate AS (
    SELECT
        li.item,
        MAX(li.itemrate) KEEP (DENSE_RANK LAST ORDER BY li.docdetailid) AS latest_rate
    FROM goodsreceiptnotelineitem li
    WHERE li.itemrate IS NOT NULL
      AND li.itemrate > 0
    GROUP BY li.item
  ),
  base_data AS (
    SELECT
        ROW_NUMBER() OVER (ORDER BY i.description) AS sno,

        i.createddatetime AS introduced_on,
        i.description AS brand_name,
        CASE
WHEN i.ISACTIVE = 1 THEN 'Active✅'
ELSE 'Inactive❌'

END AS status,m.manufacturer_name AS manufacturer,market.marketter_name AS marketer,

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
                  AND TO_DATE(:toDate,'DD/MM/YYYY HH24:MI:SS')
        ), 0) AS purchase_quantity,

        NVL((
            SELECT SUM(ibd.issued_qty)
            FROM issueheader ih
            INNER JOIN issuedetail id
                ON id.issueheader_id = ih.transaction_id
            INNER JOIN issuebatchdetail ibd
                ON ibd.issuedetail_id = id.detail_id
            WHERE ih.createddt BETWEEN
                  TO_DATE(:fromDate,'DD/MM/YYYY HH24:MI:SS')
                  AND TO_DATE(:toDate,'DD/MM/YYYY HH24:MI:SS')
              AND ih.issue_status = 452
              AND id.item = i.id
        ), 0) AS sale_qty,

        u.name AS pack,
        TO_NUMBER(REGEXP_SUBSTR(u.name, '^[0-9]+')) AS pack_qty,

        ROUND(
            NVL(i.mrp, 0) /
            NULLIF(TO_NUMBER(REGEXP_SUBSTR(u.name, '^[0-9]+')), 0),
        4) AS mrp_incl_gst,

        ROUND(
            NVL(lpr.latest_rate, 0) /
            NULLIF(TO_NUMBER(REGEXP_SUBSTR(u.name, '^[0-9]+')), 0),
        4) AS rate_incl_gst,

        NVL(ivm.quantity, 0) AS scheme_qty,
        NVL(ivm.freeqty, 0) AS offer_qty,

        ROUND(
            NVL(i.mrp, 0) /
            NULLIF(TO_NUMBER(REGEXP_SUBSTR(u.name, '^[0-9]+')), 0),
        4) AS base_mrp_per_unit,

        ROUND(
            NVL(lpr.latest_rate, 0) /
            NULLIF(TO_NUMBER(REGEXP_SUBSTR(u.name, '^[0-9]+')), 0),
        4) AS base_rate_per_unit,

        -- ── NET RATE FIX ─────────────────────────────────────────────
        -- If a drug has a scheme (scheme_qty + offer_qty > 0), net rate
        -- is the blended scheme rate as before. If there is NO scheme
        -- (both are 0), there's nothing to blend — the net rate is just
        -- the plain purchase rate per unit. Computed once here so every
        -- downstream column (net_rate, profit_margin, absolute_margin,
        -- total_margin_markup) uses the same consistent value.
       CASE
    WHEN NVL(ivm.quantity,0) > 0
     AND NVL(ivm.freeqty,0) > 0
    THEN
        ROUND(
            (
                ROUND(
                    NVL(lpr.latest_rate,0) /
                    NULLIF(
                        TO_NUMBER(REGEXP_SUBSTR(u.name,'^[0-9]+')),
                        0
                    ),
                4)
                * NVL(ivm.quantity,0)
            ) /
            (NVL(ivm.quantity,0)+NVL(ivm.freeqty,0)),
        4)

    ELSE
        ROUND(
            NVL(lpr.latest_rate,0) /
            NULLIF(
                TO_NUMBER(REGEXP_SUBSTR(u.name,'^[0-9]+')),
                0
            ),
        4)
END AS net_rate_value

    FROM item i
    INNER JOIN drugdetail dd
        ON dd.item_refid = i.id
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
    LEFT JOIN latest_purchase_rate lpr
        ON lpr.item = i.id
    WHERE i.itemtypenum = 1
      AND i.isactive = 1
      AND dg.drug_gen_id IN (${inClause})
  )
  SELECT
      sno,
      introduced_on,
      brand_name,
      status,
      manufacturer,
      marketer,
      consultant,
      present_stock,
      purchase_quantity,
      sale_qty,
      pack,
      pack_qty,
      mrp_incl_gst,
      rate_incl_gst,

      ROUND(
          ((base_mrp_per_unit - base_rate_per_unit) /
           NULLIF(base_rate_per_unit, 0)) * 100,
      2) AS markup_margin,

      scheme_qty,
      offer_qty,

      net_rate_value AS net_rate,

      ROUND(
          (base_mrp_per_unit - net_rate_value) /
          NULLIF(base_mrp_per_unit, 0) * 100,
      2) AS profit_margin,

      ROUND(
          base_mrp_per_unit - net_rate_value,
      4) AS absolute_margin,

      ROUND(
          (
            (base_mrp_per_unit - net_rate_value) /
            NULLIF(net_rate_value, 0)
          ) * 100,
      2) AS total_margin_markup,

      NULL AS remarks
  FROM base_data
  ORDER BY brand_name
`;

    const result = await conn.execute(query, {
      fromDate,
      toDate,
      ...idBinds   // gid0, gid1, … — one named bind per resolved ID
    });

    const data = result.rows.map(r => ({
      sno: r.SNO,
      introduced_on: r.INTRODUCED_ON,
      brand_name: r.BRAND_NAME,
      status: r.STATUS,
      manufacturer: r.MANUFACTURER,
      marketer: r.MARKETER,
      consultant: r.CONSULTANT,
      present_stock: r.PRESENT_STOCK,
      purchase_quantity: r.PURCHASE_QUANTITY,
      sale_qty: r.SALE_QTY,
      pack: r.PACK,
      pack_qty: r.PACK_QTY,
      mrp_incl_gst: r.MRP_INCL_GST,
      rate_incl_gst: r.RATE_INCL_GST,
      markup_margin: r.MARKUP_MARGIN,
      absolute_margin: r.ABSOLUTE_MARGIN,
      scheme_qty: r.SCHEME_QTY,
      offer_qty: r.OFFER_QTY,
      net_rate: r.NET_RATE,
      profit_margin: r.PROFIT_MARGIN,
      total_margin_markup: r.TOTAL_MARGIN_MARKUP,
      remarks: r.REMARKS
    }));

    res.json(data);

  } catch (err) { console.error('POST /api/reports/item-margin-report error:', err); res.status(500).json({ error: 'Internal server error.', detail: err.message }); } finally { await conn.close(); }
});


export default router;
