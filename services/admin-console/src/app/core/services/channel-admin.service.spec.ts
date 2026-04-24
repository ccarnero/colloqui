import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";
import { firstValueFrom } from "rxjs";

import { ChannelAdminService } from "./channel-admin.service";
import { environment } from "../../../environments/environment";

describe("ChannelAdminService", () => {
  let service: ChannelAdminService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ChannelAdminService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(ChannelAdminService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it("listAccounts GETs /channels/accounts", async () => {
    const promise = firstValueFrom(service.listAccounts());
    const req = httpMock.expectOne(`${environment.apiUrl}/channels/accounts`);
    expect(req.request.method).toBe("GET");
    req.flush([]);
    await promise;
    httpMock.verify();
  });

  it("deleteAccount DELETEs account URL", () => {
    service.deleteAccount("acc-1").subscribe();
    const req = httpMock.expectOne(
      `${environment.apiUrl}/channels/accounts/acc-1`,
    );
    expect(req.request.method).toBe("DELETE");
    req.flush(null);
    httpMock.verify();
  });

  it("getUsage serializes query parameters", async () => {
    const promise = firstValueFrom(
      service.getUsage({
        from: "2026-04-20T00:00:00Z",
        to: "2026-04-23T00:00:00Z",
        bucket: "hour",
        accountId: "acct-1",
        channel: "whatsapp",
      }),
    );
    const req = httpMock.expectOne(
      (r) =>
        r.url === `${environment.apiUrl}/channels/usage` &&
        r.params.get("from") === "2026-04-20T00:00:00Z" &&
        r.params.get("to") === "2026-04-23T00:00:00Z" &&
        r.params.get("bucket") === "hour" &&
        r.params.get("accountId") === "acct-1" &&
        r.params.get("channel") === "whatsapp",
    );
    expect(req.request.method).toBe("GET");
    req.flush({ items: [] });
    await promise;
    httpMock.verify();
  });

  it("getUsageTotals GETs /channels/usage/totals", async () => {
    const promise = firstValueFrom(
      service.getUsageTotals({
        from: "2026-04-20T00:00:00Z",
        to: "2026-04-23T00:00:00Z",
      }),
    );
    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/channels/usage/totals`,
    );
    expect(req.request.method).toBe("GET");
    req.flush({ items: [] });
    await promise;
    httpMock.verify();
  });

  it("getStreams GETs /channels/streams", async () => {
    const promise = firstValueFrom(service.getStreams());
    const req = httpMock.expectOne(`${environment.apiUrl}/channels/streams`);
    expect(req.request.method).toBe("GET");
    req.flush({ items: [] });
    await promise;
    httpMock.verify();
  });

  it("getStreamMessages URL-encodes the key and serializes params", async () => {
    const promise = firstValueFrom(
      service.getStreamMessages("ingress", {
        subject: "ingress.whatsapp.*",
        limit: 25,
      }),
    );
    const req = httpMock.expectOne(
      (r) =>
        r.url === `${environment.apiUrl}/channels/streams/ingress/messages` &&
        r.params.get("subject") === "ingress.whatsapp.*" &&
        r.params.get("limit") === "25",
    );
    expect(req.request.method).toBe("GET");
    req.flush({ items: [] });
    await promise;
    httpMock.verify();
  });

  it("getStreamMessages serializes the mode param when provided", async () => {
    const promise = firstValueFrom(
      service.getStreamMessages("ingress", {
        limit: 20,
        mode: "tail",
      }),
    );
    const req = httpMock.expectOne(
      (r) =>
        r.url === `${environment.apiUrl}/channels/streams/ingress/messages` &&
        r.params.get("mode") === "tail" &&
        r.params.get("limit") === "20",
    );
    expect(req.request.method).toBe("GET");
    req.flush({ items: [] });
    await promise;
    httpMock.verify();
  });
});
