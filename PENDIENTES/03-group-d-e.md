# 3 · Group D+E — comentarios y strings que mienten

Class: register
Summary: Catorce correcciones de texto dentro de archivos de código y scripts; sin cambio de comportamiento, agrupables en dos commits.

La auditoría no pudo tocarlos: el código fuente estaba fuera del alcance
permitido de cada tarea. **E4 y E6 ya se cerraron** en T10 (eran precondición
del guard G13).

---

## Group D — documentación de registro dentro del código (8)

Fix = solo texto de comentario/JSDoc/header. Un commit.

| # | Qué miente |
|---|---|
| E14 | El JSDoc de `ensureDurableConsumer` dice que `backoff` es inmutable, mientras `reconcileDurableConsumer` lo diffea y actualiza |
| E16 | 5 headers de `sdk/src` dicen "404s / pending deploy" contra tests e2e que afirman lo contrario; `config-files/types.ts` se contradice en oraciones consecutivas |
| E19 | `ai-agent-triage` documenta un ejemplo `🎧 Triage` que ninguna rama puede emitir |
| E20 | El header de `hosted-services-api/manifest.yaml` afirma una restricción ya levantada |
| E21 | `reference-pattern/src/setup.ts` nombra un `resolve-env.sh` que no existe en su tier |
| E22 | El bloque "COMPARABLE LIMITATION" de `registry-services-writer.ts` describe el comparador superado — **ya fabricó drift una vez**: un reviewer atajó a T06 importándolo a un README |
| E26 | El header de `reset-dev.ts` lista variables de Mongo como requeridas; `REQUIRED_ENV` tiene diez nombres y ninguno es de Mongo |
| E34 | La tabla de `DOCS/guides/dev-mode.md` omite `tracking-ingester-service` y `provisioning-service`, ambos implementados en `get_targets` |

## Group E — strings dentro de líneas ejecutables (3)

T07 solo podía editar comentarios; estos viven en argumentos de `log`/`fail`,
heredocs de `usage()` y rangos de `sed`, por eso se escalaron. Un commit chico,
sin tocar lógica.

- **E30** — tres helpers `usage()` imprimen más pasos de los que el script
  tiene: `kustomize-safe-apply.sh` 8 impresos / 6 reales, `rebuild-changed.sh`
  5 / 3, `scripts/orbstack/startup.sh` 4 / 2
- **E31** — `purge-temporal.sh` imprime dos rutas de doc muertas en runtime
- **E35** — el heredoc de `usage()` de `purge-temporal.sh` sigue afirmando la
  topología HA que se revirtió, en tres lugares

> **E32 ya no aplica**: decía que el guard `K6c` manda editar `ROW_FILES`
> cuando el símbolo real es `row_files_for`. El rename K→G de T10 reescribió
> esos mensajes. Verificar antes de abrir el ticket.
