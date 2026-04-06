import { BadRequestException, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import Ajv, { type ValidateFunction, type ErrorObject } from "ajv";
import type { EventEnvelope } from "@yoizen/shared";
import type {
  IPipelineStage,
  IPipelineContext,
} from "./pipeline-stage.interface";

@Injectable()
export class ValidationStage implements IPipelineStage {
  readonly order = 10;

  private readonly logger = new PinoLoggerService(ValidationStage.name);
  private readonly ajv = new Ajv({ allErrors: true, strict: true });
  private readonly validators = new Map<string, ValidateFunction<unknown>>();

  /**
   * Registers an AJV schema for an event type. Call from module init or tests.
   */
  registerSchema(eventType: string, schema: object): void {
    const validate = this.ajv.compile(schema);
    this.validators.set(eventType, validate);
  }

  async process(
    envelope: EventEnvelope,
    _context: IPipelineContext,
  ): Promise<EventEnvelope> {
    const validator = this.validators.get(envelope.type);
    if (!validator) return envelope;

    const payload = envelope.data.payload;
    if (!validator(payload)) {
      const errors = (validator.errors ?? []) as ErrorObject[];
      this.logger.warn(
        `Validation failed for event ${envelope.id} (type: ${envelope.type}): ${JSON.stringify(errors)}`,
      );
      throw new BadRequestException(
        `Payload validation failed for event type "${envelope.type}"`,
      );
    }

    return envelope;
  }
}
