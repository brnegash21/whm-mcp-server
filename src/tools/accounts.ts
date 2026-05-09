import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleWhmError, whmCall } from "../services/client.js";
import { err, formatResponse } from "../services/format.js";
import { FormatSchema } from "../schemas/common.js";

export function registerAccountTools(server: McpServer) {
  // ---- listaccts ----
  server.registerTool(
    "whm_list_accounts",
    {
      title: "List cPanel Accounts",
      description:
        "List all cPanel accounts on the server. Optionally filter by user, domain, owner, package, IP, or partial match. " +
        "Returns disk usage, suspension status, package, contact email, and creation date.",
      inputSchema: {
        searchtype: z
          .enum(["domain", "owner", "user", "ip", "package"])
          .optional()
          .describe("Field to filter on"),
        search: z.string().optional().describe("Pattern (regex) to match against searchtype field"),
        wantref: z.boolean().default(false).describe("Include account reference data"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("listaccts", {
          searchtype: params.searchtype,
          search: params.search,
          wantref: params.wantref ? 1 : 0,
        });
        const accts = data.acct ?? [];
        const md = [
          `# cPanel accounts (${accts.length})`,
          ...accts.map(
            (a: any) =>
              `- **${a.user}** (${a.domain}) — owner: ${a.owner}, package: ${a.plan}, suspended: ${
                a.suspended ? "YES" : "no"
              }, disk: ${a.diskused}/${a.disklimit}, email: ${a.email}, ip: ${a.ip}`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, { accounts: accts });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- accountsummary ----
  server.registerTool(
    "whm_get_account_summary",
    {
      title: "Get Account Summary",
      description:
        "Get a detailed summary for a single cPanel account: disk usage, package, suspension status, IPs, contact, partition, etc.",
      inputSchema: {
        user: z.string().optional().describe("cPanel username (one of user/domain required)"),
        domain: z.string().optional().describe("Primary domain (one of user/domain required)"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        if (!params.user && !params.domain) {
          return err("Provide either 'user' or 'domain'.");
        }
        const data: any = await whmCall("accountsummary", {
          user: params.user,
          domain: params.domain,
        });
        const a = data.acct?.[0] ?? {};
        const md = [
          `# Account: ${a.user} (${a.domain})`,
          `- Owner: ${a.owner}`,
          `- Package: ${a.plan}`,
          `- Suspended: ${a.suspended ? "YES" : "no"}${a.suspendreason ? ` (${a.suspendreason})` : ""}`,
          `- Email: ${a.email}`,
          `- IPv4: ${a.ip}`,
          `- Inodes used: ${a.inodesused} / ${a.inodeslimit}`,
          `- Disk used: ${a.diskused} / ${a.disklimit}`,
          `- Partition: ${a.partition}`,
          `- Theme: ${a.theme}`,
          `- Shell: ${a.shell}`,
          `- Created: ${a.startdate}`,
          `- Has shell: ${a.has_shell}`,
          `- Max addons: ${a.maxaddons}, parked: ${a.maxparked}, subdomains: ${a.maxsub}, sql: ${a.maxsql}`,
          `- Max ftp: ${a.maxftp}, pop: ${a.maxpop}, lst: ${a.maxlst}`,
        ].join("\n");
        return formatResponse(params.response_format, md, a);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- createacct ----
  server.registerTool(
    "whm_create_account",
    {
      title: "Create cPanel Account",
      description:
        "Create a new cPanel account. BILLABLE — uses a license seat. Confirm with user. " +
        "Returns the account info including the IP and home directory.",
      inputSchema: {
        username: z.string().min(1).max(16).describe("cPanel username (lowercase, <=16 chars)"),
        domain: z.string().describe("Primary domain"),
        password: z.string().min(8).describe("Account password"),
        plan: z.string().optional().describe("Hosting package name"),
        contactemail: z.string().email().optional(),
        quota: z.number().int().min(0).optional().describe("Disk quota in MB (0 = unlimited)"),
        ip: z.string().optional().describe("Specific IP to assign"),
        cgi: z.boolean().optional(),
        owner: z.string().optional().describe("Reseller that owns the account"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const { response_format, username, ...rest } = params;
        const data: any = await whmCall(
          "createacct",
          { username, ...rest, cgi: rest.cgi === undefined ? undefined : rest.cgi ? 1 : 0 },
          "POST"
        );
        return formatResponse(
          response_format,
          `Created account ${username} (${params.domain}). IP: ${data.ip ?? "n/a"}.`,
          data
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- removeacct ----
  server.registerTool(
    "whm_remove_account",
    {
      title: "Remove cPanel Account",
      description:
        "PERMANENTLY DELETE a cPanel account. All files, databases, mail, and DNS for the user are erased. Always confirm with the user. Optionally keep DNS via keepdns=true.",
      inputSchema: {
        user: z.string().describe("cPanel username to delete"),
        keepdns: z.boolean().default(false).describe("Keep DNS zone after removal"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        await whmCall(
          "removeacct",
          { user: params.user, keepdns: params.keepdns ? 1 : 0 },
          "POST"
        );
        return formatResponse(
          params.response_format,
          `Removed account ${params.user}${params.keepdns ? " (DNS preserved)" : ""}.`,
          { user: params.user, removed: true, keepdns: params.keepdns }
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- suspendacct ----
  server.registerTool(
    "whm_suspend_account",
    {
      title: "Suspend Account",
      description: "Suspend a cPanel account. The user can't log in or receive mail until unsuspended.",
      inputSchema: {
        user: z.string(),
        reason: z.string().optional(),
        disallowun: z.boolean().default(false).describe("Disallow self-unsuspension"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        await whmCall(
          "suspendacct",
          {
            user: params.user,
            reason: params.reason,
            disallowun: params.disallowun ? 1 : 0,
          },
          "POST"
        );
        return formatResponse(
          params.response_format,
          `Suspended ${params.user}${params.reason ? `: ${params.reason}` : ""}.`,
          { user: params.user, suspended: true }
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- unsuspendacct ----
  server.registerTool(
    "whm_unsuspend_account",
    {
      title: "Unsuspend Account",
      description: "Unsuspend a previously-suspended cPanel account.",
      inputSchema: { user: z.string(), ...FormatSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        await whmCall("unsuspendacct", { user: params.user }, "POST");
        return formatResponse(params.response_format, `Unsuspended ${params.user}.`, {
          user: params.user,
          suspended: false,
        });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- modifyacct ----
  server.registerTool(
    "whm_modify_account",
    {
      title: "Modify Account",
      description:
        "Update properties on a cPanel account: domain, contact email, quota, bandwidth, max accounts, has_shell, etc.",
      inputSchema: {
        user: z.string(),
        domain: z.string().optional(),
        CONTACTEMAIL: z.string().email().optional(),
        QUOTA: z.number().int().min(0).optional().describe("Disk quota in MB"),
        BWLIMIT: z.number().int().min(0).optional().describe("Bandwidth limit in MB"),
        MAXSUB: z.number().int().min(0).optional(),
        MAXPARK: z.number().int().min(0).optional(),
        MAXADDON: z.number().int().min(0).optional(),
        MAXFTP: z.number().int().min(0).optional(),
        MAXSQL: z.number().int().min(0).optional(),
        MAXPOP: z.number().int().min(0).optional(),
        MAXLST: z.number().int().min(0).optional(),
        HASSHELL: z.boolean().optional(),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { response_format, HASSHELL, ...rest } = params;
        await whmCall(
          "modifyacct",
          {
            ...rest,
            ...(HASSHELL !== undefined ? { HASSHELL: HASSHELL ? 1 : 0 } : {}),
          },
          "POST"
        );
        return formatResponse(response_format, `Modified account ${params.user}.`, {
          user: params.user,
          modified: true,
        });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- changepackage ----
  server.registerTool(
    "whm_change_package",
    {
      title: "Change Account Package",
      description: "Move a cPanel account to a different hosting package (plan).",
      inputSchema: {
        user: z.string(),
        pkg: z.string().describe("Target package name"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        await whmCall("changepackage", { user: params.user, pkg: params.pkg }, "POST");
        return formatResponse(
          params.response_format,
          `Moved ${params.user} to package ${params.pkg}.`,
          { user: params.user, package: params.pkg }
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- passwd ----
  server.registerTool(
    "whm_change_password",
    {
      title: "Change Account Password",
      description:
        "Change a cPanel user's password. Optionally update mail and database passwords too via db_pass_update.",
      inputSchema: {
        user: z.string(),
        password: z.string().min(5),
        db_pass_update: z.boolean().default(true).describe("Also update database/mail passwords"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        await whmCall(
          "passwd",
          {
            user: params.user,
            password: params.password,
            db_pass_update: params.db_pass_update ? 1 : 0,
          },
          "POST"
        );
        return formatResponse(
          params.response_format,
          `Changed password for ${params.user}.`,
          { user: params.user, password_changed: true }
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- list_users ----
  server.registerTool(
    "whm_list_users",
    {
      title: "List Server Users",
      description: "List all system users on the server (cPanel accounts plus system accounts).",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("list_users");
        const users = data.users ?? [];
        const md = `# Users (${users.length})\n${users.map((u: string) => `- ${u}`).join("\n")}`;
        return formatResponse(params.response_format, md, { users });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );
}
