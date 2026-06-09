import { describe, it, expect, beforeEach, vi } from "bun:test";
import { AgentsService } from "../../src/modules/agents/agents.service";
import { AgentsRuntimeService } from "../../src/modules/agents/agents-runtime.service";
import type { IAgent } from "../../src/modules/agents/agents.repository.interface";
import { NatsPublisher } from "../../src/providers/nats.provider";
import { AdaptersService } from "../../src/modules/adapters/adapters.service";

type MockFn = ReturnType<typeof vi.fn>;
const mocked = <T extends MockFn>(fn: T): T => fn;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = "tenant-123";
const USER_ID = "user-456";

function makeAgent(overrides: Partial<IAgent> = {}): IAgent {
  return {
    id: "agent-1",
    name: "Test Agent",
    description: "A test agent",
    system_prompt: "You are helpful.",
    model_config: {
      llm: {
        provider: "openai",
        model: "gpt-4o",
        temperature: 0.7,
        maxTokens: 4096,
      },
    },
    tools: [
      { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
    ],
    enabled_tools: null,
    enabled_mcp_servers: null,
    tool_description_overrides: null,
    channels: [{ type: "webchat", id: "ch-1" }],
    knowledge_base_ids: ["kb-1"],
    input_variables: [],
    output_variables: [],
    status: "published",
    is_active: true,
    published_at: new Date("2026-01-01T00:00:00Z"),
    published_config: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ===========================================================================
// AgentsService with SemVer
// ===========================================================================

describe("AgentsService with SemVer", () => {
  let service: AgentsService;
  let mockRepository: {
    findAll: MockFn;
    findById: MockFn;
    create: MockFn;
    update: MockFn;
    delete: MockFn;
    publish: MockFn;
    unpublish: MockFn;
    revertToPublished: MockFn;
    listVersions: MockFn;
    rollbackToVersion: MockFn;
    deleteVersion: MockFn;
  };
  let mockNatsPublisher: NatsPublisher;
  let mockRuntimeService: AgentsRuntimeService;
  let mockAdaptersService: AdaptersService;

  beforeEach(() => {
    mockRepository = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      publish: vi.fn(),
      unpublish: vi.fn(),
      revertToPublished: vi.fn(),
      listVersions: vi.fn(),
      rollbackToVersion: vi.fn(),
      deleteVersion: vi.fn(),
    } as typeof mockRepository;

    mockNatsPublisher = {
      publishAgentPublished: vi.fn(),
      publishAgentUnpublished: vi.fn(),
    } as unknown as NatsPublisher;

    mockRuntimeService = {
      chat: vi.fn(),
      listMemoryProposals: vi.fn(),
      reviewMemoryProposal: vi.fn(),
    } as unknown as AgentsRuntimeService;

    mockAdaptersService = {
      adapterExists: vi.fn(() => Promise.resolve(true)),
      endpointExists: vi.fn(() => Promise.resolve(true)),
    } as unknown as AdaptersService;

    service = new AgentsService(
      mockRepository,
      mockNatsPublisher,
      mockRuntimeService,
      mockAdaptersService,
    );
  });

  // ---------------------------------------------------------------------------
  // publish with SemVer — first publish (1.0.0)
  // ---------------------------------------------------------------------------

  it("should pass semver fields to repository on first publish (1.0.0)", async () => {
    const agent = makeAgent({ status: "published" });

    // No previous published_config → first publish
    mocked(mockRepository.findById).mockResolvedValue({
      ...agent,
      published_config: null,
    });
    mocked(mockRepository.publish).mockResolvedValue(agent);
    mocked(mockNatsPublisher.publishAgentPublished).mockResolvedValue(null);

    // The service should eventually accept a userId param
    await service.publish(TENANT_ID, agent.id, USER_ID);

    // Repository.publish should be called with semver data
    expect(mockRepository.publish).toHaveBeenCalledWith(
      TENANT_ID,
      agent.id,
      expect.objectContaining({
        semver: expect.objectContaining({
          major: 1,
          minor: 0,
          patch: 0,
          label: "1.0.0",
        }),
        publishedBy: USER_ID,
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // publish with SemVer — minor bump (tool addition)
  // ---------------------------------------------------------------------------

  it("should pass correct semver bump on tool addition (minor)", async () => {
    const previousPublishedConfig = {
      system_prompt: "You are helpful.",
      model_config: {
        llm: { provider: "openai", model: "gpt-4o", temperature: 0.7, maxTokens: 4096 },
      },
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
      ],
      channels: [{ type: "webchat", id: "ch-1" }],
    };

    const agent = makeAgent({
      status: "published",
      published_config: previousPublishedConfig,
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
        { name: "catalog", adapterRef: { adapterId: "cat-1", endpointId: "search" } },
      ],
    });

    // Existing version at 1.0.0
    mocked(mockRepository.findById).mockResolvedValue(agent);
    mocked(mockRepository.listVersions).mockResolvedValue([
      {
        id: "v-1",
        agent_id: agent.id,
        version_number: 10000,
        snapshot: previousPublishedConfig,
        published_at: new Date("2026-01-01T00:00:00Z"),
        created_at: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    mocked(mockRepository.publish).mockResolvedValue(agent);
    mocked(mockNatsPublisher.publishAgentPublished).mockResolvedValue(null);

    await service.publish(TENANT_ID, agent.id, USER_ID);

    expect(mockRepository.publish).toHaveBeenCalledWith(
      TENANT_ID,
      agent.id,
      expect.objectContaining({
        semver: expect.objectContaining({
          major: 1,
          minor: 1,
          patch: 0,
          label: "1.1.0",
          bumpType: "minor",
        }),
        publishedBy: USER_ID,
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // publish with SemVer — major bump (tool removal)
  // ---------------------------------------------------------------------------

  it("should pass correct semver bump on tool removal (major)", async () => {
    const previousPublishedConfig = {
      system_prompt: "You are helpful.",
      model_config: {
        llm: { provider: "openai", model: "gpt-4o", temperature: 0.7, maxTokens: 4096 },
      },
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
        { name: "catalog", adapterRef: { adapterId: "cat-1", endpointId: "search" } },
      ],
      channels: [{ type: "webchat", id: "ch-1" }],
    };

    const agent = makeAgent({
      status: "published",
      published_config: previousPublishedConfig,
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
      ],
    });

    mocked(mockRepository.findById).mockResolvedValue(agent);
    mocked(mockRepository.listVersions).mockResolvedValue([
      {
        id: "v-1",
        agent_id: agent.id,
        version_number: 10000,
        snapshot: previousPublishedConfig,
        published_at: new Date("2026-01-01T00:00:00Z"),
        created_at: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    mocked(mockRepository.publish).mockResolvedValue(agent);
    mocked(mockNatsPublisher.publishAgentPublished).mockResolvedValue(null);

    await service.publish(TENANT_ID, agent.id, USER_ID);

    expect(mockRepository.publish).toHaveBeenCalledWith(
      TENANT_ID,
      agent.id,
      expect.objectContaining({
        semver: expect.objectContaining({
          major: 2,
          minor: 0,
          patch: 0,
          label: "2.0.0",
          bumpType: "major",
        }),
        publishedBy: USER_ID,
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // publish with SemVer — patch bump (prompt change)
  // ---------------------------------------------------------------------------

  it("should pass correct semver bump on prompt change (patch)", async () => {
    const previousPublishedConfig = {
      system_prompt: "You are helpful.",
      model_config: {
        llm: { provider: "openai", model: "gpt-4o", temperature: 0.7, maxTokens: 4096 },
      },
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
      ],
      channels: [{ type: "webchat", id: "ch-1" }],
    };

    const agent = makeAgent({
      status: "published",
      published_config: previousPublishedConfig,
      system_prompt: "You are a sales assistant.",
    });

    mocked(mockRepository.findById).mockResolvedValue(agent);
    mocked(mockRepository.listVersions).mockResolvedValue([
      {
        id: "v-1",
        agent_id: agent.id,
        version_number: 10000,
        snapshot: previousPublishedConfig,
        published_at: new Date("2026-01-01T00:00:00Z"),
        created_at: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    mocked(mockRepository.publish).mockResolvedValue(agent);
    mocked(mockNatsPublisher.publishAgentPublished).mockResolvedValue(null);

    await service.publish(TENANT_ID, agent.id, USER_ID);

    expect(mockRepository.publish).toHaveBeenCalledWith(
      TENANT_ID,
      agent.id,
      expect.objectContaining({
        semver: expect.objectContaining({
          major: 1,
          minor: 0,
          patch: 1,
          label: "1.0.1",
          bumpType: "patch",
        }),
        publishedBy: USER_ID,
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // published_by audit
  // ---------------------------------------------------------------------------

  it("should pass published_by userId to repository", async () => {
    const agent = makeAgent({ status: "published" });

    mocked(mockRepository.publish).mockResolvedValue(agent);
    mocked(mockNatsPublisher.publishAgentPublished).mockResolvedValue(null);

    await service.publish(TENANT_ID, agent.id, USER_ID);

    // Verify the publish call includes the userId for audit
    expect(mockRepository.publish).toHaveBeenCalledWith(
      TENANT_ID,
      agent.id,
      expect.objectContaining({
        publishedBy: USER_ID,
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // diff computation
  // ---------------------------------------------------------------------------

  it("should compute diff and pass to repository", async () => {
    const previousPublishedConfig = {
      system_prompt: "Old prompt",
      model_config: {
        llm: { provider: "openai", model: "gpt-4o", temperature: 0.7, maxTokens: 4096 },
      },
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
      ],
      channels: [{ type: "webchat", id: "ch-1" }],
    };

    const agent = makeAgent({
      status: "published",
      published_config: previousPublishedConfig,
      system_prompt: "New prompt",
    });

    mocked(mockRepository.findById).mockResolvedValue(agent);
    mocked(mockRepository.listVersions).mockResolvedValue([
      {
        id: "v-1",
        agent_id: agent.id,
        version_number: 10000,
        snapshot: previousPublishedConfig,
        published_at: new Date("2026-01-01T00:00:00Z"),
        created_at: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    mocked(mockRepository.publish).mockResolvedValue(agent);
    mocked(mockNatsPublisher.publishAgentPublished).mockResolvedValue(null);

    await service.publish(TENANT_ID, agent.id, USER_ID);

    // Verify repository receives a diff object
    expect(mockRepository.publish).toHaveBeenCalledWith(
      TENANT_ID,
      agent.id,
      expect.objectContaining({
        diff: expect.objectContaining({
          modified: expect.arrayContaining([
            expect.objectContaining({
              field: "system_prompt",
              before: "Old prompt",
              after: "New prompt",
            }),
          ]),
        }),
      }),
    );
  });
});
