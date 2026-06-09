import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { AgentsRuntimeService } from '../../src/modules/agents/agents-runtime.service';

describe('AgentsRuntimeService', () => {
  let service: AgentsRuntimeService;
  const request = vi.fn();

  beforeEach(() => {
    request.mockReset();

    service = new AgentsRuntimeService({
      getConnection: vi.fn().mockResolvedValue({ request }),
    });
  });

  it('includes user_id in chat payload and parses envelope responses', async () => {
    request.mockResolvedValue({
      data: Buffer.from(
        JSON.stringify({
          data: {
            payload: {
              response: 'Hello from runtime',
              tool_calls: [{ name: 'memory.search' }],
            },
          },
        }),
      ),
    });

    const result = await service.chat(
      'acme',
      'agent-1',
      {
        message: 'hello',
        customerName: 'Nahuel',
        context: [],
      },
      'user-42',
    );

    const [subject, payload] = request.mock.calls[0] as [string, string];
    const parsedPayload = JSON.parse(payload) as {
      data: { payload: { user_id?: string } };
    };

    expect(subject).toContain('chat_respond.v1');
    expect(parsedPayload.data.payload.user_id).toBe('user-42');
    expect(result).toEqual({
      reply: 'Hello from runtime',
      tool_calls: [{ name: 'memory.search' }],
    });
  });

  it('maps proposal list payloads into the admin contract', async () => {
    request.mockResolvedValue({
      data: Buffer.from(
        JSON.stringify({
          data: {
            payload: {
              proposals: [
                {
                  id: 'proposal-1',
                  kind: 'fact',
                  title: 'Known preference',
                  content: 'Prefers morning follow-ups and concise answers.',
                  status: 'pending',
                },
              ],
            },
          },
        }),
      ),
    });

    const result = await service.listMemoryProposals('acme');

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toEqual({
      id: 'proposal-1',
      kind: 'fact',
      title: 'Known preference',
      content_excerpt: 'Prefers morning follow-ups and concise answers.',
      status: 'pending',
      created_at: undefined,
      updated_at: undefined,
    });
  });

  it('sends memory_id and actor for proposal reviews', async () => {
    request.mockResolvedValue({
      data: Buffer.from(
        JSON.stringify({
          success: true,
          item: {
            id: 'proposal-2',
            status: 'approved',
          },
        }),
      ),
    });

    const result = await service.reviewMemoryProposal(
      'acme',
      'proposal-2',
      'memory_proposals_approve',
      'reviewer-7',
      'Looks valid',
    );

    const [subject, payload] = request.mock.calls[0] as [string, string];
    const parsedPayload = JSON.parse(payload) as {
      data: { payload: { actor?: string; memory_id?: string; reason?: string } };
    };

    expect(subject).toContain('memory_proposals_approve.v1');
    expect(parsedPayload.data.payload.actor).toBe('reviewer-7');
    expect(parsedPayload.data.payload.memory_id).toBe('proposal-2');
    expect(parsedPayload.data.payload.reason).toBe('Looks valid');
    expect(result).toEqual({
      success: true,
      proposal: {
        id: 'proposal-2',
        kind: undefined,
        title: undefined,
        content_excerpt: undefined,
        status: 'approved',
        created_at: undefined,
        updated_at: undefined,
      },
    });
  });
});
