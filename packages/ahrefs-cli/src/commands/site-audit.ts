import { endpointCommand } from "../command-builder.ts";
import { group } from "../framework/runtime.ts";

export const siteAuditProjectsCmd = endpointCommand({
  path: "/site-audit/projects",
  name: "projects",
  rowsKey: "projects",
});

export const siteAuditIssuesCmd = endpointCommand({
  path: "/site-audit/issues",
  name: "issues",
  rowsKey: "issues",
});

export const siteAuditPageContentCmd = endpointCommand({
  path: "/site-audit/page-content",
  name: "page-content",
  single: true,
});

export const siteAuditPageExplorerCmd = endpointCommand({
  path: "/site-audit/page-explorer",
  name: "page-explorer",
  rowsKey: "pages",
});

export const siteAuditGroup = group({
  name: "site-audit",
  description: "Site Audit — projects, issues, page content/explorer.",
  commands: [
    siteAuditProjectsCmd,
    siteAuditIssuesCmd,
    siteAuditPageContentCmd,
    siteAuditPageExplorerCmd,
  ],
});
