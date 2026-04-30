// Documento de referencia
// Ver: wdocs/docs/arquitectura/02-diseño-de-mensajes.md

Referencia al documento completo de diseño de mensajes:
- **Ubicación**: `wdocs/docs/arquitectura/02-diseño-de-mensajes.md`
- **Estado**: Borrador para revisión
- **Audiencia**: Developers

## Contenido del documento original

1. Principios de diseño
   - Envelope genérico + raw payload intacto
   - Routing por subject
   - 1 evento por ingress
   - Trazabilidad completa (trace ID, causation ID, correlation ID)

2. Diseño de subjects
   - Formato: `evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v1`
   - Wildcards: `*` y `>`
   - Kinds: ingress, agent_outbound, agent_action, agent_observation

3. Contrato del envelope (CloudEvents 1.0)
   - Campos requeridos
   - Ejemplo completo de ingress de WhatsApp

4. Abstracción de transporte
   - Métodos: webhook, poll, stream, queue_bridge, agent
   - Headers allowlist

5. Campo `data`
   - Inline vs claim check
   - Payload con checksum

6. Cadena causal y correlación
   - causation_id
   - correlation_id

7. Idempotencia
   - idempotencykey = sha256(canonical_json(raw_body))
   - Nats-Msg-Id header para JetStream deduplication

8. Interfaz del módulo de ingress
   - Pipeline: verifySignature |> validateStructure |> checkPayloadSize |> storeIfClaimCheck |> buildEnvelope |> publish
