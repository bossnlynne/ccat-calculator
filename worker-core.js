export const MAX_BODY_BYTES = 256 * 1024;

export function isValidCats(value) {
  return Array.isArray(value) && value.length <= 5000 && value.every(cat => {
    if (!cat || typeof cat !== 'object' || typeof cat.name !== 'string') return false;
    if (!cat.name.trim() || cat.name.length > 200 || !Array.isArray(cat.fees)) return false;
    return cat.fees.length <= 50 && cat.fees.every(fee =>
      fee && typeof fee === 'object' &&
      typeof fee.caretaker === 'string' && fee.caretaker.length <= 100 &&
      Number.isInteger(fee.fee) && fee.fee >= 0 && fee.fee <= 100000
    );
  });
}

export function isDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1000000;
}

export function isValidSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!Array.isArray(value.ratePeriods) || value.ratePeriods.length < 1 || value.ratePeriods.length > 100) return false;
  if (!value.ratePeriods.every(period =>
    period && typeof period === 'object' &&
    typeof period.name === 'string' && period.name.length <= 100 &&
    isDateString(period.start) && isDateString(period.end) && period.start <= period.end &&
    isNonNegativeInteger(period.rate1) && isNonNegativeInteger(period.rate2) && isNonNegativeInteger(period.rate3)
  )) return false;
  const tiers = value.transportTiers;
  if (!tiers || !['base', 't10', 't15', 't20'].every(key => isNonNegativeInteger(tiers[key]))) return false;
  if (!['special1', 'special2', 'special3', 'holidayFee', 'multiCatFee'].every(key => isNonNegativeInteger(value[key]))) return false;
  if (!isDateString(value.specialStart) || !isDateString(value.specialEnd) || value.specialStart > value.specialEnd) return false;
  if (!Array.isArray(value.holidayRanges) || value.holidayRanges.length > 500) return false;
  if (!value.holidayRanges.every(range =>
    range && typeof range === 'object' &&
    typeof range.name === 'string' && range.name.length <= 100 &&
    isDateString(range.start) && isDateString(range.end) && range.start <= range.end
  )) return false;
  return typeof value.copyText === 'string' && value.copyText.length <= 50000;
}

export function allowedOrigin(origin, configuredOrigins = '') {
  if (!origin) return '';
  const allowed = new Set([
    'https://ccats-calculator.netlify.app',
    ...configuredOrigins.split(',').map(value => value.trim()).filter(Boolean),
  ]);
  if (allowed.has(origin)) return origin;
  try {
    const url = new URL(origin);
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) return origin;
  } catch (_) {
    // Invalid Origin headers are denied.
  }
  return '';
}
