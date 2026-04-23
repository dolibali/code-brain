import { createHash } from "node:crypto";
import type { EmbeddingConfig } from "../config/schema.js";
import { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js";

export type EmbeddingProvider = {
  embedTexts: (input: string[]) => Promise<{ model: string; vectors: number[][] }>;
};

export function createContentHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly client: OpenAiCompatibleClient,
    private readonly config: EmbeddingConfig
  ) {}

  async embedTexts(input: string[]): Promise<{ model: string; vectors: number[][] }> {
    return this.client.createEmbeddings({
      input,
      model: this.config.model,
      dimensions: this.config.dimensions
    });
  }
}
