import { gzip } from "node:zlib";
import { promisify } from "node:util";
import type { BrainCodeConfig } from "../config/schema.js";
import type { SyncManifest, SyncPagePayload, SyncProjectPayload } from "./types.js";

const gzipAsync = promisify(gzip);

export type RemoteSyncConfig = {
  url: string;
  token: string;
  compression: "gzip" | "none";
};

function joinUrl(baseUrl: string, pathname: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function readToken(envName: string | undefined, label: string): string {
  if (!envName) {
    throw new Error(`${label} token_env is required.`);
  }

  const token = process.env[envName];
  if (!token) {
    throw new Error(`${label} token env '${envName}' is not set.`);
  }

  return token;
}

export function resolveRemoteSyncConfig(config: BrainCodeConfig): RemoteSyncConfig {
  if (!config.remote.url) {
    throw new Error("remote.url is required for sync commands.");
  }

  return {
    url: config.remote.url,
    token: readToken(config.remote.tokenEnv, "remote"),
    compression: config.sync.compression
  };
}

export class SyncHttpClient {
  constructor(private readonly config: RemoteSyncConfig) {}

  async getManifest(): Promise<SyncManifest> {
    return this.requestJson<SyncManifest>("/sync/manifest", { method: "GET" });
  }

  async getPage(project: string, slug: string): Promise<SyncPagePayload> {
    const params = new URLSearchParams({ project, slug });
    return this.requestJson<SyncPagePayload>(`/sync/page?${params.toString()}`, { method: "GET" });
  }

  async putPage(page: SyncPagePayload): Promise<SyncPagePayload> {
    return this.requestJson<SyncPagePayload>("/sync/page", {
      method: "PUT",
      body: page
    });
  }

  async putProject(project: SyncProjectPayload): Promise<SyncProjectPayload> {
    return this.requestJson<SyncProjectPayload>("/sync/project", {
      method: "PUT",
      body: project
    });
  }

  async reindex(project?: string): Promise<{ projects: number; pages: number }> {
    return this.requestJson<{ projects: number; pages: number }>("/sync/reindex", {
      method: "POST",
      body: project ? { project } : { full: true }
    });
  }

  private async requestJson<T>(
    pathname: string,
    input: {
      method: "GET" | "POST" | "PUT";
      body?: unknown;
    }
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.config.token}`
    };
    let body: Buffer | undefined;

    if (input.body !== undefined) {
      const raw = Buffer.from(JSON.stringify(input.body), "utf8");
      headers["Content-Type"] = "application/json";
      if (this.config.compression === "gzip") {
        body = await gzipAsync(raw);
        headers["Content-Encoding"] = "gzip";
      } else {
        body = raw;
      }
    }

    const response = await fetch(joinUrl(this.config.url, pathname), {
      method: input.method,
      headers,
      body: body ? new Uint8Array(body) : undefined
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`remote ${input.method} ${pathname} failed: ${response.status} ${text}`);
    }

    return JSON.parse(text) as T;
  }
}
