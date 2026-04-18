export function normalizePageRef(input: string): string {
  return input.split("/").at(-1) ?? input;
}

