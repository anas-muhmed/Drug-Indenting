// Pure, dependency-free helper functions extracted from server.js.
// No database, no network, no side effects — safe to unit test directly.

export function normalizeGenericCombo(str) {
  return str
    .split(/\+|,|&|\/|\s+and\s+/i)   // split on delimiters
    .map(t => t.trim().toLowerCase()) // normalise case & whitespace
    .filter(Boolean)                  // drop empty tokens
    .sort();                          // order-independent matching
}

// Computes derived pricing fields (mrp, rate, margins...) for a drug
// alternative entry, from raw v2 base inputs (mrp_per_pack, rate_per_pack, ...).
export function computeAltDerived(alt) {
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

// Computes derived pricing fields for an existing drug row (comparison sheet).
export function computeExistingDerived(row) {
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

export function validatePassword(password) {
  const errors = [];
  if (!password || password.length < 6) errors.push('Password must be at least 6 characters.');
  if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter.');
  if (!/[!@#$%^&*()\-_=+\[\]{};':"\\|,.<>/?]/.test(password))
    errors.push('Password must contain at least one special symbol.');
  if (!/\d/.test(password)) errors.push('Password must contain at least one number.');
  return errors;
}
