// Catálogo de producto opcional: qué hace el producto hoy, según su código.
//
// Se activa con config.product.catalog (ruta relativa al repo del proyecto) o, si no
// se indica, cuando existe seo/producto/funcionalidades.json. Con config.product.enabled
// = false se ignora. Sin catálogo, la auditoría funciona como siempre.
//
// Formato (lo genera el repo del producto, p. ej. hi.inkup → producto/catalogo.py json):
// {
//   "producto": "inkup",
//   "promesas_prohibidas": [{ "pattern": "regex", "why": "..." }],
//   "coherencia": [{ "que": "consultas al mes", "patron": "regex con (grupo 1 numérico)", "permitidos": ["100", "1000"] }],
//   "funcionalidades": [{ "id", "nombre", "estado": "en-desarrollo|beta|activa|oculta|retirada",
//                        "menciones": ["regex"], "en_web": true, "claims_prohibidos": [] }]
// }
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ESTADOS = ['en-desarrollo', 'beta', 'activa', 'oculta', 'retirada'];
const rx = (p) => new RegExp(p, 'i');

export function loadProduct(root, seoDir, product = {}) {
  if (product.enabled === false) return null;
  const path = product.catalog ? resolve(root, product.catalog) : join(seoDir, 'producto', 'funcionalidades.json');
  if (!existsSync(path)) {
    if (product.catalog) {
      console.error(`config.product.catalog apunta a ${path}, que no existe.`);
      process.exit(2);
    }
    return null;
  }
  const catalog = JSON.parse(readFileSync(path, 'utf8'));
  const errors = checkCatalog(catalog);
  if (errors.length) {
    console.error(`El catálogo de producto ${path} no es válido:\n  ${errors.join('\n  ')}`);
    process.exit(2);
  }
  return { path, catalog, checkUnmentioned: product.checkUnmentioned !== false };
}

export function checkCatalog(c) {
  const e = [];
  if (!Array.isArray(c?.funcionalidades)) return ['falta la lista «funcionalidades»'];
  const ids = new Set();
  for (const [i, f] of c.funcionalidades.entries()) {
    const at = `funcionalidades[${i}]${f?.id ? ` (${f.id})` : ''}`;
    if (!f?.id) e.push(`${at}: falta «id»`);
    else if (ids.has(f.id)) e.push(`${at}: id repetido`);
    ids.add(f?.id);
    if (!ESTADOS.includes(f?.estado)) e.push(`${at}: estado «${f?.estado}» (usa ${ESTADOS.join(', ')})`);
    for (const m of f?.menciones ?? [])
      try {
        rx(m);
      } catch {
        e.push(`${at}: mención no es una expresión regular válida: ${m}`);
      }
  }
  for (const [i, p] of (c.promesas_prohibidas ?? []).entries())
    try {
      rx(p.pattern);
    } catch {
      e.push(`promesas_prohibidas[${i}]: patrón inválido`);
    }
  for (const [i, r] of (c.coherencia ?? []).entries()) {
    if (!Array.isArray(r.permitidos)) e.push(`coherencia[${i}]: falta «permitidos»`);
    try {
      rx(r.patron);
    } catch {
      e.push(`coherencia[${i}]: patrón inválido`);
    }
  }
  return e;
}

// Reglas listas para la auditoría.
export function productRules({ catalog }) {
  const funcs = catalog.funcionalidades;
  const label = (f) => f.nombre ?? f.id;
  return {
    // Errores como config.forbiddenClaims (salvo frase negada o pregunta): promesas
    // prohibidas del catálogo y menciones de funcionalidades retiradas.
    forbidden: [
      ...(catalog.promesas_prohibidas ?? []).map((p) => ({ re: rx(p.pattern), why: p.why })),
      ...funcs
        .filter((f) => f.estado === 'retirada')
        .flatMap((f) => (f.menciones ?? []).map((m) => ({ re: rx(m), why: `menciona «${label(f)}», funcionalidad retirada` }))),
    ],
    // Aviso por página: no se comunica lo que está oculto, en beta o sin construir.
    notPublic: funcs
      .filter((f) => ['oculta', 'beta', 'en-desarrollo'].includes(f.estado) && f.menciones?.length)
      .map((f) => ({ f, label: label(f), res: f.menciones.map(rx) })),
    // Aviso global: activa y pensada para la web, pero ninguna página la menciona.
    expected: funcs
      .filter((f) => f.estado === 'activa' && f.en_web && f.menciones?.length)
      .map((f) => ({ f, label: label(f), res: f.menciones.map(rx) })),
    // Cifras de planes y límites que no existen.
    coherence: (catalog.coherencia ?? []).map((r) => ({
      que: r.que,
      re: new RegExp(r.patron, 'gi'),
      allowed: new Set(r.permitidos.map(String).flatMap((n) => [n, n.replace(/[.,]/g, '')])),
      list: r.permitidos.join(', '),
    })),
  };
}
