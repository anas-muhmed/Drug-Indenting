// =====================================================================
// RejectionRemarksPanel.js — Reusable multi-select rejection remarks component
// Used by: HODTab, PharmacyHeadTab, DTCCommitteeTab, CEOTab
// =====================================================================
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

export const REJECTION_REASONS = [
  { label: 'Generic Already Exists', text: 'Medicine generic already exists in the formulary.' },
  { label: 'Low Clinical Benefit', text: 'Insufficient clinical advantage over existing drugs in the formulary.' },
  { label: 'Low Justification', text: 'Clinical justification provided is insufficient for formulary addition.' },
  { label: 'Alternative Available', text: 'A suitable alternative medicine is already available in the formulary.' },
  { label: 'Non-Moving Item', text: 'Expected low consumption — not viable for formulary addition at this time.' },
  { label: 'High Cost', text: 'High procurement cost compared to existing formulary alternatives.' },
  { label: 'Insufficient Clinical Evidence', text: 'Insufficient supporting clinical evidence submitted.' },
  { label: 'Low Profit Margin', text: 'Low profit margin — commercially not viable for procurement.' },
];

// Module-level caching for synchronous composition called by parent tabs
let cachedReasons = [...REJECTION_REASONS];

/**
 * Compose a formatted rejection remarks string from selected reasons + custom remarks.
 * This string is sent to the backend as the existing `remarks` field.
 */
export function composeRejectionRemarks(selectedReasons, customRemarks) {
  const lines = [];

  selectedReasons.forEach(label => {
    const found = cachedReasons.find(r => (r.label || r.LABEL) === label);
    const text = found ? (found.text || found.REASON_TEXT) : '';
    if (text) lines.push(`• ${text}`);
  });

  const validCustom = customRemarks.filter(r => r.trim());
  if (validCustom.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('Additional Remarks:');
    validCustom.forEach(r => lines.push(r.trim()));
  }

  return lines.join('\n');
}

/**
 * Validate rejection: at least one reason or one non-empty custom remark must exist.
 * Returns an error string, or '' if valid.
 */
export function validateRejection(selectedReasons, customRemarks) {
  const hasReason = selectedReasons.length > 0;
  const hasCustom = customRemarks.some(r => r.trim() !== '');
  if (!hasReason && !hasCustom) {
    return 'Please select at least one rejection reason or enter a custom remark.';
  }
  return '';
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = {
  section: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: '0.72rem',
    fontWeight: 700,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 10,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  reasonGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 8,
  },
  reasonCard: (isSelected) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 12px',
    borderRadius: 10,
    border: isSelected ? '1.5px solid #dc2626' : '1.5px solid #e2e8f0',
    background: isSelected ? 'rgba(220,38,38,0.07)' : '#f8fafc',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    userSelect: 'none',
    textAlign: 'left',
    width: '100%',
    fontFamily: 'inherit',
  }),
  checkbox: (isSelected) => ({
    width: 18,
    height: 18,
    borderRadius: 5,
    border: isSelected ? '2px solid #dc2626' : '2px solid #cbd5e1',
    background: isSelected ? '#dc2626' : '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'all 0.15s ease',
  }),
  checkmark: {
    color: '#fff',
    fontSize: '0.7rem',
    fontWeight: 800,
    lineHeight: 1,
  },
  reasonLabel: (isSelected) => ({
    fontSize: '0.78rem',
    fontWeight: isSelected ? 700 : 500,
    color: isSelected ? '#991b1b' : '#475569',
    lineHeight: 1.4,
  }),
  divider: {
    border: 'none',
    borderTop: '1px solid #e2e8f0',
    margin: '14px 0',
  },
  customRemarkRowContainer: {
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
    width: '100%',
  },
  customTextarea: (hasError) => ({
    flex: 1,
    padding: '8px 12px',
    fontSize: '0.84rem',
    borderRadius: 8,
    border: hasError ? '1.5px solid #dc2626' : '1.5px solid #e2e8f0',
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
    lineHeight: 1.5,
    color: '#1e293b',
    background: '#fff',
    transition: 'border-color 0.15s',
  }),
  removeBtn: {
    padding: '7px 10px',
    borderRadius: 8,
    border: '1.5px solid #fca5a5',
    background: '#fef2f2',
    color: '#dc2626',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontWeight: 700,
    flexShrink: 0,
    transition: 'all 0.15s',
  },
  addBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    borderRadius: 8,
    border: '1.5px dashed #94a3b8',
    background: 'transparent',
    color: '#64748b',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: 600,
    transition: 'all 0.15s',
    fontFamily: 'inherit',
    marginTop: 4,
  },
  errorBox: {
    marginTop: 10,
    padding: '8px 12px',
    borderRadius: 8,
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    color: '#dc2626',
    fontSize: '0.8rem',
    fontWeight: 600,
  },
  previewBox: {
    marginTop: 14,
    padding: '12px 16px',
    borderRadius: 10,
    background: '#fef2f2',
    border: '1.5px solid #fca5a5',
    borderLeft: '4px solid #dc2626',
  },
  previewHeader: {
    fontSize: '0.72rem',
    fontWeight: 700,
    color: '#b91c1c',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 8,
  },
  previewContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  previewItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
  },
  bullet: {
    color: '#dc2626',
    fontWeight: 800,
    fontSize: '0.85rem',
    lineHeight: 1.4,
  },
  previewText: {
    fontSize: '0.82rem',
    color: '#991b1b',
    lineHeight: 1.4,
    fontWeight: 500,
  },
  // Autocomplete suggestions dropdown styles
  autocompleteDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    background: '#fff',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
    zIndex: 1000,
    maxHeight: 180,
    overflowY: 'auto',
    marginTop: 4,
  },
  autocompleteItem: (isHovered) => ({
    padding: '8px 12px',
    cursor: 'pointer',
    background: isHovered ? '#f1f5f9' : '#fff',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    borderBottom: '1px solid #f1f5f9',
    transition: 'background 0.15s ease',
  }),
  itemText: {
    fontSize: '0.84rem',
    color: '#1e293b',
    fontWeight: 500,
    textAlign: 'left',
    whiteSpace: 'normal',
    wordBreak: 'break-word',
  },
  usageBadge: {
    fontSize: '0.68rem',
    fontWeight: 600,
    color: '#059669',
    background: '#ecfdf5',
    padding: '2px 6px',
    borderRadius: 12,
    flexShrink: 0,
  }
};

// ─── Sub-Component ─────────────────────────────────────────────────────────

/**
 * CustomRemarkRow with integrated smart autocomplete.
 */
function CustomRemarkRow({
  value,
  onChange,
  onRemove,
  showRemove,
  placeholder
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef(null);

  // Debounced autocomplete suggestions fetching
  useEffect(() => {
    if (!value.trim() || !showDropdown) {
      setSuggestions([]);
      return;
    }

    const handler = setTimeout(async () => {
      try {
        const res = await axios.get(`/api/rejection-remark-history?q=${encodeURIComponent(value)}`);
        setSuggestions(res.data);
        setActiveIndex(-1);
      } catch (err) {
        console.error('Failed to fetch suggestions:', err);
      }
    }, 250); // 250ms debounce delay

    return () => clearTimeout(handler);
  }, [value, showDropdown]);

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation & selection handlers
  const handleKeyDown = (e) => {
    if (!showDropdown || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        e.preventDefault();
        onChange(suggestions[activeIndex].remark_text);
        setShowDropdown(false);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  return (
    <div ref={containerRef} style={styles.customRemarkRowContainer}>
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <textarea
          rows={2}
          value={value}
          onChange={e => {
            onChange(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={styles.customTextarea(false)}
          onFocusCapture={e => { e.currentTarget.style.borderColor = '#94a3b8'; }}
          onBlurCapture={e => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
        />

        {showDropdown && suggestions.length > 0 && (
          <div style={styles.autocompleteDropdown}>
            {suggestions.map((item, idx) => {
              const isHovered = idx === activeIndex;
              return (
                <div
                  key={item.history_id}
                  onClick={() => {
                    onChange(item.remark_text);
                    setShowDropdown(false);
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  style={styles.autocompleteItem(isHovered)}
                >
                  <span style={styles.itemText}>{item.remark_text}</span>
                  {item.usage_count > 1 && (
                    <span style={styles.usageBadge}>used {item.usage_count}x</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showRemove && (
        <button
          type="button"
          onClick={onRemove}
          style={styles.removeBtn}
          title="Remove this remark"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function RejectionRemarksPanel({
  selectedReasons,
  onReasonsChange,
  customRemarks,
  onCustomRemarksChange,
  error,
  onErrorClear,
}) {

  const toggleReason = (label) => {
    onErrorClear?.();
    if (selectedReasons.includes(label)) {
      onReasonsChange(selectedReasons.filter(l => l !== label));
    } else {
      onReasonsChange([...selectedReasons, label]);
    }
  };

  const updateCustomRemark = (idx, value) => {
    onErrorClear?.();
    const next = [...customRemarks];
    next[idx] = value;
    onCustomRemarksChange(next);
  };

  const addCustomRemark = () => {
    onCustomRemarksChange([...customRemarks, '']);
  };

  const removeCustomRemark = (idx) => {
    const next = customRemarks.filter((_, i) => i !== idx);
    onCustomRemarksChange(next.length === 0 ? [''] : next);
  };

  return (
    <div>
      {/* ── Predefined Multi-Select Reasons ── */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>
          <span>
            Rejection Reasons <span style={{ color: '#dc2626' }}>*</span>
            {selectedReasons.length > 0 && (
              <span style={{
                marginLeft: 8, textTransform: 'none', fontWeight: 600,
                color: '#dc2626', background: '#fee2e2',
                borderRadius: 10, padding: '1px 8px', fontSize: '0.72rem',
              }}>
                {selectedReasons.length} selected
              </span>
            )}
          </span>
        </div>

        <div style={styles.reasonGrid}>
          {REJECTION_REASONS.map(({ label }) => {
            const isSelected = selectedReasons.includes(label);
            return (
              <button
                key={label}
                type="button"
                onClick={() => toggleReason(label)}
                style={styles.reasonCard(isSelected)}
                onMouseEnter={e => {
                  if (!isSelected) {
                    e.currentTarget.style.background = '#f1f5f9';
                    e.currentTarget.style.borderColor = '#cbd5e1';
                  }
                }}
                onMouseLeave={e => {
                  if (!isSelected) {
                    e.currentTarget.style.background = '#f8fafc';
                    e.currentTarget.style.borderColor = '#e2e8f0';
                  }
                }}
              >
                <div style={styles.checkbox(isSelected)}>
                  {isSelected && <span style={styles.checkmark}>✓</span>}
                </div>
                <span style={styles.reasonLabel(isSelected)}>{label}</span>
              </button>
            );
          })}
        </div>

        {/* ── Selected Rejection Remarks Preview ── */}
        {selectedReasons.length > 0 && (
          <div style={styles.previewBox}>
            <div style={styles.previewHeader}>Selected Rejection Remarks Preview</div>
            <div style={styles.previewContent}>
              {selectedReasons.map(label => {
                const found = REJECTION_REASONS.find(r => r.label === label);
                if (!found) return null;
                return (
                  <div key={label} style={styles.previewItem}>
                    <span style={styles.bullet}>•</span>
                    <span style={styles.previewText}>{found.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <hr style={styles.divider} />

      {/* ── Custom Remarks with Autocomplete suggestions ── */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>
          <span>
            Custom Remarks
            <span style={{ marginLeft: 6, textTransform: 'none', fontWeight: 400, color: '#94a3b8' }}>
              (optional — suggestions appear as you type and can be navigated using Arrow Keys and Enter)
            </span>
          </span>
        </div>

        {customRemarks.map((remark, idx) => (
          <CustomRemarkRow
            key={idx}
            value={remark}
            onChange={value => updateCustomRemark(idx, value)}
            onRemove={() => removeCustomRemark(idx)}
            showRemove={customRemarks.length > 1}
            placeholder={
              idx === 0
                ? 'e.g. Vendor quality concerns, procurement history issues, compliance notes…'
                : 'Additional remark…'
            }
          />
        ))}

        <button
          type="button"
          onClick={addCustomRemark}
          style={styles.addBtn}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = '#64748b';
            e.currentTarget.style.color = '#1e293b';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = '#94a3b8';
            e.currentTarget.style.color = '#64748b';
          }}
        >
          <span style={{ fontSize: '1rem', lineHeight: 1 }}>+</span>
          Add Another Remark
        </button>
      </div>

      {/* ── Validation Error ── */}
      {error && (
        <div style={styles.errorBox}>
          ⚠ {error}
        </div>
      )}
    </div>
  );
}
