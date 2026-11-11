#!/usr/bin/env node
// Auditoría SEO agnóstica de stack.
//   --source build  lee el HTML compilado (config.build.outputDirs)
//   --source live   rastrea el sitio publicado desde sus sitemaps
//   (por defecto: build si existe un directorio con index.html; si no, live)
// Errores (salida 1): lo que no puede llegar a producción. Avisos: oportunidades.
//
// Uso: node bin/audit.mjs --project <ruta> [--source live|build] [--json]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { loadProject, parseArgs } from '../lib/config.mjs';
import { parsePage } from '../lib/html.mjs';
import { follow, get, pool, sitemapUrls } from '../lib/http.mjs';
import { makeCoverage, norm, sentences } from '../lib/text.mjs';

const args = parseArgs();
const { root, config, keywords } = loadProject(args);
const { covers } = makeCoverage(config.language);
const A = config.audit;
const errors = [];
const warnings = [];
const info = {};
const err = (url, m) => errors.push(`${url}: ${m}`);
const warn = (url, m) => warnings.push(`${url}: ${m}`);

// Clave canónica de una ruta: sin query ni hash, sin barra final (salvo «/»).
const key = (path) => {
  const p = decodeURI(path.split(/[?#]/)[0] || '/').replace(/\/index\.html$|\.html$/, '').replace(/\/+$/, '');
  return p || '/';
};
const host = (h) => h.replace(/^www\./, '');
const internalPath = (href, base) => {
  if (!href || /^(mailto|tel|javascript|data):/i.test(href) || href.startsWith('#')) return null;
  let u;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || host(u.host) !== host(config.siteHost)) return null;
  const ext = extname(u.pathname);
  if (ext && ext !== '.html') return null; // recursos (pdf, imágenes…)
  return key(u.pathname);
};
const re = (list) => (list.length ? new RegExp(list.join('|'), 'i') : null);
const thinExclude = re(A.thinContentExclude);
const orphanExclude = re(A.orphanExclude);
const placeholders = A.placeholderMarkers.length ? new RegExp(`\\[(${A.placeholderMarkers.join('|')})`) : null;
const forbidden = config.forbiddenClaims.map((f) => ({ re: new RegExp(f.pattern, 'i'), why: f.why }));
const negation = new RegExp(`(^|[^\\p{L}])(${config.negationWords.join('|')})(?=$|[^\\p{L}])`, 'iu');

// ---------- Origen de las páginas ----------
let source = args.values.source;
const outDir = config.build.outputDirs.map((d) => join(root, d)).find((d) => existsSync(join(d, 'index.html')));
if (!source) source = outDir ? 'build' : 'live';
if (source === 'build' && !outDir) {
  console.error(`No hay build en ${config.build.outputDirs.join(', ')}${config.build.command ? `: ejecuta «${config.build.command}»` : ''} o usa --source live.`);
  process.exit(2);
}

const pages = []; // { url, html, status?, headers?, finalUrl? }
let sitemapSet = new Set();
let sitemapsFound = [];
if (source === 'build') {
  (function walk(dir) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.html')) pages.push({ url: key('/' + p.slice(outDir.length + 1)), html: readFileSync(p, 'utf8') });
    }
  })(outDir);
  for (const f of readdirSync(outDir).filter((f) => /^sitemap.*\.xml$/.test(f)))
    for (const m of readFileSync(join(outDir, f), 'utf8').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g))
      if (!/\.xml$/.test(m[1])) sitemapSet.add(key(new URL(m[1]).pathname));
  sitemapsFound = readdirSync(outDir).filter((f) => /^sitemap.*\.xml$/.test(f));
} else {
  // Sitio en vivo: robots.txt, sitemaps y cada URL (con 4 peticiones en paralelo).
  const robots = await get(new URL('/robots.txt', config.site).href).catch(() => null);
  if (!robots || robots.status !== 200) warn('/robots.txt', `no disponible (${robots?.status ?? 'sin respuesta'})`);
  else {
    if (/^\s*disallow:\s*\/\s*$/im.test(robots.text)) err('/robots.txt', 'bloquea todo el sitio (Disallow: /)');
    const declared = [...robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
    if (!declared.length) warn('/robots.txt', 'no declara el sitemap');
    config.sitemaps = [...new Set([...declared, ...config.sitemaps])];
  }
  const sm = await sitemapUrls(config.site, config.sitemaps, { limit: A.maxPages });
  sitemapsFound = sm.sitemaps;
  if (!sm.urls.length) err('sitemap', `no encuentro URLs en ${config.sitemaps.join(', ')}`);
  for (const u of sm.urls) {
    if (host(new URL(u).host) !== host(config.siteHost)) err('sitemap', `URL de otro dominio: ${u}`);
    sitemapSet.add(key(new URL(u).pathname));
  }
  const queue = [...sitemapSet];
  const seen = new Set(queue);
  // Además de las del sitemap, se rastrean las páginas enlazadas (hasta maxPages).
  while (queue.length) {
    const batch = queue.splice(0, queue.length);
    const fetched = await pool(batch, 4, async (path) => {
      const url = new URL(path, config.site).href + (config.build.trailingSlash && path !== '/' ? '/' : '');
      try {
        const r = await follow(url);
        return { url: path, html: r.text, status: r.status, headers: r.headers, finalUrl: r.finalUrl, chain: r.chain };
      } catch (e) {
        return { url: path, html: '', status: 0, error: String(e.message).slice(0, 120) };
      }
    });
    for (const pg of fetched) {
      pages.push(pg);
      if (pg.status !== 200) continue;
      for (const h of parsePage(pg.html, A).hrefs) {
        const t = internalPath(h, config.site);
        if (t && !seen.has(t) && seen.size < A.maxPages) {
          seen.add(t);
          queue.push(t);
        }
      }
    }
  }
}

// ---------- Comprobaciones por página ----------
for (const pg of pages) {
  const { url } = pg;
  if (source === 'live') {
    if (pg.status === 0) {
      err(url, `sin respuesta (${pg.error})`);
      continue;
    }
    if (pg.chain?.length > 1) {
      const fin = key(new URL(pg.finalUrl).pathname);
      if (sitemapSet.has(url)) err(url, `está en el sitemap pero redirige (${pg.chain.map((c) => c.status).join('→')}) a ${pg.finalUrl}`);
      if (fin !== url && pg.status === 200) {
        info[url] = { redirectTo: fin };
        continue;
      }
    }
    if (pg.status !== 200) {
      if (pg.status === 404 || pg.status === 410) err(url, `${pg.status}${sitemapSet.has(url) ? ' (en el sitemap)' : ' (enlazada desde el contenido)'}`);
      else err(url, `HTTP ${pg.status}`);
      info[url] = { status: pg.status };
      continue;
    }
  }
  const p = parsePage(pg.html, A);
  const xRobots = pg.headers?.get?.('x-robots-tag') ?? '';
  const noindex = /noindex/.test(p.robots) || /noindex/i.test(xRobots);
  const links = p.hrefs.map((h) => internalPath(h, new URL(url, config.site).href)).filter(Boolean);
  info[url] = { title: p.title, description: p.description, h1: p.h1s[0] ?? '', h2s: p.h2s, noindex, words: p.words, links, canonical: p.canonical };

  if (!p.lang) err(url, 'falta el atributo lang en <html>');
  else if (!p.lang.toLowerCase().startsWith(config.language.slice(0, 2))) err(url, `lang="${p.lang}" (se esperaba ${config.language})`);
  if (p.h1s.length !== 1) err(url, `${p.h1s.length} H1 (debe haber 1)`);
  if (!p.title) err(url, 'sin <title>');
  else if (p.title.length > 70) warn(url, `title de ${p.title.length} caracteres (Google corta a ~60)`);
  if (!p.description) err(url, 'sin meta description');
  else if (p.description.length < 70 || p.description.length > 170) warn(url, `description de ${p.description.length} caracteres (ideal 120-160)`);
  if (!p.canonical) err(url, 'sin canonical');
  else {
    let c;
    try {
      c = new URL(p.canonical);
    } catch {
      err(url, `canonical no absoluto: ${p.canonical}`);
    }
    if (c && c.origin !== config.site) err(url, `canonical a otro origen: ${p.canonical} (se esperaba ${config.site})`);
    else if (c && key(c.pathname) !== url && !noindex) warn(url, `canonical apunta a otra URL: ${c.pathname}`);
  }
  if (A.requireOgImage && !p.ogImage) err(url, 'sin og:image');
  for (const block of p.jsonLd) {
    try {
      JSON.parse(block);
    } catch {
      err(url, 'JSON-LD inválido');
    }
  }
  if (placeholders?.test(pg.html)) err(url, `quedan marcadores [${A.placeholderMarkers.join(']/[')}]`);
  for (const s of sentences(p.text))
    for (const f of forbidden) if (f.re.test(s) && !negation.test(s)) err(url, `${f.why}: «${s.trim().slice(0, 90)}»`);
  if (noindex && sitemapSet.has(url)) err(url, 'noindex pero está en el sitemap');
  if (!noindex && sitemapSet.size && !sitemapSet.has(url)) warn(url, 'indexable pero no está en el sitemap');
  if (!noindex && p.words < A.minWords && !thinExclude?.test(url)) warn(url, `contenido corto (${p.words} palabras${p.hasMain ? '' : ', sin <main>'})`);
}

// ---------- Enlaces internos y huérfanas ----------
const inbound = {};
for (const [from, p] of Object.entries(info))
  for (const to of p.links ?? []) {
    const target = info[to]?.redirectTo ?? to;
    // En vivo, una página sin rastrear (límite maxPages) no cuenta como rota.
    if (source === 'build' ? !info[target] : info[target]?.status) errors.push(`${from}: enlace interno roto a ${to}`);
    else if (!info[target]) continue;
    else if (target !== from) inbound[target] = (inbound[target] ?? 0) + 1;
    if (info[to]?.redirectTo) warnings.push(`${from}: enlace interno a ${to}, que redirige a ${info[to].redirectTo}`);
  }
for (const [url, p] of Object.entries(info))
  if (p.title !== undefined && !p.noindex && url !== '/' && !orphanExclude?.test(url) && (inbound[url] ?? 0) < A.minInboundLinks)
    warnings.push(`${url}: solo ${inbound[url] ?? 0} enlaces internos desde el contenido de otras páginas`);

// ---------- Mapa de keywords: cobertura y canibalización ----------
const firstThreshold = config.thresholds.newPage[0];
const primaries = {};
for (const k of keywords) {
  if (!k.url || k.role === 'discard' || k.role === 'watch') continue;
  const u = key(k.url);
  const p = info[u];
  if (!p || p.status || p.redirectTo) {
    errors.push(`keywords.json: «${k.kw}» apunta a ${k.url}, que no existe${p?.redirectTo ? ` (redirige a ${p.redirectTo})` : ''}`);
    continue;
  }
  if (k.role === 'primary') {
    (primaries[norm(k.kw)] ??= []).push(u);
    if (!covers(p.title, k.kw) && !covers(p.h1, k.kw)) warnings.push(`${u}: la keyword principal «${k.kw}» no está en el title ni en el H1`);
  }
  if (k.role === 'secondary' && firstThreshold && (k[firstThreshold.field] ?? 0) >= firstThreshold.min && ![p.title, p.h1, ...p.h2s].some((t) => covers(t, k.kw)))
    warnings.push(`${u}: la secundaria «${k.kw}» (${k[firstThreshold.field]}/mes en ${firstThreshold.field}) no aparece en title, H1 ni H2`);
}
for (const [kw, urls] of Object.entries(primaries)) if (urls.length > 1) errors.push(`canibalización: «${kw}» es principal en ${urls.join(', ')}`);
const byTitle = {};
for (const [url, p] of Object.entries(info)) if (p.title && !p.noindex) (byTitle[norm(p.title)] ??= []).push(url);
for (const urls of Object.values(byTitle)) if (urls.length > 1) errors.push(`title duplicado en ${urls.join(', ')}`);

// ---------- Salida ----------
const result = {
  project: config.project,
  source,
  origin: source === 'build' ? outDir : config.site,
  sitemaps: sitemapsFound,
  pages: Object.values(info).filter((p) => p.title !== undefined).length,
  errors,
  warnings,
};
if (args.flags.has('json')) console.log(JSON.stringify({ ...result, info }, null, 2));
else {
  console.log(`Auditoría SEO · ${config.project} · ${source} (${result.origin}) · ${result.pages} páginas`);
  console.log(`\nErrores (${errors.length})`);
  errors.forEach((e) => console.log(`  ✗ ${e}`));
  console.log(`\nAvisos (${warnings.length})`);
  warnings.forEach((w) => console.log(`  · ${w}`));
}
process.exit(errors.length ? 1 : 0);
