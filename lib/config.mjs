// Carga y valida seo/config.json del proyecto, con valores por defecto.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './schema.mjs';

export const KIT_ROOT = fileURLToPath(new URL('../', import.meta.url));

const DEFAULTS = {
  sitemaps: ['/sitemap.xml', '/sitemap-index.xml'],
  language: 'es',
  gsc: { inspectMax: 100 },
  serp: { country: 'es', language: 'es' },
  volumeMarkets: [{ key: 'es', location: 'Spain', language: 'Spanish' }],
  ideas: { max: 100, minSearchVolume: 10 },
  thresholds: {
    newPage: [{ field: 'es', min: 30 }],
    weeklyLimits: { newPages: 1, optimizations: 2 },
  },
  apify: { monthlyBudgetUsd: 6, geoEngines: ['aiOverview', 'aiMode', 'chatGpt', 'perplexity'] },
  build: { command: '', outputDirs: ['.vercel/output/static', 'dist/client', 'dist', 'out', 'build', 'public'], trailingSlash: false },
  audit: {
    mainSelector: 'main',
    minWords: 300,
    minInboundLinks: 2,
    thinContentExclude: ['aviso-legal', 'privacidad', 'cookies', 'legal', 'terminos'],
    orphanExclude: ['aviso-legal', 'privacidad', 'cookies', 'legal', 'terminos'],
    placeholderMarkers: ['VERIFICAR', 'COMPLETAR', 'CONFIRMAR'],
    requireOgImage: true,
    maxPages: 200,
  },
  forbiddenClaims: [],
  negationWords: ['no', 'nunca', 'sin', 'tampoco', 'ni'],
  protectedPaths: [],
  pr: { base: 'main', branchPrefix: 'seo/' },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set();
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, inline] = a.slice(2).split('=');
    if (inline !== undefined) values[k] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--') && ['project', 'source', 'config'].includes(k)) values[k] = argv[++i];
    else flags.add(k);
  }
  return { flags, values };
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function loadProject(args = parseArgs()) {
  const root = resolve(args.values.project ?? process.env.SEO_PROJECT ?? process.cwd());
  const seoDir = join(root, 'seo');
  const configPath = args.values.config ? resolve(args.values.config) : join(seoDir, 'config.json');
  if (!existsSync(configPath)) {
    console.error(`No encuentro ${configPath}. Pasa --project <ruta del repo> o crea seo/config.json (plantilla en templates/).`);
    process.exit(2);
  }
  const raw = readJson(configPath);
  const schema = readJson(join(KIT_ROOT, 'schema/config.schema.json'));
  const errors = validate(schema, raw);
  if (errors.length) {
    console.error(`seo/config.json no es válido:\n  ${errors.join('\n  ')}`);
    process.exit(2);
  }
  const config = merge(DEFAULTS, raw);
  config.siteHost = new URL(config.site).host;
  config.brand.mentionPatterns ??= [config.brand.name, config.siteHost.replace(/^www\./, '')].map((s) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  const optional = (name, fallback) => (existsSync(join(seoDir, name)) ? readJson(join(seoDir, name)) : fallback);
  return {
    root,
    seoDir,
    config,
    keywords: optional('keywords.json', { keywords: [] }).keywords ?? [],
    geo: optional('geo-queries.json', { queries: [] }),
  };
}
