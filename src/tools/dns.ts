import { z } from "zod";
import { handleWhmError, ToolInputError, whmCall } from "../services/client.js";
import { err, formatResponse, matches, pageNote, paginate } from "../services/format.js";
import { FormatSchema, PaginationSchema } from "../schemas/common.js";
import { ToolRegistrar } from "../types.js";

interface ZoneRecord {
  line_index: number;
  name: string;
  ttl: number;
  type: string;
  data: string[];
}

/** A record as mass_edit_dns_zone expects it (serialized to JSON per item). */
interface RecordSpec {
  line_index?: number;
  dname: string;
  ttl: number;
  record_type: string;
  data: string[];
}

function fromB64(value: string | undefined): string {
  return value ? Buffer.from(value, "base64").toString("utf8") : "";
}

/**
 * Fetch a zone with parse_dns_zone (the documented replacement for the
 * deprecated dumpzone) and decode its base64 fields.
 */
async function fetchZone(domain: string): Promise<{ serial?: number; records: ZoneRecord[] }> {
  const data: any = await whmCall("parse_dns_zone", { zone: domain });
  const records: ZoneRecord[] = (data.payload ?? [])
    .filter((item: any) => item.type === "record")
    .map((item: any) => ({
      line_index: item.line_index,
      name: fromB64(item.dname_b64),
      ttl: item.ttl,
      type: item.record_type,
      data: (item.data_b64 ?? []).map(fromB64),
    }));
  // SOA data: mname rname serial refresh retry expire minimum
  const serial = Number(records.find((r) => r.type === "SOA")?.data[2]);
  return { serial: isNaN(serial) ? undefined : serial, records };
}

async function massEditZone(
  domain: string,
  serial: number | undefined,
  changes: { add?: RecordSpec[]; edit?: RecordSpec[]; remove?: number[] }
): Promise<number | undefined> {
  if (serial === undefined) throw new ToolInputError(`Could not determine the SOA serial of ${domain}.`);
  const data: any = await whmCall(
    "mass_edit_dns_zone",
    {
      zone: domain,
      serial,
      add: changes.add?.map((r) => JSON.stringify(r)),
      edit: changes.edit?.map((r) => JSON.stringify(r)),
      remove: changes.remove,
    },
    "POST"
  );
  return data?.new_serial;
}

/**
 * "@" or "" → the zone apex. Names that already end in the zone
 * ("www.example.com") get a trailing dot so they aren't read as relative
 * names ("www.example.com.example.com.").
 */
function normalizeName(name: string, domain: string): string {
  const n = name.trim();
  const zone = domain.toLowerCase().replace(/\.$/, "");
  if (n === "" || n === "@") return `${zone}.`;
  if (n.endsWith(".")) return n;
  const lower = n.toLowerCase();
  return lower === zone || lower.endsWith(`.${zone}`) ? `${n}.` : n;
}

/** TXT character-strings are limited to 255 bytes; split longer values such as DKIM keys. */
function splitTxt(value: string): string[] {
  const chunks: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of value) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > 255) {
      chunks.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  chunks.push(current);
  return chunks;
}

const RecordFieldsSchema = {
  data: z
    .array(z.string())
    .optional()
    .describe(
      "Record data fields in zone-file order, e.g. A: ['192.0.2.10']; MX: ['10', 'mail.example.com.']; " +
        "TXT: ['v=spf1 +a +mx ~all']; SRV: ['10', '5', '5060', 'sip.example.com.']; CAA: ['0', 'issue', 'letsencrypt.org']. " +
        "Takes precedence over the per-type fields below."
    ),
  address: z.string().optional().describe("A/AAAA: IP address"),
  cname: z.string().optional().describe("CNAME: target hostname"),
  exchange: z.string().optional().describe("MX: mail server hostname"),
  preference: z.number().int().min(0).optional().describe("MX: priority (default 10)"),
  txtdata: z.string().optional().describe("TXT: record text (long values are split into 255-byte strings)"),
  target: z.string().optional().describe("SRV: target hostname"),
  priority: z.number().int().min(0).optional().describe("SRV: priority (default 0)"),
  weight: z.number().int().min(0).optional().describe("SRV: weight (default 0)"),
  port: z.number().int().min(0).max(65535).optional().describe("SRV: port"),
  nsdname: z.string().optional().describe("NS: nameserver hostname"),
  ptrdname: z.string().optional().describe("PTR: target hostname"),
  caa_flag: z.number().int().min(0).max(255).optional().describe("CAA: flag (default 0)"),
  caa_tag: z.enum(["issue", "issuewild", "iodef"]).optional().describe("CAA: tag"),
  caa_value: z.string().optional().describe("CAA: value, e.g. 'letsencrypt.org'"),
};

type RecordFields = {
  data?: string[];
  address?: string;
  cname?: string;
  exchange?: string;
  preference?: number;
  txtdata?: string;
  target?: string;
  priority?: number;
  weight?: number;
  port?: number;
  nsdname?: string;
  ptrdname?: string;
  caa_flag?: number;
  caa_tag?: string;
  caa_value?: string;
};

const RECORD_FIELD_NAMES = Object.keys(RecordFieldsSchema) as (keyof RecordFields)[];

function hasRecordFields(f: RecordFields): boolean {
  return RECORD_FIELD_NAMES.some((k) => f[k] !== undefined);
}

function buildRecordData(type: string, f: RecordFields): string[] {
  if (f.data?.length) return type === "TXT" ? f.data.flatMap(splitTxt) : f.data;
  const need = (value: unknown, field: string) => {
    if (value === undefined || value === "") {
      throw new ToolInputError(`${type} records need '${field}' (or pass 'data').`);
    }
  };
  switch (type) {
    case "A":
    case "AAAA":
      need(f.address, "address");
      return [f.address!];
    case "CNAME":
      need(f.cname, "cname");
      return [f.cname!];
    case "MX":
      need(f.exchange, "exchange");
      return [String(f.preference ?? 10), f.exchange!];
    case "TXT":
      need(f.txtdata, "txtdata");
      return splitTxt(f.txtdata!);
    case "SRV":
      need(f.target, "target");
      need(f.port, "port");
      return [String(f.priority ?? 0), String(f.weight ?? 0), String(f.port), f.target!];
    case "NS":
      need(f.nsdname, "nsdname");
      return [f.nsdname!];
    case "PTR":
      need(f.ptrdname, "ptrdname");
      return [f.ptrdname!];
    case "CAA":
      need(f.caa_tag, "caa_tag");
      need(f.caa_value, "caa_value");
      return [String(f.caa_flag ?? 0), f.caa_tag!, f.caa_value!];
    default:
      throw new ToolInputError(`Pass 'data' for ${type} records (the record's data fields in zone-file order).`);
  }
}

function fmtRecord(r: { name: string; ttl: number; type: string; data: string[] }): string {
  const data = r.type === "TXT" ? r.data.map((d) => JSON.stringify(d)).join(" ") : r.data.join(" ");
  return `${r.name} ${r.ttl} ${r.type} ${data}`;
}

const RecordTypeSchema = z
  .string()
  .regex(/^[A-Za-z0-9]+$/)
  .transform((t) => t.toUpperCase())
  .describe("Record type, e.g. A, AAAA, CNAME, MX, TXT, SRV, NS, PTR, CAA");

const SerialSchema = z
  .number()
  .int()
  .optional()
  .describe("Expected zone serial (from whm_get_dns_zone). The edit fails if the zone changed since. Default: current serial");

export function registerDnsTools(server: ToolRegistrar) {
  server.registerTool(
    "whm_list_dns_zones",
    {
      title: "List DNS Zones",
      description: "List the DNS zones (domains) hosted on the server.",
      inputSchema: {
        search: z.string().optional().describe("Case-insensitive substring of the zone name"),
        ...PaginationSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await whmCall("listzones");
        const zones = (data.zone ?? []).filter((z: any) => matches(z.domain, params.search));
        const page = paginate<any>(zones, params.limit, params.offset);
        const md = `# DNS zones (${page.total})\n${page.items.map((z) => `- ${z.domain}`).join("\n")}` + pageNote(page);
        const { items, ...meta } = page;
        return formatResponse(params.response_format, md, { ...meta, zones: items });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_get_dns_zone",
    {
      title: "Get DNS Zone",
      description:
        "Get a domain's DNS records with each record's line_index and the zone's SOA serial. " +
        "Pass line_index to whm_edit_dns_record / whm_remove_dns_record.",
      inputSchema: {
        domain: z.string(),
        type: z.string().optional().describe("Only records of this type, e.g. 'MX' or 'TXT'"),
        name: z.string().optional().describe("Only records whose name contains this text"),
        limit: z.number().int().min(1).max(1000).default(300).describe("Maximum records to return"),
        offset: z.number().int().min(0).default(0),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const zone = await fetchZone(params.domain);
        const records = zone.records.filter(
          (r) => (!params.type || r.type === params.type.toUpperCase()) && matches(r.name, params.name)
        );
        const page = paginate(records, params.limit, params.offset);
        const md =
          [
            `# Zone: ${params.domain} — serial ${zone.serial ?? "n/a"} (${page.total} records)`,
            ...page.items.map((r) => `- [${r.line_index}] ${fmtRecord(r)}`),
          ].join("\n") + pageNote(page);
        const { items, ...meta } = page;
        return formatResponse(params.response_format, md, {
          domain: params.domain,
          serial: zone.serial,
          ...meta,
          records: items,
        });
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
        ip: z.string().describe("IPv4 address for the zone's A records"),
        ipv6: z.string().optional().describe("IPv6 address for the zone's AAAA records"),
        template: z
          .string()
          .optional()
          .describe("Zone template: 'standard' (default), 'simple', 'standardvirtualftp', or a custom template name"),
        trueowner: z.string().optional().describe("cPanel user that owns the zone (default: the API token's user)"),
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const { response_format, ...rest } = params;
        const data: any = await whmCall("adddns", rest, "POST");
        return formatResponse(response_format, `Created zone for ${params.domain}.`, {
          domain: params.domain,
          created: true,
          ...data,
        });
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
      description:
        "Add a record to a zone. Pass the type-specific field (address for A/AAAA, cname for CNAME, exchange+preference for MX, txtdata for TXT, etc.) or 'data'.",
      inputSchema: {
        domain: z.string().describe("Zone domain"),
        name: z
          .string()
          .describe("Record name: relative ('www'), fully qualified with trailing dot ('www.example.com.'), or '@' for the zone apex"),
        type: RecordTypeSchema,
        ttl: z.number().int().min(0).default(14400),
        ...RecordFieldsSchema,
        serial: SerialSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const record: RecordSpec = {
          dname: normalizeName(params.name, params.domain),
          ttl: params.ttl,
          record_type: params.type,
          data: buildRecordData(params.type, params),
        };
        const serial = params.serial ?? (await fetchZone(params.domain)).serial;
        const newSerial = await massEditZone(params.domain, serial, { add: [record] });
        return formatResponse(
          params.response_format,
          `Added to ${params.domain}: ${fmtRecord({ name: record.dname, ttl: record.ttl, type: record.record_type, data: record.data })} (new serial ${newSerial ?? "n/a"}).`,
          { domain: params.domain, added: record, new_serial: newSerial }
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
        "Edit the record at a line_index from whm_get_dns_zone. Only the fields you pass change; the rest are kept from the current record.",
      inputSchema: {
        domain: z.string(),
        line_index: z.number().int().min(0).describe("The record's line_index from whm_get_dns_zone"),
        name: z.string().optional().describe("New record name ('@' for the zone apex)"),
        type: RecordTypeSchema.optional(),
        ttl: z.number().int().min(0).optional(),
        ...RecordFieldsSchema,
        serial: SerialSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const zone = await fetchZone(params.domain);
        const existing = zone.records.find((r) => r.line_index === params.line_index);
        if (!existing) {
          return err(`No record starts at line_index ${params.line_index} in ${params.domain}. Run whm_get_dns_zone to find it.`);
        }
        const type = params.type ?? existing.type;
        let data = existing.data;
        if (hasRecordFields(params)) data = buildRecordData(type, params);
        else if (type !== existing.type) throw new ToolInputError(`Changing the type to ${type} needs new record data.`);
        const record: RecordSpec = {
          line_index: params.line_index,
          dname: params.name !== undefined ? normalizeName(params.name, params.domain) : existing.name,
          ttl: params.ttl ?? existing.ttl,
          record_type: type,
          data,
        };
        const newSerial = await massEditZone(params.domain, params.serial ?? zone.serial, { edit: [record] });
        const after = { name: record.dname, ttl: record.ttl, type: record.record_type, data: record.data };
        return formatResponse(
          params.response_format,
          `Updated line ${params.line_index} in ${params.domain}:\n- before: ${fmtRecord(existing)}\n- after: ${fmtRecord(after)}\n(new serial ${newSerial ?? "n/a"})`,
          { domain: params.domain, before: existing, after: record, new_serial: newSerial }
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
      description: "Remove the DNS record at a line_index from whm_get_dns_zone. Confirm with user.",
      inputSchema: {
        domain: z.string(),
        line_index: z.number().int().min(0).describe("The record's line_index from whm_get_dns_zone"),
        serial: SerialSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const zone = await fetchZone(params.domain);
        const existing = zone.records.find((r) => r.line_index === params.line_index);
        if (!existing) {
          return err(`No record starts at line_index ${params.line_index} in ${params.domain}. Run whm_get_dns_zone to find it.`);
        }
        if (existing.type === "SOA") return err("Refusing to remove the zone's SOA record.");
        const newSerial = await massEditZone(params.domain, params.serial ?? zone.serial, { remove: [params.line_index] });
        return formatResponse(
          params.response_format,
          `Removed from ${params.domain}: ${fmtRecord(existing)} (new serial ${newSerial ?? "n/a"}).`,
          { domain: params.domain, removed: existing, new_serial: newSerial }
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  const MassRecordSchema = z.object({
    name: z.string().describe("Record name: relative, FQDN with trailing dot, or '@'"),
    type: RecordTypeSchema,
    ttl: z.number().int().min(0).default(14400),
    data: z.array(z.string()).min(1).describe("Record data fields in zone-file order"),
  });

  server.registerTool(
    "whm_mass_edit_dns_zone",
    {
      title: "Batch Edit DNS Zone",
      description:
        "Add, edit, and remove many records in one atomic zone update. Edits and removals use line_index values from whm_get_dns_zone; " +
        "edited records need their full name/type/ttl/data.",
      inputSchema: {
        domain: z.string(),
        add: z.array(MassRecordSchema).optional().describe("Records to add"),
        edit: z
          .array(MassRecordSchema.extend({ line_index: z.number().int().min(0) }))
          .optional()
          .describe("Records to replace, by line_index"),
        remove: z.array(z.number().int().min(0)).optional().describe("line_index values of records to remove"),
        serial: SerialSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const counts = { add: params.add?.length ?? 0, edit: params.edit?.length ?? 0, remove: params.remove?.length ?? 0 };
        if (counts.add + counts.edit + counts.remove === 0) return err("Pass at least one of 'add', 'edit', or 'remove'.");
        const zone = await fetchZone(params.domain);
        const byLine = new Map(zone.records.map((r) => [r.line_index, r]));
        for (const line of [...(params.remove ?? []), ...(params.edit ?? []).map((r) => r.line_index)]) {
          if (!byLine.has(line)) return err(`No record starts at line_index ${line} in ${params.domain}.`);
        }
        if ((params.remove ?? []).some((line) => byLine.get(line)?.type === "SOA")) {
          return err("Refusing to remove the zone's SOA record.");
        }
        const toSpec = (r: z.infer<typeof MassRecordSchema>, line_index?: number): RecordSpec => ({
          ...(line_index !== undefined ? { line_index } : {}),
          dname: normalizeName(r.name, params.domain),
          ttl: r.ttl,
          record_type: r.type,
          data: r.type === "TXT" ? r.data.flatMap(splitTxt) : r.data,
        });
        const newSerial = await massEditZone(params.domain, params.serial ?? zone.serial, {
          add: params.add?.map((r) => toSpec(r)),
          edit: params.edit?.map((r) => toSpec(r, r.line_index)),
          remove: params.remove,
        });
        return formatResponse(
          params.response_format,
          `Updated ${params.domain}: ${counts.add} added, ${counts.edit} edited, ${counts.remove} removed (new serial ${newSerial ?? "n/a"}).`,
          { domain: params.domain, ...counts, new_serial: newSerial }
        );
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );

  server.registerTool(
    "whm_reset_dns_zone",
    {
      title: "Reset DNS Zone",
      description:
        "Reset a zone to the server's default records. Valid TXT records are kept; ALL other custom records are replaced. Confirm with user.",
      inputSchema: { domain: z.string(), ...FormatSchema },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        await whmCall("resetzone", { domain: params.domain }, "POST");
        return formatResponse(params.response_format, `Reset zone ${params.domain} to defaults.`, {
          domain: params.domain,
          reset: true,
        });
      } catch (e) {
        return err(handleWhmError(e));
      }
    }
  );
}
