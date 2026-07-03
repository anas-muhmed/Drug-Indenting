// =ComparisonSheet====================================================================
// ComparisonSheet.js — NEW Excel layout comparison sheet
// Renders for both 'existing_generic' and 'new_generic' compTypes.
//
// mode='pharmacist'     → editable, single "Submit & Forward to PH" button
// mode='pharmacy_head'  → editable, "Save Updates" + "Forward to DTC" buttons
// mode='readonly'       → read-only view (DTC, CEO, etc.)
//
// NEW column order (v2):
//   S.No | Introduced On | Brand Name | Mfr | Mktr | Consultant |
//   MRP/Pack | Rate/Pack | GST% | Pack |
//   MRP(Inc.GST)/Nos* | Rate(Inc.GST)/Nos* | Mark Up Margin* |
//   Scheme[Qty | Offer] |
//   Net Rate* | Profit Margin* | Absolute Margin* | Total Margin(Mark Up)* |
//   Remarks
//   (* = auto-calculated, read-only)
// =====================================================================
import React from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import axios from 'axios';
import ApprovalRemarksPanel from './ApprovalRemarksPanel';

const HOSPITAL = 'MALANKARA ORTHODOX SYRIAN CHURCH MEDICAL MISSION KOLENCHERY-ERNAKULAM';

function fmt(v) {
  if (v === null || v === undefined || Number.isNaN(v)) {
    return '';
  }
  return Number(v);
}

// ── Derived-field calculator ─────────────────────────────────────────
// Computes all formula-based columns from the 4 raw inputs + scheme qty/offer.
// Returns empty string '' for any field that cannot be computed (zero divisor etc.)
function calcDerived(mrpPack, ratePack, gstPct, packAmt, qty, offer) {
  const mp = parseFloat(mrpPack) || 0;
  const rp = parseFloat(ratePack) || 0;
  const g = parseFloat(gstPct) || 0;
  const pk = parseFloat(packAmt) || 0;
  const q = parseFloat(qty) || 0;
  const o = parseFloat(offer) || 0;

  // MRP is inclusive of GST natively; do not apply/multiply GST
  const mrp = pk > 0 ? +(mp / pk).toFixed(4) : null;
  const rate = pk > 0 ? +(rp * (1 + g / 100) / pk).toFixed(4) : null;

  const markup = mrp != null && rate != null && rate > 0
    ? +(((mrp - rate) / rate) * 100).toFixed(2)
    : null;

  const netRate = rate != null ? ((q + o) > 0 ? +(rate * q / (q + o)).toFixed(4) : rate) : null;

  const profit = mrp != null && netRate != null && mrp > 0
    ? +(((mrp - netRate) / mrp) * 100).toFixed(2)
    : null;

  const absMargin = mrp != null && netRate != null
    ? +(mrp - netRate).toFixed(4)
    : null;

  const totalMargin = mrp != null && netRate != null && netRate > 0
    ? +(((mrp - netRate) / netRate) * 100).toFixed(2)
    : null;

  return {
    mrp: fmt(mrp),
    rate: fmt(rate),
    markupmargin: fmt(markup),
    profit_margin: fmt(profit),
    abs_margin: fmt(absMargin),
    net_rate: fmt(netRate),
    margin: fmt(totalMargin)
  };
}

// ── Column definitions — NEW Excel format ──────────────────────────
// isCalc: true  → auto-computed from formula; rendered as CalcCell (read-only, shaded)
// isScheme: true → rendered under merged "Scheme" header
// existingKey   → key in existingGenericData object (null = blank for existing row)
// ── Column definitions — NEW Excel format ──────────────────────────
// isCalc: true  → auto-computed from formula; rendered as CalcCell (read-only, shaded)
// isScheme: true → rendered under merged "Scheme" header
// existingKey   → key in existingGenericData object (null = blank for existing row)
const COLS_NEW = [
  { id: 'introduced_on', label: 'Introduced On', existingKey: 'existing_introduced_on', w: 140 },
  { id: 'brand_name', label: 'Brand Name', existingKey: 'existing_brand_name', w: 240 },
  { id: 'manufacturer', label: 'Mfr.', existingKey: 'existing_manufacturer', w: 220 },
  { id: 'marketer', label: 'Mktr.', existingKey: 'existing_marketer', w: 220 },
  { id: 'consultant', label: 'Consultant', existingKey: null, w: 180 },
  { id: 'mrp_per_pack', label: 'MRP/Pack', existingKey: 'existing_mrp_per_pack', w: 130, num: true },
  { id: 'rate_per_pack', label: 'Rate/Pack', existingKey: 'existing_rate_per_pack', w: 130, num: true },
  { id: 'gst_percent', label: 'GST%', existingKey: 'existing_gst_percent', w: 70, num: true },
  { id: 'pack', label: 'Pack', existingKey: 'existing_pack', w: 120 },
  { id: 'mrp', label: 'MRP (Inc. GST)/Nos', existingKey: null, isCalc: true, w: 130 },
  { id: 'rate', label: 'Rate (Inc. GST)/Nos', existingKey: null, isCalc: true, w: 130 },
  { id: 'markupmargin', label: 'Mark Up Margin', existingKey: null, isCalc: true, w: 150 },
  { id: 'qty', label: 'Qty', isScheme: true, existingKey: 'existing_qty', w: 70, num: true },
  { id: 'offer', label: 'Offer', isScheme: true, existingKey: 'existing_offer', w: 70, num: true },
  { id: 'net_rate', label: 'Net Rate', existingKey: null, isCalc: true, w: 140 },
  { id: 'profit_margin', label: 'Profit Margin', existingKey: null, isCalc: true, w: 150 },
  { id: 'abs_margin', label: 'Absolute Margin', existingKey: null, isCalc: true, w: 170 },
  { id: 'margin', label: 'Total Margin (Mark Up)', existingKey: null, isCalc: true, w: 180 },
  { id: 'remark', label: 'Remarks', existingKey: 'existing_drug_details', w: 320 },
];

const COLS_EXISTING = [
  { id: 'introduced_on', label: 'Introduced On', key: 'introduced_on', w: 140 },
  { id: 'brand_name', label: 'Brand Name', key: 'brand_name', w: 240 },
  { id: 'manufacturer', label: 'Mfr.', key: 'manufacturer', w: 220 },
  { id: 'marketer', label: 'Mktr.', key: 'marketer', w: 220 },
  { id: 'consultant', label: 'Consultant', key: 'consultant', w: 180 },
  { id: 'present_stock', label: 'Present Stock', key: 'present_stock', w: 100, num: true },
  { id: 'purchase_qty', label: 'Purchase Quantity', key: 'purchase_qty', w: 120, num: true },
  { id: 'sale_qty', label: 'Sale Qty', key: 'sale_qty', w: 100, num: true },
  { id: 'pack', label: 'Pack', key: 'pack', w: 120 },
  { id: 'mrp_inc_gst_nos', label: 'MRP (Including GST) / Nos', key: 'mrp_inc_gst_nos', w: 130, num: true },
  { id: 'rate_inc_gst_nos', label: 'Rate (Including GST) / Nos', key: 'rate_inc_gst_nos', w: 130, num: true },
  { id: 'markup_margin', label: 'Mark Up Margin', key: 'markup_margin', w: 150, num: true },
  { id: 'scheme_qty', label: 'Qty', isScheme: true, key: 'scheme_qty', w: 70, num: true },
  { id: 'scheme_offer', label: 'Offer', isScheme: true, key: 'scheme_offer', w: 70 },
  { id: 'net_rate', label: 'Net Rate', key: 'net_rate', w: 140, num: true },
  { id: 'profit_margin', label: 'Profit Margin', key: 'profit_margin', w: 150, num: true },
  { id: 'absolute_margin', label: 'Absolute Margin', key: 'absolute_margin', w: 170, num: true },
  { id: 'total_margin', label: 'Total Margin (Mark Up)', key: 'total_margin', w: 180, num: true },
  { id: 'remark', label: 'Remarks', key: 'remark', w: 320 },
];

// ── Shared style tokens ──────────────────────────────────────────────
const CELL = {
  border: '1px solid #bbb', padding: '6px 8px', fontSize: '0.73rem',
  verticalAlign: 'top',
};
const HDR = {
  ...CELL, background: '#1e3a5f', color: '#fff', fontWeight: 700,
  textAlign: 'center', fontSize: '0.7rem',
};
const SECTION_HDR = {
  background: '#d97706', color: '#fff', fontWeight: 700,
  padding: '5px 10px', fontSize: '0.78rem', letterSpacing: '0.04em',
};
const EXIST_ROW = { background: '#fefce8' };
const NEW_ROW = { background: '#f0f9ff' };
const DR_ROW = { background: '#f0fdf4' };   // first alt row (Dr. Recommended)
const INPUT_STYLE = {
  width: '100%', border: 'none', background: 'transparent',
  padding: '1px 2px', fontSize: '0.73rem', outline: 'none', minWidth: 0,
};
const TEXTAREA_STYLE = {
  width: '100%', border: 'none', background: 'transparent',
  padding: 0, margin: 0, fontSize: '0.73rem', outline: 'none',
  resize: 'none', overflowY: 'hidden', fontFamily: 'inherit',
  lineHeight: '1.3', display: 'block',
};
const CALC_STYLE = {
  ...CELL, background: '#eef2ff', color: '#1e40af',
  textAlign: 'right', fontStyle: 'italic', fontSize: '0.72rem',
};

// ── Sub-components ───────────────────────────────────────────────────

/** Standard editable / read-only data cell */
function SheetCell({ value, onChange, num, editable, style = {}, colId }) {
  const isNum = !!num;
  const useTextarea = !isNum && ['brand_name', 'manufacturer', 'marketer', 'consultant', 'remark'].includes(colId);

  // Center-aligned, right-aligned, or left-aligned depending on data type
  const textAlign = isNum 
    ? 'right' 
    : (colId === 'introduced_on' || colId === 'pack' || colId === 'scheme_offer' ? 'center' : 'left');
  
  // Wrap text fields, prevent clipping, allow numeric fields to stay single-line
  const whiteSpace = isNum ? 'nowrap' : 'pre-wrap';
  const wordBreak = isNum ? 'normal' : 'break-word';
  const overflowWrap = isNum ? 'normal' : 'anywhere';

  const merged = { 
    ...CELL, 
    textAlign, 
    whiteSpace, 
    wordBreak, 
    overflowWrap,
    ...style 
  };

  const textareaRef = React.useRef(null);
  React.useEffect(() => {
    if (useTextarea && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [value, useTextarea]);

  if (!editable) {
    return (
      <td style={merged} data-col-id={colId}>
        {value !== '' && value !== null && value !== undefined ? value : '—'}
      </td>
    );
  }

  if (useTextarea) {
    return (
      <td style={merged} data-col-id={colId}>
        <textarea
          ref={textareaRef}
          value={value ?? ''}
          onChange={e => onChange && onChange(e.target.value)}
          style={TEXTAREA_STYLE}
          rows={1}
        />
      </td>
    );
  }

  return (
    <td style={merged} data-col-id={colId}>
      <input
        type={num ? 'number' : 'text'}
        value={value ?? ''}
        onChange={e => onChange && onChange(e.target.value)}
        style={INPUT_STYLE}
      />
    </td>
  );
}

/** Auto-calculated read-only cell — always shaded blue-tint */
function CalcCell({ value, rowStyle = {}, colId }) {
  const merged = {
    ...CALC_STYLE,
    textAlign: 'right',
    whiteSpace: 'nowrap',
    ...rowStyle,
    background: rowStyle.background
      ? CALC_STYLE.background   // keep calc shade regardless of row stripe
      : CALC_STYLE.background,
  };
  return (
    <td style={merged} data-col-id={colId}>
      {value !== '' && value !== null && value !== undefined ? value : '—'}
    </td>
  );
}

const REASON_OPTIONS = [
  'Lowest/Comparable MRP',
  'Better Margin',
  'Reputed Manufacturer/Marketer',
  'Clinician Preference',
  'Better Patient Affordability',
  'DCGI & WHO-GMP Approved',
];

const createExistingRow = () => ({
  introduced_on: '',
  brand_name: '',
  manufacturer: '',
  marketer: '',
  consultant: '',
  present_stock: '',
  purchase_qty: '',
  sale_qty: '',
  pack: '',
  mrp_inc_gst_nos: '',
  rate_inc_gst_nos: '',
  markup_margin: '',
  scheme_qty: '',
  scheme_offer: '',
  net_rate: '',
  profit_margin: '',
  absolute_margin: '',
  total_margin: '',
  remark: '',
});

const mapColIdToKey = (id) => {
  switch (id) {
    case 'mrp_per_pack': return 'mrp_pack';
    case 'rate_per_pack': return 'rate_pack';
    case 'qty': return 'scheme_qty';
    case 'offer': return 'scheme_offer';
    case 'mrp': return 'mrp_inc_gst_nos';
    case 'rate': return 'rate_inc_gst_nos';
    case 'markupmargin': return 'markup_margin';
    case 'margin': return 'total_margin';
    case 'abs_margin': return 'absolute_margin';
    default: return id;
  }
};

// ── Section Headers Row Generator ────────────────────────────────────
function renderSectionHeaders(cols, columnWidths, handleMouseDown, handleDoubleClick) {
  return (
    <>
      {/* Row 1: main column headers */}
      <tr>
        <th style={{ ...HDR, width: columnWidths.sno || 40, minWidth: columnWidths.sno || 40, position: 'relative' }} data-col-id="sno">
          S.No.
          <div
            className="resize-handle"
            onMouseDown={e => handleMouseDown(e, 'sno')}
            onDoubleClick={() => handleDoubleClick('sno')}
          />
        </th>
        {cols.map(col => {
          if (col.isScheme && (col.id === 'offer' || col.id === 'scheme_offer')) return null;
          if (col.isScheme && (col.id === 'qty' || col.id === 'scheme_qty')) {
            const offerCol = cols.find(c => c.id === 'offer' || c.id === 'scheme_offer');
            const w1 = columnWidths[col.id] || col.w;
            const w2 = columnWidths[offerCol.id] || offerCol.w;
            return (
              <th key={col.id} colSpan={2} style={{ ...HDR, width: w1 + w2, minWidth: w1 + w2, position: 'relative' }}>
                Scheme
                <div
                  className="resize-handle"
                  onMouseDown={e => handleMouseDown(e, offerCol.id)}
                  onDoubleClick={() => handleDoubleClick(offerCol.id)}
                />
              </th>
            );
          }
          const colW = columnWidths[col.id] || col.w;
          return (
            <th key={col.id} style={{
              ...HDR,
              width: colW, minWidth: colW,
              background: col.isCalc ? '#16305a' : '#1e3a5f',
              position: 'relative',
            }} data-col-id={col.id}>
              {col.label}
              <div
                className="resize-handle"
                onMouseDown={e => handleMouseDown(e, col.id)}
                onDoubleClick={() => handleDoubleClick(col.id)}
              />
            </th>
          );
        })}
      </tr>
      {/* Row 2: sub-labels */}
      <tr>
        <th style={{ ...HDR, fontSize: '0.62rem', width: columnWidths.sno || 40, minWidth: columnWidths.sno || 40, position: 'relative' }} data-col-id="sno">
          <div
            className="resize-handle"
            onMouseDown={e => handleMouseDown(e, 'sno')}
            onDoubleClick={() => handleDoubleClick('sno')}
          />
        </th>
        {cols.map(col => {
          let subLabel = '';
          if (col.isScheme) subLabel = col.label;
          else if (col.isCalc) subLabel = '⟵ auto';
          const colW = columnWidths[col.id] || col.w;
          return (
            <th key={col.id} style={{
              ...HDR,
              fontSize: '0.6rem', width: colW, minWidth: colW,
              background: col.isCalc ? '#1a3a6e' : '#253d6e',
              letterSpacing: col.isCalc ? '0em' : undefined,
              fontStyle: col.isCalc ? 'italic' : 'normal',
              opacity: 0.9,
              position: 'relative',
            }} data-col-id={col.id}>
              {subLabel}
              <div
                className="resize-handle"
                onMouseDown={e => handleMouseDown(e, col.id)}
                onDoubleClick={() => handleDoubleClick(col.id)}
              />
            </th>
          );
        })}
      </tr>
    </>
  );
}

// ── Main Component ───────────────────────────────────────────────────
export default function ComparisonSheet({
  // mode: 'pharmacist' | 'pharmacy_head' | 'readonly' | 'dtc'
  mode = 'readonly',
  compType = 'new_generic',
  alternatives = [],
  existingGenericData = {},
  existingDetails: propExistingDetails = [],
  onExistingDetailsChange,
  pharmRemarks = '',
  phRemarks = '',
  requestInfo = {},
  isCorrectionMode = false,

  dtcSelectedBrand = '',
  dtcSelectedCategory = '',
  dtcSelectionReasons = [],
  dtcRecommendationNotes = '',
  dtcReviewedByName = '',
  dtcReviewedAt = '',
  dtcReviewSignature = '',
  dtcRemarks = '',
  phFinalRecommendation = '',
  finalRecommendationNotes = '',
  finalSelectedBrand = '',
  finalSelectedCategory = '',
  finalSelectionReasons = [],
  dtcFinalRecommendations = [],

  // callbacks
  onAlternativesChange,
  onExistingChange,
  onRemarksChange,       // pharmacist remarks
  onPhRemarksChange,     // pharmacy head remarks

  onDtcSelectedBrandChange,
  onDtcSelectedCategoryChange,
  onDtcSelectionReasonsChange,
  onDtcRecommendationNotesChange,
  onDtcReviewedByNameChange,
  onDtcReviewSignatureChange,
  onDtcRemarksChange,
  onPhFinalRecommendationChange,
  onFinalRecommendationNotesChange,
  onFinalSelectedBrandChange,
  onFinalSelectedCategoryChange,
  onFinalSelectionReasonsChange,
  onDtcFinalRecommendationsChange,

  // pharmacist mode
  onSubmit,
  submitting = false,

  // pharmacy_head mode
  onSave,
  saving = false,
  onForwardToDTC,
  forwarding = false,

  // DTC mode
  onDtcFinalize,
  finalizing = false,

  onBack,
  onAddAlt,
}) {
  const isExisting = compType === 'existing_generic';
  const editable = mode === 'pharmacist' || mode === 'pharmacy_head';
  const today = new Date().toLocaleDateString('en-GB');

  const wrapperRef = React.useRef(null);
  const sheetRef = React.useRef(null);
  const [zoom, setZoom] = React.useState(0.8);

  // ── Column Widths state & resizing handlers ──────────────────────────
  const [columnWidths, setColumnWidths] = React.useState(() => {
    const initial = { sno: 40 };
    COLS_NEW.forEach(col => {
      initial[col.id] = col.w;
    });
    COLS_EXISTING.forEach(col => {
      initial[col.id] = col.w;
    });
    return initial;
  });

  const getColIndex = React.useCallback((colId) => {
    let idx = COLS_NEW.findIndex(c => c.id === colId);
    if (idx === -1) {
      idx = COLS_EXISTING.findIndex(c => c.id === colId);
    }
    return idx;
  }, []);

  const handleMouseDown = React.useCallback((e, colId) => {
    e.preventDefault();
    const startX = e.clientX;
    const colIndex = getColIndex(colId);
    const startWidth = colId === 'sno' ? (columnWidths.sno || 40) : (columnWidths[colId] || 100);

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.min(600, Math.max(80, startWidth + deltaX));

      if (colId === 'sno') {
        setColumnWidths(prev => ({ ...prev, sno: newWidth }));
      } else if (colIndex !== -1) {
        const newCol = COLS_NEW[colIndex];
        const existCol = COLS_EXISTING[colIndex];
        setColumnWidths(prev => {
          const updated = { ...prev };
          if (newCol) updated[newCol.id] = newWidth;
          if (existCol) updated[existCol.id] = newWidth;
          return updated;
        });
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
  }, [columnWidths, getColIndex]);

  const handleDoubleClick = React.useCallback((colId) => {
    if (!sheetRef.current) return;
    const cells = sheetRef.current.querySelectorAll(`[data-col-id="${colId}"]`);
    let maxW = 80;
    cells.forEach(cell => {
      const oldWS = cell.style.whiteSpace;
      cell.style.whiteSpace = 'nowrap';
      const w = cell.scrollWidth + 16;
      cell.style.whiteSpace = oldWS;
      if (w > maxW) maxW = w;
    });
    const finalW = Math.min(600, Math.max(80, maxW));

    const colIndex = getColIndex(colId);
    if (colId === 'sno') {
      setColumnWidths(prev => ({ ...prev, sno: finalW }));
    } else if (colIndex !== -1) {
      const newCol = COLS_NEW[colIndex];
      const existCol = COLS_EXISTING[colIndex];
      setColumnWidths(prev => {
        const updated = { ...prev };
        if (newCol) updated[newCol.id] = finalW;
        if (existCol) updated[existCol.id] = finalW;
        return updated;
      });
    }
  }, [getColIndex]);

  const autoFitAll = React.useCallback(() => {
    if (!sheetRef.current) return;
    const updatedWidths = { ...columnWidths };

    // Fit S.No
    const snoCells = sheetRef.current.querySelectorAll('[data-col-id="sno"]');
    let maxSno = 40;
    snoCells.forEach(cell => {
      const oldWS = cell.style.whiteSpace;
      cell.style.whiteSpace = 'nowrap';
      const w = cell.scrollWidth + 12;
      cell.style.whiteSpace = oldWS;
      if (w > maxSno) maxSno = w;
    });
    updatedWidths.sno = Math.max(40, maxSno);

    // Fit other columns by index
    COLS_NEW.forEach((col, idx) => {
      const existCol = COLS_EXISTING[idx];

      // Query cells matching either column ID since they align vertically
      const newCells = sheetRef.current.querySelectorAll(`[data-col-id="${col.id}"]`);
      const existCells = existCol ? sheetRef.current.querySelectorAll(`[data-col-id="${existCol.id}"]`) : [];

      let maxW = 80;
      const processCell = cell => {
        const oldWS = cell.style.whiteSpace;
        cell.style.whiteSpace = 'nowrap';
        const w = cell.scrollWidth + 16;
        cell.style.whiteSpace = oldWS;
        if (w > maxW) maxW = w;
      };

      newCells.forEach(processCell);
      existCells.forEach(processCell);

      const finalW = Math.min(600, Math.max(80, maxW));
      updatedWidths[col.id] = finalW;
      if (existCol) updatedWidths[existCol.id] = finalW;
    });

    setColumnWidths(updatedWidths);
  }, [columnWidths]);


  // ── Existing Generic Lookup & Report State ──────────────────────────
  const [searchQuery, setSearchQuery] = React.useState('');
  const [genericSuggestions, setGenericSuggestions] = React.useState([]);
  const [selectedGeneric, setSelectedGeneric] = React.useState(null);
  const [fromDate, setFromDate] = React.useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3); // default 3 months ago
    return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = React.useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [reportRows, setReportRows] = React.useState([]);
  const [selectedReportRows, setSelectedReportRows] = React.useState([]);
  const [loadingReport, setLoadingReport] = React.useState(false);
  const [reportError, setReportError] = React.useState('');
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [dosageFilter, setDosageFilter] = React.useState('');
  const [dosageFormFilter, setDosageFormFilter] = React.useState('');

  const lookupRef = React.useRef(null);

  // Close autocomplete suggestions on click outside
  React.useEffect(() => {
    function handleClickOutside(e) {
      if (lookupRef.current && !lookupRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced autocomplete suggestions query
  React.useEffect(() => {
    if (!searchQuery.trim()) {
      setGenericSuggestions([]);
      return;
    }
    if (selectedGeneric && selectedGeneric.drug_gen_name === searchQuery) {
      return;
    }

    const handler = setTimeout(async () => {
      try {
        const res = await axios.get(`/api/generics/search?q=${encodeURIComponent(searchQuery)}`);
        setGenericSuggestions(res.data || []);
        setShowSuggestions(true);
      } catch (err) {
        console.error('Error searching generics:', err);
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [searchQuery, selectedGeneric]);

  // Robust date formatter
  const formatIntroducedDate = (val) => {
    if (!val) return '';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    } catch (e) {
      return String(val);
    }
  };

  const extractDosage = (name = '') => {
    const match = name.match(/(\d+(?:\.\d+)?\s*(?:mg|ml|mcg|g|iu|meg|%|units?))/i);
    return match ? match[1].trim().toLowerCase().replace(/\s+/, '') : null;
  };

  const extractDosageForm = (value = '') => {
    if (!value) return null;
    const v = value.trim();
    // Normalise known variants to canonical abbreviations
    const NORMALISE = [
      [/^inj(ection)?s?\.?$/i, 'Inj.'],
      [/^tab(let)?s?\.?$/i, 'Tab'],
      [/^cap(sule)?s?\.?$/i, 'Cap'],
      [/^syrup\.?$/i, 'Syrup'],
      [/^susp(ension)?n?\.?$/i, 'Suspn'],
      [/^oral\s*drops?\.?$/i, 'OralDrops'],
      [/^drops?\.?$/i, 'Drops'],
      [/^cream\.?$/i, 'Cream'],
      [/^ointment\.?$/i, 'Ointment'],
      [/^gel\.?$/i, 'Gel'],
      [/^lotion\.?$/i, 'Lotion'],
      [/^powder\.?$/i, 'Powder'],
      [/^granules?\.?$/i, 'Granules'],
      [/^sachet\.?$/i, 'Sachet'],
      [/^patch\.?$/i, 'Patch'],
      [/^inhaler?\.?$/i, 'Inhaler'],
      [/^spray\.?$/i, 'Spray'],
      [/^suppository\.?$/i, 'Suppository'],
      [/^solution\.?$/i, 'Solution'],
      [/^emulsion\.?$/i, 'Emulsion'],
    ];
    for (const [rx, label] of NORMALISE) {
      if (rx.test(v)) return label;
    }
    // Fallback: scan the raw string for embedded dosage-form keywords
    const SCAN = [
      [/\binjection\b/i, 'Inj.'], [/\binj\.?\b/i, 'Inj.'],
      [/\btablets?\b/i, 'Tab'], [/\btabs?\.?\b/i, 'Tab'],
      [/\bcapsules?\b/i, 'Cap'], [/\bcaps?\.?\b/i, 'Cap'],
      [/\bsyrup\b/i, 'Syrup'],
      [/\bsuspension\b/i, 'Suspn'], [/\bsuspn\b/i, 'Suspn'],
      [/\boral\s*drops?\b/i, 'OralDrops'],
      [/\bdrops?\b/i, 'Drops'],
      [/\bcream\b/i, 'Cream'],
      [/\bointment\b/i, 'Ointment'],
      [/\bgel\b/i, 'Gel'],
      [/\blotion\b/i, 'Lotion'],
      [/\bpowder\b/i, 'Powder'],
      [/\bsachet\b/i, 'Sachet'],
      [/\bpatch\b/i, 'Patch'],
      [/\binhaler?\b/i, 'Inhaler'],
      [/\bspray\b/i, 'Spray'],
      [/\bsolution\b/i, 'Solution'],
    ];
    for (const [rx, label] of SCAN) {
      if (rx.test(v)) return label;
    }
    // Return the raw value as-is (capitalised) if no pattern matches
    return v.charAt(0).toUpperCase() + v.slice(1);
  };

  const availableDosages = React.useMemo(() => {
    const set = new Set();
    reportRows.forEach(row => {
      const d = extractDosage(row.brand_name || row.BRAND_NAME || '');
      if (d) set.add(d);
    });
    return Array.from(set).sort();
  }, [reportRows]);

  const availableDosageForms = React.useMemo(() => {
    const set = new Set();
    reportRows.forEach(row => {
      const f = extractDosageForm(
        row.dosage_form ||
        row.DOSAGE_FORM ||
        row.pack ||
        row.PACK ||
        row.brand_name ||
        row.BRAND_NAME
      );
      if (f) set.add(f);
    });
    return Array.from(set).sort();
  }, [reportRows]);

  const filteredReportRows = React.useMemo(() => {
    return reportRows.filter(row => {
      const rowDosage = extractDosage(row.brand_name || row.BRAND_NAME || '');
      const rowForm = extractDosageForm(
        row.dosage_form ||
        row.DOSAGE_FORM ||
        row.pack ||
        row.PACK ||
        row.brand_name ||
        row.BRAND_NAME
      );

      const dosageMatch = !dosageFilter || rowDosage === dosageFilter;
      const formMatch = !dosageFormFilter || rowForm === dosageFormFilter;

      return dosageMatch && formMatch;
    });
  }, [reportRows, dosageFilter, dosageFormFilter]);

  const handleSearchReport = async () => {
    if (!selectedGeneric) {
      alert('Please select a generic drug from the autocomplete dropdown list.');
      return;
    }
    setLoadingReport(true);
    setReportError('');
    setReportRows([]);
    setSelectedReportRows([]);
    try {
      const formattedFrom = fromDate.split('-').reverse().join('/') + ' 00:00:00';
      const formattedTo = toDate.split('-').reverse().join('/') + ' 23:59:59';
      const res = await axios.post('/api/reports/item-margin-report', {
        fromDate: formattedFrom,
        toDate: formattedTo,
        genericId: selectedGeneric.drug_gen_id
      });
      setReportRows(res.data || []);
    } catch (err) {
      console.error('Error fetching item margin report:', err);
      setReportError(err.response?.data?.error || err.response?.data?.detail || 'Failed to fetch report.');
    } finally {
      setLoadingReport(false);
    }
  };

  const handleImportSelected = () => {
    if (selectedReportRows.length === 0) {
      alert('Please select at least one row to import.');
      return;
    }

    const mappedRows = selectedReportRows.map(row => ({
      introduced_on: formatIntroducedDate(row.introduced_on),
      brand_name: row.brand_name || '',
      manufacturer: row.manufacturer || '',
      marketer: row.marketer || '',
      consultant: row.consultant || '',
      present_stock: row.present_stock ?? '',
      purchase_qty: row.purchase_quantity ?? '',
      sale_qty: row.sale_qty ?? '',
      pack: row.pack || '',
      mrp_inc_gst_nos: row.mrp_incl_gst ?? '',
      rate_inc_gst_nos: row.rate_incl_gst ?? '',
      markup_margin: row.total_margin_markup ?? '',
      scheme_qty: row.scheme_qty ?? '',
      scheme_offer: row.offer_qty ?? '',
      net_rate: row.net_rate ?? '',
      profit_margin: row.profit_margin ?? '',
      absolute_margin: row.absolute_margin ?? '',
      total_margin: row.total_margin_markup ?? '',
      remark: row.remarks || '',
    }));

    let nextDetails = [];
    const isOnlyEmptyRow = existingDetails.length === 1 && Object.values(existingDetails[0]).every(v => v === '');
    if (isOnlyEmptyRow) {
      nextDetails = mappedRows;
    } else {
      nextDetails = [...existingDetails, ...mappedRows];
    }

    setExistingDetails(nextDetails);
    lastPropRef.current = nextDetails;
    if (onExistingDetailsChange) {
      onExistingDetailsChange(nextDetails);
    }

    setSelectedReportRows([]);
    alert(`Successfully imported ${mappedRows.length} brand(s) into the Existing Details section.`);
  };

  const touchStartDist = React.useRef(0);
  const touchStartZoom = React.useRef(0.8);

  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDist.current = dist;
      touchStartZoom.current = zoom;
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && touchStartDist.current > 0) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = dist / touchStartDist.current;
      let nextZoom = touchStartZoom.current * factor;
      nextZoom = Math.min(Math.max(nextZoom, 0.4), 1.6);
      setZoom(nextZoom);
    }
  };

  const handleTouchEnd = () => {
    touchStartDist.current = 0;
  };


  const fitToScreen = React.useCallback(() => {
    const container = wrapperRef.current;
    const content = sheetRef.current;
    if (!container || !content) return;

    const scaleX = (container.clientWidth - 40) / content.scrollWidth;
    const scaleY = (container.clientHeight - 40) / content.scrollHeight;

    let nextScale = Math.min(scaleX, scaleY);
    if (nextScale < 0.4) nextScale = 0.4;
    if (nextScale > 1.2) nextScale = 1.2;

    setZoom(nextScale);
  }, []);

  const zoomToFullWidth = React.useCallback(() => {
    const container = wrapperRef.current;
    const content = sheetRef.current;
    if (!container || !content) return;

    const scaleX = (container.clientWidth - 40) / content.scrollWidth;
    let nextScale = scaleX;
    if (nextScale < 0.4) nextScale = 0.4;
    if (nextScale > 1.2) nextScale = 1.2;

    setZoom(nextScale);
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      fitToScreen();
    }, 150);

    window.addEventListener('resize', fitToScreen);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', fitToScreen);
    };
  }, [fitToScreen]);

  const downloadPDF = async () => {
    const input = sheetRef.current;
    if (!input) return;

    const originalZoom = zoom;
    setZoom(1.0);
    await new Promise(resolve => setTimeout(resolve, 200));

    try {
      const canvas = await html2canvas(input, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('landscape', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Comparison_Sheet_${requestInfo.REQUEST_ID || 'Request'}.pdf`);
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('Error generating PDF. Please try again.');
    } finally {
      setZoom(originalZoom);
    }
  };

  // Local state for Existing Details rows
  const [existingDetails, setExistingDetails] = React.useState([]);
  const lastPropRef = React.useRef(null);
  const prevExistingKeyRef = React.useRef('');

  React.useEffect(() => {
    const key = JSON.stringify({ propExistingDetails, existingGenericData });
    if (prevExistingKeyRef.current !== key) {
      prevExistingKeyRef.current = key;
      let target = [];
      if (propExistingDetails && propExistingDetails.length > 0) {
        lastPropRef.current = propExistingDetails;
        target = propExistingDetails.map(row => ({
          introduced_on: row.INTRODUCED_ON ?? row.introduced_on ?? '',
          brand_name: row.BRAND_NAME ?? row.brand_name ?? '',
          manufacturer: row.MANUFACTURER ?? row.manufacturer ?? '',
          marketer: row.MARKETER ?? row.marketer ?? '',
          consultant: row.CONSULTANT ?? row.consultant ?? '',
          present_stock: row.PRESENT_STOCK ?? row.present_stock ?? '',
          purchase_qty: row.PURCHASE_QTY ?? row.purchase_qty ?? '',
          sale_qty: row.SALE_QTY ?? row.sale_qty ?? '',
          pack: row.PACK ?? row.pack ?? '',
          mrp_inc_gst_nos: row.MRP_INC_GST_NOS ?? row.mrp_inc_gst_nos ?? '',
          rate_inc_gst_nos: row.RATE_INC_GST_NOS ?? row.rate_inc_gst_nos ?? '',
          markup_margin: row.MARKUP_MARGIN ?? row.markup_margin ?? '',
          scheme_qty: row.SCHEME_QTY ?? row.scheme_qty ?? '',
          scheme_offer: row.SCHEME_OFFER ?? row.scheme_offer ?? '',
          net_rate: row.NET_RATE ?? row.net_rate ?? '',
          profit_margin: row.PROFIT_MARGIN ?? row.profit_margin ?? '',
          absolute_margin: row.ABSOLUTE_MARGIN ?? row.absolute_margin ?? '',
          total_margin: row.TOTAL_MARGIN ?? row.total_margin ?? '',
          remark: row.REMARK ?? row.remark ?? '',
        }));
      } else if (existingGenericData && Object.keys(existingGenericData).length > 0 && existingGenericData.existing_brand_name) {
        target = [{
          introduced_on: existingGenericData.existing_introduced_on || '',
          brand_name: existingGenericData.existing_brand_name || '',
          manufacturer: existingGenericData.existing_manufacturer || '',
          marketer: existingGenericData.existing_marketer || '',
          consultant: '',
          present_stock: existingGenericData.existing_stock || existingGenericData.existing_present_stock || '',
          purchase_qty: existingGenericData.existing_purchase_qty || '',
          sale_qty: existingGenericData.existing_sale_qty || '',
          pack: existingGenericData.existing_pack || '',
          mrp_inc_gst_nos: existingGenericData.existing_mrp || existingGenericData.existing_mrp_inc_gst_nos || '',
          rate_inc_gst_nos: existingGenericData.existing_rate || existingGenericData.existing_rate_inc_gst_nos || '',
          markup_margin: existingGenericData.existing_markup_margin || '',
          scheme_qty: existingGenericData.existing_qty || '',
          scheme_offer: existingGenericData.existing_offer || '',
          net_rate: existingGenericData.existing_net_rate || '',
          profit_margin: existingGenericData.existing_profit_margin || '',
          absolute_margin: existingGenericData.existing_absolute_margin || existingGenericData.existing_abs_margin || '',
          total_margin: existingGenericData.existing_total_margin || '',
          remark: existingGenericData.existing_drug_details || '',
        }];
      } else {
        target = [createExistingRow()];
      }

      setExistingDetails(prev => {
        if (JSON.stringify(prev) === JSON.stringify(target)) return prev;
        return target;
      });
    }
  }, [propExistingDetails, existingGenericData]);

  const updateExistingRow = (idx, field, val) => {
    const updated = existingDetails.map((row, i) => {
      if (i === idx) {
        return { ...row, [field]: val };
      }
      return row;
    });
    setExistingDetails(updated);
    lastPropRef.current = updated;
    if (onExistingDetailsChange) {
      onExistingDetailsChange(updated);
    }
  };

  const addExistingRow = () => {
    const next = [...existingDetails, createExistingRow()];
    setExistingDetails(next);
    lastPropRef.current = next;
    if (onExistingDetailsChange) {
      onExistingDetailsChange(next);
    }
  };

  const removeExistingRow = (idx) => {
    if (existingDetails.length <= 1) return;
    const next = existingDetails.filter((_, i) => i !== idx);
    setExistingDetails(next);
    lastPropRef.current = next;
    if (onExistingDetailsChange) {
      onExistingDetailsChange(next);
    }
  };

  // Local state for DTC selection/recommendation fields
  const [localSelectedBrand, setLocalSelectedBrand] = React.useState(finalSelectedBrand || requestInfo.FINAL_SELECTED_BRAND || dtcSelectedBrand || requestInfo.DTC_SELECTED_BRAND || '');
  const [localSelectedCategory, setLocalSelectedCategory] = React.useState(finalSelectedCategory || requestInfo.FINAL_SELECTED_CATEGORY || dtcSelectedCategory || requestInfo.DTC_SELECTED_CATEGORY || '');
  const [localSelectionReasons, setLocalSelectionReasons] = React.useState([]);
  const [localRecommendationNotes, setLocalRecommendationNotes] = React.useState(finalRecommendationNotes || requestInfo.FINAL_RECOMMENDATION_NOTES || dtcRecommendationNotes || requestInfo.DTC_RECOMMENDATION_NOTES || '');
  const [localDtcReviewedByName, setLocalDtcReviewedByName] = React.useState(dtcReviewedByName || requestInfo.DTC_REVIEWED_BY_NAME || '');
  const [localDtcReviewSignature, setLocalDtcReviewSignature] = React.useState(dtcReviewSignature || requestInfo.DTC_REVIEW_SIGNATURE || '');
  const [localDtcRemarks, setLocalDtcRemarks] = React.useState(dtcRemarks || requestInfo.DTC_REMARKS || requestInfo.DTC_FINAL_REMARKS || '');
  const [localFinalRecommendations, setLocalFinalRecommendations] = React.useState(dtcFinalRecommendations || []);

  const prevDtcKeyRef = React.useRef('');

  React.useEffect(() => {
    const serializedKey = JSON.stringify({
      dtcFinalRecommendations,
      finalSelectedBrand,
      dtcSelectedBrand,
      finalSelectedCategory,
      dtcSelectedCategory,
      finalSelectionReasons,
      dtcSelectionReasons,
      finalRecommendationNotes,
      dtcRecommendationNotes,
      dtcReviewedByName,
      dtcReviewSignature,
      dtcRemarks,
      requestInfoBrandName: requestInfo.BRAND_NAME,
      requestInfoFinalSelectedBrand: requestInfo.FINAL_SELECTED_BRAND,
      requestInfoDtcSelectedBrand: requestInfo.DTC_SELECTED_BRAND,
      requestInfoFinalSelectedCategory: requestInfo.FINAL_SELECTED_CATEGORY,
      requestInfoDtcSelectedCategory: requestInfo.DTC_SELECTED_CATEGORY,
      requestInfoFinalSelectionReasons: requestInfo.FINAL_SELECTION_REASONS,
      requestInfoDtcSelectionReasons: requestInfo.DTC_SELECTION_REASONS,
      requestInfoFinalRecommendationNotes: requestInfo.FINAL_RECOMMENDATION_NOTES,
      requestInfoDtcRecommendationNotes: requestInfo.DTC_RECOMMENDATION_NOTES,
      requestInfoDtcReviewedByName: requestInfo.DTC_REVIEWED_BY_NAME,
      requestInfoDtcReviewSignature: requestInfo.DTC_REVIEW_SIGNATURE,
      requestInfoDtcRemarks: requestInfo.DTC_REMARKS,
      requestInfoDtcFinalRemarks: requestInfo.DTC_FINAL_REMARKS,
      requestInfoDtcFinalRecommendations: requestInfo.DTC_FINAL_RECOMMENDATIONS,
      requestInfoDtcFinalRecommendationsLower: requestInfo.dtc_final_recommendations,
      alternativesMapping: alternatives.map(a => ({
        brand_name: a.brand_name || a.BRAND_NAME,
        alt_id: a.alt_id || a.ALT_ID
      }))
    });

    if (prevDtcKeyRef.current !== serializedKey) {
      prevDtcKeyRef.current = serializedKey;

      const brand = finalSelectedBrand || requestInfo.FINAL_SELECTED_BRAND || dtcSelectedBrand || requestInfo.DTC_SELECTED_BRAND || '';
      const category = finalSelectedCategory || requestInfo.FINAL_SELECTED_CATEGORY || dtcSelectedCategory || requestInfo.DTC_SELECTED_CATEGORY || '';
      const notes = finalRecommendationNotes || requestInfo.FINAL_RECOMMENDATION_NOTES || dtcRecommendationNotes || requestInfo.DTC_RECOMMENDATION_NOTES || '';
      const reviewedByName = dtcReviewedByName || requestInfo.DTC_REVIEWED_BY_NAME || '';
      const reviewSignature = dtcReviewSignature || requestInfo.DTC_REVIEW_SIGNATURE || '';
      const remarksVal = dtcRemarks || requestInfo.DTC_REMARKS || requestInfo.DTC_FINAL_REMARKS || '';

      setLocalSelectedBrand(brand);
      setLocalSelectedCategory(category);
      setLocalRecommendationNotes(notes);
      setLocalDtcReviewedByName(reviewedByName);
      setLocalDtcReviewSignature(reviewSignature);
      setLocalDtcRemarks(remarksVal);

      let reasons = [];
      const srcReasons = finalSelectionReasons && finalSelectionReasons.length > 0 ? finalSelectionReasons : (requestInfo.FINAL_SELECTION_REASONS || dtcSelectionReasons || requestInfo.DTC_SELECTION_REASONS);
      if (srcReasons) {
        if (Array.isArray(srcReasons)) {
          reasons = srcReasons;
        } else if (typeof srcReasons === 'string') {
          try {
            reasons = JSON.parse(srcReasons);
          } catch {
            reasons = srcReasons.split(',').map(r => r.trim()).filter(Boolean);
          }
        }
      }
      setLocalSelectionReasons(prev => {
        if (JSON.stringify(prev) === JSON.stringify(reasons)) return prev;
        return reasons;
      });

      let recs = [];
      if (dtcFinalRecommendations && dtcFinalRecommendations.length > 0) {
        recs = dtcFinalRecommendations;
      } else if (requestInfo.DTC_FINAL_RECOMMENDATIONS) {
        try {
          recs = JSON.parse(requestInfo.DTC_FINAL_RECOMMENDATIONS);
        } catch (e) {
          console.error(e);
        }
      } else if (requestInfo.dtc_final_recommendations) {
        try {
          recs = JSON.parse(requestInfo.dtc_final_recommendations);
        } catch (e) {
          console.error(e);
        }
      } else {
        if (brand) {
          const isOriginal = brand === requestInfo.BRAND_NAME;
          const matchedAlt = alternatives.find(a => (a.brand_name || a.BRAND_NAME) === brand);
          const altId = matchedAlt ? (matchedAlt.alt_id || matchedAlt.ALT_ID) : null;
          recs = [{
            brand_name: brand,
            category: category || 'FORMULARY',
            reasons: reasons,
            is_original: isOriginal,
            alternative_id: altId
          }];
        }
      }
      setLocalFinalRecommendations(prev => {
        if (JSON.stringify(prev) === JSON.stringify(recs)) return prev;
        return recs;
      });
    }
  }, [dtcFinalRecommendations, finalSelectedBrand, dtcSelectedBrand, finalSelectedCategory, dtcSelectedCategory, finalSelectionReasons, dtcSelectionReasons, finalRecommendationNotes, dtcRecommendationNotes, dtcReviewedByName, dtcReviewSignature, dtcRemarks, requestInfo, alternatives]);

  const handleBrandChange = (val) => {
    setLocalSelectedBrand(val);
    if (onFinalSelectedBrandChange) onFinalSelectedBrandChange(val);
    if (onDtcSelectedBrandChange) onDtcSelectedBrandChange(val);
  };

  const handleCategoryChange = (val) => {
    setLocalSelectedCategory(val);
    if (onFinalSelectedCategoryChange) onFinalSelectedCategoryChange(val);
    if (onDtcSelectedCategoryChange) onDtcSelectedCategoryChange(val);
  };

  const handleReasonToggle = (reason) => {
    const next = localSelectionReasons.includes(reason)
      ? localSelectionReasons.filter(r => r !== reason)
      : [...localSelectionReasons, reason];
    setLocalSelectionReasons(next);
    if (onFinalSelectionReasonsChange) onFinalSelectionReasonsChange(next);
    if (onDtcSelectionReasonsChange) onDtcSelectionReasonsChange(next);
  };

  const handleNotesChange = (val) => {
    setLocalRecommendationNotes(val);
    if (onFinalRecommendationNotesChange) onFinalRecommendationNotesChange(val);
    if (onDtcRecommendationNotesChange) onDtcRecommendationNotesChange(val);
  };

  const handleReviewedByNameChange = (val) => {
    setLocalDtcReviewedByName(val);
    if (onDtcReviewedByNameChange) onDtcReviewedByNameChange(val);
  };

  const handleReviewSignatureChange = (val) => {
    setLocalDtcReviewSignature(val);
    if (onDtcReviewSignatureChange) onDtcReviewSignatureChange(val);
  };

  const handleDtcRemarksChange = (val) => {
    setLocalDtcRemarks(val);
    if (onDtcRemarksChange) onDtcRemarksChange(val);
  };

  // ── State updaters ────────────────────────────────────────────────
  const updateAlt = (i, field, val) => {
    if (!onAlternativesChange) return;
    onAlternativesChange(alternatives.map((a, idx) => idx === i ? { ...a, [field]: val } : a));
  };

  const updateExisting = (field, val) => {
    if (!onExistingChange) return;
    onExistingChange({ ...existingGenericData, [field]: val });
  };

  const getVal = (obj, key) => obj?.[key] ?? '';

  const candidates = React.useMemo(() => {
    const list = [];
    if (requestInfo.BRAND_NAME) {
      list.push({
        brand_name: requestInfo.BRAND_NAME,
        manufacturer: requestInfo.MANUFACTURER,
        marketer: requestInfo.MARKETER,
        is_original: true,
        alternative_id: null
      });
    }
    alternatives.forEach(alt => {
      list.push({
        brand_name: alt.brand_name || alt.BRAND_NAME,
        manufacturer: alt.manufacturer || alt.MANUFACTURER,
        marketer: alt.marketer || alt.MARKETER,
        is_original: false,
        alternative_id: alt.alt_id || alt.ALT_ID
      });
    });
    return list;
  }, [requestInfo, alternatives]);

  const handleAddRecommendation = () => {
    const next = [
      ...localFinalRecommendations,
      {
        brand_name: '',
        category: 'FORMULARY',
        reasons: [],
        notes: '',
        remarks: '',
        alternative_id: null,
        is_original: false,
        manufacturer: '',
        marketer: ''
      }
    ];
    setLocalFinalRecommendations(next);
    if (onDtcFinalRecommendationsChange) onDtcFinalRecommendationsChange(next);
  };

  const handleRemoveRecommendation = (index) => {
    const next = localFinalRecommendations.filter((_, idx) => idx !== index);
    setLocalFinalRecommendations(next);
    if (onDtcFinalRecommendationsChange) onDtcFinalRecommendationsChange(next);
  };

  const handleUpdateRecommendation = (index, field, value) => {
    const next = localFinalRecommendations.map((rec, idx) => {
      if (idx === index) {
        if (field === 'brand_name') {
          const cand = candidates.find(c => c.brand_name === value);
          if (cand) {
            return {
              ...rec,
              brand_name: cand.brand_name,
              manufacturer: cand.manufacturer,
              marketer: cand.marketer,
              is_original: cand.is_original,
              alternative_id: cand.alternative_id
            };
          } else {
            return {
              ...rec,
              brand_name: '',
              manufacturer: '',
              marketer: '',
              is_original: false,
              alternative_id: null
            };
          }
        }
        return { ...rec, [field]: value };
      }
      return rec;
    });
    setLocalFinalRecommendations(next);
    if (onDtcFinalRecommendationsChange) onDtcFinalRecommendationsChange(next);
  };

  const renderRecommendationBlock = () => {
    return (
      <div style={{ padding: '16px 20px', background: '#ffffff', width: '100%' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          borderBottom: '2px solid #fbbf24',
          paddingBottom: 4,
        }}>
          <span style={{
            fontSize: '0.82rem',
            fontWeight: 800,
            color: '#d97706',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Final Recommendation Panel
          </span>
          {mode === 'dtc' && (
            <button
              type="button"
              onClick={handleAddRecommendation}
              style={{
                background: '#d97706',
                color: '#fff',
                border: 'none',
                padding: '4px 10px',
                borderRadius: 4,
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                boxShadow: '0 2px 4px rgba(217,119,6,0.2)',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#b45309'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#d97706'}
            >
              + Add
            </button>
          )}
        </div>

        {mode === 'dtc' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
            {localFinalRecommendations.length === 0 ? (
              <div style={{
                padding: '24px 16px',
                background: '#f8fafc',
                border: '2px dashed #cbd5e1',
                borderRadius: 8,
                textAlign: 'center',
                color: '#64748b',
                fontStyle: 'italic',
                fontSize: '0.85rem'
              }}>
                No final recommendations added. Click the "+ Add" button above to add a recommendation.
              </div>
            ) : (
              localFinalRecommendations.map((rec, idx) => (
                <div key={idx} style={{
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  padding: '16px',
                  background: '#ffffff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  position: 'relative',
                  borderLeft: '4px solid #2563eb'
                }}>
                  {/* Header of the Card */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontWeight: 800, fontSize: '0.85rem', color: '#1e3a5f' }}>
                      Recommendation #{idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveRecommendation(idx)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#dc2626',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 6px',
                        borderRadius: 4,
                        transition: 'background-color 0.2s'
                      }}
                      onMouseEnter={(e) => e.target.style.backgroundColor = '#fee2e2'}
                      onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                    >
                      ✕ Remove
                    </button>
                  </div>

                  {/* Brand Selector */}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                      RECOMMENDED BRAND
                    </label>
                    <select
                      value={rec.brand_name || ''}
                      onChange={(e) => handleUpdateRecommendation(idx, 'brand_name', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        fontSize: '0.8rem',
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                        outline: 'none',
                        background: '#f8fafc',
                        color: '#1e293b',
                        fontWeight: 600
                      }}
                    >
                      <option value="">-- Select Recommended Brand --</option>
                      {candidates.map((cand, cIdx) => (
                        <option key={cIdx} value={cand.brand_name}>
                          {cand.brand_name} ({cand.manufacturer || 'Unknown Manufacturer'}) {cand.is_original ? ' [Original]' : ' [Alternative]'}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Category Selector */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569' }}>SELECT AS:</span>
                    <div style={{ display: 'flex', gap: 16 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}>
                        <input
                          type="radio"
                          name={`category-${idx}`}
                          value="FORMULARY"
                          checked={rec.category === 'FORMULARY'}
                          onChange={() => handleUpdateRecommendation(idx, 'category', 'FORMULARY')}
                          style={{ accentColor: '#2563eb' }}
                        />
                        Formulary
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}>
                        <input
                          type="radio"
                          name={`category-${idx}`}
                          value="NON_FORMULARY"
                          checked={rec.category === 'NON_FORMULARY'}
                          onChange={() => handleUpdateRecommendation(idx, 'category', 'NON_FORMULARY')}
                          style={{ accentColor: '#2563eb' }}
                        />
                        Non-Formulary
                      </label>
                    </div>
                  </div>

                  {/* Reasons Checklist */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: 6 }}>REASON(S) FOR SELECTION:</div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '6px 12px',
                      background: '#f8fafc',
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid #cbd5e1'
                    }}>
                      {REASON_OPTIONS.map(reason => {
                        const isReasonChecked = rec.reasons?.includes(reason);
                        return (
                          <label key={reason} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.72rem', cursor: 'pointer', userSelect: 'none', marginBottom: 0, fontWeight: 500 }}>
                            <input
                              type="checkbox"
                              checked={isReasonChecked}
                              onChange={() => {
                                const nextReasons = isReasonChecked
                                  ? rec.reasons.filter(r => r !== reason)
                                  : [...(rec.reasons || []), reason];
                                handleUpdateRecommendation(idx, 'reasons', nextReasons);
                              }}
                              style={{ accentColor: '#2563eb' }}
                            />
                            {reason}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Notes Textarea */}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                      RECOMMENDATION NOTES
                    </label>
                    <textarea
                      value={rec.notes || ''}
                      onChange={(e) => handleUpdateRecommendation(idx, 'notes', e.target.value)}
                      placeholder="Enter specific notes for this recommended brand..."
                      rows={2}
                      style={{
                        width: '100%',
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        padding: '6px 10px',
                        fontSize: '0.8rem',
                        resize: 'vertical',
                        outline: 'none',
                        background: '#f8fafc'
                      }}
                    />
                  </div>

                  {/* Remarks Input */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                      REMARKS
                    </label>
                    <input
                      type="text"
                      value={rec.remarks || ''}
                      onChange={(e) => handleUpdateRecommendation(idx, 'remarks', e.target.value)}
                      placeholder="Enter remarks..."
                      style={{
                        width: '100%',
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        padding: '6px 10px',
                        fontSize: '0.8rem',
                        outline: 'none',
                        background: '#f8fafc'
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            {localFinalRecommendations.length === 0 ? (
              <div style={{ padding: '12px 16px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8, textAlign: 'center', color: '#64748b', fontStyle: 'italic', fontSize: '0.8rem' }}>
                No final recommendations made yet.
              </div>
            ) : (
              localFinalRecommendations.map((rec, idx) => (
                <div key={idx} style={{
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  padding: '12px 16px',
                  background: '#f8fafc',
                  borderLeft: '4px solid #475569'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1e3a5f' }}>
                      💊 {rec.brand_name} <span style={{ fontWeight: 400, color: '#64748b' }}>({rec.manufacturer || '—'})</span>
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span style={{
                        fontSize: '0.68rem', fontWeight: 700, borderRadius: 12, padding: '2px 8px',
                        background: rec.category === 'FORMULARY' ? '#ecfdf5' : '#fef2f2',
                        color: rec.category === 'FORMULARY' ? '#065f46' : '#991b1b'
                      }}>
                        {rec.category === 'FORMULARY' ? 'Formulary' : 'Non-Formulary'}
                      </span>
                      {rec.is_original && (
                        <span style={{ fontSize: '0.68rem', background: '#dcfce7', color: '#166534', borderRadius: 12, padding: '2px 8px', fontWeight: 600 }}>Original</span>
                      )}
                    </div>
                  </div>
                  {rec.reasons && rec.reasons.length > 0 && (
                    <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: 4 }}>
                      <strong>Reasons:</strong> {rec.reasons.join(', ')}
                    </div>
                  )}
                  {rec.notes && (
                    <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: 4 }}>
                      <strong>Notes:</strong> {rec.notes}
                    </div>
                  )}
                  {rec.remarks && (
                    <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: 4 }}>
                      <strong>Remarks:</strong> {rec.remarks}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Notes / Rationale */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1e3a5f', marginBottom: 6 }}>
            RECOMMENDATION NOTES / DTC RATIONALE:
          </div>
          {mode === 'dtc' ? (
            <ApprovalRemarksPanel
              role="DTC"
              value={localRecommendationNotes}
              onChange={handleNotesChange}
              placeholder="Enter final recommendation notes..."
              rows={2}
              hidePredefined={true}
              hideRecent={true}
            />
          ) : mode === 'pharmacy_head' ? (
            <textarea
              value={dtcRecommendationNotes}
              onChange={e => onDtcRecommendationNotesChange && onDtcRecommendationNotesChange(e.target.value)}
              style={{
                width: '100%', border: '1px solid #ddd6fe', borderRadius: 6,
                padding: '6px 10px', fontSize: '0.8rem', resize: 'vertical', minHeight: 60,
                outline: 'none', background: '#faf5ff',
              }}
              placeholder="Suggest selection notes or justification for DTC's final review..."
            />
          ) : (
            <div style={{
              border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px',
              fontSize: '0.8rem', color: '#334155', minHeight: 40, background: '#f8fafc',
              whiteSpace: 'pre-wrap',
            }}>
              {requestInfo.DTC_RECOMMENDATION_NOTES || dtcRecommendationNotes || '—'}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (

    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#e5e7eb', display: 'flex', flexDirection: 'column',
    }}>

      {/* ── Top action bar ── */}
      <div style={{
        background: mode === 'pharmacy_head' ? '#7c3aed' : '#1e3a5f',
        color: '#fff', padding: '10px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {onBack && (
            <button onClick={onBack} style={{
              background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
              color: '#fff', padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem',
            }}>← Back</button>
          )}
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
              📊 Comparison Sheet
              {mode === 'pharmacy_head' && (
                <span style={{ marginLeft: 10, fontSize: '0.75rem', background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: 4 }}>
                  Pharmacy Head Review
                </span>
              )}
              {mode === 'readonly' && (
                <span style={{ marginLeft: 10, fontSize: '0.75rem', background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: 4 }}>
                  Read Only
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.72rem', opacity: 0.8 }}>
              {isExisting ? 'Existing Generic' : 'New Generic'} • {requestInfo.BRAND_NAME} ({requestInfo.GENERIC_NAME || requestInfo.REQUEST_ID})
            </div>
            {requestInfo.FORMULARY_REQUEST_TYPE && (
              <div style={{ fontSize: '0.75rem', color: '#fbbf24', marginTop: 2, fontWeight: 700 }}>
                Request Classification: {requestInfo.FORMULARY_REQUEST_TYPE === 'FORMULARY' ? 'Formulary Drug Addition Request' : 'Non-Formulary Drug Request'}
              </div>
            )}
          </div>
        </div>

        {/* Action & Zoom buttons */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Zoom Toolbar */}
          <div className="sheet-toolbar" style={{
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.12)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: 8,
            padding: '2px 8px',
            gap: 6
          }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'rgba(255, 255, 255, 0.9)', padding: '0 4px' }}>
              Zoom: {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom(z => Math.min(z + 0.1, 2.0))}
              title="Zoom In"
              style={{
                background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px 8px', fontSize: '0.85rem', fontWeight: 'bold'
              }}
            >
              ＋
            </button>
            <button
              type="button"
              onClick={() => setZoom(z => Math.max(z - 0.1, 0.4))}
              title="Zoom Out"
              style={{
                background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px 8px', fontSize: '0.85rem', fontWeight: 'bold'
              }}
            >
              －
            </button>
            <button
              type="button"
              onClick={() => setZoom(0.8)}
              title="Reset Zoom"
              style={{
                background: 'rgba(255, 255, 255, 0.1)', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600
              }}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={fitToScreen}
              title="Fit to Screen"
              style={{
                background: 'rgba(255, 255, 255, 0.1)', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600
              }}
            >
              Fit Screen
            </button>
            <button
              type="button"
              onClick={zoomToFullWidth}
              title="Full Width"
              style={{
                background: 'rgba(255, 255, 255, 0.1)', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600
              }}
            >
              Full Width
            </button>
            <button
              type="button"
              onClick={autoFitAll}
              title="Auto Fit Columns"
              style={{
                background: 'rgba(255, 255, 255, 0.1)', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600
              }}
            >
              Auto Fit
            </button>
          </div>

          {/* Download Button (DTC mode or read-only view) */}
          {(mode === 'dtc' || mode === 'readonly') && (
            <button
              type="button"
              onClick={downloadPDF}
              style={{
                background: '#10b981',
                border: 'none',
                color: '#fff',
                padding: '8px 16px',
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 6px rgba(16,185,129,0.2)'
              }}
            >
              📥 Download Comparison Sheet
            </button>
          )}

          {/* Pharmacist: single submit */}
          {mode === 'pharmacist' && onSubmit && (
            <button onClick={() => onSubmit && onSubmit(existingDetails)} disabled={submitting} style={{
              background: submitting ? '#4b5563' : '#10b981',
              border: 'none', color: '#fff', padding: '8px 22px', borderRadius: 8,
              cursor: submitting ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.85rem',
            }}>
              {submitting ? '⏳ Submitting…' : (isCorrectionMode ? '✅ Re-Submit Corrections to Pharmacy Head' : '✅ Submit & Forward to Pharmacy Head')}
            </button>
          )}

          {/* PharmacyHead: Save + Forward to DTC */}
          {mode === 'pharmacy_head' && (
            <>
              {onSave && (
                <button onClick={onSave} disabled={saving || forwarding} style={{
                  background: saving ? '#4b5563' : '#0ea5e9',
                  border: 'none', color: '#fff', padding: '8px 18px', borderRadius: 8,
                  cursor: (saving || forwarding) ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.82rem',
                }}>
                  {saving ? '⏳ Saving…' : '💾 Save Updates'}
                </button>
              )}
              {onForwardToDTC && (
                <button onClick={onForwardToDTC} disabled={saving || forwarding} style={{
                  background: (saving || forwarding) ? '#4b5563' : '#10b981',
                  border: 'none', color: '#fff', padding: '8px 22px', borderRadius: 8,
                  cursor: (saving || forwarding) ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.85rem',
                }}>
                  {forwarding ? '⏳ Forwarding…' : '🚀 Forward to DTC'}
                </button>
              )}
            </>
          )}

          {/* DTC: Confirm & Forward to CEO */}
          {mode === 'dtc' && onDtcFinalize && (
            <button
              onClick={() => onDtcFinalize({
                recommendations: localFinalRecommendations,
                notes: localRecommendationNotes,
                reviewed_by_name: localDtcReviewedByName,
                review_signature: localDtcReviewSignature,
                dtc_remarks: localDtcRemarks
              })}
              disabled={finalizing}
              style={{
                background: finalizing ? '#4b5563' : '#2563eb',
                border: 'none', color: '#fff', padding: '8px 22px', borderRadius: 8,
                cursor: finalizing ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.85rem',
                boxShadow: '0 4px 12px rgba(37,99,235,0.25)',
              }}
            >
              {finalizing ? '⏳ Processing…' : '🏆 Confirm Selection & Forward to CEO'}
            </button>
          )}
        </div>
      </div>

      {/* ── Mobile-Only Toolbar ── */}
      <div className="mobile-only-toolbar">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setZoom(z => Math.max(z - 0.1, 0.4))} style={{ padding: '6px 12px', borderRadius: 4, background: '#4a5568', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>🔎 Out</button>
          <span style={{ fontWeight: 600, minWidth: 40, textAlign: 'center', color: '#fff' }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(z + 0.1, 1.5))} style={{ padding: '6px 12px', borderRadius: 4, background: '#4a5568', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>🔍 In</button>
        </div>
        <button
          onClick={downloadPDF}
          style={{
            background: '#10b981',
            border: 'none',
            color: '#fff',
            padding: '5px 12px',
            borderRadius: 4,
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          📥 Download
        </button>
        <div style={{ color: '#a0aec0', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem' }}>
          <span>↔</span> <span>Scroll Table</span>
        </div>
      </div>

      {/* ── Scrollable sheet body ── */}
      <div
        ref={wrapperRef}
        className="comparison-sheet-wrapper"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          width: '100%',
          height: 'calc(100vh - 120px)',
          overflow: 'auto',
          position: 'relative',
          background: '#f4f7fb',
          padding: 20,
          flex: 1,
        }}
      >
        {mode === 'pharmacist' && isExisting && (
          <div style={{
            background: '#ffffff',
            border: '1.5px solid #cbd5e1',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '24px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
            width: '100%',
            maxWidth: '1400px',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                🔍 Formulary Drug Report Explorer (Lookup & Import)
              </h3>
              <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>
                Search existing generic drug report in HIS and import to comparison sheet
              </span>
            </div>

            {/* Inputs Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '16px', alignItems: 'end', marginBottom: '16px' }}>
              {/* Autocomplete Input */}
              <div style={{ position: 'relative' }} ref={lookupRef}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>Search Generic Drug *</label>
                <input
                  type="text"
                  placeholder="Type generic name (e.g. PARACETAMOL)..."
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value);
                    setShowSuggestions(true);
                    if (selectedGeneric && selectedGeneric.drug_gen_name !== e.target.value) {
                      setSelectedGeneric(null);
                    }
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: '0.82rem',
                    borderRadius: '8px',
                    border: '1.5px solid #cbd5e1',
                    outline: 'none',
                    background: '#fff',
                  }}
                />

                {/* Suggestions Autocomplete List */}
                {showSuggestions && genericSuggestions.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: '#fff',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                    zIndex: 100,
                    maxHeight: '180px',
                    overflowY: 'auto',
                    marginTop: '4px',
                  }}>
                    {genericSuggestions.map((item) => (
                      <div
                        key={item.drug_gen_id}
                        onClick={() => {
                          setSelectedGeneric(item);
                          setSearchQuery(item.drug_gen_name);
                          setShowSuggestions(false);
                        }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          borderBottom: '1px solid #f1f5f9',
                          textAlign: 'left',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                      >
                        <strong>{item.drug_gen_name}</strong> <span style={{ color: '#94a3b8', fontSize: '0.72rem', marginLeft: '6px' }}>(ID: {item.drug_gen_id})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* From Date */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>From Date</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: '0.82rem',
                    borderRadius: '8px',
                    border: '1.5px solid #cbd5e1',
                    outline: 'none',
                    background: '#fff',
                  }}
                />
              </div>

              {/* To Date */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>To Date</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: '0.82rem',
                    borderRadius: '8px',
                    border: '1.5px solid #cbd5e1',
                    outline: 'none',
                    background: '#fff',
                  }}
                />
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-start', marginBottom: '16px' }}>
              <button
                type="button"
                onClick={handleSearchReport}
                disabled={loadingReport}
                style={{
                  background: '#1e3a5f',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 18px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                }}
              >
                {loadingReport ? '⏳ Fetching...' : '🔍 Search Existing Drugs'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedGeneric(null);
                  setReportRows([]);
                  setSelectedReportRows([]);
                  setReportError('');
                  setDosageFilter('');
                  setDosageFormFilter('');
                }}
                style={{
                  background: '#f1f5f9',
                  color: '#475569',
                  border: '1px solid #cbd5e1',
                  padding: '8px 18px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                }}
              >
                Clear
              </button>

              {reportRows.length > 0 && (
                <button
                  type="button"
                  onClick={handleImportSelected}
                  disabled={selectedReportRows.length === 0}
                  style={{
                    background: selectedReportRows.length === 0 ? '#cbd5e1' : '#10b981',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 18px',
                    borderRadius: '6px',
                    cursor: selectedReportRows.length === 0 ? 'not-allowed' : 'pointer',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    marginLeft: 'auto',
                  }}
                >
                  📥 Import Selected ({selectedReportRows.length})
                </button>
              )}
            </div>

            {/* Filters Row */}
            {reportRows.length > 0 && (
              <div style={{
                display: 'flex',
                gap: '20px',
                alignItems: 'center',
                padding: '12px 16px',
                background: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                marginBottom: '16px',
                flexWrap: 'wrap'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>Dosage Form:</label>
                  <select
                    value={dosageFormFilter}
                    onChange={e => setDosageFormFilter(e.target.value)}
                    style={{
                      padding: '6px 10px',
                      fontSize: '0.78rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      background: '#fff',
                      outline: 'none',
                    }}
                  >
                    <option value="">All</option>
                    {availableDosageForms.map(form => (
                      <option key={form} value={form}>{form}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>Dosage Size:</label>
                  <select
                    value={dosageFilter}
                    onChange={e => setDosageFilter(e.target.value)}
                    style={{
                      padding: '6px 10px',
                      fontSize: '0.78rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      background: '#fff',
                      outline: 'none',
                    }}
                  >
                    <option value="">All</option>
                    {availableDosages.map(dose => (
                      <option key={dose} value={dose}>{dose}</option>
                    ))}
                  </select>
                </div>

                {/* Summary */}
                <div style={{ marginLeft: 'auto', fontSize: '0.78rem', fontWeight: 500, color: '#475569' }}>
                  Found <strong style={{ color: '#1e3a5f' }}>{reportRows.length}</strong> brands
                  {(dosageFilter || dosageFormFilter) && (
                    <span>
                      {' '}• Showing <strong style={{ color: '#10b981' }}>{filteredReportRows.length}</strong> brands matching:
                      {dosageFormFilter && ` Form = ${dosageFormFilter}`}
                      {dosageFilter && `${dosageFormFilter ? ',' : ''} Dosage = ${dosageFilter}`}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Error / Loading State */}
            {reportError && (
              <div style={{ color: '#ef4444', background: '#fef2f2', padding: '10px 14px', borderRadius: '8px', fontSize: '0.8rem', marginBottom: '12px', border: '1px solid #fca5a5' }}>
                ⚠️ {reportError}
              </div>
            )}

            {loadingReport && (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#4b5563', fontSize: '0.85rem' }}>
                ⏳ Loading formulary drugs from HIS report...
              </div>
            )}

            {/* Results Table */}
            {!loadingReport && reportRows.length > 0 && (
              <div style={{ overflowX: 'auto', maxHeight: '300px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', textAlign: 'left' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1', width: '35px' }}>
                        <input
                          type="checkbox"
                          onChange={e => {
                            if (e.target.checked) {
                              const newSelections = [...selectedReportRows];
                              filteredReportRows.forEach(row => {
                                if (!newSelections.some(r => r.sno === row.sno)) {
                                  newSelections.push(row);
                                }
                              });
                              setSelectedReportRows(newSelections);
                            } else {
                              setSelectedReportRows(prev => prev.filter(r => !filteredReportRows.some(fr => fr.sno === r.sno)));
                            }
                          }}
                          checked={filteredReportRows.length > 0 && filteredReportRows.every(row => selectedReportRows.some(r => r.sno === row.sno))}
                        />
                      </th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>S.No.</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Introduced On</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Brand Name</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Manufacturer</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Marketer</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Consultant</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Present Stock</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Purchase Qty</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Sale Qty</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Pack</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>MRP</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Rate</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Margin</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Scheme</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Net Rate</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Profit Margin</th>
                      <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Total Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReportRows.length === 0 ? (
                      <tr>
                        <td colSpan={18} style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', background: '#f8fafc' }}>
                          📭 No brands match the selected filter criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredReportRows.map((row, idx) => {
                        const isChecked = selectedReportRows.some(r => r.sno === row.sno);
                        return (
                          <tr
                            key={idx}
                            style={{
                              background: isChecked ? '#f0fdf4' : idx % 2 === 0 ? '#ffffff' : '#f8fafc',
                              borderBottom: '1px solid #f1f5f9',
                              transition: 'background 0.1s ease',
                              cursor: 'pointer',
                            }}
                            onClick={() => {
                              if (isChecked) {
                                setSelectedReportRows(prev => prev.filter(r => r.sno !== row.sno));
                              } else {
                                setSelectedReportRows(prev => [...prev, row]);
                              }
                            }}
                          >
                            <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setSelectedReportRows(prev => [...prev, row]);
                                  } else {
                                    setSelectedReportRows(prev => prev.filter(r => r.sno !== row.sno));
                                  }
                                }}
                              />
                            </td>
                            <td style={{ padding: '8px 10px' }}>{row.sno}</td>
                            <td style={{ padding: '8px 10px' }}>{formatIntroducedDate(row.introduced_on)}</td>
                            <td style={{ padding: '8px 10px', fontWeight: 600 }}>{row.brand_name}</td>
                            <td style={{ padding: '8px 10px' }}>{row.manufacturer}</td>
                            <td style={{ padding: '8px 10px' }}>{row.marketer}</td>
                            <td style={{ padding: '8px 10px' }}>{row.consultant}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.present_stock}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.purchase_quantity}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.sale_qty}</td>
                            <td style={{ padding: '8px 10px' }}>{row.pack}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.mrp_incl_gst}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.rate_incl_gst}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.absolute_margin}</td>
                            <td style={{ padding: '8px 10px' }}>{row.scheme_qty && row.offer_qty ? `${row.scheme_qty}+${row.offer_qty}` : row.scheme_qty || '—'}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.net_rate}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.profit_margin}%</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.total_margin_markup}%</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {!loadingReport && reportRows.length === 0 && selectedGeneric && (
              <div style={{ textAlign: 'center', padding: '16px', background: '#f8fafc', color: '#64748b', fontSize: '0.8rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                📭 No existing drugs found in the formulary report for "{selectedGeneric.drug_gen_name}" within the chosen date range.
              </div>
            )}
          </div>
        )}

        <div
          ref={sheetRef}
          className="comparison-sheet-scalable"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
            transition: 'transform 0.2s ease',
            width: 'fit-content',
            minWidth: '1400px',
            background: '#fff',
            borderRadius: 8,
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
            overflow: 'hidden',
          }}
        >

          {/* Hospital Header */}
          <div style={{ background: '#1e3a5f', color: '#fff', textAlign: 'center', padding: '12px 20px' }}>
            <div style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '0.03em' }}>{HOSPITAL}</div>
            <div style={{ fontSize: '0.78rem', marginTop: 4, opacity: 0.85 }}>
              ITEM-GENERIC: {requestInfo.BRAND_NAME || '—'} — {requestInfo.GENERIC_NAME || '—'}
            </div>
            <div style={{ fontSize: '0.72rem', marginTop: 2, opacity: 0.75 }}>
              Comparison Sheet • Prepared on: {today}
            </div>
          </div>

          {/* ── Calc legend ── */}
          <div style={{ background: '#eef2ff', padding: '4px 16px', fontSize: '0.68rem', color: '#3730a3', borderBottom: '1px solid #c7d2fe' }}>
            💡 <em>Shaded blue-tint columns</em> are auto-calculated from MRP/Pack, Rate/Pack, GST% and Pack. Edit the base columns to update them.
          </div>

          {/* Style tag for resize handles */}
          <style>{`
            .resize-handle {
              position: absolute;
              top: 0;
              right: 0;
              width: 4px;
              height: 100%;
              cursor: col-resize;
              z-index: 10;
              background: transparent;
              transition: background 0.1s;
            }
            .resize-handle:hover {
              background: #0ea5e9;
              width: 4px;
            }
          `}</style>

          {/* ── Main Table ── */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              tableLayout: 'fixed',
              borderCollapse: 'collapse',
              width: `${(columnWidths.sno || 40) + COLS_NEW.reduce((acc, col) => acc + (columnWidths[col.id] || col.w), 0)}px`,
            }}>
              <colgroup>
                <col style={{ width: columnWidths.sno || 40 }} />
                {COLS_NEW.map(col => (
                  <col key={col.id} style={{ width: columnWidths[col.id] || col.w }} />
                ))}
              </colgroup>
              <tbody>
                {/* ── EXISTING DETAILS ── */}
                {isExisting && (
                  <>
                    <tr>
                      <td colSpan={20} style={SECTION_HDR}>EXISTING DETAILS</td>
                    </tr>
                    {renderSectionHeaders(COLS_EXISTING, columnWidths, handleMouseDown, handleDoubleClick)}
                    {existingDetails.map((row, idx) => (
                      <tr key={`exist-${idx}`} style={EXIST_ROW}>
                        <td style={{ ...CELL, textAlign: 'center', fontWeight: 600, ...EXIST_ROW, position: 'relative' }} data-col-id="sno">
                          {idx + 1}
                          {mode === 'pharmacist' && existingDetails.length > 1 && (
                            <button
                              onClick={() => removeExistingRow(idx)}
                              title="Remove row"
                              style={{
                                position: 'absolute', left: 2, top: '50%', transform: 'translateY(-50%)',
                                background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%',
                                width: 14, height: 14, fontSize: '9px', display: 'flex', alignItems: 'center',
                                justifyContent: 'center', cursor: 'pointer', padding: 0, lineHeight: 1
                              }}
                            >
                              ×
                            </button>
                          )}
                        </td>
                        {COLS_EXISTING.map(col => {
                          const key = col.key;
                          return (
                            <SheetCell
                              key={col.id}
                              value={row[key] ?? ''}
                              onChange={v => updateExistingRow(idx, key, v)}
                              num={col.num}
                              editable={mode === 'pharmacist'}
                              style={EXIST_ROW}
                              colId={col.id}
                            />
                          );
                        })}
                      </tr>
                    ))}
                    {mode === 'pharmacist' && (
                      <tr>
                        <td colSpan={20} style={{ padding: '6px 10px', borderTop: '1px dashed #bbb', background: '#fefce8' }}>
                          <button onClick={addExistingRow} style={{
                            background: 'none', border: '1px dashed #d97706', color: '#d97706',
                            padding: '3px 14px', borderRadius: 5, cursor: 'pointer', fontSize: '0.78rem',
                            fontWeight: 600
                          }}>+ Add Existing Drug Row</button>
                        </td>
                      </tr>
                    )}
                  </>
                )}

                {/* ── NEW QUOTATION DETAILS ── */}
                <tr>
                  <td colSpan={20} style={{ ...SECTION_HDR, background: '#1e3a5f' }}>
                    NEW QUOTATION DETAILS
                  </td>
                </tr>
                {renderSectionHeaders(COLS_NEW, columnWidths, handleMouseDown, handleDoubleClick)}
                {alternatives.map((alt, i) => {
                  const rowStyle = i === 0 ? DR_ROW : NEW_ROW;
                  const derived = calcDerived(
                    alt.mrp_per_pack, alt.rate_per_pack, alt.gst_percent,
                    alt.pack, alt.qty, alt.offer,
                  );
                  return (
                    <tr key={i} style={rowStyle}>
                      <td style={{ ...CELL, textAlign: 'center', fontWeight: 600, ...rowStyle }} data-col-id="sno">
                        {i + 1}
                        {i === 0 && <div style={{ fontSize: '0.6rem', color: '#15803d' }}>Dr. Rec.</div>}
                      </td>
                      {COLS_NEW.map(col => {
                        if (col.isCalc) {
                          return <CalcCell key={col.id} value={derived[col.id]} rowStyle={rowStyle} colId={col.id} />;
                        }
                        return (
                          <SheetCell
                            key={col.id}
                            value={getVal(alt, col.id)}
                            onChange={v => updateAlt(i, col.id, v)}
                            num={col.num}
                            editable={mode === 'pharmacist'}
                            style={rowStyle}
                            colId={col.id}
                          />
                        );
                      })}
                    </tr>
                  );
                })}

                {/* Add row button */}
                {mode === 'pharmacist' && onAddAlt && (
                  <tr>
                    <td colSpan={20} style={{ padding: '6px 10px', borderTop: '1px dashed #bbb' }}>
                      <button onClick={onAddAlt} style={{
                        background: 'none', border: '1px dashed #6366f1', color: '#6366f1',
                        padding: '3px 14px', borderRadius: 5, cursor: 'pointer', fontSize: '0.78rem',
                      }}>+ Add Alternative Row</button>
                    </td>
                  </tr>
                )}

                {/* ── AFTER NEGOTIATION ── */}
                <tr>
                  <td colSpan={20} style={{ ...SECTION_HDR, background: '#7c3aed' }}>
                    AFTER NEGOTIATION
                  </td>
                </tr>
                {renderSectionHeaders(COLS_NEW, columnWidths, handleMouseDown, handleDoubleClick)}
                {alternatives.map((alt, i) => {
                  const rowStyle = i === 0 ? DR_ROW : NEW_ROW;

                  // Compute derived values for negotiated fields
                  const derived = calcDerived(
                    alt.negotiated_mrp, alt.negotiated_rate, alt.negotiated_gst,
                    alt.pack, alt.negotiated_scheme_qty, alt.negotiated_scheme_offer
                  );

                  const phEditable = mode === 'pharmacy_head';

                  return (
                    <tr key={`neg-${i}`} style={rowStyle}>
                      <td style={{ ...CELL, textAlign: 'center', fontWeight: 600, ...rowStyle }} data-col-id="sno">
                        {i + 1}
                        {i === 0 && <div style={{ fontSize: '0.6rem', color: '#15803d' }}>Dr. Rec.</div>}
                      </td>
                      {COLS_NEW.map(col => {
                        if (col.isCalc) {
                          return <CalcCell key={col.id} value={derived[col.id]} rowStyle={rowStyle} colId={col.id} />;
                        }

                        let fieldVal = '';
                        let cellEditable = false;
                        let fieldName = '';
                        let isNum = col.num;

                        if (col.id === 'mrp_per_pack') {
                          fieldName = 'negotiated_mrp';
                          fieldVal = alt.negotiated_mrp;
                          cellEditable = phEditable;
                        } else if (col.id === 'rate_per_pack') {
                          fieldName = 'negotiated_rate';
                          fieldVal = alt.negotiated_rate;
                          cellEditable = phEditable;
                        } else if (col.id === 'gst_percent') {
                          fieldName = 'negotiated_gst';
                          fieldVal = alt.negotiated_gst;
                          cellEditable = phEditable;
                        } else if (col.id === 'qty') {
                          fieldName = 'negotiated_scheme_qty';
                          fieldVal = alt.negotiated_scheme_qty;
                          cellEditable = phEditable;
                        } else if (col.id === 'offer') {
                          fieldName = 'negotiated_scheme_offer';
                          fieldVal = alt.negotiated_scheme_offer;
                          cellEditable = phEditable;
                        } else if (col.id === 'remark') {
                          fieldName = 'negotiation_remarks';
                          fieldVal = alt.negotiation_remarks;
                          cellEditable = phEditable;
                          isNum = false;
                        } else {
                          // Shared properties are read-only in the negotiated table
                          fieldVal = alt[col.id];
                          cellEditable = false;
                        }

                        return (
                          <SheetCell
                            key={col.id}
                            value={fieldVal}
                            onChange={v => updateAlt(i, fieldName, v)}
                            num={isNum}
                            editable={cellEditable}
                            style={rowStyle}
                            colId={col.id}
                          />
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Pharmacist Remarks ── */}
          <div style={{ padding: '14px 20px', borderTop: '2px solid #e5e7eb' }}>
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#1e3a5f', marginBottom: 6 }}>
              PHARMACIST ANALYSIS REMARKS
            </div>
            {mode === 'pharmacist' ? (
              <textarea
                value={pharmRemarks}
                onChange={e => onRemarksChange && onRemarksChange(e.target.value)}
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 12px', fontSize: '0.82rem', resize: 'vertical', minHeight: 70 }}
                placeholder="Add your clinical/pricing analysis observations, recommendations…"
              />
            ) : (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', fontSize: '0.82rem', color: '#374151', minHeight: 50, background: '#f9fafb' }}>
                {pharmRemarks || '—'}
              </div>
            )}
          </div>

          {/* ── Pharmacy Head Remarks & Recommendations ── */}
          <div style={{ padding: '14px 20px', borderTop: '1px solid #e5e7eb', background: '#faf5ff' }}>
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#7c3aed', marginBottom: 6 }}>
              REMARKS & PROCUREMENT RECOMMENDATIONS BY MANAGER-PHARMACY SERVICES
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.72rem', color: '#6b21a8', marginBottom: 4 }}>Pharmacy Head Review Remarks:</div>
                {mode === 'pharmacy_head' ? (
                  <ApprovalRemarksPanel
                    role="PharmacyHead"
                    value={phRemarks}
                    onChange={onPhRemarksChange}
                    placeholder="Add Pharmacy Head review remarks..."
                    rows={2}
                  />
                ) : (
                  <div style={{ border: '1px solid #ddd6fe', borderRadius: 6, padding: '8px 12px', fontSize: '0.82rem', color: '#374151', minHeight: 60, background: '#fff' }}>
                    {requestInfo.PH_REVIEW_REMARKS || phRemarks || '—'}
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.72rem', color: '#6b21a8', marginBottom: 4 }}>Procurement / Commercial Final Recommendation:</div>
                {mode === 'pharmacy_head' ? (
                  <textarea
                    value={phFinalRecommendation}
                    onChange={e => onPhFinalRecommendationChange && onPhFinalRecommendationChange(e.target.value)}
                    style={{ width: '100%', border: '1px solid #ddd6fe', borderRadius: 6, padding: '8px 12px', fontSize: '0.82rem', resize: 'vertical', minHeight: 60 }}
                    placeholder="Add suggested negotiated brand, procurement observations & final commercial recommendations..."
                  />
                ) : (
                  <div style={{ border: '1px solid #ddd6fe', borderRadius: 6, padding: '8px 12px', fontSize: '0.82rem', color: '#374151', minHeight: 60, background: '#fff' }}>
                    {requestInfo.PH_FINAL_RECOMMENDATION || phFinalRecommendation || '—'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Lower Recommendation/Review Section (matches Excel layout) ── */}
          <div className="comparison-lower-grid" style={{
            borderTop: '2.5px solid #1e3a5f',
            borderBottom: '1px solid #cbd5e1',
          }}>

            {/* Left Column: REVIEWED BY SECTION */}
            <div style={{
              borderRight: '1.5px solid #cbd5e1',
              padding: '16px 20px',
              background: '#f8fafc',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}>
              <div>
                <div style={{
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  color: '#1e3a5f',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 8,
                }}>
                  Reviewed By:
                </div>
                {mode === 'dtc' ? (
                  <input
                    type="text"
                    value={localDtcReviewedByName}
                    onChange={e => handleReviewedByNameChange(e.target.value)}
                    placeholder="Enter Chairperson Name"
                    style={{
                      width: '100%', padding: '6px 10px', fontSize: '0.82rem',
                      borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none',
                      marginBottom: 10,
                    }}
                  />
                ) : (
                  <div style={{
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    color: '#334155',
                    padding: '8px 12px',
                    background: '#f1f5f9',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    textAlign: 'center',
                    marginBottom: 10,
                  }}>
                    {localDtcReviewedByName || requestInfo.DTC_REVIEWED_BY_NAME || 'CHAIRPERSON DTC'}
                  </div>
                )}
              </div>
              <div style={{ marginTop: 12, fontSize: '0.75rem', color: '#475569', lineHeight: 1.5 }}>
                {mode === 'dtc' ? (
                  <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: '10px 14px', borderRadius: 8 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6, color: '#1e3a5f' }}>
                      ✍️ Electronic Approval Signature:
                    </div>
                    <input
                      type="text"
                      value={localDtcReviewSignature}
                      onChange={e => handleReviewSignatureChange(e.target.value)}
                      placeholder="Type electronic signature / name"
                      style={{
                        width: '100%', padding: '6px 10px', fontSize: '0.8rem',
                        borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none',
                      }}
                    />
                  </div>
                ) : (localDtcReviewSignature || requestInfo.DTC_REVIEW_SIGNATURE) ? (
                  <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '10px 14px', borderRadius: 8, color: '#065f46' }}>
                    <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span>🛡️</span> Approved digitally by:
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '0.8rem', marginTop: 4 }}>
                      {localDtcReviewedByName || requestInfo.DTC_REVIEWED_BY_NAME || 'DTC Chairperson'}
                    </div>
                    <div style={{ fontStyle: 'italic', fontSize: '0.75rem', marginTop: 2, fontFamily: 'monospace' }}>
                      Sign: {localDtcReviewSignature || requestInfo.DTC_REVIEW_SIGNATURE}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#047857', marginTop: 2 }}>
                      Date: {new Date(requestInfo.DTC_REVIEWED_AT || dtcReviewedAt || Date.now()).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ) : (
                  <div style={{ border: '1.5px dashed #cbd5e1', padding: '10px 14px', borderRadius: 8, textAlign: 'center', fontStyle: 'italic', color: '#64748b' }}>
                    Awaiting final selection and electronic signature from DTC Chairperson.
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Unified Final Recommendation Panel */}
            {renderRecommendationBlock()}
          </div>


          {/* ── Footer (matches Excel footer) ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderTop: '2px solid #1e3a5f' }}>
            {[
              { label: 'PREPARED BY', value: `${requestInfo.PREPARED_BY || requestInfo.PHARMACIST_NAME || 'Pharmacist'} — ${today}` },
              { label: 'REVIEWED BY', value: 'Manager — Pharmacy Services' },
              { label: 'SANCTIONED BY', value: 'Secretary MOSCMM' },
            ].map((f, i) => (
              <div key={i} style={{ padding: '10px 14px', borderRight: i < 2 ? '1px solid #d1d5db' : 'none', fontSize: '0.72rem' }}>
                <div style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: 4 }}>{f.label}:</div>
                <div style={{ color: '#6b7280' }}>{f.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid #d1d5db', fontSize: '0.72rem' }}>
            {/* DTC Remarks */}
            <div style={{ padding: '10px 14px', borderRight: '1px solid #d1d5db' }}>
              <div style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: 4 }}>REMARKS BY CHAIRPERSON (DTC):</div>
              {mode === 'dtc' ? (
                <ApprovalRemarksPanel
                  role="DTC"
                  value={localDtcRemarks}
                  onChange={handleDtcRemarksChange}
                  placeholder="Enter Chairperson remarks..."
                  rows={2}
                  hidePredefined={true}
                  hideRecent={true}
                />
              ) : (
                <div style={{ minHeight: 36, borderBottom: '1px solid #9ca3af', color: '#374151', paddingTop: 4 }}>
                  {localDtcRemarks || requestInfo.DTC_REMARKS || requestInfo.DTC_FINAL_REMARKS || '—'}
                </div>
              )}
            </div>
            {/* PH Remarks */}
            <div style={{ padding: '10px 14px' }}>
              <div style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: 4 }}>REMARKS BY PHARMACY HEAD:</div>
              {mode === 'pharmacy_head' ? (
                <ApprovalRemarksPanel
                  role="PharmacyHead"
                  value={phRemarks}
                  onChange={onPhRemarksChange}
                  placeholder="Enter Pharmacy Head remarks..."
                  rows={2}
                />
              ) : (
                <div style={{ minHeight: 36, borderBottom: '1px solid #9ca3af', color: '#374151', paddingTop: 4 }}>
                  {requestInfo.PH_REVIEW_REMARKS || phRemarks || '—'}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
