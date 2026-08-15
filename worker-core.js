export const MAX_BODY_BYTES = 256 * 1024;

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { values.push(value.trim()); value = ''; }
    else value += char;
  }
  values.push(value.trim());
  return values;
}

function addDays(ymd, days) {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function parseOfficialHolidayCsv(csv, year) {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('official_csv_empty');
  const headers = parseCsvLine(lines[0]);
  const dateIndex = headers.findIndex(value => value.includes('西元日期'));
  const holidayIndex = headers.findIndex(value => value.includes('是否放假'));
  const noteIndex = headers.findIndex(value => value.includes('備註'));
  if (dateIndex < 0 || holidayIndex < 0 || noteIndex < 0) throw new Error('official_csv_schema_changed');
  const rows = lines.slice(1).map(parseCsvLine).map(cols => {
    const digits = String(cols[dateIndex]).replace(/\D/g, '');
    return {
      date: digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : '',
      holiday: cols[holidayIndex] === '2',
      note: cols[noteIndex] || '',
    };
  }).filter(row => row.date.startsWith(`${year}-`));
  const byDate = new Map(rows.map(row => [row.date, row]));
  const seeds = rows.filter(row => row.holiday && row.note && !/星期[六日]|例假日/.test(row.note));
  const blocks = [];
  for (const seed of seeds) {
    let start = seed.date;
    let end = seed.date;
    while (byDate.get(addDays(start, -1))?.holiday) start = addDays(start, -1);
    while (byDate.get(addDays(end, 1))?.holiday) end = addDays(end, 1);
    const existing = blocks.find(block => start <= addDays(block.end, 1) && end >= addDays(block.start, -1));
    if (existing) {
      existing.start = existing.start < start ? existing.start : start;
      existing.end = existing.end > end ? existing.end : end;
      if (!existing.names.includes(seed.note)) existing.names.push(seed.note);
    } else blocks.push({ start, end, names: [seed.note] });
  }
  return blocks.map(block => ({ name: block.names.join('、'), officialStart: block.start, officialEnd: block.end }));
}

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
