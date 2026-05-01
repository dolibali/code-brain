import { z } from "zod";

const ModelListSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1)
      })
    )
    .default([])
});

function joinUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${pathname}`;
}

export async function fetchOpenAiCompatibleModelIds(input: {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}): Promise<string[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), input.timeoutMs ?? 8000);

  try {
    const response = await fetch(joinUrl(input.baseUrl, "/models"), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.apiKey}`
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`.trim());
    }

    const payload = ModelListSchema.parse(await response.json());
    return Array.from(new Set(payload.data.map((model) => model.id))).sort((left, right) => left.localeCompare(right));
  } finally {
    clearTimeout(timeoutId);
  }
}
