// Raw Meta webhook POST body samples for use in tests.
// Mirrors the exact structure that Meta sends to the webhook endpoint.

const textMessage = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba_123',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '+15550001234',
              phone_number_id: 'phone_001',
            },
            contacts: [
              {
                profile: { name: 'Alice' },
                wa_id: '5215512345678',
              },
            ],
            messages: [
              {
                id: 'wamid.text001',
                from: '5215512345678',
                timestamp: '1711929600',
                type: 'text',
                text: { body: 'Hello from Alice' },
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
}

const imageMessage = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba_123',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '+15550001234',
              phone_number_id: 'phone_001',
            },
            contacts: [
              {
                profile: { name: 'Bob' },
                wa_id: '5219876543210',
              },
            ],
            messages: [
              {
                id: 'wamid.image001',
                from: '5219876543210',
                timestamp: '1711929601',
                type: 'image',
                image: {
                  id: 'media_img_001',
                  mime_type: 'image/jpeg',
                  caption: 'Check this out',
                  sha256: 'fakehash',
                },
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
}

const statusUpdate = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba_123',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '+15550001234',
              phone_number_id: 'phone_001',
            },
            statuses: [
              {
                id: 'wamid.text001',
                status: 'delivered',
                timestamp: '1711929605',
                recipient_id: '5215512345678',
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
}

export { textMessage, imageMessage, statusUpdate }
