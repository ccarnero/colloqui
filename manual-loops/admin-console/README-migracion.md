# Migración consola admin → UI "Rediseño Terminal"

Plan maestro de manual loops para migrar la consola Angular actual a la nueva
UI (dark/light, estilo Vercel/Linear, acento azul corporativo). El contrato
visual binding es **`Rediseño Terminal.dc.html`** (proyecto Cowork "Rediseño
consola admin") — copiar ese archivo + screenshots por sección a
`manual-loops/admin-console/design/` del repo antes de la primera corrida, para que
implementer y reviewers puedan consultarlo.

## Orden y dependencias

```
L0 console-redesign-foundation      ← todo depende de esto
├── L1 console-redesign-dashboard
├── L2 console-redesign-channels
├── L3 console-redesign-connections
├── L4 console-redesign-ai
├── L5 console-redesign-processes-builder
│   └── L6 console-redesign-trace   ← depende de L5 (vive dentro de Processes)
└── L7 console-redesign-users-analytics-settings
```

L1–L5 y L7 son paralelizables entre sí una vez que L0 está shipped.
L6 arranca solo con L5 done.

## Convenciones comunes a todos los loops

- **Stack real** (validado 2026-07-21): Angular 21 + Material/CDK, monorepo
  pnpm con `@yoizen/angular-shared` (se buildea en pre-steps de build/test),
  tests con vitest vía `ng test`, Monaco en AI (`ngx-monaco-editor-v2`),
  `@foblex/flow` 18.6.0 en el builder. No se agrega ninguna librería nueva
  sin aprobación humana.
- **Gates Angular** (la consola no tiene dev-mode → no hay G5a; el commit
  gate es build de producción):
  - G1 `cd services/admin-console && pnpm exec ng test --watch=false`
  - G2 `cd services/admin-console && pnpm exec tsc -p tsconfig.app.json --noEmit`
  - G5b `cd services/admin-console && pnpm run build` (el prebuild compila la lib compartida)
- **Contrato visual**: desviarse de `Rediseño Terminal.dc.html` requiere
  sign-off humano (está en Human boundaries de cada SPEC).
- **Paths validados** (2026-07-21) contra el repo real; cada loop conserva su
  T01 de inventario como confirmación fina (líneas, firmas, contratos de
  respuesta) antes de codear.
- **Sin cambios de backend**: estos loops son 100% front. Cualquier gap de
  API se reporta como finding y se decide con el humano.

## Archivos

- `console-redesign-foundation.md` — tokens de tema, shell (sidebar/topbar),
  primitivas compartidas (health dot, sparkline, metric card, needs-attention
  panel, inventory table, detail modal), toggle dark/light.
- `console-redesign-dashboard.md`
- `console-redesign-channels.md` — fleet + detalle de cuenta.
- `console-redesign-connections.md` — inventario + detalle.
- `console-redesign-ai.md` — lista de agentes, editor IDE con mention
  highlights, panel de test con chat en vivo.
- `console-redesign-processes-builder.md` — lista de workflows + builder
  full-bleed (chrome flotante, puertos coloreados, edge labels, mini-stats,
  inspector flotante).
- `console-redesign-trace.md` — waterfall, causal graph, run view canvas,
  step log; event inspector compartido con selección sincronizada y deep
  links a Temporal/builder.
- `console-redesign-users-analytics-settings.md`

No cubiertos (follow-ups, post L0–L7): Schedules, sub-páginas de AI
(playground, memories, skills, knowledge bases, structured KB, system
variables), Roles / API keys / Billing.
