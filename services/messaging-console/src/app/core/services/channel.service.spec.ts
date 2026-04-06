import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";

import { ChannelService } from "./channel.service";

describe("ChannelService", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ChannelService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  it("can be instantiated", () => {
    const service = TestBed.inject(ChannelService);
    expect(service).toBeTruthy();
  });

  it("exposes expected HTTP API methods", () => {
    const service = TestBed.inject(ChannelService);
    expect(typeof service.listAccounts).toBe("function");
    expect(typeof service.getAccount).toBe("function");
    expect(typeof service.createAccount).toBe("function");
    expect(typeof service.updateAccount).toBe("function");
    expect(typeof service.deleteAccount).toBe("function");
    expect(typeof service.sendMessage).toBe("function");
    expect(typeof service.listAutoReplyRules).toBe("function");
    expect(typeof service.createAutoReplyRule).toBe("function");
    expect(typeof service.deleteAutoReplyRule).toBe("function");
  });
});
