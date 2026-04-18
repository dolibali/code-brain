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
        project: z.string().min(1)
      }
    },
    async ({ slug, project }) => {
      const page = await service.pages.getPage(project, slug);
      if (!page) {
        throw new Error(`Page '${slug}' not found in project '${project}'.`);
      }

      return toolResult({
        slug: page.slug,
        frontmatter: page.frontmatter,
        body: page.body,
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
        limit: z.number().int().positive().optional()
      }
    },
    async ({ project, types, status, tags, limit }) => {
      const pages = service.pages.listPages({
        project,
        types,
        status,
        tags,
        limit
      });
      return toolResult({ pages });
    }
  );

  server.registerTool(
    "upsert_page",
    {
      description: "Create or update a long-lived knowledge page",
      inputSchema: {
        project: z.string().min(1),
        type: z.enum(["issue", "architecture", "decision", "practice"]),
        slug: z.string().optional(),
        title: z.string().min(1),
        content: z.string().min(1),
        tags: z.array(z.string()).optional(),
        aliases: z.array(z.string()).optional(),
        scope_refs: z.array(ScopeRefSchema).optional(),
        status: z.string().min(1),
        see_also: z.array(z.string()).optional(),
        source_type: z.enum(["manual", "diff", "commit", "agent_summary", "import"]).optional(),
        source_agent: z.enum(["claude-code", "cursor", "codex", "gemini-cli", "none"]).optional()
      }
    },
    async ({
      project,
      type,
      slug,
      title,
      content,
      tags,
      aliases,
      scope_refs,
      status,
      see_also,
      source_type,
      source_agent
    }) => {
      const page = await service.pages.upsertPage({
        project,
        type,
        slug,
        title,
        body: content,
        tags,
        aliases,
        scopeRefs: scope_refs,
        status,
        seeAlso: see_also,
        sourceType: source_type ?? "manual",
        sourceAgent: source_agent ?? "none"
      });
      return toolResult({ slug: page.slug, markdown_path: page.markdownPath });
    }
  );

  server.registerTool(
    "record_change",
    {
      description: "Create or update a change page and related long-lived knowledge",
      inputSchema: {
        project: z.string().optional(),
        title: z.string().optional(),
        change_kind: z.enum(["bugfix", "refactor", "feature", "rollback", "recovery", "maintenance"]).optional(),
        diff: z.string().optional(),
        commit_message: z.string().optional(),
        agent_summary: z.string().optional(),
        scope_refs: z.array(ScopeRefSchema).optional(),
        related_types: z.array(z.enum(["issue", "architecture", "decision", "practice"])).optional(),
        source_ref: z.string().optional(),
        source_agent: z.enum(["claude-code", "cursor", "codex", "gemini-cli", "none"]).optional(),
        context_path: z.string().optional()
      }
    },
    async ({
      project,
      title,
      change_kind,
      diff,
      commit_message,
      agent_summary,
      scope_refs,
      related_types,
      source_ref,
      source_agent,
      context_path
    }) => {
      const result = await service.changes.recordChange({
        project,
        title,
        changeKind: change_kind,
        diff,
        commitMessage: commit_message,
        agentSummary: agent_summary,
        scopeRefs: scope_refs,
        relatedTypes: related_types,
        sourceRef: source_ref,
        sourceAgent: source_agent,
        contextPath: context_path
      });
      return toolResult({
        mode: result.mode,
        fingerprint: result.fingerprint,
        source_type: result.sourceType,
        source_ref: result.sourceRef,
        change_slug: result.changePage.slug,
        linked_pages: result.linkedPages.map((page) => ({
          slug: page.slug,
          type: page.frontmatter.type,
          title: page.frontmatter.title
        }))
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
    name: "code-brain",
    version: "0.1.0"
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
