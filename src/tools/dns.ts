import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleWhmError, whmCall } from "../services/client.js";
import { err, formatResponse } from "../services/format.js";
import { FormatSchema } from "../schemas/common.js";

export function registerDnsTools(server: McpServer) {
  server.registerTool(
    "whm_list_dns_zones",
    {
      title: "List DNS Zones",
      description: "List all DNS zones (domains) hosted on the server.",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("listzones");
        const zones = data.zone ?? [];
        const md = `# DNS zones (${zones.length})\n${zones.map((z: any) => `- ${z.domain}`).join("\n")}`;
        return formatResponse(params.response_format, md, { zones });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_get_dns_zone",
    {
      title: "Get DNS Zone",
      description: "Dump the full BIND zone file for a domain, with all records.",
      inputSchema: {
        domain: z.string(),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("dumpzone", { domain: params.domain });
        const records = data.zone?.[0]?.record ?? [];
        const md = [
          `# Zone: ${params.domain} (${records.length} records)`,
          ...records.map(
            (r: any) =>
              `- ${r.name || "@"} ${r.ttl ?? ""} ${r.class ?? "IN"} ${r.type} ${
                r.cname || r.address || r.exchange || r.txtdata || r.target || ""
              }${r.preference ? ` (pref ${r.preference})` : ""}`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, data);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_create_dns_zone",
    {
      title: "Create DNS Zone",
      description: "Create a new DNS zone for a domain.",
      inputSchema: {
        domain: z.string(),
        ip: z.string().describe("IPv4 address for the zone's A record"),
        template: z.string().optional().describe("Zone template, e.g. 'standardvirtualftp'"),
        trueowner: z.string().optional().describe("cPanel user that owns the zone"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const { response_format, ...rest } = params;
        const data: any = await whmCall("addzone", rest, "POST");
        return formatResponse(response_format, `Created zone for ${params.domain}.`, data);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_delete_dns_zone",
    {
      title: "Delete DNS Zone",
      description: "Delete a DNS zone. Confirm with user — affects mail, web, anything pointing to this zone.",
      inputSchema: { domain: z.string(), ...FormatSchema },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        await whmCall("killdns", { domain: params.domain }, "POST");
        return formatResponse(params.response_format, `Deleted zone ${params.domain}.`, {
          domain: params.domain,
          deleted: true,
        });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_add_dns_record",
    {
      title: "Add DNS Record",
      description: "Add a record to a zone. Pass type-appropriate fields (address for A, cname for CNAME, etc.).",
      inputSchema: {
        domain: z.string().describe("Zone domain"),
        name: z.string().describe("Record name (FQDN with trailing dot, or relative)"),
        type: z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "NS", "PTR", "CAA"]),
        ttl: z.number().int().min(0).default(14400),
        address: z.string().optional().describe("For A/AAAA"),
        cname: z.string().optional().describe("For CNAME"),
        exchange: z.string().optional().describe("For MX (mail server)"),
        preference: z.number().int().optional().describe("For MX (priority)"),
        txtdata: z.string().optional().describe("For TXT/CAA"),
        target: z.string().optional().describe("For SRV"),
        port: z.number().int().optional().describe("For SRV"),
        priority: z.number().int().optional().describe("For SRV"),
        weight: z.number().int().optional().describe("For SRV"),
        nsdname: z.string().optional().describe("For NS"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const { response_format, domain, ...rest } = params;
        const data: any = await whmCall(
          "addzonerecord",
          { zone: domain, ...rest },
          "POST"
        );
        return formatResponse(
          response_format,
          `Added ${params.type} record ${params.name} to ${domain}.`,
          data
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_edit_dns_record",
    {
      title: "Edit DNS Record",
      description:
        "Edit an existing DNS record. line is the zone-file line number from get_dns_zone (Line property in records).",
      inputSchema: {
        domain: z.string(),
        line: z.number().int().describe("Line number in zone file (1-based)"),
        name: z.string().optional(),
        type: z.string().optional(),
        ttl: z.number().int().min(0).optional(),
        address: z.string().optional(),
        cname: z.string().optional(),
        exchange: z.string().optional(),
        preference: z.number().int().optional(),
        txtdata: z.string().optional(),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { response_format, domain, line, ...rest } = params;
        await whmCall(
          "editzonerecord",
          { zone: domain, Line: line, ...rest },
          "POST"
        );
        return formatResponse(
          response_format,
          `Edited record at line ${line} in ${domain}.`,
          { domain, line, edited: true }
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_remove_dns_record",
    {
      title: "Remove DNS Record",
      description: "Remove a DNS record by zone file line. Confirm with user.",
      inputSchema: {
        domain: z.string(),
        line: z.number().int(),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        await whmCall(
          "removezonerecord",
          { zone: params.domain, Line: params.line },
          "POST"
        );
        return formatResponse(
          params.response_format,
          `Removed record at line ${params.line} in ${params.domain}.`,
          { domain: params.domain, line: params.line, removed: true }
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );
}
