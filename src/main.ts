import { createCli } from "./cli.js";
import { ValidationError } from "./errors/validation-error.js";

async function main(): Promise<void> {
  const cli = createCli();
  await cli.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  if (error instanceof ValidationError) {
    console.error(JSON.stringify(error.toPayload(), null, 2));
    process.exitCode = 1;
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`Code Brain failed: ${message}`);
  process.exitCode = 1;
});
