import { Injectable } from "@nestjs/common";
import type { IAgentConfig } from "./agent-config.repository.interface";
import type { Agent } from "./agent.model";
import { AgentInstance } from "./agent.model";

@Injectable()
export class AgentFactory {
  build(config: IAgentConfig): Agent {
    const modelConfig = config.modelConfig ?? {};

    const skills = this.extractField(config, "skills");
    const rules = this.extractField(config, "rules");

    const enabledMcpServers = config.enabledMcpServers ?? null;

    return new AgentInstance(
      config.id,
      config.name,
      config.description ?? "",
      config.systemPrompt,
      modelConfig,
      Array.isArray(config.tools) ? config.tools : [],
      config.enabledTools ?? null,
      enabledMcpServers,
      null, // toolDescriptionOverrides not exposed in IAgentConfig yet
      skills,
      rules,
      Array.isArray(config.channels) ? config.channels : [],
      config.knowledgeBaseIds ?? [],
    );
  }

  private extractField(
    config: IAgentConfig,
    field: string,
  ): readonly unknown[] {
    const value = (config as unknown as Record<string, unknown>)[field];
    return Array.isArray(value) ? value : [];
  }
}
