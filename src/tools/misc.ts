import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleWhmError, whmCall } from "../services/client.js";
import { err, formatResponse } from "../services/format.js";
import { FormatSchema } from "../schemas/common.js";

export function registerPackageTools(server: McpServer) {
  server.registerTool(
    "whm_list_packages",
    {
      title: "List Hosting Packages",
      description: "List all hosting packages (plans) defined on the server with their resource limits.",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("listpkgs");
        const pkgs = data.pkg ?? [];
        const md = [
          `# Packages (${pkgs.length})`,
          ...pkgs.map(
            (p: any) =>
              `- **${p.name}** — quota ${p.QUOTA}MB, bw ${p.BWLIMIT}MB, sub ${p.MAXSUB}, park ${p.MAXPARK}, addon ${p.MAXADDON}, sql ${p.MAXSQL}, pop ${p.MAXPOP}, ftp ${p.MAXFTP}`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, { packages: pkgs });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_create_package",
    {
      title: "Create Hosting Package",
      description: "Create a new hosting package.",
      inputSchema: {
        name: z.string(),
        QUOTA: z.number().int().min(0).optional().describe("Disk quota MB (0=unlimited)"),
        BWLIMIT: z.number().int().min(0).optional(),
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
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const { response_format, HASSHELL, ...rest } = params;
        const data: any = await whmCall(
          "addpkg",
          { ...rest, ...(HASSHELL !== undefined ? { HASSHELL: HASSHELL ? 1 : 0 } : {}) },
          "POST"
        );
        return formatResponse(response_format, `Created package ${params.name}.`, data);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_edit_package",
    {
      title: "Edit Hosting Package",
      description: "Edit an existing hosting package's limits.",
      inputSchema: {
        name: z.string(),
        QUOTA: z.number().int().min(0).optional(),
        BWLIMIT: z.number().int().min(0).optional(),
        MAXSUB: z.number().int().min(0).optional(),
        MAXPARK: z.number().int().min(0).optional(),
        MAXADDON: z.number().int().min(0).optional(),
        MAXFTP: z.number().int().min(0).optional(),
        MAXSQL: z.number().int().min(0).optional(),
        MAXPOP: z.number().int().min(0).optional(),
        MAXLST: z.number().int().min(0).optional(),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { response_format, ...rest } = params;
        await whmCall("editpkg", rest, "POST");
        return formatResponse(response_format, `Edited package ${params.name}.`, { name: params.name, edited: true });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_delete_package",
    {
      title: "Delete Hosting Package",
      description: "Delete a hosting package. Confirm with user. Accounts on this package retain their settings.",
      inputSchema: { pkg: z.string(), ...FormatSchema },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        await whmCall("killpkg", { pkg: params.pkg }, "POST");
        return formatResponse(params.response_format, `Deleted package ${params.pkg}.`, { pkg: params.pkg, deleted: true });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );
}

export function registerSslTools(server: McpServer) {
  server.registerTool(
    "whm_list_ssl_certs",
    {
      title: "List SSL Certificates",
      description: "List installed SSL certificates on the server, with expiration dates and domains.",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("listcrts");
        const crts = data.crt ?? [];
        const md = [
          `# SSL certs (${crts.length})`,
          ...crts.map(
            (c: any) =>
              `- ${c.domains ?? c.domain} — issuer: ${c.issuer?.commonName ?? c.issuer ?? "n/a"}, expires: ${c.not_after ?? c.expiration ?? "n/a"}`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, { certs: crts });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_get_ssl_info",
    {
      title: "Get SSL Info for Domain",
      description: "Get SSL certificate info for a specific domain.",
      inputSchema: {
        domain: z.string(),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("fetchsslinfo", { domain: params.domain });
        return formatResponse(
          params.response_format,
          `# SSL for ${params.domain}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``,
          data
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_install_ssl",
    {
      title: "Install SSL Certificate",
      description:
        "Install an SSL certificate for a domain. Requires PEM-encoded cert, key, and optionally chain (CA bundle).",
      inputSchema: {
        domain: z.string(),
        crt: z.string().describe("PEM-encoded certificate"),
        key: z.string().describe("PEM-encoded private key"),
        cab: z.string().optional().describe("CA bundle (chain) PEM"),
        ip: z.string().optional().describe("IP to install on"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { response_format, ...rest } = params;
        const data: any = await whmCall("installssl", rest, "POST");
        return formatResponse(response_format, `Installed SSL on ${params.domain}.`, data);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );
}

export function registerBackupTools(server: McpServer) {
  server.registerTool(
    "whm_get_backup_config",
    {
      title: "Get Backup Configuration",
      description: "Get the WHM backup configuration: schedule, retention, destinations.",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("backup_config_get");
        return formatResponse(
          params.response_format,
          `# Backup config\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``,
          data
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_list_backup_destinations",
    {
      title: "List Backup Destinations",
      description: "List all configured remote backup destinations.",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("backup_destination_list");
        const dests = data.destination ?? data.destinations ?? [];
        const md = [
          `# Backup destinations (${dests.length})`,
          ...dests.map(
            (d: any) =>
              `- **${d.name}** (${d.type}) — host: ${d.host ?? "n/a"}, disabled: ${d.disabled ?? "no"}`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, { destinations: dests });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );
}

export function registerResellerTools(server: McpServer) {
  server.registerTool(
    "whm_list_resellers",
    {
      title: "List Resellers",
      description: "List all reseller accounts on the server.",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("listresellers");
        const resellers = data.reseller ?? data.resellers ?? [];
        const md = `# Resellers (${resellers.length})\n${resellers.map((r: any) => `- ${typeof r === "string" ? r : r.user ?? r}`).join("\n")}`;
        return formatResponse(params.response_format, md, { resellers });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_set_reseller_limits",
    {
      title: "Set Reseller Limits",
      description: "Set bandwidth, disk, and account limits for a reseller.",
      inputSchema: {
        user: z.string(),
        bandwidth_limit: z.number().int().min(0).optional().describe("In MB; 0/unlimited"),
        diskspace_limit: z.number().int().min(0).optional(),
        account_limit: z.number().int().min(0).optional(),
        enable_overselling: z.boolean().optional(),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { response_format, enable_overselling, ...rest } = params;
        await whmCall(
          "setresellerlimits",
          {
            ...rest,
            ...(enable_overselling !== undefined ? { enable_overselling: enable_overselling ? 1 : 0 } : {}),
          },
          "POST"
        );
        return formatResponse(response_format, `Updated limits for reseller ${params.user}.`, { user: params.user });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );
}
