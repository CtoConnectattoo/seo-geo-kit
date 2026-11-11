#!/usr/bin/env node
// Valida seo/config.json, keywords.json y geo-queries.json de un proyecto.
// Uso: node bin/validate.mjs --project <ruta>
import { loadProject, parseArgs } from '../lib/config.mjs';
import { norm } from '../lib/text.mjs';

const { config, keywords, geo } = loadProject(parseArgs()); // sale con 2 si config.json no es válido
const problems = [];
const ROLES = new Set(['primary', 'secondary', 'backlog', 'watch', 'discard']);
const seen = new Set();
const primaryUrl = {};
for (const [i, k] of keywords.entries()) {
  if (!k.kw) problems.push(`keywords[${i}]: falta kw`);
  if (!ROLES.has(k.role)) problems.push(`keywords[${i}] «${k.kw}»: role «${k.role}» no válido`);
  if (seen.has(norm(k.kw))) problems.push(`keywords[${i}] «${k.kw}»: duplicada`);
  seen.add(norm(k.kw));
  if (k.url && !k.url.startsWith('/')) problems.push(`keywords[${i}] «${k.kw}»: url debe ser una ruta (/…)`);
  if (k.role === 'primary') {
    if (!k.url) problems.push(`keywords[${i}] «${k.kw}»: una primary necesita url`);
    else if (primaryUrl[norm(k.kw)]) problems.push(`«${k.kw}» es primary dos veces`);
    primaryUrl[norm(k.kw)] = k.url;
  }
}
if (!Array.isArray(geo.queries)) problems.push('geo-queries.json: falta queries[]');
else if (geo.queries.length > 10) problems.push(`geo-queries.json: ${geo.queries.length} preguntas (máximo 10 por presupuesto)`);

console.log(`${config.project}: config.json válido · ${keywords.length} keywords · ${geo.queries?.length ?? 0} preguntas GEO`);
problems.forEach((p) => console.log(`  ✗ ${p}`));
process.exit(problems.length ? 1 : 0);
