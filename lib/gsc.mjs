// Search Console con una cuenta de servicio (JWT RS256, sin dependencias).
// GSC_SERVICE_ACCOUNT: JSON de la clave o el mismo JSON en base64.
import { createSign } from 'node:crypto';

export function loadServiceAccount(raw = process.env.GSC_SERVICE_ACCOUNT) {
  if (!raw) return null;
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(text);
}

export async function googleToken(sa, scope = 'https://www.googleapis.com/auth/webmasters.readonly') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(`token de Google: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

export function gscClient(token) {
  const call = async (url, body, method = 'POST') => {
    const res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${url.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  const site = (property) => `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}`;
  return {
    sites: () => call('https://www.googleapis.com/webmasters/v3/sites', null, 'GET'),
    sitemaps: (property) => call(`${site(property)}/sitemaps`, null, 'GET'),
    query: (property, body) => call(`${site(property)}/searchAnalytics/query`, body).then((r) => r.rows ?? []),
    inspect: (property, url, languageCode) =>
      call('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { inspectionUrl: url, siteUrl: property, languageCode }),
  };
}
