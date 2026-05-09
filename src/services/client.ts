import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import * as https from "node:https";
import { REQUEST_TIMEOUT_MS } from "../constants.js";

let cachedClient: AxiosInstance | null = null;

interface WhmConfig {
  host: string;
  port: number;
  user: string;
  token: string;
  insecureTls: boolean;
}

function readConfig(): WhmConfig {
  const host = process.env.WHM_HOST;
  const user = process.env.WHM_USER || "root";
  const token = process.env.WHM_TOKEN;
  const port = parseInt(process.env.WHM_PORT || "2087", 10);
  const insecureTls = (process.env.WHM_INSECURE_TLS || "").toLowerCase() === "true";

  if (!host) throw new Error("WHM_HOST env var is not set (e.g. 'server.example.com').");
  if (!token) {
    throw new Error(
      "WHM_TOKEN env var is not set. Create one in WHM → Development → Manage API Tokens."
    );
  }
  return { host, port, user, token, insecureTls };
}

export function getClient(): AxiosInstance {
  if (cachedClient) return cachedClient;
  const cfg = readConfig();
  cachedClient = axios.create({
    baseURL: `https://${cfg.host}:${cfg.port}/json-api`,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `whm ${cfg.user}:${cfg.token}`,
      Accept: "application/json",
    },
    httpsAgent: new https.Agent({ rejectUnauthorized: !cfg.insecureTls }),
  });
  return cachedClient;
}

/**
 * Call a WHM API v1 function. WHM's idiomatic style is GET with query params,
 * but it accepts POST for mutating ops. We pick based on `method`.
 */
export async function whmCall<T = any>(
  fn: string,
  params: Record<string, any> = {},
  method: "GET" | "POST" = "GET"
): Promise<T> {
  // Always include api.version=1 so the response envelope is the modern shape.
  const allParams = { "api.version": 1, ...params };

  const cfg: AxiosRequestConfig = {
    method,
    url: `/${fn}`,
    ...(method === "GET" ? { params: allParams } : { data: new URLSearchParams(
      Object.entries(allParams).reduce((acc, [k, v]) => {
        if (v === undefined || v === null) return acc;
        if (Array.isArray(v)) v.forEach((vi) => (acc[k] = String(vi)));
        else acc[k] = String(v);
        return acc;
      }, {} as Record<string, string>)
    ).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded" } }),
  };
  const res = await getClient().request<any>(cfg);
  const body = res.data;

  // WHM v1 envelope: { metadata: { result, command, reason, version }, data: {...} }
  if (body?.metadata && body.metadata.result === 0) {
    const reason = body.metadata.reason || "WHM API call failed";
    throw new WhmApiError(reason, body.metadata);
  }
  return (body?.data ?? body) as T;
}

export class WhmApiError extends Error {
  metadata: any;
  constructor(message: string, metadata: any) {
    super(message);
    this.name = "WhmApiError";
    this.metadata = metadata;
  }
}

export function handleWhmError(error: unknown): string {
  if (error instanceof WhmApiError) {
    return `WHM API error: ${error.message}${
      error.metadata?.command ? ` (function: ${error.metadata.command})` : ""
    }`;
  }
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      return `Error ${status}: WHM authentication failed. Check WHM_USER and WHM_TOKEN, and that the token has the required ACLs.`;
    }
    if (status === 404) {
      return "Error 404: WHM endpoint not found. Verify the function name.";
    }
    if (error.code === "ECONNREFUSED") {
      return `Error: Could not connect to ${process.env.WHM_HOST}:${process.env.WHM_PORT || 2087}. Verify host/port and that WHM is running.`;
    }
    if (error.code === "ECONNABORTED") {
      return "Error: Request timed out. WHM operation may still be running on the server.";
    }
    if (error.code === "DEPTH_ZERO_SELF_SIGNED_CERT" || error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
      return "Error: TLS certificate could not be verified. If you trust this host, set WHM_INSECURE_TLS=true.";
    }
    return `Error ${status ?? "?"}: ${error.message}`;
  }
  return `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}
