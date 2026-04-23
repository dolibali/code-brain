import * as z from "zod/v4";
import { ValidationError } from "../errors/validation-error.js";

export const ScopeRefSchema = z.object({
  kind: z.enum(["repo", "module", "file", "symbol"]),
  value: z.string().min(1)
});

export function toolResult<T extends Record<string, unknown>>(payload: T): {
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

export function toolErrorResult(error: unknown): {
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

export function safeToolHandler<TInput, TOutput extends Record<string, unknown>>(
  handler: (input: TInput) => Promise<TOutput>
) {
  return async (input: TInput) => {
    try {
      return toolResult(await handler(input));
    } catch (error) {
      return toolErrorResult(error);
    }
  };
}
