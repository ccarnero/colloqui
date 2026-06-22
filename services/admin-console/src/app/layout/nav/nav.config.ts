/**
 * Visual treatment for a sub-nav indicator.
 *  - "count":         muted gray number (informational, e.g. "Users 142")
 *  - "count-warn":    amber number (something needs attention soon)
 *  - "count-danger":  red number (something needs you now)
 *  - "dot":           a single colored status dot (no number)
 */
export type NavIndicatorKind =
  | "count"
  | "count-warn"
  | "count-danger"
  | "dot";

/**
 * Declares that a nav item should display a live indicator.
 * `source` is a free-form key resolved at render time by the
 * NavIndicatorRegistry.
 */
export interface INavIndicator {
  kind: NavIndicatorKind;
  source: string;
}

export interface INavPage {
  label: string;
  route: string;
  dividerBefore?: true;
  /** Optional live indicator (count or dot) shown next to the label. */
  indicator?: INavIndicator;
}

export interface INavSection {
  key: string;
  label: string;
  /** Route prefixes used to detect the active section from the current URL. */
  matchPaths: string[];
  /** Path the section tab navigates to (the section's landing page). */
  landingPath: string;
  pages: INavPage[];
}

/**
 * Phase 4 reorganization:
 *  - Overview, Channels, Connections, AI, Processes, Settings (6 sections)
 *  - Auto-Reply removed from Channels
 *  - Connections is a new section grouping connector instances by type
 *    (Internal HTTP / External HTTP / MCP / Hosted services)
 *  - Processes replaces Automate
 *  - Settings trimmed to backed pages (+ Billing kept as a planned area)
 */
export const NAV_SECTIONS: INavSection[] = [
  {
    key: "overview",
    label: "Overview",
    matchPaths: ["/dashboard", "/analytics"],
    landingPath: "/dashboard",
    pages: [
      { label: "Dashboard", route: "/dashboard" },
      { label: "Analytics", route: "/analytics" },
    ],
  },
  {
    key: "channels",
    label: "Channels",
    matchPaths: ["/channels"],
    landingPath: "/channels",
    pages: [
      {
        label: "WhatsApp",
        route: "/channels/whatsapp",
        indicator: { kind: "count", source: "channels.whatsapp.total" },
      },
      {
        label: "Telegram",
        route: "/channels/telegram",
        indicator: { kind: "count", source: "channels.telegram.total" },
      },
      {
        label: "HTTP",
        route: "/channels/http",
        indicator: { kind: "count", source: "channels.http.total" },
      },
    ],
  },
  {
    key: "connections",
    label: "Connections",
    matchPaths: ["/connections", "/connectors", "/hosted-services"],
    landingPath: "/connections",
    pages: [
      { label: "Overview", route: "/connections" },
      {
        label: "HTTP",
        route: "/connections/http",
        indicator: { kind: "count", source: "connections.http.total" },
      },
      { label: "MCP", route: "/connections/mcp" },
      {
        label: "Hosted services",
        route: "/connections/hosted-services",
        indicator: { kind: "count", source: "connections.hosted.total" },
      },
    ],
  },
  {
    key: "ai",
    label: "AI",
    matchPaths: ["/ai"],
    landingPath: "/ai",
    pages: [
      {
        label: "Agents",
        route: "/ai/agents",
        indicator: { kind: "count", source: "ai.agents.total" },
      },
      { label: "Playground", route: "/ai/playground" },
      {
        label: "Memories",
        route: "/ai/memories",
        indicator: { kind: "count", source: "ai.memories.total" },
      },
      { label: "Skills", route: "/ai/skills" },
      { label: "Knowledge Bases", route: "/ai/knowledge-bases" },
      { label: "System Variables", route: "/ai/system-variables" },
    ],
  },
  {
    key: "processes",
    label: "Processes",
    matchPaths: ["/processes", "/automate", "/workflows", "/schedules"],
    landingPath: "/processes",
    pages: [
      {
        label: "Workflows",
        route: "/workflows",
        indicator: { kind: "count", source: "processes.workflows.total" },
      },
      {
        label: "Schedules",
        route: "/schedules",
      },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    matchPaths: ["/settings", "/users", "/roles", "/api-keys", "/billing"],
    landingPath: "/settings",
    pages: [
      {
        label: "Users",
        route: "/users",
        indicator: { kind: "count", source: "settings.users.total" },
      },
      {
        label: "Roles",
        route: "/roles",
        indicator: { kind: "count", source: "settings.roles.total" },
      },
      { label: "API keys", route: "/api-keys" },
      { label: "Billing", route: "/billing" },
    ],
  },
];
