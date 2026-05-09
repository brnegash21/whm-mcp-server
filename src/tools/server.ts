import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleWhmError, whmCall } from "../services/client.js";
import { err, fmtBytes, formatResponse } from "../services/format.js";
import { FormatSchema } from "../schemas/common.js";

export function registerServerTools(server: McpServer) {
  // ---- get_server_information ----
  server.registerTool(
    "whm_get_server_information",
    {
      title: "Get Server Information",
      description: "Get host info: OS, kernel, hostname, server time, IPs, mainip, contact email.",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("get_server_information");
        const md = [
          `# Server`,
          `- Hostname: ${data.hostname}`,
          `- OS: ${data.distro} ${data.distro_release} (kernel ${data.kernel_version})`,
          `- Server time: ${data.servertime_iso8601 ?? data.servertime}`,
          `- Main IP: ${data.mainip}`,
          `- IPs: ${(data.ips ?? []).join(", ")}`,
          `- Contact: ${data.contact_email}`,
        ].join("\n");
        return formatResponse(params.response_format, md, data);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- version ----
  server.registerTool(
    "whm_get_version",
    {
      title: "Get WHM Version",
      description: "Get the running WHM/cPanel version.",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("version");
        return formatResponse(
          params.response_format,
          `WHM/cPanel version: ${data.version}`,
          data
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- systemloadavg ----
  server.registerTool(
    "whm_get_load_avg",
    {
      title: "Get Load Average",
      description: "Get current 1, 5, 15-minute system load averages.",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("systemloadavg");
        const md = `# Load average\n- 1 min: ${data.one}\n- 5 min: ${data.five}\n- 15 min: ${data.fifteen}`;
        return formatResponse(params.response_format, md, data);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- get_disk_usage ----
  server.registerTool(
    "whm_get_disk_usage",
    {
      title: "Get Disk Usage",
      description: "Get disk usage by partition and per cPanel account home directory.",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("get_disk_usage");
        const md: string[] = [`# Disk usage`];
        for (const p of data.partition ?? []) {
          md.push(
            `- **${p.partition}** (${p.mount}) — ${p.used}% used (${fmtBytes((p.used_blocks ?? 0) * 1024)} / ${fmtBytes((p.total_blocks ?? 0) * 1024)})`
          );
        }
        return formatResponse(params.response_format, md.join("\n"), data);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- showbw ----
  server.registerTool(
    "whm_get_bandwidth_usage",
    {
      title: "Get Bandwidth Usage",
      description: "Get monthly bandwidth usage per account, optionally for a specific month.",
      inputSchema: {
        month: z.number().int().min(1).max(12).optional(),
        year: z.number().int().min(2000).max(2100).optional(),
        showres: z.string().optional().describe("Specific reseller's accounts only"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("showbw", {
          month: params.month,
          year: params.year,
          showres: params.showres,
        });
        const accts = data.month?.[0]?.acct ?? data.acct ?? [];
        const md = [
          `# Bandwidth (${params.month ?? ""}/${params.year ?? ""})`,
          ...accts.map(
            (a: any) =>
              `- **${a.user}** (${a.domain}) — ${fmtBytes(a.totalbytes)} used / ${a.limit === "unlimited" ? "unlimited" : fmtBytes(a.limit)}`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, data);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- gethostname ----
  server.registerTool(
    "whm_get_hostname",
    {
      title: "Get Hostname",
      description: "Get the server's hostname.",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("gethostname");
        return formatResponse(params.response_format, `Hostname: ${data.hostname}`, data);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- sethostname ----
  server.registerTool(
    "whm_set_hostname",
    {
      title: "Set Hostname",
      description: "Change the server's hostname. Affects mail, SSL, and licensing — confirm with user.",
      inputSchema: {
        hostname: z.string().describe("New FQDN, e.g. 'srv2.example.com'"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("sethostname", { hostname: params.hostname }, "POST");
        return formatResponse(params.response_format, `Hostname set to ${params.hostname}.`, data);
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- servicestatus ----
  server.registerTool(
    "whm_check_service_status",
    {
      title: "Check Service Status",
      description:
        "Check the status of system services (httpd, exim, mysql, named, dovecot, ftpd, etc.). Without 'service', returns all monitored services.",
      inputSchema: {
        service: z.string().optional().describe("Specific service name, e.g. 'httpd', 'mysql', 'exim'"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("servicestatus", { service: params.service });
        const services = data.service ?? [];
        const md = [
          `# Services${params.service ? ` (${params.service})` : ""}`,
          ...services.map(
            (s: any) =>
              `- **${s.name}** — running: ${s.running ? "✅" : "❌"}, monitored: ${s.monitored ? "yes" : "no"}, enabled: ${s.enabled ? "yes" : "no"}${s.info ? ` (${s.info})` : ""}`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, { services });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- restartservice ----
  server.registerTool(
    "whm_restart_service",
    {
      title: "Restart Service",
      description:
        "Restart a system service (httpd, exim, mysql, named, dovecot, etc.). DESTRUCTIVE — causes a brief outage. Confirm with user.",
      inputSchema: {
        service: z.string().describe("Service name, e.g. 'httpd', 'mysql', 'exim', 'named'"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("restartservice", { service: params.service }, "POST");
        return formatResponse(
          params.response_format,
          `Restart issued for ${params.service}.`,
          data
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- configureservice (enable/disable monitoring) ----
  server.registerTool(
    "whm_configure_service",
    {
      title: "Configure Service Monitoring",
      description:
        "Enable/disable a service or its monitoring. enabled=false will stop the service.",
      inputSchema: {
        service: z.string(),
        enabled: z.boolean().describe("Whether the service should be enabled (running)"),
        monitored: z.boolean().describe("Whether chkservd should monitor it"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall(
          "configureservice",
          {
            service: params.service,
            enabled: params.enabled ? 1 : 0,
            monitored: params.monitored ? 1 : 0,
          },
          "POST"
        );
        return formatResponse(
          params.response_format,
          `Configured ${params.service}: enabled=${params.enabled}, monitored=${params.monitored}.`,
          data
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- listips ----
  server.registerTool(
    "whm_list_ips",
    {
      title: "List Server IPs",
      description: "List all IPv4 addresses configured on the server, with allocation status.",
      inputSchema: { ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("listips");
        const ips = data.ip ?? data.ips ?? [];
        const md = [
          `# Server IPs (${ips.length})`,
          ...ips.map(
            (i: any) =>
              `- ${i.ip} — used: ${i.used ? "yes" : "no"}, primary: ${i.primary ? "yes" : "no"}${i.user ? `, user: ${i.user}` : ""}`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, { ips });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  // ---- get_current_lynx_pings (server reachability info, useful for monitoring) ----
  server.registerTool(
    "whm_reboot_server",
    {
      title: "Reboot Server",
      description:
        "Reboot the entire server. EXTREMELY DESTRUCTIVE — causes downtime for ALL hosted accounts. Always confirm explicitly with the user.",
      inputSchema: {
        force: z.boolean().default(false).describe("Force reboot without graceful shutdown"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall(
          params.force ? "forcereboot" : "graceful_reboot",
          {},
          "POST"
        );
        return formatResponse(
          params.response_format,
          `Reboot issued (${params.force ? "forced" : "graceful"}). Server going down.`,
          data
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );
}
