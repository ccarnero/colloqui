import { describe, it, expect } from "bun:test";
import {
  decodeKubernetesSecretData,
  extractCnpgApplicationPassword,
  passwordFromPostgresUri,
  unwrapNamespacedSecretRead,
} from "../../src/providers/cnpg-credentials";

describe("decodeKubernetesSecretData", () => {
  it("decodes base64 data.password", () => {
    const secret = {
      data: {
        password: Buffer.from("secret-pw", "utf8").toString("base64"),
      },
    };
    expect(decodeKubernetesSecretData(secret, "password")).toBe("secret-pw");
  });

  it("returns undefined when key missing", () => {
    expect(decodeKubernetesSecretData(undefined, "password")).toBeUndefined();
  });
});

describe("unwrapNamespacedSecretRead", () => {
  it("unwraps direct V1Secret response", () => {
    const s = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: "postgres-shared-app" },
      data: {
        password: Buffer.from("x", "utf8").toString("base64"),
      },
    };
    expect(unwrapNamespacedSecretRead(s)?.metadata?.name).toBe(
      "postgres-shared-app",
    );
  });

  it("unwraps { body: V1Secret }", () => {
    const inner = {
      apiVersion: "v1",
      kind: "Secret",
      data: { password: Buffer.from("y", "utf8").toString("base64") },
    };
    expect(
      decodeKubernetesSecretData(
        unwrapNamespacedSecretRead({ body: inner }),
        "password",
      ),
    ).toBe("y");
  });
});

describe("extractCnpgApplicationPassword", () => {
  it("prefers data.password", () => {
    const secret = {
      data: {
        password: Buffer.from("pw1", "utf8").toString("base64"),
        uri: Buffer.from("postgresql://u:pw2@h:5432/db", "utf8").toString(
          "base64",
        ),
      },
    };
    expect(extractCnpgApplicationPassword(secret)).toBe("pw1");
  });

  it("falls back to postgres URI", () => {
    const uri = "postgresql://yoizen:p%40ss%3Aword@postgres.example:5432/yoizen";
    const secret = {
      data: {
        uri: Buffer.from(uri, "utf8").toString("base64"),
      },
    };
    expect(extractCnpgApplicationPassword(secret)).toBe("p@ss:word");
  });
});

describe("passwordFromPostgresUri", () => {
  it("parses encoded password", () => {
    expect(
      passwordFromPostgresUri("postgresql://u:abc%2Fdef@localhost:5432/db"),
    ).toBe("abc/def");
  });
});
