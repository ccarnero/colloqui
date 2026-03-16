// Normalizes a raw Meta webhook payload into a clean structure.
// Handles both message events and status update events.
// BSUID-aware: uses parseSenderId() for all from/to fields.
//
// Returns:
//   { type: 'message', data: { ... } }
//   { type: 'status', data: { ... } }
//   { type: 'unknown', raw: payload }

import { parseSenderId } from './parse-sender-id.js'

const parseWebhook = (body) => {
  if (body?.object !== 'whatsapp_business_account') {
    return { type: 'unknown', raw: body }
  }

  const entry = body.entry?.[0]
  const change = entry?.changes?.[0]
  const value = change?.value

  if (!value) {
    return { type: 'unknown', raw: body }
  }

  const metadata = value.metadata || {}
  const phoneNumberId = metadata.phone_number_id
  const displayPhone = metadata.display_phone_number

  // --- Message event ---
  if (value.messages?.length > 0) {
    const raw = value.messages[0]
    const contact = value.contacts?.[0] || {}
    const sender = parseSenderId(raw.from)

    return {
      type: 'message',
      data: {
        wa_message_id: raw.id,
        sender,
        phone_number_id: phoneNumberId,
        display_phone: displayPhone,
        timestamp: raw.timestamp ? Number(raw.timestamp) * 1000 : Date.now(),
        message_type: raw.type,
        content: extractContent(raw),
        profile_name: contact.profile?.name || null,
        context: raw.context || null,  // reply-to info
      },
    }
  }

  // --- Status event ---
  if (value.statuses?.length > 0) {
    const raw = value.statuses[0]
    const recipient = parseSenderId(raw.recipient_id)

    return {
      type: 'status',
      data: {
        wa_message_id: raw.id,
        recipient,
        status: raw.status,  // sent | delivered | read | failed
        timestamp: raw.timestamp ? Number(raw.timestamp) * 1000 : Date.now(),
        phone_number_id: phoneNumberId,
        errors: raw.errors || null,
      },
    }
  }

  return { type: 'unknown', raw: body }
}

// Extracts content based on message type into a uniform shape.
const extractContent = (raw) => {
  switch (raw.type) {
    case 'text':
      return { text: raw.text?.body || '' }

    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker':
      return {
        media_id: raw[raw.type]?.id,
        mime_type: raw[raw.type]?.mime_type,
        caption: raw[raw.type]?.caption || null,
        filename: raw[raw.type]?.filename || null,
      }

    case 'location':
      return {
        latitude: raw.location?.latitude,
        longitude: raw.location?.longitude,
        name: raw.location?.name || null,
        address: raw.location?.address || null,
      }

    case 'interactive':
      return {
        interactive_type: raw.interactive?.type,
        button_reply_id: raw.interactive?.button_reply?.id || null,
        button_reply_title: raw.interactive?.button_reply?.title || null,
        list_reply_id: raw.interactive?.list_reply?.id || null,
        list_reply_title: raw.interactive?.list_reply?.title || null,
      }

    case 'reaction':
      return {
        emoji: raw.reaction?.emoji,
        reacted_message_id: raw.reaction?.message_id,
      }

    default:
      return { raw_type: raw.type }
  }
}

export { parseWebhook }
