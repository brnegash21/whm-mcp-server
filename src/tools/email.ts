import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleWhmError, whmCall } from "../services/client.js";
import { err, fmtBytes, formatResponse } from "../services/format.js";
import { FormatSchema } from "../schemas/common.js";

export function registerEmailTools(server: McpServer) {
  server.registerTool(
    "whm_get_mail_queue_summary",
    {
      title: "Get Mail Queue Summary",
      description:
        "Get a summary of the Exim mail queue: total messages, oldest message age, queue size on disk. " +
        "Critical for diagnosing mail delivery issues. Large/old queues indicate problems.",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("get_mailq_summary");
        const md = [
          `# Mail queue summary`,
          `- Messages in queue: ${data.message_count ?? data.count ?? "n/a"}`,
          `- Queue size on disk: ${fmtBytes(data.size)}`,
          `- Oldest age (s): ${data.oldest ?? "n/a"}`,
        ].join("\n");
        return formatResponse(params.response_format, md, data);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_get_exim_stats",
    {
      title: "Get Exim Mail Stats",
      description:
        "Get Exim mail statistics: messages sent, received, bounced, rejected, deferred over a time range.",
      inputSchema: {
        starttime: z.string().optional().describe("Start time, e.g. '2025-01-01' or unix timestamp"),
        endtime: z.string().optional(),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("exim_stats_from_mainlog", {
          starttime: params.starttime,
          endtime: params.endtime,
        });
        return formatResponse(params.response_format, `# Exim stats\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``, data);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_purge_mail_queue",
    {
      title: "Purge Mail Queue",
      description:
        "DESTRUCTIVE: Delete messages from the Exim mail queue. Without filters, purges ALL queued mail. Confirm with user.",
      inputSchema: {
        all: z.boolean().default(false).describe("Purge entire queue"),
        sender: z.string().optional().describe("Purge by sender address"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall(
          params.all ? "purge_mail_queue" : "purge_mail_queue",
          { sender: params.sender },
          "POST"
        );
        return formatResponse(params.response_format, `Purge requested.`, data);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_list_pop_accounts_for_user",
    {
      title: "List Email Accounts for User",
      description: "List all POP/IMAP email accounts under a cPanel user.",
      inputSchema: {
        user: z.string(),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("list_pops_for", { user: params.user });
        const accts = data.pops ?? data.acct ?? [];
        const md = [
          `# Email accounts for ${params.user} (${accts.length})`,
          ...accts.map((a: any) => `- ${typeof a === "string" ? a : a.email ?? a}`),
        ].join("\n");
        return formatResponse(params.response_format, md, { accounts: accts });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_list_pop_accounts_with_disk",
    {
      title: "List Email Accounts with Disk Usage",
      description:
        "List all email accounts on the server with disk usage. Useful for finding accounts hitting quota or consuming bulk storage.",
      inputSchema: {
        domain: z.string().optional().describe("Restrict to one domain"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("listpopswithdisk", { domain: params.domain });
        const accts = data.acct ?? data.pops ?? [];
        const md = [
          `# Email accounts with disk usage (${accts.length})`,
          ...accts.map(
            (a: any) =>
              `- ${a.email} — ${fmtBytes(a.diskused ?? 0)} used / ${
                a.diskquota === "unlimited" ? "unlimited" : fmtBytes(a.diskquota)
              }`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, { accounts: accts });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_get_exim_config",
    {
      title: "Get Exim Configuration",
      description: "Fetch the current Exim configuration values.",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("fetch_exim_config_text");
        return formatResponse(
          params.response_format,
          `# Exim config\n\`\`\`\n${data.text ?? data.config ?? JSON.stringify(data)}\n\`\`\``,
          data
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );
}
