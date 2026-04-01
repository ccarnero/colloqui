import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { ValidateFunction } from 'ajv';
import type { EventEnvelope } from '@yoizen/shared';
import type { PipelineStage, PipelineContext } from './pipeline-stage.interface';

@Injectable()
export class ValidationStage implements PipelineStage {
  readonly order = 10;

  private readonly logger = new Logger(ValidationStage.name);
  private readonly validators = new Map<string, ValidateFunction>();

  async process(
    envelope: EventEnvelope,
    _context: PipelineContext,
  ): Promise<EventEnvelope> {
    const validator = this.validators.get(envelope.type);
    if (!validator) return envelope;

    if (!validator(envelope.data.payload)) {
      this.logger.warn(
        `Validation failed for event ${envelope.id} (type: ${envelope.type}): ${JSON.stringify(validator.errors)}`,
      );
      throw new BadRequestException(
        `Payload validation failed for event type "${envelope.type}"`,
      );
    }

    return envelope;
  }
}
