#!/usr/bin/env node
// Recoge los datos de la semana de un proyecto y los guarda en
// <proyecto>/seo/history/AAAA-MM-DD/. Cada fuente es opcional: si falta su
// credencial, se salta y queda anotado en summary.json.
//
//   GSC_SERVICE_ACCOUNT  JSON (o JSON en base64) de la cuenta de servicio con
//                        acceso restringido a la propiedad de config.gsc.property
//   APIFY_TOKEN          token de Apify (SERPs, respuestas de IA y volúmenes)
//
// Uso: node bin/collect.mjs --project <ruta> [--dry-run] [--volumes] [--no-gsc]
//   --volumes  fuerza la actualización de volúmenes (por defecto, 1.ª ejecución del mes)
//   --dry-run  no escribe nada ni llama a Apify; muestra el plan y su coste estimado
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_INPUT, PRICE, runActor } from '../lib/apify.mjs';
import { loadProject, parseArgs } from '../lib/config.mjs';
import { googleToken, gscClient, loadServiceAccount } from '../lib/gsc.mjs';
import { sitemapUrls } from '../lib/http.mjs';

const args = parseArgs();
const { seoDir, config, keywords, geo } = loadProject(args);
const dryRun = args.flags.has('dry-run');
const today = new Date().toISOString().slice(0, 10);
const histDir = join(seoDir, 'history');
const outDir = join(histDir, today);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const save = (name, data) => (dryRun ? null : writeFileSync(join(outDir, `${name}.json`), JSON.stringify(data, null, 2) + '\n'));
const summary = { project: config.project, date: today, dryRun, sources: {}, estimatedCostUsd: 0, notes: [] };

const mentionRe = new RegExp(config.brand.mentionPatterns.join('|'), 'i');
const mentionsBrand = (v) => mentionRe.test(JSON.stringify(v ?? ''));
const isOwnUrl = (u = '') => {
  try {
    return new URL(u).host.replace(/^www\./, '') === config.siteHost.replace(/^www\./, '');
  } catch {
    return false;
  }
};

// ---------- Presupuesto (por proyecto, sumando sus summary.json del mes) ----------
const monthDirs = () =>
  existsSync(histDir) ? readdirSync(histDir).filter((d) => d.startsWith(today.slice(0, 7)) && d !== today) : [];
const spentThisMonth = () =>
  monthDirs()
    .filter((d) => existsSync(join(histDir, d, 'summary.json')))
    .reduce((sum, d) => sum + (readJson(join(histDir, d, 'summary.json')).estimatedCostUsd || 0), 0);
const volumesDoneThisMonth = () => monthDirs().some((d) => existsSync(join(histDir, d, 'volumes.json')));

// ---------- Search Console ----------
const isoDaysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

async function collectGsc() {
  const { urls, sitemaps } = await sitemapUrls(config.site, config.sitemaps);
  summary.sitemap = { sitemaps, urls: urls.length };
  if (args.flags.has('no-gsc')) {
    summary.sources.gsc = 'omitido: --no-gsc';
    return;
  }
  const sa = loadServiceAccount();
  if (!sa) {
    summary.sources.gsc = 'omitido: falta GSC_SERVICE_ACCOUNT';
    return;
  }
  const gsc = gscClient(await googleToken(sa));
  const property = config.gsc.property;
  // Search Console publica con 2-3 días de retraso: ventana de 28 días terminada hace 3.
  const range = { startDate: isoDaysAgo(30), endDate: isoDaysAgo(3) };
  const query = (dimensions, rowLimit = 1000) => gsc.query(property, { ...range, dimensions, rowLimit, dataState: 'final' });
  const [byQueryPage, byPage, byCountry, byDevice] = await Promise.all([
    query(['query', 'page']),
    query(['page']),
    query(['country'], 50),
    query(['device'], 10),
  ]);
  save('gsc', { property, ...range, byQueryPage, byPage, byCountry, byDevice });

  const sm = await gsc.sitemaps(property).catch((e) => ({ error: String(e.message).slice(0, 200) }));
  save('gsc-sitemaps', sm);

  // Estado de indexación de las URLs del sitemap (URL Inspection API, gratis, cuota 2000/día).
  const inspection = [];
  for (const url of urls.slice(0, config.gsc.inspectMax)) {
    try {
      const r = await gsc.inspect(property, url, config.language);
      const s = r.inspectionResult?.indexStatusResult ?? {};
      inspection.push({
        url,
        verdict: s.verdict,
        coverageState: s.coverageState,
        lastCrawlTime: s.lastCrawlTime,
        googleCanonical: s.googleCanonical,
        userCanonical: s.userCanonical,
      });
    } catch (e) {
      inspection.push({ url, error: String(e.message).slice(0, 200) });
    }
  }
  save('inspection', inspection);
  if (urls.length > config.gsc.inspectMax) summary.notes.push(`Inspeccionadas ${config.gsc.inspectMax} de ${urls.length} URLs (gsc.inspectMax).`);
  summary.sources.gsc = `${byQueryPage.length} filas consulta/página, ${inspection.length} URLs inspeccionadas`;
}

// ---------- Apify ----------
const strip = ({ html, htmlSnapshotUrl, ...rest }) => rest;

function plan() {
  const serpQueries = keywords.filter((k) => k.role === 'primary' || k.role === 'backlog').map((k) => k.kw);
  const engines = config.apify.geoEngines;
  const serpCost = serpQueries.length * (PRICE.serpPage + PRICE.aiOverview);
  const geoQueries = geo.queries ?? [];
  const geoCost = geoQueries.length * (PRICE.serpPage + engines.reduce((s, e) => s + PRICE[e], 0));
  const doVolumes = args.flags.has('volumes') || !volumesDoneThisMonth();
  const volumeList = keywords.filter((k) => k.role !== 'discard').map((k) => k.kw);
  const seeds = keywords.filter((k) => k.role === 'primary').map((k) => k.kw).slice(0, 20);
  const ideasMax = seeds.length ? config.ideas.max : 0;
  const volCost =
    doVolumes && volumeList.length
      ? config.volumeMarkets.length * (PRICE.kwRequest + volumeList.length * PRICE.kwRow) + (ideasMax ? PRICE.kwRequest + ideasMax * PRICE.kwRow : 0)
      : 0;
  return { serpQueries, geoQueries, engines, serpCost, geoCost, doVolumes: doVolumes && volumeList.length > 0, volumeList, seeds, ideasMax, volCost };
}

async function collectApify() {
  const p = plan();
  const spent = spentThisMonth();
  const budget = config.apify.monthlyBudgetUsd;
  const planned = p.serpCost + p.geoCost + p.volCost;
  summary.budget = {
    monthlyUsd: budget,
    spentBeforeUsd: +spent.toFixed(3),
    plannedUsd: +planned.toFixed(3),
    breakdown: { serp: +p.serpCost.toFixed(3), geo: +p.geoCost.toFixed(3), volumes: +p.volCost.toFixed(3) },
  };
  if (dryRun) {
    summary.sources.apify = `dry-run: ${p.serpQueries.length} SERPs, ${p.geoQueries.length} preguntas GEO × [${p.engines.join(', ')}], volúmenes=${p.doVolumes} (${p.volumeList.length} kw × ${config.volumeMarkets.map((m) => m.key).join('+')}, ${p.ideasMax} ideas)`;
    if (planned > budget - spent) summary.notes.push(`Con el gasto actual, la ejecución real se saltaría Apify: plan ${planned.toFixed(2)} $ > quedan ${(budget - spent).toFixed(2)} $.`);
    return;
  }
  if (!process.env.APIFY_TOKEN) {
    summary.sources.apify = 'omitido: falta APIFY_TOKEN';
    return;
  }
  if (planned > budget - spent) {
    summary.sources.apify = `omitido: presupuesto (quedan ${(budget - spent).toFixed(2)} $ de ${budget} $ este mes)`;
    return;
  }

  // 1) SERPs de las keywords atacadas y del backlog, con AI Overview.
  let serpRows = [];
  if (p.serpQueries.length) {
    const serp = await runActor(
      'apify/google-search-scraper',
      {
        queries: p.serpQueries.join('\n'),
        maxPagesPerQuery: 1,
        countryCode: config.serp.country,
        languageCode: config.serp.language,
        ...ENGINE_INPUT.aiOverview,
        saveHtmlToKeyValueStore: false,
      },
      +(p.serpCost * 1.5 + 0.01).toFixed(2),
    );
    serpRows = serp.map((it) => {
      const organic = (it.organicResults ?? []).map((r) => ({ position: r.position, title: r.title, url: r.url }));
      const own = organic.find((r) => isOwnUrl(r.url));
      return {
        query: it.searchQuery?.term,
        ownPosition: own?.position ?? null,
        ownUrl: own?.url ?? null,
        aiOverviewMentionsBrand: mentionsBrand(it.aiOverview),
        organic,
        aiOverview: it.aiOverview ?? null,
        peopleAlsoAsk: (it.peopleAlsoAsk ?? []).map((q) => q.question ?? q.title),
        relatedQueries: (it.relatedQueries ?? []).map((q) => q.title ?? q.query),
      };
    });
    save('serp', serpRows);
    summary.estimatedCostUsd += p.serpCost;
  }

  // 2) GEO: la misma pregunta en los motores configurados.
  let geoRows = [];
  if (p.geoQueries.length) {
    const geoItems = await runActor(
      'apify/google-search-scraper',
      {
        queries: p.geoQueries.join('\n'),
        maxPagesPerQuery: 1,
        countryCode: geo.country ?? config.serp.country,
        languageCode: config.serp.language,
        ...Object.assign({}, ...p.engines.map((e) => ENGINE_INPUT[e])),
        saveHtmlToKeyValueStore: false,
      },
      +(p.geoCost * 1.5 + 0.01).toFixed(2),
    );
    geoRows = geoItems.map((it) => {
      const engines = Object.fromEntries(
        Object.entries(strip(it))
          .filter(([k]) => /aiOverview|aiMode|chatGpt|perplexity/i.test(k))
          .map(([k, v]) => [k, { mentionsBrand: mentionsBrand(v), answer: v }]),
      );
      return {
        query: it.searchQuery?.term,
        organicOwnPosition: (it.organicResults ?? []).find((r) => isOwnUrl(r.url))?.position ?? null,
        engines,
      };
    });
    save('geo', geoRows);
    summary.estimatedCostUsd += p.geoCost;
  }

  // 3) Volúmenes (mensual): métricas por mercado + ideas nuevas.
  if (p.doVolumes) {
    const volumes = {};
    for (const m of config.volumeMarkets) {
      volumes[m.key] = await runActor(
        'wrenfield-data/keyword-search-volume',
        { keywords: p.volumeList, mode: 'search_volume', location: m.location, language: m.language, includeMonthlySearches: true },
        +(PRICE.kwRequest + p.volumeList.length * PRICE.kwRow + 0.1).toFixed(2),
      );
    }
    if (p.ideasMax) {
      const im = config.volumeMarkets[0];
      volumes[`ideas_${im.key}`] = await runActor(
        'wrenfield-data/keyword-search-volume',
        {
          keywords: p.seeds,
          mode: 'keyword_ideas',
          location: config.ideas.location ?? im.location,
          language: config.ideas.language ?? im.language,
          maxIdeas: p.ideasMax,
          minSearchVolume: config.ideas.minSearchVolume,
          includeMonthlySearches: false,
        },
        +(PRICE.kwRequest + p.ideasMax * PRICE.kwRow + 0.1).toFixed(2),
      );
    }
    save('volumes', volumes);
    summary.estimatedCostUsd += p.volCost;
  }
  summary.estimatedCostUsd = +summary.estimatedCostUsd.toFixed(3);
  summary.sources.apify = `${serpRows.length} SERPs, ${geoRows.length} preguntas GEO, volúmenes=${p.doVolumes}`;
  summary.brand = {
    serpRanked: serpRows.filter((r) => r.ownPosition).map((r) => ({ query: r.query, position: r.ownPosition, url: r.ownUrl })),
    aiOverviewMentions: serpRows.filter((r) => r.aiOverviewMentionsBrand).map((r) => r.query),
    geoMentions: geoRows.flatMap((r) =>
      Object.entries(r.engines)
        .filter(([, v]) => v.mentionsBrand)
        .map(([engine]) => `${engine}: ${r.query}`),
    ),
  };
}

if (!dryRun) mkdirSync(outDir, { recursive: true });
for (const [name, fn] of [
  ['gsc', collectGsc],
  ['apify', collectApify],
]) {
  try {
    await fn();
  } catch (e) {
    summary.sources[name] = `error: ${String(e.message).slice(0, 300)}`;
    summary.notes.push(`${name} falló; el resto de fuentes sigue.`);
  }
}
save('summary', summary);
console.log(JSON.stringify(summary, null, 2));
