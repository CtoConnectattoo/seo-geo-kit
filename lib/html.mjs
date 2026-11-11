// Extracción de señales SEO de un HTML sin dependencias. Tolera el orden de
// atributos, comillas simples o dobles y entidades básicas.
const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
export const decode = (s = '') =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(parseInt(e.slice(e[1].toLowerCase() === 'x' ? 2 : 1), e[1].toLowerCase() === 'x' ? 16 : 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });

export function attrs(tagInner) {
  const out = {};
  // El primer caso recoge valores con comillas escapadas (href=\"/ruta\"), que el
  // navegador trata como una URL rota; se conservan tal cual para poder señalarlos.
  for (const m of tagInner.matchAll(/([\w:-]+)\s*=\s*(\\"[^"]*\\"|"([^"]*)"|'([^']*)'|([^\s>"']+))/g))
    out[m[1].toLowerCase()] = m[2].startsWith('\\"') ? m[2] : decode(m[3] ?? m[4] ?? m[5] ?? '');
  return out;
}
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map((m) => attrs(m[1]));
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const inner = (html, name) =>
  [...html.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'gi'))].map((m) => stripTags(m[1]));

export function parsePage(html, { mainSelector = 'main' } = {}) {
  const head = html.split(/<body\b/i)[0];
  const metas = tags(head, 'meta');
  const meta = (key, val) => metas.find((a) => (a[key] ?? '').toLowerCase() === val)?.content?.trim() ?? '';
  const links = tags(head, 'link');
  const htmlTag = tags(html, 'html')[0] ?? {};
  const scrub = (s) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const body = html.split(/<body\b[^>]*>/i)[1]?.split(/<\/body>/i)[0] ?? html;
  let main = mainSelector === 'main' ? html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] : null;
  const hasMain = !!main;
  if (!main) main = body;
  const text = stripTags(scrub(main));
  return {
    lang: htmlTag.lang ?? '',
    title: inner(head, 'title')[0] ?? '',
    description: meta('name', 'description'),
    robots: meta('name', 'robots').toLowerCase(),
    canonical: links.find((a) => (a.rel ?? '').toLowerCase().split(/\s+/).includes('canonical'))?.href ?? '',
    ogImage: meta('property', 'og:image'),
    h1s: inner(html, 'h1'),
    h2s: inner(html, 'h2'),
    jsonLd: [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]),
    text,
    words: text.split(/\s+/).filter(Boolean).length,
    hasMain,
    hrefs: tags(scrub(main), 'a').map((a) => a.href).filter(Boolean),
  };
}
