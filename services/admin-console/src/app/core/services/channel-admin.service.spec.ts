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
});
