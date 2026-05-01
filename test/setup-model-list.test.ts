import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { fetchOpenAiCompatibleModelIds } from "../src/setup/model-list.js";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
});

async function startModelServer(): Promise<{ url: string; seenAuth: string[] }> {
  const seenAuth: string[] = [];
  const server = http.createServer((request, response) => {
    seenAuth.push(request.headers.authorization ?? "");
    if (request.url !== "/v1/models") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        data: [{ id: "zeta" }, { id: "alpha" }, { id: "alpha" }]
      })
    );
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server.");
  }
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    seenAuth
  };
}

describe("setup model listing", () => {
  it("fetches unique sorted model ids from an OpenAI-compatible provider", async () => {
    const server = await startModelServer();

    const models = await fetchOpenAiCompatibleModelIds({
      baseUrl: server.url,
      apiKey: "secret"
    });

    expect(models).toEqual(["alpha", "zeta"]);
    expect(server.seenAuth).toEqual(["Bearer secret"]);
  });
});
