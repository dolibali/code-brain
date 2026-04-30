import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createContentHash } from "../embedding/provider.js";
import { createBrainCodeMcpServerForService } from "../mcp/server.js";
import { openService, type ServiceContext } from "../runtime/open-service.js";
import { buildSyncManifest, readSyncPage } from "../sync/manifest.js";
import { SyncPagePayloadSchema, SyncReindexRequestSchema } from "../sync/schema.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export type HttpServerOverrides = {
  host?: string;
  port?: number;
};

function isLocalHost(host: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(host);
}

function resolveAuthToken(service: ServiceContext, host: string): string | undefined {
  const envName = service.config.server.authTokenEnv;
  const token = envName ? process.env[envName] : undefined;
  if (!isLocalHost(host) && !token) {
    throw new Error("server.auth_token_env must reference a non-empty token when binding outside localhost.");
  }
  return token;
}

function isAuthorized(request: IncomingMessage, token: string | undefined): boolean {
  if (!token) {
    return true;
  }

  return request.headers.authorization === `Bearer ${token}`;
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw Object.assign(new Error("request body too large"), { statusCode: 413 });
    }
    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks);
  if (request.headers["content-encoding"] === "gzip") {
    return gunzipAsync(body);
  }

  return body;
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const body = await readRequestBody(request, maxBytes);
  if (body.byteLength === 0) {
    return {};
  }
  return JSON.parse(body.toString("utf8"));
}

async function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): Promise<void> {
  const raw = Buffer.from(JSON.stringify(payload), "utf8");
  const acceptsGzip = request.headers["accept-encoding"]?.includes("gzip") ?? false;
  const body = acceptsGzip ? await gzipAsync(raw) : raw;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...(acceptsGzip ? { "content-encoding": "gzip" } : {})
  });
  response.end(body);
}

async function sendError(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  message: string
): Promise<void> {
  await sendJson(request, response, statusCode, {
    error: statusCode === 401 ? "unauthorized" : "request_failed",
    message
  });
}

async function handleMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: ServiceContext
): Promise<void> {
  if (request.method !== "POST") {
    await sendJson(request, response, 405, {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    });
    return;
  }

  const { server } = createBrainCodeMcpServerForService(service);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  try {
    await server.connect(transport);
    const body = await readJsonBody(request, service.config.server.maxBodyMb * 1024 * 1024);
    await transport.handleRequest(request, response, body);
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

async function handleSyncRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: ServiceContext,
  url: URL
): Promise<void> {
  if (request.method === "GET" && url.pathname === "/sync/manifest") {
    await sendJson(request, response, 200, await buildSyncManifest(service.config));
    return;
  }

  if (request.method === "GET" && url.pathname === "/sync/page") {
    const project = url.searchParams.get("project");
    const slug = url.searchParams.get("slug");
    if (!project || !slug) {
      await sendError(request, response, 400, "project and slug query parameters are required.");
      return;
    }
    await sendJson(request, response, 200, await readSyncPage(service.config, project, slug));
    return;
  }

  if (request.method === "PUT" && url.pathname === "/sync/page") {
    const raw = await readJsonBody(request, service.config.server.maxBodyMb * 1024 * 1024);
    const payload = SyncPagePayloadSchema.parse(raw);
    if (createContentHash(payload.content) !== payload.content_hash) {
      await sendError(request, response, 400, "content_hash does not match content.");
      return;
    }
    const stored = await service.pages.putPage({
      project: payload.project,
      slug: payload.slug,
      content: payload.content
    });
    await sendJson(request, response, 200, {
      project: stored.frontmatter.project,
      slug: stored.slug,
      content: stored.content,
      content_hash: createContentHash(stored.content)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/sync/reindex") {
    const raw = await readJsonBody(request, service.config.server.maxBodyMb * 1024 * 1024);
    const input = SyncReindexRequestSchema.parse(raw);
    await sendJson(request, response, 200, await service.pages.reindex(input));
    return;
  }

  await sendError(request, response, 404, "sync endpoint not found.");
}

export function createBrainCodeHttpServer(input: {
  service: ServiceContext;
  authToken?: string;
}): http.Server {
  return http.createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

        if (request.method === "GET" && url.pathname === "/health") {
          await sendJson(request, response, 200, {
            ok: true,
            name: input.service.config.mcp.name,
            version: input.service.config.mcp.version
          });
          return;
        }

        if ((url.pathname === "/mcp" || url.pathname.startsWith("/sync/")) && !isAuthorized(request, input.authToken)) {
          await sendError(request, response, 401, "missing or invalid bearer token.");
          return;
        }

        if (url.pathname === "/mcp") {
          await handleMcpRequest(request, response, input.service);
          return;
        }

        if (url.pathname.startsWith("/sync/")) {
          await handleSyncRequest(request, response, input.service, url);
          return;
        }

        await sendError(request, response, 404, "endpoint not found.");
      } catch (error) {
        const statusCode =
          typeof error === "object" && error !== null && "statusCode" in error
            ? Number((error as { statusCode: unknown }).statusCode)
            : 500;
        const message = error instanceof Error ? error.message : String(error);
        if (!response.headersSent) {
          await sendError(request, response, Number.isFinite(statusCode) ? statusCode : 500, message);
        } else {
          response.destroy(error instanceof Error ? error : new Error(message));
        }
      }
    })();
  });
}

export async function serveBrainCodeHttp(
  configPath?: string,
  overrides: HttpServerOverrides = {}
): Promise<void> {
  const service = await openService(configPath);
  const host = overrides.host ?? service.config.server.host;
  const port = overrides.port ?? service.config.server.port;
  const authToken = resolveAuthToken(service, host);
  const server = createBrainCodeHttpServer({ service, authToken });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.error(`BrainCode HTTP MCP server listening on http://${host}:${port}`);

  const shutdown = (): void => {
    server.close(() => {
      service.close();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
