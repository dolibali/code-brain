import type { Command } from "commander";
import { formatSetupResult, runSetup, type RemoteMode } from "../../setup/setup-runner.js";
import { getConfigPath } from "../helpers.js";

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port '${value}'.`);
  }
  return parsed;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer '${value}'.`);
  }
  return parsed;
}

function parseRemoteMode(value: string): RemoteMode {
  if (value === "none" || value === "client" || value === "server" || value === "both") {
    return value;
  }
  throw new Error(`Invalid remote mode '${value}'. Expected none/client/server/both.`);
}

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Run the interactive setup wizard or non-interactive configuration flow")
    .option("--force", "Start from defaults instead of merging with existing config", false)
    .option("--non-interactive", "Run setup without prompts", false)
    .option("--brain-repo <path>", "Brain repo path")
    .option("--index-db <path>", "SQLite index database path")
    .option("--project-name <name>", "Project name")
    .option("--project-path <path>", "Project local mount path")
    .option("--project-url <url...>", "Project Git remote URL")
    .option("--branch <branch>", "Project main branch")
    .option("--title <title>", "Project title")
    .option("--enable-llm", "Enable search-side LLM", false)
    .option("--llm-provider <provider>", "LLM provider preset id")
    .option("--llm-base-url <url>", "Custom LLM OpenAI-compatible base URL")
    .option("--llm-api-key-env <env>", "Custom LLM API key environment variable")
    .option("--llm-model <model>", "Custom LLM model")
    .option("--enable-embedding", "Enable embedding search", false)
    .option("--embedding-provider <provider>", "Embedding provider preset id")
    .option("--embedding-base-url <url>", "Custom embedding OpenAI-compatible base URL")
    .option("--embedding-api-key-env <env>", "Custom embedding API key environment variable")
    .option("--embedding-model <model>", "Embedding model")
    .option("--embedding-dimensions <number>", "Embedding vector dimensions", parsePositiveInteger)
    .option("--remote-mode <mode>", "Remote mode: none, client, server, or both", parseRemoteMode)
    .option("--remote-url <url>", "Remote BrainCode server URL")
    .option("--remote-token-env <env>", "Remote sync token environment variable")
    .option("--server-host <host>", "Remote HTTP server bind host")
    .option("--server-port <port>", "Remote HTTP server bind port", parsePort)
    .option("--server-token-env <env>", "Remote HTTP server token environment variable")
    .option("--max-body-mb <number>", "Remote HTTP max request body size in MB", parsePositiveInteger)
    .action(async (commandOptions, command: Command) => {
      const result = await runSetup({
        configPath: getConfigPath(command),
        force: commandOptions.force,
        nonInteractive: commandOptions.nonInteractive,
        brainRepo: commandOptions.brainRepo,
        indexDb: commandOptions.indexDb,
        projectName: commandOptions.projectName,
        projectPath: commandOptions.projectPath,
        projectUrl: commandOptions.projectUrl,
        branch: commandOptions.branch,
        title: commandOptions.title,
        enableLlm: commandOptions.enableLlm,
        llmProvider: commandOptions.llmProvider,
        llmBaseUrl: commandOptions.llmBaseUrl,
        llmApiKeyEnv: commandOptions.llmApiKeyEnv,
        llmModel: commandOptions.llmModel,
        enableEmbedding: commandOptions.enableEmbedding,
        embeddingProvider: commandOptions.embeddingProvider,
        embeddingBaseUrl: commandOptions.embeddingBaseUrl,
        embeddingApiKeyEnv: commandOptions.embeddingApiKeyEnv,
        embeddingModel: commandOptions.embeddingModel,
        embeddingDimensions: commandOptions.embeddingDimensions,
        remoteMode: commandOptions.remoteMode,
        remoteUrl: commandOptions.remoteUrl,
        remoteTokenEnv: commandOptions.remoteTokenEnv,
        serverHost: commandOptions.serverHost,
        serverPort: commandOptions.serverPort,
        serverTokenEnv: commandOptions.serverTokenEnv,
        maxBodyMb: commandOptions.maxBodyMb
      });

      if (!result) {
        console.log("setup: cancelled");
        return;
      }

      console.log(formatSetupResult(result));
    });
}
