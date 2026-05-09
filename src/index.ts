#!/usr/bin/env node
/**
 * WHM MCP Server
 *
 * Exposes the WHM (WebHost Manager) API v1 as MCP tools for server-level
 * cPanel administration: accounts, services, DNS, email queue, packages,
 * SSL, logs, backups, resellers.
 *
 * Auth (env vars):
 *   WHM_HOST     - server hostname or IP (e.g. 'srv.example.com')
 *   WHM_USER     - WHM username (default: 'root')
 *   WHM_TOKEN    - API token (WHM → Development → Manage API Tokens)
 *   WHM_PORT     - port (default: 2087)
 *   WHM_INSECURE_TLS - 'true' to skip TLS verification (self-signed certs)
 *
 * Transport: stdio.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAccountTools } from "./tools/accounts.js";
import { registerServerTools } from "./tools/server.js";
import { registerDnsTools } from "./tools/dns.js";
import { registerEmailTools } from "./tools/email.js";
import {
  registerPackageTools,
  registerSslTools,
  registerBackupTools,
  registerResellerTools,
} from "./tools/misc.js";
import { registerLogTools } from "./tools/logs.js";

async function main() {
  const server = new McpServer({
    name: "whm-mcp-server",
    version: "0.1.0",
  });

  registerAccountTools(server);
  registerServerTools(server);
  registerDnsTools(server);
  registerEmailTools(server);
  registerPackageTools(server);
  registerSslTools(server);
  registerBackupTools(server);
  registerResellerTools(server);
  registerLogTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("whm-mcp-server: listening on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`whm-mcp-server: fatal error: ${err?.stack ?? err}\n`);
  process.exit(1);
});
