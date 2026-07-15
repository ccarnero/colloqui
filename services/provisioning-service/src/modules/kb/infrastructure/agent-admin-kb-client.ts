// HTTP client reusing agent-admin-service's EXISTING knowledge-base API
// (`services/agent-admin-service/src/modules/knowledge-bases/*.controller.ts`)
// — SPEC.md constraint: "the reconciler calls existing service APIs — never
// writes to their tables directly". No new agent-admin routes are added;
// this is a plain fetch client over `/admin/knowledge-bases*`, mirroring the
// style of `agents-writer.ts`.
//
// Idempotent create-or-update by NAME: agent-admin has no "find KB/document
// by name" endpoint, so this lists (`GET /admin/knowledge-bases`,
// `GET .../documents`) and matches client-side — same trade-off T03's
// `create-http-list-resource-client.ts` already made for other sections.

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { TENANT_HEADER } from "@yoizen/shared";
import { err, ok, type Result } from "../../../lib/result";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface AgentAdminKbSummary {
  readonly id: string;
  readonly name: string;
}

export interface AgentAdminDocumentSummary {
  readonly id: string;
  readonly original_filename: string;
}

/**
 * agent-admin-service's list endpoints return the ENVELOPED shape
 * `{ knowledge_bases, total }` / `{ documents, total }` (its
 * `*.service.ts` `findAll` methods), NOT a plain array. These helpers unwrap
 * the envelope — and tolerate a bare array too, so the client never assumes
 * a shape and can't throw `.find is not a function` if an endpoint changes.
 */
function extractKbList(value: unknown): { id: string; name: string }[] {
  if (Array.isArray(value)) {
    return value as { id: string; name: string }[];
  }
  const envelope = value as { knowledge_bases?: unknown } | null;
  const list = envelope?.knowledge_bases;
  return Array.isArray(list) ? (list as { id: string; name: string }[]) : [];
}

function extractDocumentList(value: unknown): AgentAdminDocumentSummary[] {
  if (Array.isArray(value)) {
    return value as AgentAdminDocumentSummary[];
  }
  const envelope = value as { documents?: unknown } | null;
  const list = envelope?.documents;
  return Array.isArray(list) ? (list as AgentAdminDocumentSummary[]) : [];
}

export interface IAgentAdminKbClient {
  findKbByName(
    tenantId: string,
    name: string
  ): Promise<Result<AgentAdminKbSummary | null, string>>;
  createKb(
    tenantId: string,
    name: string
  ): Promise<Result<AgentAdminKbSummary, string>>;
  listDocuments(
    tenantId: string,
    kbId: string
  ): Promise<Result<readonly AgentAdminDocumentSummary[], string>>;
  uploadTextDocument(
    tenantId: string,
    kbId: string,
    filename: string,
    contentText: string
  ): Promise<Result<{ documentId: string }, string>>;
  uploadFileDocument(
    tenantId: string,
    kbId: string,
    filename: string,
    fileBase64: string
  ): Promise<Result<{ documentId: string }, string>>;
  deleteDocument(
    tenantId: string,
    kbId: string,
    documentId: string
  ): Promise<Result<void, string>>;
}

export function createAgentAdminKbClient(baseUrl: string): IAgentAdminKbClient {
  const logger = new PinoLoggerService("kb.agent-admin-client");

  async function requestJson(
    tenantId: string,
    method: string,
    path: string,
    body?: unknown
  ): Promise<Result<unknown, string>> {
    const url = `${baseUrl}${path}`;
    let response: Response;
    try {
      response = await tracedFetch(url, {
        method,
        headers: {
          [TENANT_HEADER]: tenantId,
          "content-type": "application/json",
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (cause) {
      const message = `network failure calling ${method} ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
      logger.warn(message);
      return err(message);
    }

    if (!response.ok) {
      const message = `HTTP ${String(response.status)} from ${method} ${url}`;
      logger.warn(message);
      return err(message);
    }

    if (
      response.status === 204 ||
      (response.status === 200 && method === "DELETE")
    ) {
      return ok(undefined);
    }
    return ok(await response.json());
  }

  return {
    async findKbByName(tenantId, name) {
      const result = await requestJson(
        tenantId,
        "GET",
        "/admin/knowledge-bases"
      );
      if (!result.ok) {
        return err(result.error);
      }
      // agent-admin-service's `GET /admin/knowledge-bases` returns the
      // ENVELOPED shape `{ knowledge_bases, total }` (see
      // `KnowledgeBasesService.findAll` /
      // `knowledge-bases.controller.ts`), NOT a plain array — unwrap it.
      // Tolerate a bare array too, defensively, so a future unwrapped
      // endpoint doesn't reintroduce the `.find is not a function` 500.
      const list = extractKbList(result.value);
      const found = list.find((kb) => kb.name === name);
      logger.log(
        `findKbByName: kb='${name}' tenant='${tenantId}' found=${String(!!found)}`
      );
      return ok(found ? { id: found.id, name: found.name } : null);
    },

    async createKb(tenantId, name) {
      logger.log(`createKb: kb='${name}' tenant='${tenantId}'`);
      const result = await requestJson(
        tenantId,
        "POST",
        "/admin/knowledge-bases",
        {
          name,
        }
      );
      if (!result.ok) {
        return err(result.error);
      }
      const created = result.value as { id: string; name: string };
      return ok({ id: created.id, name: created.name });
    },

    async listDocuments(tenantId, kbId) {
      const result = await requestJson(
        tenantId,
        "GET",
        `/admin/knowledge-bases/${kbId}/documents`
      );
      if (!result.ok) {
        return err(result.error);
      }
      return ok(
        extractDocumentList(result.value).map((d) => ({
          id: d.id,
          original_filename: d.original_filename,
        }))
      );
    },

    async uploadTextDocument(tenantId, kbId, filename, contentText) {
      logger.log(
        `uploadTextDocument: kb='${kbId}' document='${filename}' tenant='${tenantId}'`
      );
      const result = await requestJson(
        tenantId,
        "POST",
        `/admin/knowledge-bases/${kbId}/documents/upload`,
        {
          content_text: contentText,
          original_filename: filename,
          mime_type: "text/plain",
          content_type: "text",
        }
      );
      if (!result.ok) {
        return err(result.error);
      }
      const created = result.value as { documentId: string };
      return ok({ documentId: created.documentId });
    },

    async uploadFileDocument(tenantId, kbId, filename, fileBase64) {
      logger.log(
        `uploadFileDocument: kb='${kbId}' document='${filename}' tenant='${tenantId}'`
      );
      const result = await requestJson(
        tenantId,
        "POST",
        `/admin/knowledge-bases/${kbId}/documents/upload-file`,
        {
          filename,
          file_base64: fileBase64,
          content_type: "auto",
        }
      );
      if (!result.ok) {
        return err(result.error);
      }
      const created = result.value as { documentId: string };
      return ok({ documentId: created.documentId });
    },

    async deleteDocument(tenantId, kbId, documentId) {
      logger.log(
        `deleteDocument: kb='${kbId}' document='${documentId}' tenant='${tenantId}' (superseded by a reembed)`
      );
      const result = await requestJson(
        tenantId,
        "DELETE",
        `/admin/knowledge-bases/${kbId}/documents/${documentId}`
      );
      if (!result.ok) {
        return err(result.error);
      }
      return ok(undefined);
    },
  };
}
