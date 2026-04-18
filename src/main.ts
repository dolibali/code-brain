import { createCli } from "./cli.js";

async function main(): Promise<void> {
  const cli = createCli();
  await cli.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Code Brain failed: ${message}`);
  process.exitCode = 1;
});

