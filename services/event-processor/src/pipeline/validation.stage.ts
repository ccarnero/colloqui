import { Injectable, Logger } from '@nestjs/common';
import Ajv, { type ValidateFunction } from 'ajv';
import type { EventEnvelope } from '@yoizen/shared';
import type { PipelineStage, PipelineContext } from './pipeline-stage.interface';

@Injectable()
export class ValidationStage implements PipelineStage {
  readonly order = 10;

  private readonly logger = new Logger(ValidationStage.name);
  private readonly ajv = new Ajv({ allErrors: true, coerceTypes: false });
  private readonly validators = new Map<string, ValidateFunction>();

  registerSchema(eventType: string, schema: object): void {
    const validate = this.ajv.compile(schema);
    this.validators.set(eventType, validate);
  }

  hasSchema(eventType: string): boolean {
    return this.validators.has(eventType);
  }

  async process(
    envelope: EventEnvelope,
    _context: PipelineContext,
  ): Promise<EventEnvelope> {
    const validator = this.validators.get(envelope.type);
    if (!validator) return envelope;

    if (!validator(envelope.payload)) {
      this.logger.warn(
        `Validation failed for event ${envelope.id} (type: ${envelope.type}): ${JSON.stringify(validator.errors)}`,
      );
      throw new Error(
        `Payload validation failed for event type "${envelope.type}"`,
      );
    }

    return envelope;
  }
}
