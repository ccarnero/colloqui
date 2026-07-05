import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

const TENANT_HEADER_NAME = "x-yoizen-tenant";
const DOCS_PATH = "docs";

/**
 * Serves Swagger UI at `/api/docs` and the raw OpenAPI JSON at
 * `/api/docs-json`. Both are registered directly on the Fastify instance by
 * `SwaggerModule.setup` (not through Nest's controller/guard pipeline), so
 * they are reachable without a JWT or tenant header — see
 * `OPENAPI-TODO.md` for the verification notes on why `@Public()` /
 * `@SkipTenant()` are not needed here.
 */
export function configureOpenApi(app: NestFastifyApplication): void {
  const config = new DocumentBuilder()
    .setTitle("Yoizen Platform API")
    .setVersion("1")
    .addBearerAuth()
    .addGlobalParameters({
      name: TENANT_HEADER_NAME,
      in: "header",
      required: false,
      schema: { type: "string" },
      description:
        "Tenant identifier. Alternatively resolved from the request hostname or `?tenant=` query param.",
    })
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(DOCS_PATH, app, document, {
    useGlobalPrefix: true,
  });
}
