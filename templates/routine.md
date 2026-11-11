# Rutina semanal en la nube (Claude Code routines)

Una rutina por proyecto. **Fuentes: el kit y el repo del proyecto.** Entorno con `GSC_SERVICE_ACCOUNT` y `APIFY_TOKEN` (los crea la persona en claude.ai; nunca en un repo). Conector de Google Drive solo de lectura si las reglas del proyecto viven en Drive.

## Prompt (sustituye `<…>`)

```
Eres el agente SEO y GEO semanal de <dominio> (repositorio <owner/proyecto>, rama <base>).
Tienes dos repositorios clonados: el kit CtoConnectattoo/seo-geo-kit ($KIT, el que contiene playbook/AGENT.md) y el proyecto <owner/proyecto> ($P, el que contiene seo/config.json). Localízalos antes de empezar.

1. Si $P/seo/config.json no existe en <base>, termina diciendo que falta fusionar el PR de alta del agente SEO.
2. Lee las reglas del proyecto (config.rules.files; mandan sobre todo lo demás) y sigue $KIT/playbook/AGENT.md al pie de la letra: validar, medir, auditar, analizar, decidir con datos, ejecutar e informar.<nota de stack: versión de Node, gestor de paquetes…>
3. Las credenciales GSC_SERVICE_ACCOUNT y APIFY_TOKEN están en las variables de entorno. No las imprimas ni las escribas en ningún fichero, commit, informe ni PR. Si falta alguna o una API falla (Apify por límite de gasto, Search Console con 403), sigue con lo que haya y explícalo en el informe.
4. Respeta el tope de Apify de config.apify.monthlyBudgetUsd que aplica el colector; no lo eludas.
5. Trabaja en una rama seo/AAAA-MM-DD desde <base> del proyecto y abre un único PR a <base> titulado «SEO semanal AAAA-MM-DD: <cambio principal>», con el resumen de seo/reports/AAAA-MM-DD.md. Nunca hagas push a <base> ni fusiones el PR. No modifiques el kit.
6. Puedes usar Google Drive solo para leer <carpeta de Drive del proyecto>; no escribas en Drive ni envíes correos o mensajes.
```

## Cuerpo para `RemoteTrigger create`

```json
{
  "name": "<Proyecto> · Agente SEO y GEO semanal",
  "cron_expression": "0 7 * * 1",
  "enabled": true,
  "job_config": {
    "ccr": {
      "environment_id": "<env_… con GSC_SERVICE_ACCOUNT y APIFY_TOKEN>",
      "session_context": {
        "model": "claude-sonnet-5-5",
        "allowed_tools": ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
        "sources": [
          { "git_repository": { "url": "https://github.com/CtoConnectattoo/seo-geo-kit" } },
          { "git_repository": { "url": "https://github.com/<owner/proyecto>" } }
        ]
      },
      "events": [
        { "data": { "type": "user", "uuid": "<uuid nuevo>", "session_id": "", "parent_tool_use_id": null,
                    "message": { "role": "user", "content": "<prompt de arriba>" } } }
      ]
    }
  }
}
```

Escalona la hora entre proyectos (07:00, 07:30…) para no coincidir en Apify. Antes de crearla, lanza una ejecución manual (`RemoteTrigger run`) y revisa su registro (`list_runs` y `get_run_log`).
