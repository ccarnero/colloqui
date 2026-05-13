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
      { label: "WhatsApp", route: "/channels/whatsapp" },
      { label: "Telegram", route: "/channels/telegram" },
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
        indicator: {
          kind: "count-danger",
          source: "connections.http.errored",
        },
      },
      { label: "MCP", route: "/connections/mcp" },
      {
        label: "Hosted services",
        route: "/connections/hosted-services",
        indicator: { kind: "count", source: "connections.hosted.count" },
      },
    ],
  },
  {
    key: "ai",
    label: "AI",
    matchPaths: ["/yoizenclaw"],
    landingPath: "/yoizenclaw",
    pages: [
      { label: "Agents", route: "/yoizenclaw/agents" },
      { label: "Playground", route: "/yoizenclaw/playground" },
      {
        label: "Memories",
        route: "/yoizenclaw/memories",
        indicator: { kind: "count-danger", source: "ai.memories.pending" },
      },
    ],
  },
  {
    key: "processes",
    label: "Processes",
    matchPaths: ["/processes", "/automate", "/workflows"],
    landingPath: "/processes",
    pages: [
      {
        label: "Workflows",
        route: "/workflows",
        indicator: {
          kind: "count-danger",
          source: "processes.workflows.failing",
        },
      },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    matchPaths: ["/settings", "/users", "/roles", "/api-keys", "/billing"],
    landingPath: "/settings",
    pages: [
      { label: "Users", route: "/users" },
      { label: "Roles", route: "/roles" },
      { label: "API keys", route: "/api-keys" },
      { label: "Billing", route: "/billing" },
    ],
  },
];
