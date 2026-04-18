import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
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

function registerTools(server: McpServer, service: ServiceContext): void {
  server.registerTool(
    "search",
    {
      description: "Search Code Brain knowledge pages",
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
      const results = service.search.search({
        query,
        project,
        global,
        types,
        scopeRefs: scope_refs,
        limit,
        contextPath: context_path
      });
      return toolResult({ results });
    }
  );

  server.registerTool(
    "get_page",
    {
      description: "Get one canonical knowledge page",
      inputSchema: {
        slug: z.string().min(1),
        project: z.string().optional()
      }
    },
    async ({ slug, project }) => {
      const page = await service.pages.getPage(project, slug);
      if (!page) {
        throw new Error(`Page '${slug}' not found.`);
      }

      return toolResult({
        project: page.frontmatter.project,
        slug: page.slug,
        content: page.content,
        markdown_path: page.markdownPath
      });
    }
  );

  server.registerTool(
    "list_pages",
    {
      description: "List canonical knowledge pages",
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
      const pages = service.pages.listPages({
        project,
        types,
        status,
        tags,
        scopeRefs: scope_refs,
        limit
      });
      return toolResult({ pages });
    }
  );

  server.registerTool(
    "put_page",
    {
      description: "Create or update a full markdown page",
      inputSchema: {
        project: z.string().optional(),
        slug: z.string().min(1),
        content: z.string().min(1),
        context_path: z.string().optional()
      }
    },
    async ({ project, slug, content, context_path }) => {
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
    }
  );

  server.registerTool(
    "link_pages",
    {
      description: "Create or update a page link",
      inputSchema: {
        project: z.string().min(1),
        from_slug: z.string().min(1),
        to_slug: z.string().min(1),
        relation: z.string().min(1),
        context: z.string().optional()
      }
    },
    async ({ project, from_slug, to_slug, relation, context }) => {
      service.links.linkPages({
        project,
        fromSlug: from_slug,
        toSlug: to_slug,
        relation,
        context
      });
      return toolResult({ ok: true });
    }
  );

  server.registerTool(
    "get_links",
    {
      description: "Get page links",
      inputSchema: {
        project: z.string().min(1),
        slug: z.string().min(1),
        direction: z.enum(["incoming", "outgoing", "both"]).optional()
      }
    },
    async ({ project, slug, direction }) => {
      const links = service.links.getLinks({
        project,
        slug,
        direction
      });
      return toolResult({ links });
    }
  );

  server.registerTool(
    "reindex",
    {
      description: "Rebuild the index from Markdown truth",
      inputSchema: {
        project: z.string().optional(),
        full: z.boolean().optional()
      }
    },
    async ({ project, full }) => {
      const result = await service.pages.reindex({ project, full });
      return toolResult(result);
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

