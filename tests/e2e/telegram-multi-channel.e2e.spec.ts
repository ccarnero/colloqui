import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "bun:test";
import {
  getBaseUrl,
  httpPost,
  httpPatch,
  httpGet,
  httpDelete,
  poll,
} from "./helpers";
import { authHeaders, getTenant } from "./auth.setup";

const GW = getBaseUrl("api-gateway");

/**
 * Channel account row as returned by `POST /api/channels/accounts`.
 * The auto-generated `appSecret` for Telegram accounts is mirrored back
 * in the create response (see `mapRow` in `accounts.service.ts`).
 */
interface IChannelAccount {
  readonly id: string;
  readonly channel: string;
  readonly appSecret?: string;
}

/**
 * Subset of the workflow definition returned by `POST /api/workflows`.
 * The full type lives in `services/workflow-service/src/modules/workflows/workflows.service.ts`
 * (`ICreateWorkflowResult`); we keep the spec dependency-free.
 */
interface IWorkflowDefinitionCreated {
  readonly id: string;
  readonly name: string;
  readonly application: string;
}

/**
 * One row from `GET /api/workflows/:id/executions` (paginated). Only the
 * fields the assertions read are declared.
 */
interface IExecutionListItem {
  readonly id: string;
  readonly status: string;
  readonly request?: {
    readonly text?: string;
    readonly tenantId?: string;
  } | null;
}

interface IExecutionsPage {
  readonly items: IExecutionListItem[];
  readonly total: number;
}

/**
 * Cold-start of api-gateway + channel-service + workflow-service +
 * workflow-worker + Temporal under minikube/orbstack is bounded by the
 * sequential boot of all four pods plus the first activity batch. 120s
 * matches the repo-wide ceiling used by `workflow.e2e.spec.ts`.
 */
const POLL_TIMEOUT_MS = 120_000;
const NEGATIVE_WINDOW_MS = 8_000;
const NEGATIVE_TICK_MS = 1_000;

/**
 * Distinct secret per channel keeps the assertions deterministic. The
 * `Date.now()` suffix scopes them to this test process so two parallel
 * test runs on the same shared tenant do not collide on signature checks.
 */
const RUN_SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 0xffff)}`;
const SECRET_A = `e2e-tg-secret-a-${RUN_SUFFIX}`;
const SECRET_B = `e2e-tg-secret-b-${RUN_SUFFIX}`;

interface IChannelFixture {
  id: string;
  secret: string;
  workflowId: string;
}

const fixtures = new Map<"A" | "B", IChannelFixture>();
const createdChannelIds: string[] = [];
const createdWorkflowIds: string[] = [];

function buildTelegramUpdate(text: string): Record<string, unknown> {
  return {
    update_id: Math.floor(Math.random() * 0xffffffff),
    message: {
      message_id: Math.floor(Math.random() * 0xffffffff),
      date: Math.floor(Date.now() / 1000),
      from: { id: 1, is_bot: false, first_name: "E2E" },
      chat: { id: 1, type: "private" },
      text,
    },
  };
}

/**
 * Builds a workflow definition payload whose trigger filters by a single
 * `accountIds` entry. The `jsFunction` step mirrors `ctx.request.text`
 * back into the execution result so we don't depend on Temporal worker
 * configuration for assertions — `request.text` is also persisted on
 * the row itself by the trigger consumer, which is what we poll for.
 */
function buildWorkflowPayload(
  name: string,
  channelAccountId: string,
): Record<string, unknown> {
  return {
    name,
    application: "e2e-multi-tg",
    actions: [
      {
        activity: "jsFunction",
        name: "tag",
        args: {
          code: `(ctx) => ({ tag: ${JSON.stringify(name)}, text: ctx.request.text })`,
        },
      },
    ],
    trigger: {
      type: "message_received",
      mode: "shared",
      config: { accountIds: [channelAccountId] },
    },
  };
}

async function createChannel(
  headers: Record<string, string>,
  externalId: string,
  appSecret: string,
): Promise<IChannelAccount> {
  const res = await httpPost<IChannelAccount>(
    `${GW}/channels/accounts`,
    {
      channel: "telegram",
      provider: "telegram",
      name: `e2e-multi-tg-${externalId}`,
      externalId,
      telegramBotToken: `0000000000:fake-${externalId}`,
      accessToken: `fake-${externalId}`,
      appSecret,
      isActive: false,
    },
    { headers },
  );
  expect(res.status).toBe(201);
  expect(res.body.id).toBeDefined();
  return res.body;
}

async function activateChannel(
  headers: Record<string, string>,
  channelId: string,
): Promise<void> {
  const res = await httpPatch(
    `${GW}/channels/accounts/${encodeURIComponent(channelId)}`,
    { isActive: true },
    { headers },
  );
  expect(res.status).toBe(200);
}

async function createWorkflow(
  headers: Record<string, string>,
  name: string,
  channelAccountId: string,
): Promise<IWorkflowDefinitionCreated> {
  const res = await httpPost<IWorkflowDefinitionCreated>(
    `${GW}/workflows`,
    buildWorkflowPayload(name, channelAccountId),
    { headers },
  );
  expect(res.status).toBe(201);
  expect(res.body.id).toBeDefined();
  return res.body;
}

interface IPostWebhookOptions {
  /** When `undefined`, omits the header entirely. */
  readonly secret: string | undefined;
  readonly tenant: string;
  readonly text: string;
}

async function postWebhook(
  opts: IPostWebhookOptions,
): Promise<{ status: number }> {
  const headers: Record<string, string> = {};
  if (opts.secret !== undefined) {
    headers["X-Telegram-Bot-Api-Secret-Token"] = opts.secret;
  }
  const res = await httpPost(
    `${GW}/webhooks/telegram/${encodeURIComponent(opts.tenant)}`,
    buildTelegramUpdate(opts.text),
    { headers },
  );
  return { status: res.status };
}

async function listExecutions(
  definitionId: string,
): Promise<IExecutionListItem[]> {
  const h = await authHeaders();
  const res = await httpGet<IExecutionsPage>(
    `${GW}/workflows/${encodeURIComponent(definitionId)}/executions?pageSize=50`,
    { headers: h },
  );
  if (res.status !== 200) return [];
  return res.body?.items ?? [];
}

async function waitForExecutionWithText(
  definitionId: string,
  expectedText: string,
  timeoutMs: number = POLL_TIMEOUT_MS,
): Promise<IExecutionListItem> {
  return poll<IExecutionListItem>(
    async () => {
      const items = await listExecutions(definitionId);
      // O(n) scan over a page sized to 50 — bounded and intentionally
      // simple; we only ever produce 1-2 executions per definition in
      // this suite.
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        if (
          item.status === "COMPLETED" &&
          item.request?.text === expectedText
        ) {
          return item;
        }
      }
      return null;
    },
    { timeoutMs, initialDelayMs: 500, maxDelayMs: 3_000 },
  );
}

async function assertNoExecutionWithText(
  definitionIds: readonly string[],
  text: string,
  windowMs: number = NEGATIVE_WINDOW_MS,
): Promise<void> {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    for (const id of definitionIds) {
      const items = await listExecutions(id);
      for (let i = 0; i < items.length; i++) {
        if (items[i]!.request?.text === text) {
          throw new Error(
            `Unexpected execution with text='${text}' on workflow '${id}'`,
          );
        }
      }
    }
    await Bun.sleep(NEGATIVE_TICK_MS);
  }
}

describe("E2E: telegram multi-channel with distinct secrets", () => {
  const tenant = getTenant();

  beforeAll(async () => {
    const h = await authHeaders();

    const a = await createChannel(h, `e2e-tg-a-${RUN_SUFFIX}`, SECRET_A);
    const b = await createChannel(h, `e2e-tg-b-${RUN_SUFFIX}`, SECRET_B);
    createdChannelIds.push(a.id, b.id);

    await activateChannel(h, a.id);
    await activateChannel(h, b.id);

    const wfA = await createWorkflow(h, `e2e-multi-tg-A-${RUN_SUFFIX}`, a.id);
    const wfB = await createWorkflow(h, `e2e-multi-tg-B-${RUN_SUFFIX}`, b.id);
    createdWorkflowIds.push(wfA.id, wfB.id);

    fixtures.set("A", { id: a.id, secret: SECRET_A, workflowId: wfA.id });
    fixtures.set("B", { id: b.id, secret: SECRET_B, workflowId: wfB.id });
  });

  afterAll(async () => {
    const h = await authHeaders();

    for (const wfId of createdWorkflowIds) {
      await httpDelete(`${GW}/workflows/${encodeURIComponent(wfId)}`, {
        headers: h,
      }).catch(() => undefined);
    }
    for (const id of createdChannelIds) {
      await httpDelete(`${GW}/channels/accounts/${encodeURIComponent(id)}`, {
        headers: h,
      }).catch(() => undefined);
    }
  });

  it(
    "routes a webhook signed with SECRET_A only to workflow A",
    async () => {
      const fxA = fixtures.get("A")!;
      const fxB = fixtures.get("B")!;
      const text = `tx-a-${RUN_SUFFIX}-${Date.now()}`;

      const res = await postWebhook({ secret: SECRET_A, tenant, text });
      expect(res.status).toBe(200);

      const exec = await waitForExecutionWithText(fxA.workflowId, text);
      expect(exec.status).toBe("COMPLETED");
      expect(exec.request?.text).toBe(text);

      await assertNoExecutionWithText([fxB.workflowId], text);
    },
    POLL_TIMEOUT_MS + 30_000,
  );

  it(
    "routes a webhook signed with SECRET_B only to workflow B",
    async () => {
      const fxA = fixtures.get("A")!;
      const fxB = fixtures.get("B")!;
      const text = `tx-b-${RUN_SUFFIX}-${Date.now()}`;

      const res = await postWebhook({ secret: SECRET_B, tenant, text });
      expect(res.status).toBe(200);

      const exec = await waitForExecutionWithText(fxB.workflowId, text);
      expect(exec.status).toBe("COMPLETED");
      expect(exec.request?.text).toBe(text);

      await assertNoExecutionWithText([fxA.workflowId], text);
    },
    POLL_TIMEOUT_MS + 30_000,
  );

  it(
    "rejects a webhook with a missing X-Telegram-Bot-Api-Secret-Token header",
    async () => {
      const fxA = fixtures.get("A")!;
      const fxB = fixtures.get("B")!;
      const text = `tx-none-${RUN_SUFFIX}-${Date.now()}`;

      // The gateway publishes to JetStream before signature verification
      // happens in the channel-service consumer, so the HTTP layer still
      // returns 200 — the rejection is observable only as the absence of
      // any matching workflow execution.
      const res = await postWebhook({ secret: undefined, tenant, text });
      expect(res.status).toBe(200);

      await assertNoExecutionWithText(
        [fxA.workflowId, fxB.workflowId],
        text,
      );
    },
    NEGATIVE_WINDOW_MS + 30_000,
  );

  it(
    "rejects a webhook with an empty signature header",
    async () => {
      const fxA = fixtures.get("A")!;
      const fxB = fixtures.get("B")!;
      const text = `tx-empty-${RUN_SUFFIX}-${Date.now()}`;

      const res = await postWebhook({ secret: "", tenant, text });
      expect(res.status).toBe(200);

      await assertNoExecutionWithText(
        [fxA.workflowId, fxB.workflowId],
        text,
      );
    },
    NEGATIVE_WINDOW_MS + 30_000,
  );

  it(
    "rejects a webhook signed with a secret that matches no active account",
    async () => {
      const fxA = fixtures.get("A")!;
      const fxB = fixtures.get("B")!;
      const text = `tx-wrong-${RUN_SUFFIX}-${Date.now()}`;

      const res = await postWebhook({
        secret: `${SECRET_A}-bogus`,
        tenant,
        text,
      });
      expect(res.status).toBe(200);

      await assertNoExecutionWithText(
        [fxA.workflowId, fxB.workflowId],
        text,
      );
    },
    NEGATIVE_WINDOW_MS + 30_000,
  );

  it(
    "dispatches two consecutive SECRET_A webhooks only to workflow A",
    async () => {
      const fxA = fixtures.get("A")!;
      const fxB = fixtures.get("B")!;
      const baseText = `tx-double-${RUN_SUFFIX}-${Date.now()}`;
      const text1 = `${baseText}-1`;
      const text2 = `${baseText}-2`;

      const res1 = await postWebhook({ secret: SECRET_A, tenant, text: text1 });
      const res2 = await postWebhook({ secret: SECRET_A, tenant, text: text2 });
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const exec1 = await waitForExecutionWithText(fxA.workflowId, text1);
      const exec2 = await waitForExecutionWithText(fxA.workflowId, text2);
      expect(exec1.status).toBe("COMPLETED");
      expect(exec2.status).toBe("COMPLETED");

      await assertNoExecutionWithText([fxB.workflowId], text1);
      await assertNoExecutionWithText([fxB.workflowId], text2);
    },
    POLL_TIMEOUT_MS + 30_000,
  );
});
