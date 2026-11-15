const KEY = 'cal_token';
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

async function request(method, url, body) {
  const res = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && getToken()) { setToken(null); window.location.assign('/login'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}
export const api = { get: (u) => request('GET', u), post: (u, b) => request('POST', u, b || {}), put: (u, b) => request('PUT', u, b), patch: (u, b) => request('PATCH', u, b), del: (u) => request('DELETE', u) };

// Download a PDF with the auth header and hand it to the browser.
export async function downloadPdf(url, fallbackName) {
  const res = await fetch('/api' + url, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message || 'Download failed'); }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
  const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
