# 4 · E3 — subject inconsistente en `ExecutionHandler`

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
