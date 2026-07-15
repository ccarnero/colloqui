# Debug handoff — http-fanout-telegram no entrega el mensaje de Telegram

> Para **Claude Code corriendo local** (tiene acceso a `kubectl` y al gateway en `localhost:8080`,
> que el entorno Cowork no tenía). Objetivo: que el sample `http-fanout-telegram` dispare **una**
> ejecución y **entregue** el resumen por Telegram. Podés correr todo y ver outputs en vivo.

## Síntoma actual
`./run.sh` (en `integrations/channels/http-fanout-telegram/`) **no produce ejecución** del workflow / no llega
ningún mensaje a Telegram. Antes llegó a andar (un envío OK a las 13:36), después se rompió.

## Entorno (dev)
- Gateway (port-forward): `GW=http://localhost:8080`  · Host header: `HH=api-gateway.platform-services-dev.127.0.0.1.sslip.io`
- Tenant `acme` · seed `yclawd@demo.io` / `admin123` · namespace k8s `platform-services-dev`
- `/health` del gateway sirve de probe. El **port-forward** se cae cuando el redeploy reinicia pods → `./port-forward.sh dev` desde la raíz.
- El **JWT de login vence ~1h** — re-login si una query devuelve 401 (síntoma: `jq: Cannot index string with string "name"`).

## Datos confirmados
- **Cuentas Telegram**: `0346a0d0-1505-4524-805e-6dc4ec52b88b` ("Telegram Sample Bot") y
  `e0e98707-18ab-4a35-a1b6-f89326f32343` ("Onboarded Bot" / @yzndev_bot).
- **Par PROBADO que entrega OK**: chat `517998951` vía bot `0346a0d0` (envío exitoso 13:36 en el worker log).
- **Cuenta http del fanout**: `externalId = http-fanout-telegram` (la crea `setup.sh`).
- **Workflows**: `http-fanout-telegram` (trigger http) y `telegram-transform-reply` (trigger telegram).
  `e2e-http-log` ya fue borrado (soft-delete; el trigger filtra `deleted_at IS NULL`, no dispara).
- **Redeploy de Opción B**: hecho. La ruta por instancia `POST /api/webhooks/http/acme/http-fanout-telegram`
  debería responder `200 {"status":"accepted"}` (si da 404, el código nuevo no quedó).
- El fanout quedó **pineado** (`FANOUT_PIN=1` en la última corrida de validación) → su trigger tiene
  `config.accountIds=[<cuenta http del fanout>]` → **solo dispara si el mensaje resuelve a ESA cuenta**
  (vía la URL de instancia, o el token exacto de esa cuenta).

## Bugs ya encontrados y arreglados (historial)
1. **chat_id equivocado** → el `notify` daba `400 "chat not found"` (workflow COMPLETED pero sin entrega).
   Fix: recrear con `TELEGRAM_CHAT_ID=517998951 TG_ACCOUNT_ID=0346a0d0-…`.
2. **3 copias duplicadas** de `http-fanout-telegram` → ejecuciones múltiples. Causa: `setup.sh` con
   `RECREATE` borraba solo `head -1`. Fix aplicado: ahora borra **todas** las copias (loop).
3. **Pin prematuro**: el `accountIds` exige resolver a la cuenta puntual (URL por instancia), que
   necesitaba el redeploy. Fix: `FANOUT_PIN` ahora es **opcional** (`0` por defecto).

## Hipótesis del problema actual (verificar corriéndolo)
- **(a) `run.sh` aborta antes de mandar.** Tiene `set -euo pipefail` y encadena
  `../http-connectors/setup.sh`, `../telegram-transform-reply/setup.sh`, `./setup.sh`; si alguno falla
  (o el `TELEGRAM_BOT_TOKEN` del `.env` es inválido) corta y nunca llega al "drive". → Correr `run.sh`
  con `bash -x` o paso a paso.
- **(b) Circuit breaker de egress tripeado** por la catarata de `chat not found` → bloquea TODOS los
  envíos de Telegram. Fix: `kubectl rollout restart deploy/channel-service-worker -n platform-services-dev`.
- **(c) Pin sin match**: con `FANOUT_PIN=1`, si el mensaje no resuelve a la cuenta del fanout, no dispara.
  Simplificar: `FANOUT_PIN=0 … RECREATE=1 ./setup.sh` (dispara con cualquier http, y es el único wf http).

## Pasos sugeridos (Claude Code los puede EJECUTAR)
```bash
# 0) conexión + login
curl -s -o /dev/null -w 'health %{http_code}\n' http://localhost:8080/health    # 000 => ./port-forward.sh dev
GW=http://localhost:8080; HH=api-gateway.platform-services-dev.127.0.0.1.sslip.io
TOKEN=$(curl -s -X POST "$GW/api/auth/login" -H "Host: $HH" -H 'Content-Type: application/json' \
  -d '{"email":"yclawd@demo.io","password":"admin123","tenant_id":"acme"}' | jq -r .access_token)
auth(){ curl -s -H "Host: $HH" -H "x-yoizen-tenant: acme" -H "Authorization: Bearer $TOKEN" "$@"; }

# 1) reset del breaker de egress (hipótesis b)
kubectl rollout restart deploy/channel-service-worker -n platform-services-dev
kubectl rollout status  deploy/channel-service-worker -n platform-services-dev

# 2) simplificar: fanout SIN pin (dispara con cualquier http), chat+cuenta probados
cd integrations/channels/http-fanout-telegram
FANOUT_PIN=0 YOIZEN_BASE_URL=$GW YOIZEN_HOST_HEADER=$HH \
  TG_ACCOUNT_ID=0346a0d0-1505-4524-805e-6dc4ec52b88b TELEGRAM_CHAT_ID=517998951 RECREATE=1 ./setup.sh

# 3) mandar UN mensaje http (cuenta del fanout) y observar
SECRET=$(auth "$GW/api/channels/accounts?channel=http" | jq -r '[.[]|select(.externalId=="http-fanout-telegram")|.appSecret]|.[0] // empty')
auth -X POST "$GW/api/webhooks/http/acme" -H 'content-type: application/json' \
  -H "x-http-channel-token: $SECRET" -d '{"from":"t","text":"DEBUG-CC"}'; echo

# 4) ¿ejecutó? ¿entregó?
sleep 4
WF=$(auth "$GW/api/workflows" | jq -r 'if type=="array" then (.[]|select(.name=="http-fanout-telegram")|.id) else empty end' | head -1)
auth "$GW/api/workflows/$WF/executions?page=1&pageSize=3&sort=desc" | jq -c '.items[]|{status,text:.request.text,createdAt}'
kubectl logs -n platform-services-dev -l app.kubernetes.io/name=channel-service-worker -c user-container --tail=60 \
  | grep -iE 'telegram|send|chat|circuit|breaker|open|cooldown|404|400'
```
**Lectura:** ejecución con `text:"DEBUG-CC"` + worker log "Sent message to 517998951" = OK. `chat not found`
= revisar account/chat del `notify`. `circuit/open` = breaker (reset paso 1). Sin ejecución = no disparó
(ruteo/pin) → revisar `trigger.config` y a qué cuenta resolvió el mensaje.

## Dónde está el código
- Sample: `integrations/channels/http-fanout-telegram/{setup.sh,run.sh}` · `integrations/lib/resolve-env.sh` · `integrations/channels/telegram-onboard.sh`
- Opción B (necesita el redeploy): `services/api-gateway/src/modules/channels/{webhooks.controller.ts,webhook-ingress-publisher.service.ts}` ·
  `services/channel-service/src/modules/webhooks/{webhook-ingress.service.ts (resolveAccount),webhook-ingress-consumer.service.ts}` ·
  `packages/shared/src/webhook.interfaces.ts` · `sdk/src/infrastructure/{ingest-adapter,channel-directory-adapter,config}.js` + `sdk/src/application/{ingest-client,ports}.js`
- Matcher de triggers: `services/workflow-service/src/modules/triggers/trigger-consumer.service.ts` (`filterMatching`, `applyExclusiveSharedLogic`)
- Egress/envío Telegram: `services/channel-service` worker (`SendCommandConsumerService`, `TelegramProvider`)
- Diseño completo de Opción B: `cowork/DESIGN-http-channel-instances.md`

## Notas de diseño relevantes
- El soft-delete SÍ excluye del trigger (`findDefinitionsByTriggerType` filtra `deleted_at IS NULL`).
- `{{...}}` en los args se coerciona con `String()` → el `join` entrega strings (`summary`, `combinedJson`), no objetos.
- El canal HTTP es ingest-only; la respuesta del fanout sale por Telegram (channelSend).
