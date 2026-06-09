import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";
import { firstValueFrom } from "rxjs";
import { vi, describe, expect, it, beforeEach, afterEach } from "vitest";

import { StructuredKbService } from "../../../src/app/core/services/structured-kb.service";

describe("StructuredKbService", () => {
  let service: StructuredKbService;
  let httpMock: HttpTestingController;

  const BASE = "/api/admin/structured-kb";

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [StructuredKbService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(StructuredKbService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("getContainers() → GET /admin/structured-kb/containers", async () => {
    const promise = firstValueFrom(service.getContainers());
    const req = httpMock.expectOne(`${BASE}/containers`);
    expect(req.request.method).toBe("GET");
    req.flush({ containers: [], total: 0 });
    const res = await promise;
    expect(res.containers).toEqual([]);
  });

  it("getContainer(id) → GET /admin/structured-kb/containers/:id", async () => {
    const promise = firstValueFrom(service.getContainer("skb-1"));
    const req = httpMock.expectOne(`${BASE}/containers/skb-1`);
    expect(req.request.method).toBe("GET");
    req.flush({ id: "skb-1", name: "Catalog", status: "ready" });
    const res = await promise;
    expect(res.id).toBe("skb-1");
  });

  it("createContainer(data) → POST /admin/structured-kb/containers", async () => {
    const payload = { name: "New SKB", description: "Test container" };
    const promise = firstValueFrom(service.createContainer(payload));
    const req = httpMock.expectOne(`${BASE}/containers`);
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toEqual(payload);
    req.flush({ id: "skb-new", ...payload, status: "pending" });
    const res = await promise;
    expect(res.id).toBe("skb-new");
  });

  it("deleteContainer(id) → DELETE /admin/structured-kb/containers/:id", async () => {
    const promise = firstValueFrom(service.deleteContainer("skb-1"));
    const req = httpMock.expectOne(`${BASE}/containers/skb-1`);
    expect(req.request.method).toBe("DELETE");
    req.flush(null);
    await promise;
  });

  it("uploadFile(containerId, file) → POST /admin/structured-kb/containers/:id/files", async () => {
    const file = new File(["csv-data"], "data.csv", { type: "text/csv" });
    const promise = firstValueFrom(service.uploadFile("skb-1", file));
    const req = httpMock.expectOne(`${BASE}/containers/skb-1/files`);
    expect(req.request.method).toBe("POST");
    req.flush({ id: "f1", name: "data.csv", status: "pending" });
    const res = await promise;
    expect(res.id).toBe("f1");
  });

  it("query(containerId, nlQuery) → POST /admin/structured-kb/containers/:id/query", async () => {
    const promise = firstValueFrom(
      service.query("skb-1", "show me all products over $5"),
    );
    const req = httpMock.expectOne(`${BASE}/containers/skb-1/query`);
    expect(req.request.method).toBe("POST");
    expect(req.request.body.nl_query).toBe("show me all products over $5");
    req.flush({
      columns: ["product_id", "name"],
      rows: [{ product_id: 1, name: "Widget" }],
      total: 1,
      sql: "SELECT product_id, name FROM data WHERE price > 5",
      duration_ms: 42,
    });
    const res = await promise;
    expect(res.rows).toHaveLength(1);
  });

  it("query(containerId, nlQuery, options) passes options in body", async () => {
    const promise = firstValueFrom(
      service.query("skb-1", "count products", { limit: 10, offset: 0 }),
    );
    const req = httpMock.expectOne(`${BASE}/containers/skb-1/query`);
    expect(req.request.method).toBe("POST");
    expect(req.request.body.nl_query).toBe("count products");
    expect(req.request.body.limit).toBe(10);
    expect(req.request.body.offset).toBe(0);
    req.flush({ columns: [], rows: [], total: 0, sql: "", duration_ms: 0 });
    await promise;
  });

  it("getQueryHistory(containerId) → GET /admin/structured-kb/containers/:id/queries", async () => {
    const promise = firstValueFrom(service.getQueryHistory("skb-1"));
    const req = httpMock.expectOne(`${BASE}/containers/skb-1/queries`);
    expect(req.request.method).toBe("GET");
    req.flush({
      queries: [
        { id: "q1", query: "test", sql: "SELECT 1", results_count: 0, duration_ms: 5 },
      ],
      total: 1,
    });
    const res = await promise;
    expect(res.queries).toHaveLength(1);
  });

  it("all calls include auth headers", async () => {
    const promise = firstValueFrom(service.getContainers());
    const req = httpMock.expectOne(`${BASE}/containers`);

    const authHeader = req.request.headers.get("Authorization");
    expect(authHeader).toBeTruthy();

    req.flush({ containers: [], total: 0 });
    await promise;
  });

  it("all calls include tenant header", async () => {
    const promise = firstValueFrom(service.getContainers());
    const req = httpMock.expectOne(`${BASE}/containers`);

    const tenantHeader = req.request.headers.get("X-Tenant-Id");
    expect(tenantHeader).toBeTruthy();

    req.flush({ containers: [], total: 0 });
    await promise;
  });
});
