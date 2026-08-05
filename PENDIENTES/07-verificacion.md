# 7 · Verificación pendiente

Class: register
Summary: Lo que falta correr o mirar a ojo antes de dar la sesión por cerrada del todo.

---

## Correr

### El ciclo completo desde frío

```bash
./scripts/e2e/reset-and-verify.sh
```

Wipea el tenant (delegando en `reset-tenant.sh`), reinicia los siete pods,
verifica el CHECK constraint, corre el suite dos veces (frío y caliente) y
comprueba que el fallback a core-NATS realmente se ejecutó.

Si el tenant ya está limpio y los pods al día:
```bash
./scripts/e2e/reset-and-verify.sh --skip-reset --skip-restart
```

**Gotcha conocido:** borrar el pod de `api-gateway` mata el port-forward, y si
levantás `port-forward.sh` mientras el ksvc todavía no está Ready, el script
**saltea el forward del gateway en silencio** (está en su propio header). Se ve
así: los forwards de tempo/grafana/nats están, el del gateway no. Solución:
esperar a que el ksvc diga Ready y reiniciar `port-forward.sh`.

### Lo que ya se corrió y quedó verde

| | |
|---|---|
| channel-service · api-gateway | 160 · 314 |
| workflow-service · provisioning-service | 283 · 480 |
| packages/shared | 375 |
| e2e desde cero | exit 0, 20 etapas |
| G0 (doc-code-guards) | 16/16 |

Todo con builds y typecheck limpios.

---

## Mirar a ojo

Tres cosas que conviene que revise una persona, porque son decisiones más que
verificaciones:

**1. El canal `e2e-tests` en el producto.** Es lo único de esta sesión que se
despliega para todos los tenants. Vive en el union `Channel`
(`packages/shared/src/channel.interfaces.ts`), el provider en
`services/channel-service/src/providers/e2e-tests/`, y la fila en la tabla de
`DOCS/channels/channel-service.md`. La decisión de nombrarlo por su propósito
—en vez de `sink`— fue explícita: que nadie lo elija por accidente.

**2. El constraint de la base.** `packages/shared/src/channel-schema.ts` se
reaplica en cada `ensureSchema`, así que toca a **todos** los tenants
existentes, no solo a los nuevos. Verificado contra `tenant_acme`.

**3. Los cinco commits.** `8f3ff8f4` (canal), `79d9b2da` (fix schema external),
`3f7fb977` (fix fallback), `56856370` (cobertura e2e), `f877aebf` (runbook —
después reemplazado por el script `reset-and-verify.sh`).

---

## Sin resolver: PR a main

La memoria del proyecto dice que PR-to-main está **abandonado para siempre** y
que `feature/versioning-and-sdk` es "el nuevo main". Pero esta sesión trabajó
sobre `feature/fix-docs-codigo-manda`, que son dos ramas distintas.

**Nadie definió cómo se integran.** Vale la pena decidirlo antes de que las
ramas divergan más.
