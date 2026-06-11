# Dónde sacar los IDs del dashboard de Meta

Todos los IDs necesarios para conectar WhatsApp o Instagram están en el panel de Meta for Developers.

## Acceder al dashboard

1. Ir a https://developers.facebook.com
2. Loguearse con cuenta de Facebook
3. Menú superior → "My Apps"
4. Seleccionar la app (o crear una nueva: tipo "Business" → "WhatsApp")

## WABA ID (WhatsApp Business Account ID)

```
App Dashboard → WhatsApp → API Setup
"WhatsApp Business Account ID" — número tipo: 123456789012345
```

También en: App Dashboard → WhatsApp → Configuration → WABA ID

## Phone Number ID

El ID interno de Meta para el número de teléfono. **No es el número de teléfono** (+54...).

```
App Dashboard → WhatsApp → API Setup
Sección "From", debajo del número → "Phone number ID" — número tipo: 987654321098765
```

## Access Token

### Token temporal (desarrollo)

```
App Dashboard → WhatsApp → API Setup → "Temporary access token"
Duración: 24 horas
```

### Token permanente (producción)

```
Business Settings → System Users → crear usuario → Generate Token
Permisos: whatsapp_business_management, whatsapp_business_messaging
```

## App Secret

```
App Dashboard → Settings → Basic → "App Secret" → clic en "Show"
```

Se usa para verificar la firma HMAC-SHA256 de los webhooks entrantes (campo `appSecret` al crear la cuenta).

## App ID

```
App Dashboard → Settings → Basic → primer campo "App ID"
```

## Verify Token

No viene de Meta. Es el valor que elegís vos al crear la cuenta en la plataforma. Debe ser el mismo valor en el campo `verifyToken` de la cuenta y en la configuración del webhook en Meta.

## Resumen de campos para crear una cuenta WhatsApp

```
POST /channels/accounts
{
  "channel": "whatsapp",
  "phoneNumberId": "<Phone Number ID de API Setup>",
  "wabaId": "<WABA ID>",
  "accessToken": "<Access Token>",
  "appSecret": "<App Secret>",
  "verifyToken": "<valor elegido por vos>"
}
```

## Instagram

Para Instagram, los campos relevantes son:

| Campo en la plataforma | De dónde en Meta |
|------------------------|-----------------|
| `igUserId` | Instagram → API Setup → "Instagram Professional Account ID" |
| `accessToken` | Instagram User Access Token (via OAuth) |
| `appSecret` | Settings → Basic → App Secret (igual que WhatsApp) |
| `verifyToken` | Elegido por vos |

## Modo sandbox de Meta (test number)

Si no querés usar un número real:

1. Meta asigna un "test phone number" en API Setup
2. Podés enviar mensajes solo a números registrados como "test recipients" (máx 5)
3. Para agregar recipients: API Setup → "To" → "Manage phone number list"

El Phone Number ID del test number funciona igual que uno de producción.
