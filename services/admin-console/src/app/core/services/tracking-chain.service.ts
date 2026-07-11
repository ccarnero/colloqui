import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import type { Observable } from "rxjs";
import { environment } from "../../../environments/environment";

const TRACKING = `${environment.apiUrl}/tracking`;

/** Compliance level assigned by the ingester per TAXONOMY.md envelope rules. */
export type TrackingCompliance = "full" | "partial" | "none";

export interface ITrackedEvent {
  readonly event_id: string;
  readonly subject: string;
  readonly tenant: string | null;
  readonly producer: string;
  readonly domain: string;
  readonly kind: string | null;
  readonly version: string | null;
  readonly correlation_id: string | null;
  readonly causation_id: string | null;
  readonly causation_depth: number | null;
  readonly occurred_at: string;
  readonly tech: string;
  readonly business_fn: string;
  readonly rule: number;
  readonly consumed_by: string[];
  readonly is_claim_check: boolean;
  readonly compliance: TrackingCompliance;
  readonly workflow_id: string | null;
  readonly run_id: string | null;
  readonly connector_id: string | null;
  readonly cache_status: string | null;
  readonly has_envelope: boolean;
}

export interface ITrackedEventSpan {
  readonly kind_prefix: string | null;
  readonly entity_id: string | null;
  readonly started_at: string;
  readonly completed_at: string;
  readonly duration_ms: number;
}

export interface ITrackingChainSummary {
  readonly count: number;
  readonly first_at: string | null;
  readonly last_at: string | null;
  readonly total_ms: number;
  readonly orphan_count: number;
}

export interface ITrackingChainResponse {
  readonly correlation_id: string;
  readonly tenant: string | null;
  readonly events: ITrackedEvent[];
  readonly spans: ITrackedEventSpan[];
  readonly summary: ITrackingChainSummary;
}

/**
 * Payload lifecycle state assigned by the ingester (SPEC.md
 * `manual-loops/payload-capture.md` T01/T02/T03): `inline`/`resolved` carry a
 * usable payload, `unresolved` failed claim-check resolution at ingest,
 * `scrubbed` was cleared by the 30-day retention job, `none` was never
 * captured.
 */
export type PayloadStatus =
  | "inline"
  | "resolved"
  | "unresolved"
  | "scrubbed"
  | "none";

export interface IEventPayloadResponse {
  readonly payload: unknown;
  readonly payload_status: PayloadStatus;
}

@Injectable({ providedIn: "root" })
export class TrackingChainService {
  private readonly http = inject(HttpClient);

  /**
   * Fetches the full causal chain (events + spans + summary) for a correlation id
   * from the tracking-ingester-service, proxied by the api-gateway.
   * @param correlationId  Correlation id to fetch the chain for.
   */
  getChain(correlationId: string): Observable<ITrackingChainResponse> {
    return this.http.get<ITrackingChainResponse>(
      `${TRACKING}/chains/${correlationId}`
    );
  }

  /**
   * Fetches a single event's payload on demand (never pre-fetched with the
   * chain — SPEC.md `manual-loops/payload-capture.md` T05). Gated server-side
   * by the `tracking:payload:read` tenant-admin permission
   * (`api-gateway/modules/tracking/tracking.controller.ts`); the caller is
   * responsible for gating the UI affordance with the same permission.
   * @param correlationId  Correlation id owning the event.
   * @param eventId        Event id to fetch the payload for.
   */
  getEventPayload(
    correlationId: string,
    eventId: string
  ): Observable<IEventPayloadResponse> {
    return this.http.get<IEventPayloadResponse>(
      `${TRACKING}/chains/${correlationId}/events/${eventId}/payload`
    );
  }
}
