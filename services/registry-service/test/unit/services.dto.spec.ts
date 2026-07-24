import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  RegisterServiceDto,
  UpdateServiceDto,
} from "../../src/modules/services/services.dto";

// manual-loops/provisioning-manifest-gaps-4.md T04 (Option B — k8s-native
// valueFrom.secretKeyRef, human ruling 2026-07-24). `envVars` widens from
// plain-strings-only to a union of plain string | { secretKeyRef: { name,
// key } } — this service never resolves a secretKeyRef to a value itself.
describe("RegisterServiceDto envVars validation", () => {
  it("accepts an envVars map with only plain-string values (unchanged)", async () => {
    const dto = plainToInstance(RegisterServiceDto, {
      name: "svc-1",
      image: "img:v1",
      envVars: { MODE: "production" },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("accepts an envVars map with a { secretKeyRef: { name, key } } entry", async () => {
    const dto = plainToInstance(RegisterServiceDto, {
      name: "svc-1",
      image: "img:v1",
      envVars: {
        YOIZEN_PASSWORD: {
          secretKeyRef: { name: "psec-service-svc-1", key: "svc-password" },
        },
      },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("accepts a mixed envVars map (literal + secretKeyRef entries)", async () => {
    const dto = plainToInstance(RegisterServiceDto, {
      name: "svc-1",
      image: "img:v1",
      envVars: {
        MODE: "production",
        YOIZEN_PASSWORD: {
          secretKeyRef: { name: "psec-service-svc-1", key: "svc-password" },
        },
      },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects a bare { secretRef } entry (not the k8s-native secretKeyRef shape)", async () => {
    const dto = plainToInstance(RegisterServiceDto, {
      name: "svc-1",
      image: "img:v1",
      envVars: { YOIZEN_PASSWORD: { secretRef: "svc-password" } },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe("envVars");
  });

  it("rejects a secretKeyRef entry missing the key field", async () => {
    const dto = plainToInstance(RegisterServiceDto, {
      name: "svc-1",
      image: "img:v1",
      envVars: {
        YOIZEN_PASSWORD: { secretKeyRef: { name: "psec-service-svc-1" } },
      },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe("envVars");
  });
});

describe("UpdateServiceDto envVars validation", () => {
  it("accepts a mixed envVars map (literal + secretKeyRef entries)", async () => {
    const dto = plainToInstance(UpdateServiceDto, {
      envVars: {
        MODE: "production",
        YOIZEN_PASSWORD: {
          secretKeyRef: { name: "psec-service-svc-1", key: "svc-password" },
        },
      },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects a bare { secretRef } entry", async () => {
    const dto = plainToInstance(UpdateServiceDto, {
      envVars: { YOIZEN_PASSWORD: { secretRef: "svc-password" } },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe("envVars");
  });
});
