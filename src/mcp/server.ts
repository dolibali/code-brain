import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { ValidationError } from "../errors/validation-error.js";
import { openService, type ServiceContext } from "../runtime/open-service.js";

const ScopeRefSchema = z.object({
  kind: z.enum(["repo", "module", "file", "symbol"]),
  value: z.string().min(1)
});

function toolResult<T extends Record<string, unknown>>(payload: T): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: T;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

function toolErrorResult(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  if (error instanceof ValidationError) {
    return toolResult(error.toPayload());
  }

  const message = error instanceof Error ? error.message : String(error);
  return toolResult({
    error: "runtime_failed",
    message
  });
}

function registerTools(server: McpServer, service: ServiceContext): void {
  server.registerTool(
    "search",
    {
      description:
        "Search candidate Code Brain knowledge pages. Use this before edits or page updates. Returns summaries and related change evidence, not a final synthesized answer.",
      inputSchema: {
        query: z.string().min(1),
        project: z.string().optional(),
        global: z.boolean().optional(),
        types: z.array(z.enum(["issue", "architecture", "decision", "practice", "change"])).optional(),
        scope_refs: z.array(ScopeRefSchema).optional(),
        limit: z.number().int().positive().optional(),
        context_path: z.string().optional()
      }
    },
    async ({ query, project, global, types, scope_refs, limit, context_path }) => {
      try {
        const response = await service.search.search({
          query,
          project,
          global,
          types,
          scopeRefs: scope_refs,
          limit,
          contextPath: context_path
        });
        return toolResult(response);
      } catch (error) {
        return toolErrorResult(error);
      }
    }
  );

  server.registerTool(
    "get_page",
    {
      description:
        "Read one canonical Markdown knowledge page after search identifies a likely slug. Returns the full page content from the Markdown source of truth.",
      inputSchema: {
        slug: z.string().min(1),
        project: z.string().optional()
      }
    },
    async ({ slug, project }) => {
      try {
        const page = await service.pages.getPage(project, slug);
        if (!page) {
          return toolResult({
            error: "not_found",
            message: `Page '${slug}' not found.`
          });
        }

        return toolResult({
          project: page.frontmatter.project,
          slug: page.slug,
          content: page.content,
          markdown_path: page.markdownPath
        });
      } catch (error) {
        return toolErrorResult(error);
      }
    }
  );

  server.registerTool(
    "list_pages",
    {
      description:
        "List canonical knowledge pages by structured filters such as project, type, status, tags, and scope_refs. Use this when you know the structure you want instead of free-text search.",
      inputSchema: {
        project: z.string().optional(),
        types: z.array(z.enum(["issue", "architecture", "decision", "practice", "change"])).optional(),
        status: z.string().optional(),
        tags: z.array(z.string()).optional(),
        scope_refs: z.array(ScopeRefSchema).optional(),
        limit: z.number().int().positive().optional()
      }
    },
    async ({ project, types, status, tags, scope_refs, limit }) => {
      try {
        const pages = service.pages.listPages({
          project,
          types,
          status,
          tags,
          scopeRefs: scope_refs,
          limit
        });
        return toolResult({ pages });
      } catch (error) {
        return toolErrorResult(error);
      }
    }
  );

  server.registerTool(
    "put_page",
    {
      description:
        "Create or overwrite a full Markdown page. Use this only after you have already decided the target slug and full page content; the service does not auto-merge or auto-extract links.",
      inputSchema: {
        project: z.string().optional(),
        slug: z.string().min(1),
        content: z.string().min(1),
        context_path: z.string().optional()
      }
    },
    async ({ project, slug, content, context_path }) => {
      try {
        const page = await service.pages.putPage({
          project,
          slug,
          content,
          contextPath: context_path
        });
        return toolResult({
          project: page.frontmatter.project,
          slug: page.slug,
          markdown_path: page.markdownPath
        });
      } catch (error) {
        return toolErrorResult(error);
      }
    }
  );

  server.registerTool(
    "link_pages",
    {
      description:
        "Create or update a formal relationship between two pages. Use this after put_page when a change page should explicitly connect to an issue, practice, decision, or architecture page.",
      inputSchema: {
        project: z.string().min(1),
        from_slug: z.string().min(1),
        to_slug: z.string().min(1),
        relation: z.string().min(1),
        context: z.string().optional()
      }
    },
    async ({ project, from_slug, to_slug, relation, context }) => {
      try {
        service.links.linkPages({
          project,
          fromSlug: from_slug,
          toSlug: to_slug,
          relation,
          context
        });
        return toolResult({ ok: true });
      } catch (error) {
        return toolErrorResult(error);
      }
    }
  );

  server.registerTool(
    "get_links",
    {
      description:
        "Get explicit page links for one slug. Use this to inspect evidence and navigation after search or put_page operations.",
      inputSchema: {
        project: z.string().min(1),
        slug: z.string().min(1),
        direction: z.enum(["incoming", "outgoing", "both"]).optional()
      }
    },
    async ({ project, slug, direction }) => {
      try {
        const links = service.links.getLinks({
          project,
          slug,
          direction
        });
        return toolResult({ links });
      } catch (error) {
        return toolErrorResult(error);
      }
    }
  );

  server.registerTool(
    "reindex",
    {
      description:
        "Rebuild the search index from Markdown truth. Use this after direct Markdown edits or when local search/embedding state needs to be repaired.",
      inputSchema: {
        project: z.string().optional(),
        full: z.boolean().optional()
      }
    },
    async ({ project, full }) => {
      try {
        const result = await service.pages.reindex({ project, full });
        return toolResult(result);
      } catch (error) {
        return toolErrorResult(error);
      }
    }
  );
}

export async function createCodeBrainMcpServer(configPath?: string): Promise<{
  server: McpServer;
  service: ServiceContext;
}> {
  const service = await openService(configPath);
  const server = new McpServer({
    name: service.config.mcp.name,
    version: service.config.mcp.version
  });

  registerTools(server, service);
  return { server, service };
}

export async function serveCodeBrainMcp(configPath?: string): Promise<void> {
  const { server, service } = await createCodeBrainMcpServer(configPath);
  const transport = new StdioServerTransport();
  transport.onclose = () => {
    service.close();
  };

  await server.connect(transport);
}
