import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { createAuthAdminClient } from "../../../src/resources/auth-admin/client.js";

interface Call extends TransportRequestOptions {}

function fakeTransport(
  handler: (
    call: Call
  ) => TransportResponse<unknown> | Promise<TransportResponse<unknown>>
): { transport: Transport; calls: Call[] } {
  const calls: Call[] = [];
  const transport: Transport = {
    async request(options) {
      calls.push(options);
      return (await handler(options)) as TransportResponse<never>;
    },
  };
  return { transport, calls };
}

test("users.create() POSTs /auth/users", async () => {
  const user = {
    id: "u-1",
    email: "a@b.com",
    role: "admin",
    created_at: "2026-07-04T00:00:00.000Z",
    updated_at: "2026-07-04T00:00:00.000Z",
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: user,
  }));
  const client = createAuthAdminClient({ transport });

  const result = await client.users.create({
    email: "a@b.com",
    password: "password123",
  });

  assert.equal(calls[0]!.path, "/auth/users");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, {
    email: "a@b.com",
    password: "password123",
  });
  assert.deepEqual(result, user);
});

test("users.list() GETs /auth/users and degrades to a single page", async () => {
  const users = [
    {
      id: "u-1",
      email: "a@b.com",
      role: "admin",
      created_at: "2026-07-04T00:00:00.000Z",
      updated_at: "2026-07-04T00:00:00.000Z",
    },
  ];
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: users,
  }));
  const client = createAuthAdminClient({ transport });

  const seen: unknown[] = [];
  for await (const u of client.users.list()) {
    seen.push(u);
  }

  assert.equal(calls[0]!.path, "/auth/users");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(seen, users);
});

test("clients.create() POSTs /auth/clients and returns the client_secret", async () => {
  const created = {
    id: "c-1",
    client_id: "client-1",
    name: "svc",
    scope: "platform",
    is_active: true,
    client_secret: "s3cr3t",
    created_at: "2026-07-04T00:00:00.000Z",
    updated_at: "2026-07-04T00:00:00.000Z",
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: created,
  }));
  const client = createAuthAdminClient({ transport });

  const result = await client.clients.create({ name: "svc" });
  assert.equal(calls[0]!.path, "/auth/clients");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, created);
});

test("clients.list() GETs /auth/clients", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: [],
  }));
  const client = createAuthAdminClient({ transport });

  await client.clients.list().page();
  assert.equal(calls[0]!.path, "/auth/clients");
  assert.equal(calls[0]!.method, "GET");
});

test("clients.remove() DELETEs /auth/clients/:id and URL-encodes the id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createAuthAdminClient({ transport });

  const result = await client.clients.remove("c/1");
  assert.equal(calls[0]!.path, "/auth/clients/c%2F1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});

test("tenantUsers.create() POSTs /auth/tenant-users", async () => {
  const tenantUser = {
    id: "tu-1",
    tenant_id: "acme",
    email: "u@acme.com",
    role_id: "role-1",
    role: "member",
    display_name: null,
    created_at: "2026-07-04T00:00:00.000Z",
    updated_at: "2026-07-04T00:00:00.000Z",
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: tenantUser,
  }));
  const client = createAuthAdminClient({ transport });

  const result = await client.tenantUsers.create({
    email: "u@acme.com",
    password: "password123",
    role_id: "role-1",
  });
  assert.equal(calls[0]!.path, "/auth/tenant-users");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, tenantUser);
});

test("tenantUsers.list() GETs /auth/tenant-users", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: [],
  }));
  const client = createAuthAdminClient({ transport });
  await client.tenantUsers.list().page();
  assert.equal(calls[0]!.path, "/auth/tenant-users");
  assert.equal(calls[0]!.method, "GET");
});

test("tenantUsers.get() GETs /auth/tenant-users/:id", async () => {
  const tenantUser = {
    id: "tu-1",
    tenant_id: "acme",
    email: "u@acme.com",
    role_id: "role-1",
    role: "member",
    display_name: null,
    created_at: "2026-07-04T00:00:00.000Z",
    updated_at: "2026-07-04T00:00:00.000Z",
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: tenantUser,
  }));
  const client = createAuthAdminClient({ transport });
  const result = await client.tenantUsers.get("tu-1");
  assert.equal(calls[0]!.path, "/auth/tenant-users/tu-1");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, tenantUser);
});

test("tenantUsers.update() PATCHes /auth/tenant-users/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { id: "tu-1" },
  }));
  const client = createAuthAdminClient({ transport });
  await client.tenantUsers.update("tu-1", { display_name: "New Name" });
  assert.equal(calls[0]!.path, "/auth/tenant-users/tu-1");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { display_name: "New Name" });
});

test("tenantUsers.remove() DELETEs /auth/tenant-users/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createAuthAdminClient({ transport });
  const result = await client.tenantUsers.remove("tu-1");
  assert.equal(calls[0]!.path, "/auth/tenant-users/tu-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});

test("tenantRoles.create() POSTs /auth/tenant-roles", async () => {
  const role = {
    id: "r-1",
    tenant_id: "acme",
    name: "Support",
    description: null,
    is_system: false,
    is_active: true,
    permissions: [{ resource: "tickets", action: "read" }],
    created_at: "2026-07-04T00:00:00.000Z",
    updated_at: "2026-07-04T00:00:00.000Z",
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: role,
  }));
  const client = createAuthAdminClient({ transport });

  const result = await client.tenantRoles.create({
    name: "Support",
    permissions: [{ resource: "tickets", action: "read" }],
  });
  assert.equal(calls[0]!.path, "/auth/tenant-roles");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, role);
});

test("tenantRoles.list() GETs /auth/tenant-roles", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: [],
  }));
  const client = createAuthAdminClient({ transport });
  await client.tenantRoles.list().page();
  assert.equal(calls[0]!.path, "/auth/tenant-roles");
  assert.equal(calls[0]!.method, "GET");
});

test("tenantRoles.get() GETs /auth/tenant-roles/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { id: "r-1", permissions: [] },
  }));
  const client = createAuthAdminClient({ transport });
  await client.tenantRoles.get("r-1");
  assert.equal(calls[0]!.path, "/auth/tenant-roles/r-1");
  assert.equal(calls[0]!.method, "GET");
});

test("tenantRoles.update() PATCHes /auth/tenant-roles/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { id: "r-1" },
  }));
  const client = createAuthAdminClient({ transport });
  await client.tenantRoles.update("r-1", { description: "updated" });
  assert.equal(calls[0]!.path, "/auth/tenant-roles/r-1");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { description: "updated" });
});

test("tenantRoles.remove() DELETEs /auth/tenant-roles/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createAuthAdminClient({ transport });
  const result = await client.tenantRoles.remove("r-1");
  assert.equal(calls[0]!.path, "/auth/tenant-roles/r-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});

test("publicRoutes.create() POSTs /auth/public-routes", async () => {
  const route = {
    id: "pr-1",
    method: "GET",
    path_pattern: "/sdk-e2e-fin/fake-route",
    scope: "platform",
    environment: "dev",
    created_at: "2026-07-04T00:00:00.000Z",
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: route,
  }));
  const client = createAuthAdminClient({ transport });

  const result = await client.publicRoutes.create({
    method: "GET",
    path_pattern: "/sdk-e2e-fin/fake-route",
    scope: "platform",
  });
  assert.equal(calls[0]!.path, "/auth/public-routes");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, route);
});

test("publicRoutes.list() GETs /auth/public-routes", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: [],
  }));
  const client = createAuthAdminClient({ transport });
  await client.publicRoutes.list().page();
  assert.equal(calls[0]!.path, "/auth/public-routes");
  assert.equal(calls[0]!.method, "GET");
});

test("publicRoutes.remove() DELETEs /auth/public-routes/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createAuthAdminClient({ transport });
  const result = await client.publicRoutes.remove("pr-1");
  assert.equal(calls[0]!.path, "/auth/public-routes/pr-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});
