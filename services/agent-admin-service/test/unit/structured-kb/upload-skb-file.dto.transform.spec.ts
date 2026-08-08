import "../../setup-env";
import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from "@nestjs/common";
import { PRODUCTION_VALIDATION_PIPE_OPTIONS } from "@yoizen/observability";
import { UploadSKBFileDto } from "../../../src/modules/structured-kb/dto/upload-skb-file.dto";

// ---------------------------------------------------------------------------
// Explicit regression test for finding H6 of register
// `PENDIENTES/11-implicit-conversion.md` (fixed by T03).
//
// `UploadSKBFileDto.categories` is declared `string[]` but was validated with
// `@IsArray()` only. Under the production pipe's implicit conversion, an object
// element was coerced via `plainToClass(Array, element)` and reached
// `SKBContainersController` as `[[]]` instead of being rejected.
// `@IsString({ each: true })` turns that corruption into a 400 while the legit
// string payload keeps flowing untouched.
// ---------------------------------------------------------------------------

/**
 * THE production options object, imported — not copied — from
 * `@yoizen/observability`, so this suite can never validate a pipe the service
 * does not actually run.
 */
const productionPipe = new ValidationPipe(PRODUCTION_VALIDATION_PIPE_OPTIONS);

const bodyMetadata = (metatype: new () => unknown): ArgumentMetadata => ({
  type: "body",
  metatype,
  data: "",
});

const basePayload = {
  filename: "tarifas.csv",
  file_base64: "Y29sMSxjb2wyCjEsMg==",
};

describe("H6 — UploadSKBFileDto.categories validates its elements", () => {
  it("still accepts the legit string-array payload", async () => {
    const result = (await productionPipe.transform(
      { ...basePayload, categories: ["tarifas"] },
      bodyMetadata(UploadSKBFileDto as unknown as new () => unknown)
    )) as Record<string, unknown>;

    expect(result.categories).toEqual(["tarifas"]);
  });

  it("rejects object elements with a 400 instead of forwarding [[]]", async () => {
    const error = await productionPipe
      .transform(
        { ...basePayload, categories: [{ name: "tarifas" }] },
        bodyMetadata(UploadSKBFileDto as unknown as new () => unknown)
      )
      .then(
        (value) => value,
        (thrown: unknown) => thrown
      );

    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as {
      statusCode: number;
      message: string[];
    };
    expect(response.statusCode).toBe(400);
    // The message must name the offending field — the whole point of the fix is
    // that the client learns `categories` was wrong instead of silently getting
    // `[[]]` ingested as a category list.
    expect(response.message.join(" | ")).toMatch(/categories/);
  });
});
