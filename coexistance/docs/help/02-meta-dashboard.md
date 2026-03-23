# Dónde sacar los IDs del dashboard de Meta

Todos los IDs que necesitás están en el panel de Meta for Developers. Esta guía te muestra exactamente dónde encontrar cada uno.

## Acceder al dashboard

1. Andá a https://developers.facebook.com
2. Logueate con tu cuenta de Facebook
3. En el menú superior, hacé clic en "My Apps"
4. Seleccioná tu app (o creá una nueva: tipo "Business" → "WhatsApp")

## WABA ID (WhatsApp Business Account ID)

Es el identificador de tu cuenta de negocio de WhatsApp.

```
Dónde encontrarlo:
  App Dashboard → WhatsApp → API Setup
  Arriba dice "WhatsApp Business Account ID"
  Es un número tipo: 123456789012345
```

También lo podés ver en:
```
  App Dashboard → WhatsApp → Configuration → WABA ID
```

Copialo y pegalo en el campo "WABA ID" de Coexistance.

## Phone Number ID

Es el ID interno de Meta para el número de teléfono que usás para enviar/recibir mensajes. No es el número de teléfono en sí.

```
Dónde encontrarlo:
  App Dashboard → WhatsApp → API Setup
  En la sección "From", debajo del número de teléfono
  Dice "Phone number ID" y es un número tipo: 987654321098765
```

IMPORTANTE: No confundir con el número de teléfono (+15551234567). El Phone Number ID es un ID numérico largo que Meta asigna internamente.

Si estás en modo sandbox/test, Meta te da un test phone number con su propio Phone Number ID.

## Access Token

Es el token que autoriza las llamadas a la API de WhatsApp Cloud.

### Token temporal (para testing)

```
Dónde encontrarlo:
  App Dashboard → WhatsApp → API Setup
  Sección "Temporary access token"
  Hacé clic en "Generate" si no hay uno activo
```

Este token dura 24 horas y es suficiente para desarrollo.

### Token permanente (para producción)

```
Dónde generarlo:
  App Dashboard → Settings → Basic → App Secret (lo necesitás para el flow)

  Después:
  Business Settings → System Users → crear uno → Generate Token
  Permisos necesarios: whatsapp_business_management, whatsapp_business_messaging
```

## META_APP_ID (App ID)

```
Dónde encontrarlo:
  App Dashboard → Settings → Basic
  Primer campo: "App ID"
  Es un número tipo: 1690770278576601
```

Este ya lo tenés en tu .env del proyecto anterior.

## META_APP_SECRET (App Secret)

```
Dónde encontrarlo:
  App Dashboard → Settings → Basic
  Campo "App Secret" → hacé clic en "Show"
  Es un hash tipo: f0b2f67705375efa88a8902cd0daea00
```

Este también ya lo tenés del proyecto anterior.

## META_VERIFY_TOKEN

Este NO viene de Meta. Lo elegís vos. Es una string secreta que usás para verificar que los webhooks vienen de Meta.

```
Ejemplo: my_local_verify_token_2024
```

Tiene que ser el mismo valor en tu .env y en la configuración del webhook en Meta:
```
  App Dashboard → WhatsApp → Configuration → Webhook
  Campo "Verify token"
```

## META_CONFIG_ID (solo para Embedded Signup)

Solo necesitás esto si vas a usar el flujo de Embedded Signup (producción).

```
Dónde encontrarlo:
  App Dashboard → WhatsApp → Embedded Signup
  Campo "Configuration ID"
```

Si estás en modo sandbox/desarrollo, no lo necesitás.

## Resumen: qué poner en cada campo de "Sandbox / Manual Connect"

```
┌───────────────────┬──────────────────────────────────────────┐
│ Campo             │ De dónde                                 │
├───────────────────┼──────────────────────────────────────────┤
│ WABA ID *         │ WhatsApp → API Setup → WABA ID           │
│ Phone Number ID * │ WhatsApp → API Setup → Phone number ID   │
│ Access Token *    │ WhatsApp → API Setup → Temporary token   │
│ Display Phone     │ Tu número de WA (ej +54 11 1234-5678)    │
│ Business Name     │ El nombre de tu negocio (libre)          │
└───────────────────┴──────────────────────────────────────────┘
```

## Modo sandbox de Meta (test number)

Si no querés usar un número real:

1. En API Setup, Meta te asigna un "test phone number" gratis
2. Podés enviar mensajes solo a números que hayas registrado como "test recipients"
3. Máximo 5 recipients en sandbox
4. Para agregar recipients: API Setup → "To" → "Manage phone number list"

El Phone Number ID del test number funciona igual que uno de producción — usá ese en Coexistance.
