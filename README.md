# seo-geo-kit

Motor compartido del agente SEO (Google) y GEO (AI Overview, AI Mode, ChatGPT, Perplexity) de los proyectos de Connectattoo. Cada proyecto aporta solo su `seo/config.json` y sus datos; el kit pone el colector, la auditoría, el playbook semanal y las plantillas. Nacido del agente de kalmaa.io.

Node ≥ 20, sin dependencias.

## Piezas

| Ruta | Qué es |
|---|---|
| `bin/collect.mjs` | Recoge la semana en `<proyecto>/seo/history/AAAA-MM-DD/`: Search Console (consultas, páginas, países, dispositivos, sitemaps) e inspección de URLs del sitemap; con Apify, SERPs con AI Overview, preguntas GEO en los motores de IA y, una vez al mes, volúmenes de Keyword Planner e ideas. |
| `bin/audit.mjs` | Auditoría agnóstica de stack. `--source live` rastrea el sitio publicado (robots.txt, sitemaps y enlaces internos); `--source build` lee el HTML compilado. Comprueba lang, un H1, title y description, canonical, og:image, JSON-LD, marcadores pendientes, promesas prohibidas, sitemap/noindex, redirecciones, enlaces rotos, páginas huérfanas, cobertura de keywords y canibalización. Sale con 1 si hay errores. |
| `bin/validate.mjs` | Valida `config.json` (contra `schema/config.schema.json`), `keywords.json` y `geo-queries.json`. |
| `schema/config.schema.json` | Esquema de `seo/config.json`, con la descripción de cada campo. |
| `playbook/AGENT.md` | Instrucciones semanales del agente: medir, analizar, decidir, ejecutar e informar. |
| `templates/` | `config.example.json`, `keywords.json`, `geo-queries.json`, `report.md` y `routine.md` (prompt y cuerpo de la rutina en la nube). |

## Uso

Clona el kit junto a los proyectos y apúntalo a uno:

```bash
node bin/validate.mjs --project ../inkup-landing
node bin/collect.mjs  --project ../inkup-landing --dry-run     # plan y coste sin gastar ni escribir
node bin/audit.mjs    --project ../inkup-landing --source live
```

Flags del colector: `--dry-run`, `--volumes` (forzar volúmenes), `--no-gsc`. De la auditoría: `--source live|build`, `--json`. Ambos aceptan `--config <ruta>` para probar un config fuera del proyecto.

## Qué vive en cada proyecto

```
seo/
  config.json        dominio, propiedad GSC, mercados, tope de Apify, build, reglas de marca, receta de página…
  keywords.json      universo de keywords con volumen, URL asignada y papel
  geo-queries.json   8-10 preguntas GEO
  history/           datos brutos semanales (los escribe el colector)
  reports/           informes semanales (los escribe el agente)
```

Para dar de alta un proyecto, usa la skill personal `seo-geo-setup` de Claude Code.

## Credenciales (en el entorno de la rutina o del shell, nunca en un repo)

- `GSC_SERVICE_ACCOUNT`: JSON (o JSON en base64) de la cuenta de servicio `kalmaa-seo-agent@kalmaa-seo.iam.gserviceaccount.com` (proyecto GCP `kalmaa-seo`). Se añade como usuario **restringido** en la propiedad de Search Console de cada proyecto.
- `APIFY_TOKEN`: token de Apify.

## Presupuesto de Apify

La cuenta tiene un límite de **19 $/mes** para todos los proyectos. Cada proyecto pone su tope en `apify.monthlyBudgetUsd` (por defecto 6 $) y el colector lo respeta sumando sus propios `summary.json` del mes; no puede ver el gasto de los demás, así que el reparto se lleva aquí:

| Proyecto | Tope ($/mes) | Gasto típico |
|---|---|---|
| Kalmaa | 6 (hoy 10 en su agente propio, hasta migrar) | ~1,7 $ la semana con volúmenes, ~0,3 $ el resto |
| Inkup | 6 | ~1,7 $ la semana con volúmenes, ~0,3 $ el resto (alta 2026-11-11) |
| Reserva | 7 | — |

No subas el límite de la cuenta sin el propietario.

## Reglas

- El agente publica siempre por PR revisado por una persona; nunca en la rama base.
- Nada de una marca vive en el kit: claims, promesas prohibidas, textos intocables y rutas protegidas van en el `config.json` y en las reglas del proyecto.
- Los cambios del kit también van por PR: afectan a todas las rutinas a la vez.
