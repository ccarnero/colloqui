import { describe, expect, it } from "bun:test";
import { sanitizeMcpToolKey } from "../../src/modules/tools/sanitize-mcp-tool-key";

describe("sanitizeMcpToolKey", () => {
  it("joins serverName and toolName with a double underscore", () => {
    expect(sanitizeMcpToolKey("github-mcp", "list_issues")).toBe(
      "github-mcp__list_issues"
    );
  });

  it("matches the OpenAI tool-name pattern for a plain server/tool pair", () => {
    const key = sanitizeMcpToolKey("github-mcp", "list_issues");
    expect(key).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("strips illegal characters from a server name containing a space or dot (deepwiki-shaped real name)", () => {
    // agent-mcp-tool-naming.md T01 regression: the exact incident class —
    // MCP server names have no character-class validation
    // (mcp-servers.dto.ts's CreateMcpServerDto.name is @IsString @Length
    // only), so a name like "deep.wiki server" is legal today.
    const key = sanitizeMcpToolKey("deep.wiki server", "search_wiki");
    expect(key).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(key).toBe("deepwikiserver__search_wiki");
  });

  it("strips illegal characters from a tool name supplied by the remote MCP server", () => {
    const key = sanitizeMcpToolKey("srv", "search wiki (v2)");
    expect(key).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(key).toBe("srv__searchwikiv2");
  });

  it("never emits a colon", () => {
    const key = sanitizeMcpToolKey("srv", "tool");
    expect(key).not.toContain(":");
  });
});
