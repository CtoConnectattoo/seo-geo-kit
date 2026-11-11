// Normalización de texto y cobertura de keywords, por idioma.
const STOPWORDS = {
  es: ['en', 'de', 'del', 'la', 'las', 'el', 'los', 'a', 'al', 'para', 'con', 'que', 'es', 'como', 'un', 'una', 'y', 'o', 'mi', 'tu', 'su', 'por', 'se', 'lo', 'poner'],
  en: ['the', 'a', 'an', 'of', 'to', 'for', 'in', 'on', 'and', 'or', 'with', 'how', 'is', 'my', 'your', 'what'],
  pt: ['de', 'da', 'do', 'a', 'o', 'as', 'os', 'para', 'com', 'que', 'e', 'um', 'uma', 'em', 'no', 'na', 'como'],
};

export const norm = (s = '') =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function makeCoverage(language = 'es') {
  const stop = new Set(STOPWORDS[language.slice(0, 2)] ?? []);
  const terms = (kw) => norm(kw).split(' ').filter((w) => w && !stop.has(w));
  // Tolera plural/singular: «mensajes automaticos» cubre «mensaje automatico».
  const covers = (text, kw) => {
    const t = norm(text);
    return terms(kw).every((w) => t.includes(w.length > 3 ? w.replace(/(es|s)$/, '') : w));
  };
  return { terms, covers };
}

export const sentences = (text) => text.split(/(?<=[.!?¿¡])\s+/);
