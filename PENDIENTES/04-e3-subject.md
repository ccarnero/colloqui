# 4 · E3 — subject inconsistente en `ExecutionHandler` — **CERRADO 2026-08-08**

> Resuelto por el loop de `04-e3-subject.spec.md` (3/3 tareas, commits
> `931d16dd`/`a3bd82c0`/`1b338261`): los subjects de lifecycle
> (`execution_started/completed/failed`) y el heartbeat `online.v1` pasaron a
> `evt.{tenant}.agent-ai-service...` (el producer real, cierra DRIFT item 10);
> `execution_requested` queda en el gateway porque ahí el producer es correcto.
> Verificado en vivo 2026-08-08: seis servicios redeployados, durables
> `ai-agent-gateway-results` + `execution-audit` recreados con los filtros
> nuevos, e2e `long-agent-execution.sh` verde de punta a punta (requested=1
> bajo el gateway, completed=1 bajo agent-ai-service, cero redeliveries).
> Registro histórico abajo.

Class: register
Summary: Ticket acordado para corregir el subject que `publishStatus` usa, que no coincide con el productor declarado en el propio envelope.

`ExecutionHandler.publishStatus` publica hacia un subject que nombra
`ai-agent-gateway`, mientras el envelope que va adentro declara
`producer: "agent-ai-service"`.

`runtime-streaming.md` ya lo reconoce como inconsistencia preexistente.

**Ruling de T09:** abrir ticket para corregir el subject — probablemente deba
decir `agent-ai-service`, para coincidir con el `producer`. Se descartó
explícitamente la opción de bendecirlo como está.

**Ojo al arreglarlo:** el subject es la clave de ruteo (token 1 = tenant,
token 2 = productor). Cambiarlo mueve el evento de lugar en el bus, así que hay
que verificar que ningún consumidor filtre por el subject viejo antes de
tocarlo.
