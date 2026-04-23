import path from "node:path";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { getDefaultConfig, loadConfig, writeConfig } from "./config/load-config.js";
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

async function loadContent(input: {
  inline?: string;
  file?: string;
}): Promise<string> {
  if (input.inline && input.file) {
    throw new Error("Use either --content or --file, not both.");
  }

  if (input.file) {
    return readFile(path.resolve(input.file), "utf8");
  }

  if (input.inline) {
    return input.inline;
  }

  throw new Error("Either --content or --file is required.");
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
    .name("codebrain")
    .description("Code Brain CLI")
    .showHelpAfterError()
    .showSuggestionAfterError()
    .option("-c, --config <path>", "Path to config.yaml");

  program
    .command("init")
    .description("Create a minimal config and bootstrap local state")
    .option("--force", "Overwrite an existing config file", false)
    .action(async (commandOptions, command: Command) => {
      const options = command.parent?.opts<GlobalOptions>() ?? {};
      const configPath = resolveOptionalConfigPath(options.config);
      const loaded = await loadConfig(configPath);

      if (loaded.exists && !commandOptions.force) {
        await ensureBrainDirectories(loaded.config);
        const index = await openIndexDatabase(loaded.config);
        try {
          index.initialize();
          index.syncProjects();
        } finally {
          index.close();
        }

        console.log(`config_path: ${loaded.path}`);
        console.log("status: existing_config_reused");
        return;
      }

      const defaultConfig = getDefaultConfig(configPath);
      const savedPath = await writeConfig({
        path: configPath,
        config: defaultConfig
      });
      const nextLoaded = await loadConfig(savedPath);
      await ensureBrainDirectories(nextLoaded.config);

      const index = await openIndexDatabase(nextLoaded.config);
      try {
        index.initialize();
        index.syncProjects();
      } finally {
        index.close();
      }

      console.log(`config_path: ${savedPath}`);
      console.log(`brain_repo: ${nextLoaded.config.brain.repo}`);
      console.log(`index_db: ${nextLoaded.config.brain.indexDb}`);
    });

  program
    .command("serve")
    .description("Run the Code Brain MCP server over stdio")
    .action(async (_, command: Command) => {
      const options = command.parent?.opts<GlobalOptions>() ?? {};
      await serveCodeBrainMcp(resolveOptionalConfigPath(options.config));
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
        const roots = entry.roots.join(", ");
        const remotes = entry.gitRemotes.length > 0 ? entry.gitRemotes.join(", ") : "-";
        console.log(`${entry.id}\t${entry.mainBranch}\t${roots}\t${remotes}`);
      }
    });

  project
    .command("register")
    .description("Register or update a project entry")
    .requiredOption("--id <id>", "Project id")
    .requiredOption("--root <root>", "Project root path")
    .option("--main-branch <branch>", "Main branch name", "main")
    .option("--remote <remote...>", "Git remote matcher", [])
    .option("--title <title>", "Human-readable project title")
    .action(async (commandOptions, command: Command) => {
      const options = command.parent?.parent?.opts<GlobalOptions>() ?? {};
      const loaded = await registerProject({
        id: commandOptions.id,
        root: commandOptions.root,
        remotes: commandOptions.remote,
        title: commandOptions.title,
        mainBranch: commandOptions.mainBranch,
        configPath: resolveOptionalConfigPath(options.config)
      });

      const index = await openIndexDatabase(loaded.config);
      try {
        index.initialize();
        index.syncProjects();
      } finally {
        index.close();
      }

      console.log(`registered: ${commandOptions.id}`);
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
        const response = await service.search.search({
          query,
          project: commandOptions.project,
          contextPath: commandOptions.contextPath,
          global: commandOptions.global,
          types: parseCsv(commandOptions.types) as PageType[],
          scopeRefs: parseScopeRefs(commandOptions.scopeRef),
          limit: Number(commandOptions.limit)
        });

        const results = response.results;
        if (results.length === 0) {
          console.log("No results found.");
          return;
        }

        for (const result of results) {
          const relatedChanges = result.relatedChanges.join(", ") || "-";
          console.log(
            `${result.project}\t${result.type}\t${result.slug}\t${result.title}\t${relatedChanges}\t${result.summary}`
          );
        }
      } finally {
        service.close();
      }
    });

  program
    .command("put")
    .description("Create or update a full markdown page")
    .argument("<slug>", "Page slug, such as issue/electron-sandbox-crash")
    .option("--project <project>", "Project id used for helper validation")
    .option("--context-path <path>", "Context path used for helper validation")
    .option("--content <content>", "Inline markdown content")
    .option("--file <path>", "Load markdown content from a file")
    .action(async (slug: string, commandOptions, command: Command) => {
      const options = command.parent?.opts<GlobalOptions>() ?? {};
      const service = await openService(resolveOptionalConfigPath(options.config));

      try {
        const stored = await service.pages.putPage({
          project: commandOptions.project,
          slug,
          content: await loadContent({
            inline: commandOptions.content,
            file: commandOptions.file
          }),
          contextPath: commandOptions.contextPath
        });

        console.log(`put: ${stored.frontmatter.project}/${stored.slug}`);
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
    .alias("get-links")
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
    .argument("<slug>", "Page slug, such as issue/electron-sandbox-crash")
    .option("--project <project>", "Project id")
    .action(async (slug: string, commandOptions, command: Command) => {
      const options = command.parent?.opts<GlobalOptions>() ?? {};
      const service = await openService(resolveOptionalConfigPath(options.config));

      try {
        const page = await service.pages.getPage(commandOptions.project, slug);
        if (!page) {
          throw new Error(`Page '${slug}' not found.`);
        }

        console.log(page.content);
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
    .option("--scope-ref <kind:value...>", "Structured scope refs", [])
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
          scopeRefs: parseScopeRefs(commandOptions.scopeRef),
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
