import path from "node:path";
import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import type { ScopeKind, ScopeRef } from "../pages/schema.js";
import { openService, type ServiceContext } from "../runtime/open-service.js";

export type GlobalOptions = {
  config?: string;
};

export function resolveOptionalConfigPath(configPath?: string): string | undefined {
  return configPath ? path.resolve(configPath) : undefined;
}

function getRootCommand(command: Command): Command {
  let current = command;
  while (current.parent) {
    current = current.parent;
  }

  return current;
}

export function getGlobalOptions(command: Command): GlobalOptions {
  return getRootCommand(command).opts<GlobalOptions>();
}

export function getConfigPath(command: Command): string | undefined {
  return resolveOptionalConfigPath(getGlobalOptions(command).config);
}

export async function withService<T>(
  command: Command,
  action: (service: ServiceContext) => Promise<T>
): Promise<T> {
  const service = await openService(getConfigPath(command));
  try {
    return await action(service);
  } finally {
    service.close();
  }
}

export function parseCsv(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function parseScopeRefs(values: string[]): ScopeRef[] {
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

export async function loadContent(input: {
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

export function parseDirection(value?: string): "incoming" | "outgoing" | "both" {
  if (!value) {
    return "both";
  }

  if (value === "incoming" || value === "outgoing" || value === "both") {
    return value;
  }

  throw new Error("Direction must be one of incoming, outgoing, or both.");
}
