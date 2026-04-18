import path from "node:path";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import type { RelatedKnowledgeType } from "./changes/schema.js";
import { loadConfig } from "./config/load-config.js";
import { serveCodeBrainMcp } from "./mcp/server.js";
import type { PageType, ScopeKind, ScopeRef } from "./pages/schema.js";
import { normalizePageRef } from "./pages/page-ref.js";
import { ensureBrainDirectories, registerProject } from "./projects/project-registry.js";
import { openService } from "./runtime/open-service.js";
import { openIndexDatabase } from "./storage/index-db.js";

type GlobalOptions = {
  config?: string;
};

function resolveOptionalConfigPath(configPath?: string): string | undefined {
  return configPath ? path.resolve(configPath) : undefined;
}

function parseCsv(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseScopeRefs(values: string[]): ScopeRef[] {
  return values.map((entry) => {
    const [kind, ...rest] = entry.split(":");
    const value = rest.join(":").trim();
    if (!kind || !value) {
      throw new Error(`Invalid scope ref '${entry}'. Expected kind:value.`);
    }

    if (!["repo", "module", "file", "symbol"].includes(kind)) {
      throw new Error(`Invalid scope kind '${kind}'. Expected repo/module/file/symbol.`);
    }

    return {
      kind: kind as ScopeKind,
      value
    };
  });
}

async function loadBody(body?: string, bodyFile?: string): Promise<string> {
  if (body && bodyFile) {
    throw new Error("Use either --body or --body-file, not both.");
  }

  if (bodyFile) {
    return readFile(path.resolve(bodyFile), "utf8");
  }

  if (body) {
    return body;
  }

  throw new Error("Either --body or --body-file is required.");
}

async function loadOptionalText(input: {
  inline?: string;
  file?: string;
  label: string;
}): Promise<string | undefined> {
  if (input.inline && input.file) {
    throw new Error(`Use either --${input.label} or --${input.label}-file, not both.`);
  }

  if (input.file) {
    try {
      return await readFile(path.resolve(input.file), "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read ${input.label} file '${input.file}': ${message}`);
    }
  }

  return input.inline;
}

function parseDirection(value?: string): "incoming" | "outgoing" | "both" {
  if (!value) {
    return "both";
  }

  if (value === "incoming" || value === "outgoing" || value === "both") {
    return value;
  }

  throw new Error("Direction must be one of incoming, outgoing, or both.");
}

export function createCli(): Command {
  const program = new Command();

  program
    .name("code-brain")
    .description("Code Brain CLI")
    .showHelpAfterError()
    .showSuggestionAfterError()
    .option("-c, --config <path>", "Path to config.yaml");

  program
    .command("serve")
    .description("Run the Code Brain MCP server over stdio")
    .action(async (_, command: Command) => {
      const options = command.parent?.opts<GlobalOptions>() ?? {};
      await serveCodeBrainMcp(resolveOptionalConfigPath(options.config));
    });

  program
    .command("doctor")
    .description("Load config, ensure brain directories, and initialize the SQLite index")
    .action(async (_, command: Command) => {
      const options = command.parent?.opts<GlobalOptions>() ?? {};
      const loaded = await loadConfig(resolveOptionalConfigPath(options.config));
      await ensureBrainDirectories(loaded.config);
      const index = await openIndexDatabase(loaded.config);

      try {
        index.initialize();
        index.syncProjects();

        console.log("Code Brain doctor");
        console.log(`config_path: ${loaded.path}`);
        console.log(`config_exists: ${loaded.exists}`);
        console.log(`brain_repo: ${loaded.config.brain.repo}`);
        console.log(`index_db: ${loaded.config.brain.indexDb}`);
        console.log(`projects: ${loaded.config.projects.length}`);
        console.log(`journal_mode: ${index.getJournalMode()}`);
      } finally {
        index.close();
      }
    });

  const project = program.command("project").description("Manage registered projects");

  project
    .command("list")
    .description("List all registered projects")
    .action(async (_, command: Command) => {
      const options = command.parent?.parent?.opts<GlobalOptions>() ?? {};
      const loaded = await loadConfig(resolveOptionalConfigPath(options.config));

      if (loaded.config.projects.length === 0) {
        console.log("No registered projects.");
        return;
      }

      for (const entry of loaded.config.projects) {
        const remotes = entry.remotes.length > 0 ? entry.remotes.join(", ") : "-";
        console.log(`${entry.id}\t${entry.root}\t${remotes}`);
      }
    });

  project
    .command("register")
    .description("Register or update a project entry")
    .requiredOption("--id <id>", "Project id")
    .requiredOption("--root <root>", "Project root path")
    .option("--remote <remote...>", "Git remote matcher", [])
    .option("--description <description>", "Human-readable description")
    .action(async (commandOptions, command: Command) => {
      const options = command.parent?.parent?.opts<GlobalOptions>() ?? {};
      const loaded = await registerProject({
        id: commandOptions.id,
        root: commandOptions.root,
        remotes: commandOptions.remote,
        description: commandOptions.description,
        configPath: resolveOptionalConfigPath(options.config)
      });

      const index = await openIndexDatabase(loaded.config);
      try {
        index.initialize();
        index.syncProjects();
      } finally {
        index.close();
      }

      console.log(`Registered project ${commandOptions.id}`);
      console.log(`config_path: ${loaded.path}`);
    });

  program
    .command("search")
    .description("Search knowledge pages")
    .argument("<query>", "Search query")
    .option("--project <project>", "Project id")
    .option("--context-path <path>", "Context path used for project resolution")
    .option("--global", "Search across all projects", false)
    .option("--types <csv>", "Comma-separated page types")
    .option("--scope-ref <kind:value...>", "Structured scope refs", [])
    .option("--limit <limit>", "Maximum rows to return", "10")
    .action(async (query: string, commandOptions, command: Command) => {
      const options = command.parent?.opts<GlobalOptions>() ?? {};
      const service = await openService(resolveOptionalConfigPath(options.config));

      try {
        const results = service.search.search({
          query,
          project: commandOptions.project,
          contextPath: commandOptions.contextPath,
          global: commandOptions.global,
          types: parseCsv(commandOptions.types) as PageType[],
          scopeRefs: parseScopeRefs(commandOptions.scopeRef),
          limit: Number(commandOptions.limit)
        });

        if (results.length === 0) {
          console.log("No results found.");
          return;
        }

        for (const result of results) {
          console.log(
            `${result.project}\t${result.type}\t${result.slug}\t${result.title}\t${result.summary}`
          );
        }
      } finally {
        service.close();
      }
    });

  const change = program.command("change").description("Record meaningful development changes");

  change
    .command("record")
    .description("Create or update a change page from diff, commit message, or agent summary")
    .option("--project <project>", "Project id")
    .option("--context-path <path>", "Context path used for project resolution")
    .option("--title <title>", "Change title")
    .option("--kind <kind>", "Change kind")
    .option("--diff <diff>", "Raw diff text")
    .option("--diff-file <path>", "Load diff text from file")
    .option("--commit-message <message>", "Commit message")
    .option("--summary <summary>", "Agent summary")
    .option("--summary-file <path>", "Load agent summary from file")
    .option("--scope-ref <kind:value...>", "Structured scope refs", [])
    .option("--related-types <csv>", "Comma-separated target page types")
    .option("--source-ref <sourceRef>", "Stable source reference such as a commit hash or task id")
    .option("--source-agent <sourceAgent>", "Source agent", "none")
    .action(async (commandOptions, command: Command) => {
      const options = command.parent?.parent?.opts<GlobalOptions>() ?? {};
      const service = await openService(resolveOptionalConfigPath(options.config));

      try {
        const diff = await loadOptionalText({
          inline: commandOptions.diff,
          file: commandOptions.diffFile,
          label: "diff"
        });
        const summary = await loadOptionalText({
          inline: commandOptions.summary,
          file: commandOptions.summaryFile,
          label: "summary"
        });

        const result = await service.changes.recordChange({
          project: commandOptions.project,
          contextPath: commandOptions.contextPath,
          title: commandOptions.title,
          changeKind: commandOptions.kind,
          diff,
          commitMessage: commandOptions.commitMessage,
          agentSummary: summary,
          scopeRefs: parseScopeRefs(commandOptions.scopeRef),
          relatedTypes: parseCsv(commandOptions.relatedTypes) as RelatedKnowledgeType[],
          sourceRef: commandOptions.sourceRef,
          sourceAgent: commandOptions.sourceAgent
        });

        console.log(`mode: ${result.mode}`);
        console.log(`fingerprint: ${result.fingerprint}`);
        console.log(`source_type: ${result.sourceType}`);
        console.log(`source_ref: ${result.sourceRef}`);
        console.log(`change_slug: ${result.changePage.slug}`);
        console.log(`linked_pages: ${result.linkedPages.map((page) => page.slug).join(", ") || "-"}`);
      } finally {
        service.close();
      }
    });

  program
    .command("upsert")
    .description("Create or update a canonical knowledge page")
    .requiredOption("--project <project>", "Project id")
    .requiredOption("--type <type>", "Page type")
    .requiredOption("--title <title>", "Page title")
    .requiredOption("--status <status>", "Page status")
    .option("--slug <slug>", "Page slug")
    .option("--body <body>", "Page body")
    .option("--body-file <path>", "Load page body from a file")
    .option("--tags <csv>", "Comma-separated tags")
    .option("--aliases <csv>", "Comma-separated aliases")
    .option("--see-also <csv>", "Comma-separated related slugs")
    .option("--scope-ref <kind:value...>", "Structured scope refs", [])
    .option("--source-type <sourceType>", "Source type", "manual")
    .option("--source-agent <sourceAgent>", "Source agent", "none")
    .action(async (commandOptions, command: Command) => {
      const options = command.parent?.opts<GlobalOptions>() ?? {};
      const service = await openService(resolveOptionalConfigPath(options.config));

      try {
        const stored = await service.pages.upsertPage({
          project: commandOptions.project,
          type: commandOptions.type as PageType,
          title: commandOptions.title,
          slug: commandOptions.slug,
          body: await loadBody(commandOptions.body, commandOptions.bodyFile),
          tags: parseCsv(commandOptions.tags),
          aliases: parseCsv(commandOptions.aliases),
          seeAlso: parseCsv(commandOptions.seeAlso),
          scopeRefs: parseScopeRefs(commandOptions.scopeRef),
          status: commandOptions.status,
          sourceType: commandOptions.sourceType,
          sourceAgent: commandOptions.sourceAgent
        });

        console.log(`upserted: ${stored.frontmatter.project}/${stored.slug}`);
        console.log(`path: ${stored.markdownPath}`);
      } finally {
        service.close();
      }
    });

  program
    .command("link")
    .description("Create or update an explicit page link")
    .requiredOption("--project <project>", "Project id")
    .requiredOption("--from <slug>", "Source page slug")
    .requiredOption("--to <slug>", "Target page slug")
    .requiredOption("--relation <relation>", "Link relation")
    .option("--context <context>", "Optional link context")
    .action(async (commandOptions, command: Command) => {
      const options = command.parent?.opts<GlobalOptions>() ?? {};
      const service = await openService(resolveOptionalConfigPath(options.config));

      try {
        service.links.linkPages({
          project: commandOptions.project,
          fromSlug: commandOptions.from,
          toSlug: commandOptions.to,
          relation: commandOptions.relation,
          context: commandOptions.context
        });

        console.log(
          `linked: ${normalizePageRef(commandOptions.from)} -> ${normalizePageRef(commandOptions.to)} (${commandOptions.relation})`
        );
      } finally {
        service.close();
      }
    });

  program
    .command("links")
    .description("Get page links")
    .requiredOption("--project <project>", "Project id")
    .requiredOption("--slug <slug>", "Page slug")
    .option("--direction <direction>", "incoming | outgoing | both", "both")
    .action(async (commandOptions, command: Command) => {
      const options = command.parent?.opts<GlobalOptions>() ?? {};
      const service = await openService(resolveOptionalConfigPath(options.config));

      try {
        const links = service.links.getLinks({
          project: commandOptions.project,
          slug: commandOptions.slug,
          direction: parseDirection(commandOptions.direction)
        });

        if (links.length === 0) {
          console.log("No links found.");
          return;
        }

        for (const link of links) {
          console.log(
            `${link.direction}\t${link.relation}\t${link.fromSlug}\t${link.toSlug}\t${link.otherType ?? "-"}\t${link.otherTitle ?? "-"}`
          );
        }
      } finally {
        service.close();
      }
    });

  program
    .command("get")
    .description("Get a canonical knowledge page by slug")
    .argument("<slug>", "Page slug, such as issue/foo")
    .requiredOption("--project <project>", "Project id")
    .action(async (slug: string, commandOptions, command: Command) => {
      const options = command.parent?.opts<GlobalOptions>() ?? {};
      const service = await openService(resolveOptionalConfigPath(options.config));

      try {
        const page = await service.pages.getPage(commandOptions.project, slug);
        if (!page) {
          throw new Error(`Page '${slug}' not found in project '${commandOptions.project}'.`);
        }

        console.log(await readFile(page.markdownPath, "utf8"));
      } finally {
        service.close();
      }
    });

  program
    .command("list")
    .description("List canonical knowledge pages")
    .option("--project <project>", "Project id")
    .option("--types <csv>", "Comma-separated page types")
    .option("--status <status>", "Page status")
    .option("--tags <csv>", "Comma-separated tags")
    .option("--limit <limit>", "Maximum rows to return", "20")
    .action(async (commandOptions, command: Command) => {
      const options = command.parent?.opts<GlobalOptions>() ?? {};
      const service = await openService(resolveOptionalConfigPath(options.config));

      try {
        const rows = service.pages.listPages({
          project: commandOptions.project,
          types: parseCsv(commandOptions.types) as PageType[],
          status: commandOptions.status,
          tags: parseCsv(commandOptions.tags),
          limit: Number(commandOptions.limit)
        });

        if (rows.length === 0) {
          console.log("No pages found.");
          return;
        }

        for (const row of rows) {
          console.log(`${row.project}\t${row.type}\t${row.slug}\t${row.title}`);
        }
      } finally {
        service.close();
      }
    });

  program
    .command("reindex")
    .description("Rebuild the index from Markdown truth")
    .option("--project <project>", "Project id")
    .option("--full", "Rebuild all registered projects", false)
    .action(async (commandOptions, command: Command) => {
      const options = command.parent?.opts<GlobalOptions>() ?? {};
      const service = await openService(resolveOptionalConfigPath(options.config));

      try {
        const result = await service.pages.reindex({
          project: commandOptions.project,
          full: commandOptions.full
        });

        console.log(`reindexed_projects: ${result.projects}`);
        console.log(`reindexed_pages: ${result.pages}`);
      } finally {
        service.close();
      }
    });

  return program;
}
