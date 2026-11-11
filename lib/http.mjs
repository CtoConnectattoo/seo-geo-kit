// Peticiones HTTP del kit (UA propio, tiempo máximo) y lectura de sitemaps.
export const UA = 'seo-geo-kit/1.0 (+https://github.com/CtoConnectattoo/seo-geo-kit)';

export async function get(url, { timeoutMs = 20000, method = 'GET' } = {}) {
  const res = await fetch(url, {
    method,
    redirect: 'manual',
    headers: { 'user-agent': UA, accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, headers: res.headers, location: res.headers.get('location'), text: method === 'HEAD' ? '' : await res.text() };
}

// Sigue redirecciones (máx. 5) y devuelve la cadena.
export async function follow(url, opts) {
  const chain = [];
  let current = url;
  for (let i = 0; i < 6; i++) {
    const r = await get(current, opts);
    chain.push({ url: current, status: r.status });
    if (r.status >= 300 && r.status < 400 && r.location) current = new URL(r.location, current).href;
    else return { ...r, finalUrl: current, chain };
  }
  throw new Error(`demasiadas redirecciones desde ${url}`);
}

// Lee los sitemaps configurados, siguiendo índices. Devuelve URLs únicas.
export async function sitemapUrls(site, sitemaps, { limit = 5000 } = {}) {
  const seen = new Set();
  const urls = new Set();
  const found = [];
  const queue = sitemaps.map((s) => new URL(s, site).href);
  while (queue.length && urls.size < limit) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    let r;
    try {
      r = await follow(sm);
    } catch {
      continue;
    }
    if (r.status !== 200) continue;
    found.push(r.finalUrl);
    const locs = [...r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    if (/<sitemapindex\b/i.test(r.text)) queue.push(...locs);
    else locs.forEach((u) => urls.add(u));
  }
  return { sitemaps: found, urls: [...urls].slice(0, limit) };
}

export async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}
