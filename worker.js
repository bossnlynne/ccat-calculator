import { DurableObject } from 'cloudflare:workers';
import { MAX_BODY_BYTES, allowedOrigin, isValidCats, isValidSettings } from './worker-core.js';

const COMMON_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, X-Data-Version',
  'Access-Control-Expose-Headers': 'X-Data-Version',
  'Cache-Control': 'no-store',
  'Vary': 'Origin',
  'X-Content-Type-Options': 'nosniff',
};

function corsHeaders(request, env) {
  const origin = allowedOrigin(request.headers.get('Origin') || '', env.ALLOWED_ORIGINS || '');
  return origin ? { ...COMMON_HEADERS, 'Access-Control-Allow-Origin': origin } : COMMON_HEADERS;
}

function json(request, env, data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(request, env), ...extraHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function secureEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
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

export class CcatStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS records (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        revision TEXT NOT NULL
      )
    `);
  }

  getRecord(key) {
    return this.ctx.storage.sql
      .exec('SELECT value, revision FROM records WHERE key = ?', key)
      .toArray()[0] || null;
  }

  initializeIfEmpty(key, value, revision) {
    this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO records (key, value, revision) VALUES (?, ?, ?)',
      key,
      value,
      revision,
    );
    return this.getRecord(key);
  }

  writeRecord(key, value, expectedRevision) {
    const current = this.getRecord(key);
    const currentRevision = current?.revision || 'none';
    if (expectedRevision !== currentRevision) return { ok: false, revision: currentRevision };

    const revision = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      `INSERT INTO records (key, value, revision) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, revision = excluded.revision`,
      key,
      value,
      revision,
    );
    return { ok: true, revision };
  }
}

function store(env) {
  return env.CCAT_STORE.getByName('shared-settings');
}

async function getRecord(env, key, fallback) {
  const stub = store(env);
  const stored = await stub.getRecord(key);
  if (stored) return stored;

  // One-time compatibility path: preserve the data already stored in KV.
  const [legacyValue, legacyRevision] = await Promise.all([
    env.CCAT_CATS.get(key),
    env.CCAT_CATS.get(`${key}_revision`),
  ]);
  return stub.initializeIfEmpty(
    key,
    legacyValue || JSON.stringify(fallback),
    legacyRevision || (legacyValue ? 'legacy' : 'none'),
  );
}

async function writeRecord(request, env, key, validator) {
  if (!(await isAuthorized(request, env))) return json(request, env, { error: 'unauthorized' }, 401);

  let value;
  try {
    value = await readJson(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_json';
    return json(request, env, { error: message }, message === 'payload_too_large' ? 413 : 400);
  }
  if (!validator(value)) return json(request, env, { error: 'invalid_data' }, 400);

  await getRecord(env, key, key === 'cats' ? [] : {});
  const expected = request.headers.get('X-Data-Version') || '';
  const result = await store(env).writeRecord(key, JSON.stringify(value), expected);
  if (!result.ok) {
    return json(request, env, { error: 'version_conflict', revision: result.revision }, 409, {
      'X-Data-Version': result.revision,
    });
  }
  return json(request, env, { ok: true, revision: result.revision }, 200, {
    'X-Data-Version': result.revision,
  });
}

async function handleRequest(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (origin && !allowedOrigin(origin, env.ALLOWED_ORIGINS || '')) {
    return json(request, env, { error: 'origin_not_allowed' }, 403);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  const url = new URL(request.url);
  if (url.pathname === '/auth' && request.method === 'POST') {
    return (await isAuthorized(request, env))
      ? json(request, env, { ok: true })
      : json(request, env, { error: 'unauthorized' }, 401);
  }

  const routes = {
    '/cats': { key: 'cats', fallback: [], validator: isValidCats },
    '/settings': { key: 'settings', fallback: {}, validator: isValidSettings },
  };
  const route = routes[url.pathname];
  if (!route) return json(request, env, { error: 'not_found' }, 404);

  if (request.method === 'GET') {
    const record = await getRecord(env, route.key, route.fallback);
    return new Response(record.value, {
      headers: {
        ...corsHeaders(request, env),
        'Content-Type': 'application/json; charset=utf-8',
        'X-Data-Version': record.revision,
      },
    });
  }
  if (request.method === 'POST') return writeRecord(request, env, route.key, route.validator);
  return json(request, env, { error: 'method_not_allowed' }, 405, { Allow: 'GET, POST, OPTIONS' });
}

export default {
  async fetch(request, env) {
    const requestId = request.headers.get('CF-Ray') || crypto.randomUUID();
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'request_failed',
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return json(request, env, { error: 'internal_error', requestId }, 500);
    }
  },
};
