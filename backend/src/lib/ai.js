const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:5001';

async function call(path, opts = {}, timeoutMs = 3500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(AI_URL + path, { ...opts, signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(process.env.AI_API_KEY ? { 'x-api-key': process.env.AI_API_KEY } : {}) } });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body };
  } finally { clearTimeout(t); }
}

// Never throws: the deterministic verdict must still work when the AI service is down.
async function predict(payload) {
  try {
    const { ok, body } = await call('/predict', { method: 'POST', body: JSON.stringify(payload) });
    return ok ? body : { supported: false, reason: 'ai_error' };
  } catch {
    return { supported: false, reason: 'ai_unavailable' };
  }
}
const status = async () => { try { return (await call('/status')).body; } catch { return { trained: false, unavailable: true }; } };
const train = async (body) => call('/train', { method: 'POST', body: JSON.stringify(body || {}) }, 120000);

module.exports = { predict, status, train };
