const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, X-Data-Version',
  'Access-Control-Expose-Headers': 'X-Data-Version',
  'Cache-Control': 'no-store',
};

const MAX_BODY_BYTES = 256 * 1024;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, ...extraHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function secureEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

async function isAuthorized(request, env) {
  const provided = request.headers.get('X-Admin-Key') || '';
  return Boolean(env.ADMIN_KEY) && secureEqual(provided, env.ADMIN_KEY);
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > MAX_BODY_BYTES) throw new Error('payload_too_large');
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new Error('payload_too_large');
  return JSON.parse(body);
}

function isValidCats(value) {
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

function isDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1000000;
}

function isValidSettings(value) {
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

async function getRecord(env, key, fallback) {
  const [raw, revision] = await Promise.all([
    env.CCAT_CATS.get(key),
    env.CCAT_CATS.get(`${key}_revision`),
  ]);
  return {
    raw: raw || JSON.stringify(fallback),
    revision: revision || (raw ? 'legacy' : 'none'),
  };
}

async function writeRecord(request, env, key, validator) {
  if (!(await isAuthorized(request, env))) return json({ error: 'unauthorized' }, 401);

  let value;
  try {
    value = await readJson(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'invalid_json' }, error?.message === 'payload_too_large' ? 413 : 400);
  }
  if (!validator(value)) return json({ error: 'invalid_data' }, 400);

  const current = await getRecord(env, key, key === 'cats' ? [] : {});
  const expected = request.headers.get('X-Data-Version') || '';
  if (expected !== current.revision) {
    return json({ error: 'version_conflict', revision: current.revision }, 409, { 'X-Data-Version': current.revision });
  }

  const revision = crypto.randomUUID();
  await Promise.all([
    env.CCAT_CATS.put(key, JSON.stringify(value)),
    env.CCAT_CATS.put(`${key}_revision`, revision),
  ]);
  return json({ ok: true, revision }, 200, { 'X-Data-Version': revision });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);

    if (url.pathname === '/auth' && request.method === 'POST') {
      return (await isAuthorized(request, env)) ? json({ ok: true }) : json({ error: 'unauthorized' }, 401);
    }

    if (url.pathname === '/cats') {
      if (request.method === 'GET') {
        const record = await getRecord(env, 'cats', []);
        return new Response(record.raw, {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'X-Data-Version': record.revision },
        });
      }
      if (request.method === 'POST') return writeRecord(request, env, 'cats', isValidCats);
    }

    if (url.pathname === '/settings') {
      if (request.method === 'GET') {
        const record = await getRecord(env, 'settings', {});
        return new Response(record.raw, {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'X-Data-Version': record.revision },
        });
      }
      if (request.method === 'POST') return writeRecord(request, env, 'settings', isValidSettings);
    }

    return json({ error: 'not_found' }, 404);
  },
};
