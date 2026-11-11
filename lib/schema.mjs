// Validador mínimo de JSON Schema (subconjunto usado por schema/config.schema.json):
// type, required, properties, additionalProperties, items, enum, minimum, maximum,
// minItems, minLength, pattern, format=uri. Sin dependencias.
const typeOf = (v) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;
const matchesType = (v, t) => {
  const actual = typeOf(v);
  return actual === t || (t === 'number' && actual === 'integer');
};

export function validate(schema, value, path = '$', errors = []) {
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path}: se esperaba ${types.join(' | ')} y hay ${typeOf(value)}`);
      return errors;
    }
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value)))
    errors.push(`${path}: debe ser uno de ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: mínimo ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: máximo ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: vacío`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: no cumple ${schema.pattern}`);
    if (schema.format === 'uri' && !/^https?:\/\/[^/\s]+/.test(value)) errors.push(`${path}: no es una URL http(s)`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: al menos ${schema.minItems} elementos`);
    if (schema.items) value.forEach((v, i) => validate(schema.items, v, `${path}[${i}]`, errors));
  }
  if (typeOf(value) === 'object') {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${path}: falta «${k}»`);
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('$') || k.startsWith('_')) continue; // $schema, _doc
      const sub = schema.properties?.[k];
      if (sub) validate(sub, v, `${path}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: propiedad desconocida «${k}»`);
      else if (typeof schema.additionalProperties === 'object') validate(schema.additionalProperties, v, `${path}.${k}`, errors);
    }
  }
  return errors;
}
