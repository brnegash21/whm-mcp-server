import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleWhmError, whmCall } from "../services/client.js";
import { err, formatResponse } from "../services/format.js";
import { FormatSchema } from "../schemas/common.js";

/**
 * Log tailing/error reading. Critical for the user's "error monitoring" use case.
 * WHM exposes a few endpoints for this; for arbitrary log tailing, the
 * cpanel function on UAPI is more flexible — but at the WHM level we have
 * dedicated endpoints for the most useful logs.
 */
export function registerLogTools(server: McpServer) {
  server.registerTool(
    "whm_tail_apache_error_log",
    {
      title: "Tail Apache Error Log",
      description:
        "Tail the global Apache error_log. THE big one for diagnosing 500 errors, mod_security blocks, PHP fatals, etc.",
      inputSchema: {
        lines: z.number().int().min(1).max(2000).default(200).describe("Lines to tail"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("tail_apache_error_log", { lines: params.lines });
        const text = data.text ?? data.log ?? data.lines?.join("\n") ?? JSON.stringify(data);
        return formatResponse(
          params.response_format,
          `# Apache error_log (last ${params.lines} lines)\n\`\`\`\n${text}\n\`\`\``,
          { log: "apache_error_log", lines: params.lines, content: text }
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_tail_exim_log",
    {
      title: "Tail Exim Log",
      description: "Tail Exim's mainlog for delivery, deferral, and reject events.",
      inputSchema: {
        lines: z.number().int().min(1).max(2000).default(200),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        // WHM doesn't have a uniform tail endpoint; we use 'cpanel' module to fetch_log
        const data: any = await whmCall("cpanel", {
          cpanel_jsonapi_user: "root",
          cpanel_jsonapi_module: "Exim",
          cpanel_jsonapi_func: "fetch_mainlog",
          cpanel_jsonapi_apiversion: 2,
          lines: params.lines,
        });
        const text =
          data?.cpanelresult?.data?.[0]?.log ??
          data?.cpanelresult?.data?.map((r: any) => r.text).join("\n") ??
          JSON.stringify(data);
        return formatResponse(
          params.response_format,
          `# Exim mainlog (last ${params.lines})\n\`\`\`\n${text}\n\`\`\``,
          { log: "exim_mainlog", lines: params.lines, content: text }
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_get_chkservd_log",
    {
      title: "Get Chkservd Log",
      description:
        "Fetch the chkservd log — critical for diagnosing why a service was reported down by WHM monitoring.",
      inputSchema: {
        lines: z.number().int().min(1).max(2000).default(200),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("get_chkservd_log");
        const text = data.text ?? data.log ?? JSON.stringify(data);
        const trimmed = text.split("\n").slice(-params.lines).join("\n");
        return formatResponse(
          params.response_format,
          `# chkservd log (last ${params.lines})\n\`\`\`\n${trimmed}\n\`\`\``,
          { log: "chkservd", lines: params.lines, content: trimmed }
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_get_login_history",
    {
      title: "Get WHM Login History",
      description: "Get the login history for the WHM control panel — root and reseller logins.",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("get_login_history");
        const events = data.history ?? data.login_history ?? [];
        const md = [
          `# WHM login history (${events.length})`,
          ...events.slice(0, 50).map(
            (e: any) =>
              `- ${e.date ?? e.time ?? ""} — ${e.user ?? "?"} from ${e.host ?? e.ip ?? "?"} (${e.status ?? "?"})`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, data);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_get_audit_log",
    {
      title: "Get WHM Audit Log",
      description:
        "Get the audit log of WHM administrative actions (account creation/removal, package changes, etc.).",
      inputSchema: {
        days: z.number().int().min(1).max(365).default(7),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("get_audit_log", { days: params.days });
        const items = data.items ?? data.entries ?? data.log ?? [];
        const md = [
          `# WHM audit log (last ${params.days} days)`,
          ...(Array.isArray(items) ? items : []).slice(0, 100).map(
            (e: any) =>
              `- ${e.date ?? e.timestamp ?? ""} — ${e.username ?? e.user ?? "?"} did **${e.action ?? e.event ?? "?"}** (${e.target ?? ""})`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, data);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );
}
