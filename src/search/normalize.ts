function extractAsciiTokens(input: string): string[] {
  const rawTokens = input
    .toLowerCase()
    .split(/[^a-z0-9_./:-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const expanded = rawTokens.flatMap((token) => [
    token,
    ...token.split(/[./:_-]+/).filter((part) => part.length > 0)
  ]);

  return expanded;
}

function extractCjkRuns(input: string): string[] {
  return input.match(/[\u3400-\u9fff]+/g) ?? [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function tokenizeForIndex(input: string): string[] {
  const asciiTokens = extractAsciiTokens(input);
  const cjkRuns = extractCjkRuns(input);
  const cjkTokens = cjkRuns.flatMap((run) => [run, ...run.split("")]);
  return unique([...asciiTokens, ...cjkTokens]);
}

export function tokenizeForQuery(input: string): string[] {
  const asciiTokens = extractAsciiTokens(input);
  const cjkRuns = extractCjkRuns(input);
  const cjkTokens = cjkRuns.flatMap((run) => run.split(""));
  return unique([...asciiTokens, ...cjkTokens]);
}

export function buildIndexedSearchText(input: string): string {
  return [input, ...tokenizeForIndex(input)].join(" ").trim();
}

export function buildFtsQuery(input: string): string {
  const tokens = tokenizeForQuery(input);
  if (tokens.length === 0) {
    return `"${input.replace(/"/g, '""')}"`;
  }

  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" AND ");
}

