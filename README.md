# whm-mcp-server

MCP server exposing the WHM (WebHost Manager) API v1 as tools for server-level cPanel administration. Pairs with `cpanel-mcp-server` (per-account ops) and complements it nicely.

## What's covered

| Area | Tools |
|------|-------|
| Accounts | `list_accounts`, `get_account_summary`, `create_account`, `remove_account`, `suspend_account`, `unsuspend_account`, `modify_account`, `change_package`, `change_password`, `list_users` |
| Server | `get_server_information`, `get_version`, `get_load_avg`, `get_disk_usage`, `get_bandwidth_usage`, `get_hostname`, `set_hostname`, `list_ips`, `reboot_server` |
| Services | `check_service_status`, `restart_service`, `configure_service` |
| DNS | `list_dns_zones`, `get_dns_zone`, `create_dns_zone`, `delete_dns_zone`, `add_dns_record`, `edit_dns_record`, `remove_dns_record` |
| Email | `get_mail_queue_summary`, `get_exim_stats`, `purge_mail_queue`, `list_pop_accounts_for_user`, `list_pop_accounts_with_disk`, `get_exim_config` |
| Packages | `list_packages`, `create_package`, `edit_package`, `delete_package` |
| SSL | `list_ssl_certs`, `get_ssl_info`, `install_ssl` |
| Backups | `get_backup_config`, `list_backup_destinations` |
| Resellers | `list_resellers`, `set_reseller_limits` |
| Logs/Audit | `tail_apache_error_log`, `tail_exim_log`, `get_chkservd_log`, `get_login_history`, `get_audit_log` |

All tools prefixed `whm_*`. Read-only tools marked `readOnlyHint: true`. Destructive ops (delete account, restart service, reboot server, purge queue, remove DNS, set hostname) marked `destructiveHint: true`.

## Install

```bash
git clone <your-fork-url> whm-mcp-server
cd whm-mcp-server
npm install
npm run build
```

## Authentication

Generate an API token in WHM → Development → Manage API Tokens. Give it the ACLs you want this server to be able to use (read-only ACLs for monitoring, full root for ops).

```bash
export WHM_HOST="srv.example.com"
export WHM_USER="root"          # or another whm user
export WHM_TOKEN="your-token"
export WHM_PORT="2087"          # default
# If your WHM uses a self-signed cert:
# export WHM_INSECURE_TLS="true"
```

## Run

```bash
npm start
```

## Test interactively

```bash
npm run inspect
```

Launches the MCP Inspector UI for calling tools by hand.

## Wire to MCP client

```json
{
  "mcpServers": {
    "whm": {
      "command": "node",
      "args": ["/absolute/path/to/whm-mcp-server/dist/index.js"],
      "env": {
        "WHM_HOST": "srv.example.com",
        "WHM_USER": "root",
        "WHM_TOKEN": "your-token"
      }
    }
  }
}
```

## Notes

- WHM API responses use a `metadata.result` envelope. The server checks this and turns failures into proper errors with the WHM-supplied reason.
- Some endpoints return data in slightly different shapes across cPanel versions; tools fall back to multiple key names where applicable.
- The `cpanel` proxy endpoint is used for log tailing where WHM lacks a direct function (e.g. Exim mainlog).
- If you see TLS errors on a server with a self-signed cert, set `WHM_INSECURE_TLS=true`.

## License

MIT
