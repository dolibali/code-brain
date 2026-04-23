import type { ResolvedProviderConfig } from "./provider-config.js";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCompletionInput = {
  model?: string;
  messages: ChatMessage[];
};

type EmbeddingInput = {
  model?: string;
  input: string[];
  dimensions?: number;
};

function joinUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${pathname}`;
}

async function parseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    if (payload.error?.message) {
      return payload.error.message;
    }
  } catch {
    // Ignore parse failures and fall back to status text.
  }

  return `${response.status} ${response.statusText}`.trim();
}

async function withRetries<T>(
  retries: number,
  action: (attempt: number) => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await action(attempt);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export class OpenAiCompatibleClient {
  constructor(private readonly config: ResolvedProviderConfig) {}

  async createChatCompletion(input: ChatCompletionInput): Promise<string> {
    const response = await this.post("/chat/completions", {
      model: input.model ?? this.config.defaultModel,
      messages: input.messages,
      temperature: 0,
      stream: false,
      ...this.config.extraBody
    });

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((entry) => (typeof entry.text === "string" ? entry.text : ""))
        .filter((entry) => entry.length > 0)
        .join("\n");
    }

    throw new Error("LLM provider returned an empty chat completion.");
  }

  async createEmbeddings(input: EmbeddingInput): Promise<{
    model: string;
    vectors: number[][];
  }> {
    const response = await this.post("/embeddings", {
      model: input.model ?? this.config.defaultModel,
      input: input.input,
      dimensions: input.dimensions
    });

    const payload = (await response.json()) as {
      model?: string;
      data?: Array<{ embedding?: number[] }>;
    };

    const vectors = (payload.data ?? []).map((entry) => entry.embedding ?? []);
    if (vectors.length !== input.input.length || vectors.some((vector) => vector.length === 0)) {
      throw new Error("Embedding provider returned incomplete vectors.");
    }

    return {
      model: payload.model ?? input.model ?? this.config.defaultModel,
      vectors
    };
  }

  private async post(pathname: string, body: Record<string, unknown>): Promise<Response> {
    return withRetries(this.config.retries, async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await fetch(joinUrl(this.config.baseUrl, pathname), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`OpenAI-compatible request failed: ${await parseError(response)}`);
        }

        return response;
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }
}
