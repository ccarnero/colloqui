# Primeros Pasos — Coexistance

## Qué es Coexistance

Coexistance es tu plataforma propia para gestionar líneas de atención al cliente por WhatsApp. Conectás tu número de WhatsApp Business y desde el dashboard podés ver conversaciones, responder mensajes y enviar templates — todo sin depender de plataformas externas.

## Flujo general

```
Setup → Login → Conectar cuenta WhatsApp → Recibir/Enviar mensajes
```

## 1. Setup

Si corriste `./setup.sh`, ya tenés todo listo. Si no:

```bash
cd coexistance
./setup.sh
```

Esto instala dependencias, crea tu usuario, crea una cuenta sandbox en MongoDB y buildea el frontend.

## 2. Levantar el servidor

```bash
# Opción simple (API + frontend juntos):
bun server/src/server.js

# Opción dev (hot reload en frontend):
bun server/src/server.js &
cd client && npx vite
```

## 3. Login

Abrí `http://localhost:6666` (o `:5173` en dev mode).

Credenciales del seed:

```
email:    christian.carnero@gmail.com
password: coexistance2024
```

## 4. Pantalla "Connect WhatsApp Account"

Después del primer login vas a ver esta pantalla. Tenés dos opciones:

### Opción A: Sandbox / Manual (para desarrollo)

Usá esta opción si estás testeando o si ya tenés los IDs de tu cuenta de Meta. Necesitás 3 datos obligatorios que sacás del dashboard de Meta (ver `02-meta-dashboard.md`):

- **WABA ID** — el ID de tu WhatsApp Business Account
- **Phone Number ID** — el ID del número de teléfono registrado
- **Access Token** — tu token de acceso a la API

Los otros dos campos son opcionales (Display Phone y Business Name) — son para mostrar en la UI nomás.

### Opción B: Embedded Signup (para producción)

Esta opción lanza el flujo guiado de Meta donde el usuario conecta su cuenta de WhatsApp Business sin salir de tu app. Requiere que hayas configurado `META_APP_ID`, `META_APP_SECRET` y `META_CONFIG_ID` en el `.env`, y que tu app de Meta esté aprobada para Embedded Signup.

**Para empezar, usá Sandbox / Manual.** Es más simple y no necesitás aprobación de Meta.

## 5. Si el seed ya creó la cuenta

Si corriste `./setup.sh` y tenías `META_WABA_ID` en el `.env`, el seed ya creó una cuenta sandbox automáticamente. En ese caso no vas a ver la pantalla de "Connect" — vas directo al dashboard de conversaciones (que va a estar vacío hasta que recibas o envíes mensajes).

## ¿Y ahora?

Una vez conectada la cuenta, pasá a `03-usar-el-dashboard.md` para aprender a usar el chat.
