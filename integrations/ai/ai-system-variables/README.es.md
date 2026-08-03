# ai-system-variables — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

**Variables de sistema como configuración viva**: la sección `systemVariables` del manifest v1
maneja un router de escalación con marca propia en tres puntos de resolución en runtime, dentro de
un solo workflow. `company-name` se estampa en cada notificación de Telegram, `escalation-priority`
es el LADO DERECHO templado de una regla `conditional` (la política de ruteo es dato: hacé `PATCH`
de la variable y el workflow re-rutea SIN editar el workflow), y `brand-voice` se referencia DENTRO
del `system_prompt` del agente. El provisioning es **declarativo**: un único
[`manifest.yaml`](./manifest.yaml) aplicado con la CLI `yoizen`.

## Qué provisiona `manifest.yaml`

| Recurso | Nombre | Notas |
| --- | --- | --- |
| Canal | `ai-system-variables` | Instancia HTTP dedicada |
| Connector | `sample-openai-llm` | Compartido con los otros samples de IA |
| Variables de sistema | `company-name`, `escalation-priority`, `brand-voice`, `ai-system-variables-chat-id` | Todas `type: string`, ninguna secreta |
| Agente | `ai-sample-sysvars` | `system_prompt` embebe `{{variables.system.company-name}}`/`{{variables.system.brand-voice}}` |
| Workflow | `ai-system-variables` | `triage` -> `parse` -> `notify` |

## Nombres (slug vs. camelCase)

El schema del manifest exige `systemVariables[].name` como slug (sin camelCase). El `setup.ts`
eliminado usaba los nombres camelCase de la plataforma (`companyName`/`escalationPriority`/
`brandVoice`) directamente vía la API viva. Este manifest los renombra a
`company-name`/`escalation-priority`/`brand-voice` — cada referencia
`{{variables.system.<nombre>}}` usa el MISMO slug renombrado consistentemente, así que la
resolución en runtime sigue funcionando; solo cambió el NOMBRE, no la semántica. El destinatario de
Telegram es una CUARTA variable separada (`ai-system-variables-chat-id`).

## Secretos (auth bearer del connector LLM)

| Binding (= var de entorno para `--secrets-from-env`) | Apunta a | Valor |
| --- | --- | --- |
| `ai-system-variables-openai-api-key` | `authConfig.bearerToken` | Tu `OPENAI_API_KEY` real |

## Cómo ejecutarlo y qué esperar

```bash
cd sdk && bun link

yoizen manifests validate -f ../integrations/ai/ai-system-variables/manifest.yaml
yoizen manifests plan     -f ../integrations/ai/ai-system-variables/manifest.yaml
env "ai-system-variables-openai-api-key=$OPENAI_API_KEY" \
  yoizen manifests apply  -f ../integrations/ai/ai-system-variables/manifest.yaml --secrets-from-env
```

## Configurar (cambio de política en vivo, sin editar el workflow)

Editá `spec.systemVariables[*].value` en `manifest.yaml` y volvé a aplicar — por ejemplo, poné
`escalation-priority` en `urgent` para que solo los mensajes clasificados como `urgent` escalen.
`workflow-service` cachea las variables de sistema por tenant durante 5 minutos.

```bash
cd integrations/ai/ai-system-variables
./run.sh
```

`run.sh` verifica el workflow, muestra los valores actuales de las variables de sistema, y publica
un mensaje FURIOSO y uno TRANQUILO. Esperá DMs de Telegram con el valor de `company-name`
estampado:

```text
🚨 [Acme Telco] escalation — priority: high
<resumen de una línea con la voz de marca>
Original: <el mensaje del cliente>
```

```text
✅ [Acme Telco] handled — priority: low
<resumen de una línea con la voz de marca>
Original: <el mensaje del cliente>
```

> **BUG CONOCIDO (escalación E18 del ledger) — el paso 2/3 siempre imprime `(missing!)`.**
> `src/index.ts` busca las variables por sus nombres camelCase PREVIOS al manifest (`companyName`,
> `escalationPriority`, `brandVoice`), pero este manifest declara los slugs `company-name`,
> `escalation-priority`, `brand-voice` y el writer manda `name` tal cual — así que ningún nombre
> matchea. Los tres valores salen como `(missing!)` y el hint final para cambiar la política en
> vivo cae a `<id>` en vez del id real. Los DMs de Telegram NO se ven afectados (el workflow
> resuelve los MISMOS slugs que declara el manifest). Hasta que se arregle el driver, leé los
> valores vivos con `GET /api/admin/system-variables`.

## Detalles y advertencias

- `parse` devuelve SOLO `{ priority, summary }` — la decisión de ruteo queda en el lado derecho
  templado del `conditional` (el variable store), no en código.
- **El trigger está pineado** a la cuenta HTTP propia del sample vía `trigger.config.accountIds:
  [{channelRef: ai-system-variables}]` (sustitución de arreglo `accountIds`) — ningún otro workflow
  HTTP dispara con este tráfico.
