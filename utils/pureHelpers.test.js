import {
  normalizeGenericCombo,
  computeAltDerived,
  computeExistingDerived,
  validatePassword,
} from './pureHelpers.js';

describe('normalizeGenericCombo', () => {
  test('single word', () => {
    expect(normalizeGenericCombo('Aspirin')).toEqual(['aspirin']);
  });

  test('combo with + delimiter, sorted', () => {
    expect(normalizeGenericCombo('Aspirin + Clopidogrel')).toEqual(['aspirin', 'clopidogrel']);
  });

  test('order-independent — reversed input gives same result', () => {
    expect(normalizeGenericCombo('Clopidogrel + Aspirin')).toEqual(['aspirin', 'clopidogrel']);
  });

  test('supports comma, ampersand, slash, and "and" delimiters', () => {
    const expected = ['aspirin', 'clopidogrel'];
    expect(normalizeGenericCombo('Aspirin, Clopidogrel')).toEqual(expected);
    expect(normalizeGenericCombo('Aspirin & Clopidogrel')).toEqual(expected);
    expect(normalizeGenericCombo('Aspirin / Clopidogrel')).toEqual(expected);
    expect(normalizeGenericCombo('Aspirin and Clopidogrel')).toEqual(expected);
  });

  test('trims whitespace and lowercases', () => {
    expect(normalizeGenericCombo('  ASPIRIN  +  Clopidogrel  ')).toEqual(['aspirin', 'clopidogrel']);
  });

  test('drops empty tokens from repeated delimiters', () => {
    expect(normalizeGenericCombo('Aspirin ++ Clopidogrel')).toEqual(['aspirin', 'clopidogrel']);
  });
});

describe('computeAltDerived', () => {
  test('computes pricing fields from raw pack/GST inputs', () => {
    const result = computeAltDerived({
      mrp_per_pack: 100, rate_per_pack: 80, gst_percent: 10, pack: 10, qty: 8, offer: 2,
    });
    expect(result).toEqual({
      mrp: 10,
      rate: 8.8,
      markup_margin: 13.64,
      profit_margin: 29.6,
      absolute_margin: 2.96,
      net_rate: 7.04,
      total_margin: 42.05,
    });
  });

  // Characterizes existing behavior: when pack=0 and no legacy `mrp`/`rate`
  // fields are present in the input, the `?? parseFloat(alt.mrp)` fallback
  // evaluates parseFloat(undefined) = NaN, and `?? null` does NOT catch NaN
  // (only null/undefined trigger a fallback) — so this returns NaN, not null.
  test('pack=0 with no legacy fallback fields produces NaN (existing behavior, not null)', () => {
    const result = computeAltDerived({
      mrp_per_pack: 100, rate_per_pack: 80, gst_percent: 10, pack: 0, qty: 8, offer: 2,
    });
    expect(result.mrp).toBeNaN();
    expect(result.rate).toBeNaN();
  });

  test('falls back to legacy pre-computed fields when pack is 0', () => {
    const result = computeAltDerived({
      pack: 0, mrp: 55, rate: 40, markupmargin: 12,
    });
    expect(result.mrp).toBe(55);
    expect(result.rate).toBe(40);
    expect(result.markup_margin).toBe(12);
  });
});

describe('computeExistingDerived', () => {
  test('computes pricing fields including GST-adjusted MRP', () => {
    const result = computeExistingDerived({
      mrp_pack: 100, rate_pack: 80, gst_percent: 10, pack: 10, scheme_qty: 8, scheme_offer: 2,
    });
    expect(result).toEqual({
      mrp_inc_gst_nos: 11,
      rate_inc_gst_nos: 8.8,
      markup_margin: 25,
      profit_margin: 20,
      absolute_margin: 2.2,
      net_rate: 7.04,
    });
  });

  test('pack=0 avoids divide-by-zero', () => {
    const result = computeExistingDerived({
      mrp_pack: 100, rate_pack: 80, gst_percent: 10, pack: 0, scheme_qty: 8, scheme_offer: 2,
    });
    expect(result.mrp_inc_gst_nos).toBeNull();
    expect(result.rate_inc_gst_nos).toBeNull();
  });
});

describe('validatePassword', () => {
  test('accepts a password meeting all rules', () => {
    expect(validatePassword('Abcdef1!')).toEqual([]);
  });

  test('rejects passwords under 6 characters', () => {
    expect(validatePassword('Ab1!')).toContain('Password must be at least 6 characters.');
  });

  test('rejects missing uppercase letter', () => {
    expect(validatePassword('abcdef1!')).toContain('Password must contain at least one uppercase letter.');
  });

  test('rejects missing special symbol', () => {
    expect(validatePassword('Abcdefg1')).toContain('Password must contain at least one special symbol.');
  });

  test('rejects missing number', () => {
    expect(validatePassword('Abcdefg!')).toContain('Password must contain at least one number.');
  });

  test('empty password produces the length error', () => {
    expect(validatePassword('')).toContain('Password must be at least 6 characters.');
  });
});
