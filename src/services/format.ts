import { CHARACTER_LIMIT, ResponseFormat } from "../constants.js";

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: any;
  isError?: boolean;
}

export function ok(text: string, structured?: any): ToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structured !== undefined ? { structuredContent: structured } : {}),
  };
}

export function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

export function formatResponse(
  format: ResponseFormat,
  markdown: string,
  structured: any
): ToolResult {
  let text =
    format === ResponseFormat.JSON ? JSON.stringify(structured, null, 2) : markdown;
  if (text.length > CHARACTER_LIMIT) {
    text =
      text.slice(0, CHARACTER_LIMIT - 200) +
      `\n\n[Response truncated at ${CHARACTER_LIMIT} characters. Add filters or use response_format='json' for selective fields.]`;
  }
  return ok(text, structured);
}

export function fmtBytes(bytes: number | string | undefined): string {
  const n = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (n === undefined || n === null || isNaN(n)) return "n/a";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
