# Usar el Dashboard — Coexistance

## Layout

Una vez conectada tu cuenta de WhatsApp, el dashboard tiene esta estructura:

```
┌──────────────────────────────────────────────────────┐
│ Coexistance    Business Name      + Add Account  Chris│  ← Header
├──────────────┬───────────────────────────────────────┤
│              │                                       │
│ Conversations│         Chat Area                     │
│              │                                       │
│ ┌──────────┐ │  ┌─────────────────────────────────┐  │
│ │ Contact 1│ │  │ Hola, necesito ayuda            │  │  ← Mensaje entrante
│ │ último.. │ │  │                          10:30  │  │
│ ├──────────┤ │  │                                 │  │
│ │ Contact 2│ │  │          Claro, en qué puedo │  │  ← Tu respuesta
│ │ último.. │ │  │          ayudarte?       10:31 ✓✓│  │
│ └──────────┘ │  └─────────────────────────────────┘  │
│              │                                       │
│              │  ┌───────────────────────────┬──────┐ │
│              │  │ Type a message...         │  ➤   │ │  ← Input
│              │  └───────────────────────────┴──────┘ │
└──────────────┴───────────────────────────────────────┘
```

## Conversaciones (sidebar izquierdo)

La lista muestra todos los contactos que te escribieron o a los que les escribiste, ordenados por último mensaje. Cada entrada muestra:

- Nombre del contacto (o su número/BSUID si no tiene nombre)
- Preview del último mensaje
- Hora o fecha

Hacé clic en un contacto para ver su historial de chat.

El botón de refresh (↻) recarga la lista si no se actualizó automáticamente.

## Chat Area

### Leer mensajes

- Burbujas a la izquierda (blancas) = mensajes del contacto (inbound)
- Burbujas a la derecha (verdes) = tus respuestas (outbound)
- Cada burbuja muestra hora y estado (✓ enviado, ✓✓ entregado, ✓✓ azul = leído)

### Responder

1. Escribí tu mensaje en el input de abajo
2. Enter o clic en el botón verde ➤ para enviar
3. El mensaje aparece inmediatamente como burbuja verde

IMPORTANTE: Solo podés enviar mensajes de texto libre dentro de la ventana de 24 horas. Meta permite responder libremente solo si el contacto te escribió en las últimas 24 horas. Si pasaron más de 24 horas, necesitás usar un Template.

### Enviar Templates

1. Hacé clic en el ícono de documento (📄) en el header del chat
2. Se abre el Template Picker con los templates aprobados de tu cuenta
3. Seleccioná uno y hacé clic en "Send"

Los templates son mensajes pre-aprobados por Meta. Los usás para:

- Iniciar una conversación (fuera de la ventana de 24h)
- Enviar notificaciones proactivas
- Mensajes de seguimiento

Para crear/editar templates: Meta Dashboard → WhatsApp → Message Templates.

## Header

- **Coexistance** — nombre de la app
- **Business Name** — muestra el nombre del negocio conectado
- **+ Add Account** — conectar otra cuenta de WhatsApp
- **Tu nombre** — del usuario logueado
- **Logout** — cierra sesión

## Actualizaciones en tiempo real

El dashboard se conecta por SSE (Server-Sent Events) al servidor. Cuando llega un mensaje nuevo:

1. La lista de conversaciones se actualiza automáticamente
2. Si estás viendo el chat de ese contacto, el mensaje aparece al instante
3. Los cambios de estado (enviado → entregado → leído) también se actualizan en vivo

SSE se reconecta automáticamente (es un comportamiento nativo de la API EventSource). El endpoint es `GET /api/events/stream?token=JWT`. El hook `useEventStream` maneja la conexión y los eventos automáticamente.

## Flujo típico de uso

```
1. Un cliente te escribe por WhatsApp
      ↓
2. El mensaje llega al webhook → se guarda en MongoDB → se envía por SSE
      ↓
3. Aparece en tu dashboard (lista + chat si lo tenés abierto)
      ↓
4. Leés el mensaje y respondés desde el input
      ↓
5. El servidor envía tu respuesta vía WhatsApp Cloud API
      ↓
6. El cliente la recibe en su WhatsApp
```

## Múltiples cuentas

Coexistance soporta múltiples cuentas de WhatsApp Business. Cada cuenta tiene sus propias conversaciones y contactos, aisladas entre sí.

Para agregar otra cuenta: clic en "+ Add Account" en el header.

(El selector de múltiples cuentas está implementado a través del componente AccountSelector.)
