## Referencias a Recursos YoizenClaw UI

Esta carpeta contiene links a la documentación y recursos reales del proyecto YoizenClaw.

### Archivos de Configuración

| Recurso | Ubicación | Descripción |
|---------|-----------|-------------|
| Tailwind Config | `YoizenClaw/Services/yoizen-ui/tailwind.config.js` | Configuración completa de tema |
| Estilos Base | `YoizenClaw/Services/yoizen-ui/src/index.css` | CSS variables y utilidades |
| PostCSS Config | `YoizenClaw/Services/yoizen-ui/postcss.config.js` | Configuración PostCSS |
| Vite Config | `YoizenClaw/Services/yoizen-ui/vite.config.ts` | Configuración bundler |

### Componentes de Referencia

| Componente | Ubicación | Patrones Demostrados |
|------------|-----------|---------------------|
| Layout | `YoizenClaw/Services/yoizen-ui/src/components/layout/Layout.tsx` | Estructura sidebar + main |
| Sidebar | `YoizenClaw/Services/yoizen-ui/src/components/layout/Sidebar.tsx` | Navegación, estados activos |
| Button | `YoizenClaw/Services/yoizen-ui/src/components/common/Button.tsx` | Variantes, iconos, loading |
| Card | `YoizenClaw/Services/yoizen-ui/src/components/common/Card.tsx` | Bordes, sombras, padding |
| Input | `YoizenClaw/Services/yoizen-ui/src/components/common/Input.tsx` | Estados, validación, focus |
| Modal | `YoizenClaw/Services/yoizen-ui/src/components/common/Modal.tsx` | Overlays, animaciones |
| HealthStatus | `YoizenClaw/Services/yoizen-ui/src/components/dashboard/HealthStatus.tsx` | Badges, colores estado |
| StatsCards | `YoizenClaw/Services/yoizen-ui/src/components/dashboard/StatsCards.tsx` | Grids, métricas |

### Assets Visuales

| Asset | Ubicación | Uso |
|-------|-----------|-----|
| Logo Principal | `YoizenClaw/Services/yoizen-ui/public/logo.svg` | Header, branding |
| Logo Negativo | `YoizenClaw/Services/yoizen-ui/public/logo-negativo.svg` | Dark backgrounds |
| Logo con Slogan | `YoizenClaw/Services/yoizen-ui/public/logo-sec-slogan.svg` | Landing pages |
| Icono | `YoizenClaw/Services/yoizen-ui/public/icon.svg` | Favicon, avatares |
| Logo Footer | `YoizenClaw/Services/yoizen-ui/public/logo-footer.svg` | Optimizado footer |

### Hooks y Utilidades

| Utilidad | Ubicación | Propósito |
|----------|-----------|-----------|
| useJobs | `YoizenClaw/Services/yoizen-ui/src/hooks/useJobs.ts` | Data fetching pattern |
| useAiAssist | `YoizenClaw/Services/yoizen-ui/src/hooks/useAiAssist.ts` | AI drawer state |
| api.ts | `YoizenClaw/Services/yoizen-ui/src/services/api.ts` | API client configuration |

### Tipos TypeScript

| Tipo | Ubicación | Entidades |
|------|-----------|-----------|
| Agent | `YoizenClaw/Services/yoizen-ui/src/types/agent.ts` | Estructura agente |
| Job | `YoizenClaw/Services/yoizen-ui/src/types/jobs.ts` | Tipos de jobs |
| Health | `YoizenClaw/Services/yoizen-ui/src/types/health.ts` | Estados de salud |
| Webchat | `YoizenClaw/Services/yoizen-ui/src/types/webchat.ts` | Mensajes conversación |

### Páginas Completas (Ejemplos de Layout)

| Página | Ubicación | Features |
|--------|-----------|----------|
| Dashboard | `YoizenClaw/Services/yoizen-ui/src/pages/Dashboard.tsx` | Grid layout, widgets |
| Agents | `YoizenClaw/Services/yoizen-ui/src/pages/Agents.tsx` | Listas, filtros, acciones |
| Agent Detail | `YoizenClaw/Services/yoizen-ui/src/pages/AgentDetail.tsx` | Formularios, tabs |
| Jobs | `YoizenClaw/Services/yoizen-ui/src/pages/Jobs.tsx` | Tablas, paginación |
| Settings | `YoizenClaw/Services/yoizen-ui/src/pages/Settings.tsx` | Paneles, configuración |
| Demo | `YoizenClaw/Services/yoizen-ui/src/pages/Demo.tsx` | Component showcase |

---

**Nota**: Todas las rutas son relativas desde la raíz del workspace (`YoizenClaw/`).
