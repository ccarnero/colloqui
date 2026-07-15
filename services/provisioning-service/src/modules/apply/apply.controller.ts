import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard, TenantId } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import { extractTarBundle } from "../kb/lib/extract-tar-bundle";
import { KB_FILE_SOURCE_MAX_BYTES } from "../kb/lib/resolve-kb-document-source";
import { ApplyService } from "./apply.service";

// T06: the KB content bundle travels as base64-encoded tar bytes in the JSON
// request body rather than true `multipart/form-data`. DEVIATION from
// SPEC.md's "apply accepts manifest + tar bundle (multipart)" wording — this
// service's dependency tree (and the workspace lockfile) has no multipart
// parser (`@fastify/multipart` or equivalent) and this task has no network
// access to add one. A base64 JSON field is functionally equivalent for the
// content-addressed extraction/storage semantics this task implements (same
// tar bytes in, same sha256-keyed blobs out) — wiring a real
// `multipart/form-data` route is a follow-up once that dependency is vendored.
export interface ApplyManifestRequestBody {
  readonly bundle?: {
    readonly contentBase64: string;
  };
}

const MAX_BUNDLE_TOTAL_BYTES = 10 * KB_FILE_SOURCE_MAX_BYTES;

@Controller("manifests")
@UseGuards(TenantGuard)
export class ApplyController {
  private readonly logger = new PinoLoggerService(ApplyController.name);

  constructor(private readonly applyService: ApplyService) {}

  @Post(":name/apply")
  @HttpCode(HttpStatus.OK)
  async apply(
    @TenantId() tenantId: string,
    @Param("name") name: string,
    @Body() body?: ApplyManifestRequestBody
  ) {
    this.logger.log(
      `POST /manifests/${name}/apply tenant='${tenantId}' bundle=${String(!!body?.bundle)}`
    );

    let bundle: ReadonlyMap<string, Buffer> | undefined;
    if (body?.bundle) {
      const tarBytes = Buffer.from(body.bundle.contentBase64, "base64");
      const extracted = extractTarBundle(tarBytes, {
        maxEntryBytes: KB_FILE_SOURCE_MAX_BYTES,
        maxTotalBytes: MAX_BUNDLE_TOTAL_BYTES,
      });
      if (!extracted.ok) {
        this.logger.warn(
          `apply: KB bundle extraction FAILED tenant='${tenantId}' manifest='${name}': ${extracted.error.message}`
        );
        throw new HttpException(
          { error: extracted.error },
          HttpStatus.BAD_REQUEST
        );
      }
      bundle = extracted.value;
    }

    const result = await this.applyService.apply(tenantId, name, bundle);
    if (result.ok) {
      return result.value;
    }

    if (result.error.kind === "manifest_not_found") {
      throw new HttpException(
        `No manifest named '${name}' found for this tenant`,
        HttpStatus.NOT_FOUND
      );
    }
    if (result.error.kind === "cycle_detected") {
      throw new HttpException({ error: result.error }, HttpStatus.CONFLICT);
    }
    // KB reconciliation failures and partial-failure apply results both
    // surface as 409 with the typed error body so the caller can inspect
    // progress (or the failed document) and re-apply to resume.
    throw new HttpException({ error: result.error }, HttpStatus.CONFLICT);
  }
}
