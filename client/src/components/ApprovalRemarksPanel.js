// =====================================================================
// ApprovalRemarksPanel.js — Reusable approval remarks autocomplete panel
// Used by: HODTab, PharmacyHeadTab, DTCCommitteeTab, CEOTab, ComparisonSheet
// =====================================================================
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const PREDEFINED_REMARKS = {
  HOD: [
    'Clinically justified for patient care and recommended for formulary review.',
    'Department requirement verified; therapeutic benefit justifies inclusion.',
    'Therapeutic necessity confirmed; recommended for pharmacy evaluation.',
    'Approved based on clinical evidence and departmental guidelines.',
    'Suitable for patient care and forwarded for committee review.',
    'Recommended for formulary analysis based on clinical efficacy.',
    'Approved; satisfies unmet clinical need in current formulary.',
    'Verified departmental demand; recommended for inclusion.',
    'Essential for specialized treatment protocols; approved.'
  ],
  PharmacyHead: [
    'Commercial evaluation completed; pricing is acceptable and aligned.',
    'Negotiated pricing verified and found favorable for institutional supply.',
    'Alternative comparison analyzed; procurement feasibility confirmed.',
    'Therapeutic comparison completed; verified as cost-effective.',
    'Feasible for procurement; recommended for DTC consideration.',
    'Price negotiation successful; margin and net rates are acceptable.',
    'Procurement feasibility and logistics verified; approved.',
    'Supplier terms and institutional rates validated; recommended.',
    'Commercial terms optimized; forwarded for final review.'
  ],
  DTC: [
    'DTC approved for formulary inclusion based on safety and efficacy.',
    'Selected based on superior therapeutic value and patient affordability.',
    'Approved after comprehensive clinical and cost comparison evaluation.',
    'Recommended for institutional procurement and clinical implementation.',
    'Clinically sound and commercially viable; approved for formulary.',
    'Approved; clinical advantage over existing alternatives established.',
    'DTC evaluation completed; recommended for standard procurement.',
    'Addition justified by clinical efficacy and safety profile.',
    'Approved; therapeutic efficacy matches hospital clinical protocols.'
  ],
  CEO: [
    'Final administrative and formulary approval granted.',
    'Approved for institutional procurement and clinical utilization.',
    'Budgetary and operational compliance verified; approved.',
    'Approved for implementation in accordance with DTC recommendation.',
    'Executive sanction completed; authorized for hospital supply.',
    'Approved; procurement authorized under standard terms.',
    'Financial and administrative clearance completed; approved.',
    'Sanctioned for hospital formulary integration.',
    'Final executive approval completed.'
  ]
};

// Helper to parse parent value string into selected list and custom text
function parseApprovalRemarks(value, predefinedList) {
  if (!value) return { selected: [], custom: '' };
  
  const selected = [];
  predefinedList.forEach(remark => {
    if (value.includes(remark)) {
      selected.push(remark);
    }
  });

  // Extract custom text: remove predefined remarks and bullet points
  let custom = value;
  selected.forEach(remark => {
    const escaped = remark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    custom = custom.replace(new RegExp(`•\\s*${escaped}\\s*\\n?`, 'g'), '');
    custom = custom.replace(new RegExp(escaped + `\\.?\\s*\\n?`, 'g'), '');
  });

  custom = custom.replace(/Additional Remarks:/gi, '');
  custom = custom.trim();
  
  return { selected, custom };
}

// Helper to compose predefined list and custom text back to a formatted string
function composeApprovalRemarks(selectedRemarks, customText) {
  const lines = [];
  selectedRemarks.forEach(remark => {
    lines.push(`• ${remark}`);
  });

  const trimmedCustom = (customText || '').trim();
  if (trimmedCustom) {
    if (lines.length > 0) lines.push('');
    lines.push('Additional Remarks:');
    lines.push(trimmedCustom);
  }

  return lines.join('\n');
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    width: '100%',
    fontFamily: 'inherit',
  },
  sectionLabel: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 6,
  },
  reasonGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 8,
  },
  reasonCard: (isSelected) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 12px',
    borderRadius: 10,
    border: isSelected ? '1.5px solid #10b981' : '1.5px solid #e2e8f0',
    background: isSelected ? 'rgba(16,185,129,0.07)' : '#f8fafc',
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
    border: isSelected ? '2px solid #10b981' : '2px solid #cbd5e1',
    background: isSelected ? '#10b981' : '#fff',
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
    color: isSelected ? '#047857' : '#475569',
    lineHeight: 1.4,
  }),
  divider: {
    border: 'none',
    borderTop: '1px solid #e2e8f0',
    margin: '14px 0',
  },
  previewBox: {
    marginTop: 14,
    padding: '12px 16px',
    borderRadius: 10,
    background: '#ecfdf5',
    border: '1.5px solid #a7f3d0',
    borderLeft: '4px solid #10b981',
  },
  previewHeader: {
    fontSize: '0.72rem',
    fontWeight: 700,
    color: '#047857',
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
    color: '#10b981',
    fontWeight: 800,
    fontSize: '0.85rem',
    lineHeight: 1.4,
  },
  previewText: {
    fontSize: '0.82rem',
    color: '#065f46',
    lineHeight: 1.4,
    fontWeight: 500,
  },
  chipContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  recentLabel: {
    fontSize: '0.68rem',
    fontWeight: 700,
    color: '#059669',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginTop: 4,
    marginBottom: 4,
  },
  recentChip: {
    padding: '5px 10px',
    fontSize: '0.72rem',
    fontWeight: 600,
    borderRadius: 16,
    border: '1.5px solid #a7f3d0',
    background: '#ecfdf5',
    color: '#065f46',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    fontFamily: 'inherit',
  },
  inputWrapper: {
    position: 'relative',
    width: '100%',
  },
  textarea: {
    width: '100%',
    padding: '8px 12px',
    fontSize: '0.84rem',
    borderRadius: 8,
    border: '1.5px solid #cbd5e1',
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
    lineHeight: 1.5,
    color: '#1e293b',
    background: '#fff',
    transition: 'border-color 0.15s',
  },
  dropdown: {
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
  dropdownItem: (isHovered) => ({
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
    fontSize: '0.82rem',
    color: '#1e293b',
    fontWeight: 500,
    textAlign: 'left',
    wordBreak: 'break-word',
  },
  usageBadge: {
    fontSize: '0.66rem',
    fontWeight: 600,
    color: '#3b82f6',
    background: '#eff6ff',
    padding: '2px 6px',
    borderRadius: 12,
    flexShrink: 0,
  }
};

export default function ApprovalRemarksPanel({
  role,
  value,
  onChange,
  placeholder = 'Add approval remarks...',
  rows = 2,
  hidePredefined = false,
  hideRecent = false
}) {
  const [selectedRemarks, setSelectedRemarks] = useState([]);
  const [customText, setCustomText] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [recentRemarks, setRecentRemarks] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef(null);
  const lastComposedRef = useRef(null);

  const predefinedList = PREDEFINED_REMARKS[role] || [];

  // Sync state from prop value if changed externally
  useEffect(() => {
    if (value !== lastComposedRef.current) {
      const { selected, custom } = parseApprovalRemarks(value, predefinedList);
      setSelectedRemarks(selected);
      setCustomText(custom);
      lastComposedRef.current = value;
    }
  }, [value, role]);

  // Fetch top/recent remarks for quick suggestion chips on mount or role change
  useEffect(() => {
    async function fetchRecent() {
      try {
        const res = await axios.get(`/api/approval-remarks/${role}`);
        setRecentRemarks(res.data.slice(0, 4));
      } catch (err) {
        console.error('Failed to load recent approval remarks:', err);
      }
    }
    fetchRecent();
  }, [role]);

  // Debounced search suggestions query as the user types
  useEffect(() => {
    if (!customText.trim() || !showDropdown) {
      setSuggestions([]);
      return;
    }

    const handler = setTimeout(async () => {
      try {
        const res = await axios.get(`/api/approval-remarks/${role}?q=${encodeURIComponent(customText)}`);
        setSuggestions(res.data);
        setActiveIndex(-1);
      } catch (err) {
        console.error('Failed to fetch approval suggestions:', err);
      }
    }, 200);

    return () => clearTimeout(handler);
  }, [customText, showDropdown, role]);

  // Click outside listener to close dropdown
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
        handleTextChange(suggestions[activeIndex].remark_text);
        setShowDropdown(false);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  const handleToggleRemark = (remark) => {
    let nextSelected;
    if (selectedRemarks.includes(remark)) {
      nextSelected = selectedRemarks.filter(r => r !== remark);
    } else {
      nextSelected = [...selectedRemarks, remark];
    }
    setSelectedRemarks(nextSelected);
    const nextComposed = composeApprovalRemarks(nextSelected, customText);
    lastComposedRef.current = nextComposed;
    onChange(nextComposed);
  };

  const handleTextChange = (newText) => {
    setCustomText(newText);
    const nextComposed = composeApprovalRemarks(selectedRemarks, newText);
    lastComposedRef.current = nextComposed;
    onChange(nextComposed);
  };

  const handleRecentClick = (text) => {
    const val = customText || '';
    const trimmedVal = val.trim();
    let nextText = '';
    if (trimmedVal.includes(text)) {
      nextText = trimmedVal.replace(text, '').trim();
    } else {
      if (trimmedVal === '') {
        nextText = text;
      } else {
        const lastChar = trimmedVal.slice(-1);
        const separator = (lastChar === '.' || lastChar === '?' || lastChar === '!' || lastChar === '\n') ? '\n' : '.\n';
        nextText = trimmedVal + separator + text;
      }
    }
    setCustomText(nextText);
    const nextComposed = composeApprovalRemarks(selectedRemarks, nextText);
    lastComposedRef.current = nextComposed;
    onChange(nextComposed);
  };

  return (
    <div ref={containerRef} style={styles.container}>
      {/* ── Predefined reasons grid ── */}
      {predefinedList.length > 0 && !hidePredefined && (
        <div>
          <div style={styles.sectionLabel}>💡 Predefined Approval Reasons</div>
          <div style={styles.reasonGrid}>
            {predefinedList.map((remark, idx) => {
              const isSelected = selectedRemarks.includes(remark);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleToggleRemark(remark)}
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
                      e.currentTarget.style.borderColor = '#cbd5e1';
                    }
                  }}
                >
                  <div style={styles.checkbox(isSelected)}>
                    {isSelected && <span style={styles.checkmark}>✓</span>}
                  </div>
                  <span style={styles.reasonLabel(isSelected)}>{remark}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Selected Approval Remarks Preview ── */}
      {selectedRemarks.length > 0 && !hidePredefined && (
        <div style={styles.previewBox}>
          <div style={styles.previewHeader}>Selected Approval Remarks Preview</div>
          <div style={styles.previewContent}>
            {selectedRemarks.map((remark, idx) => (
              <div key={idx} style={styles.previewItem}>
                <span style={styles.bullet}>•</span>
                <span style={styles.previewText}>{remark}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {predefinedList.length > 0 && !hidePredefined && <hr style={styles.divider} />}

      {/* ── Recently used custom remarks suggestions ── */}
      {recentRemarks.length > 0 && !hideRecent && (
        <div>
          <div style={styles.recentLabel}>Recently Used Remarks</div>
          <div style={styles.chipContainer}>
            {recentRemarks.map((item) => (
              <button
                key={item.history_id}
                type="button"
                onClick={() => handleRecentClick(item.remark_text)}
                style={styles.recentChip}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#d1fae5';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#ecfdf5';
                }}
              >
                {item.remark_text} {item.usage_count > 1 && `(${item.usage_count}x)`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Input text area with Autocomplete dropdown ── */}
      <div style={styles.inputWrapper}>
        <div style={styles.sectionLabel}>Custom Approval Remarks</div>
        <textarea
          rows={rows}
          value={customText}
          onChange={e => {
            handleTextChange(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={styles.textarea}
          onFocusCapture={e => { e.currentTarget.style.borderColor = '#10b981'; }}
          onBlurCapture={e => { e.currentTarget.style.borderColor = '#cbd5e1'; }}
        />

        {showDropdown && suggestions.length > 0 && (
          <div style={styles.dropdown}>
            {suggestions.map((item, idx) => {
              const isHovered = idx === activeIndex;
              return (
                <div
                  key={item.history_id}
                  onClick={() => {
                    handleTextChange(item.remark_text);
                    setShowDropdown(false);
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  style={styles.dropdownItem(isHovered)}
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
    </div>
  );
}
