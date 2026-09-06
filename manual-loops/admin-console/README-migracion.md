# SPEC — Migración consola admin → UI "Rediseño Terminal"

> Plan maestro de manual loops para migrar la consola Angular actual a la nueva
> UI (dark/light, estilo Vercel/Linear, acento azul corporativo).

## Goal

Estandarizar el orden, contrato visual y alcance de los loops de rediseño de
la consola admin para que todos compartan la misma base y dependencias.

## User decisions (human boundary — do not reinterpret)

1. El contrato visual base es **`Rediseño Terminal.dc.html`** + screenshots
   por sección en `manual-loops/admin-console/design/`.
2. El alcance de este grupo queda en frontend: Angular, temas y pantallas.
3. Los loops de datos/servicios sólo se modifican según sus propias decisiones
   de implementación y nunca para cambiar este orden base.

## Constraints (apply to every task)

- Stack real (validado 2026-07-21): Angular 21 + Material/CDK, monorepo pnpm con
  `@yoizen/angular-shared` (se buildea en pre-steps de build/test), tests con
  `ng test`, Monaco en AI (`ngx-monaco-editor-v2`), `@foblex/flow` 18.6.0 en
  builder. No se agrega ninguna librería nueva sin aprobación humana.
- Sin cambios de backend: cualquier gap de API se reporta como finding y se decide
  con el humano.
- Paths validados contra el repo real y cada loop conserva su inventario T01.

## Task queue

### Orden y dependencias

```text
L0 console-redesign-foundation      ← todo depende de esto
├── L1 console-redesign-dashboard
├── L2 console-redesign-channels
├── L3 console-redesign-connections
├── L4 console-redesign-ai
├── L5 console-redesign-processes-builder
│   └── L6 console-redesign-trace   ← depende de L5 (vive dentro de Processes)
└── L7 console-redesign-users-analytics-settings
```

L1–L5 y L7 son paralelizables entre sí una vez que L0 esté shipped.
L6 arranca solo con L5 terminado.

### Convenciones comunes a todos los loops

- Gates Angular para este bloque:
  - G1 `cd services/admin-console && pnpm exec ng test --watch=false`
  - G2 `cd services/admin-console && pnpm exec tsc -p tsconfig.app.json --noEmit`
  - G5b `cd services/admin-console && pnpm run build` (el prebuild compila la
    lib compartida)
- Contrato visual: cualquier desvío de `Rediseño Terminal.dc.html` requiere
  sign-off humano.

### Archivos de alcance

- `console-redesign-foundation.md` — tokens de tema, shell y componentes
  compartidos.
- `console-redesign-dashboard.md`
- `console-redesign-channels.md` — fleet + detalle de cuenta.
- `console-redesign-connections.md` — inventario + detalle.
- `console-redesign-ai.md` — lista de agentes, editor IDE + chat.
- `console-redesign-processes-builder.md` — builder full-bleed y flujo.
- `console-redesign-trace.md` — waterfall / causal graph / run view.
- `console-redesign-users-analytics-settings.md`

No cubiertos (follow-ups, post L0–L7): Schedules, sub-páginas de AI
(playground, memories, skills, knowledge bases, structured KB, system variables),
Roles / API keys / Billing.

## Progress

- [ ] L0 fundacional definido (esperando ejecución de loop dependientes).

## Out of scope (explicit)

- Diseño de nuevas capacidades o cambios de producto fuera del alcance del
  rediseño de consola.

## Human boundaries for this change

- Human approves this planning sequence before dependent loops run.
