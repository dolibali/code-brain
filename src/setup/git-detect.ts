import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitDefaults = {
  root: string;
  projectName: string;
  remote?: string;
  branch?: string;
};

async function git(args: string[], cwd: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", args, { cwd });
    const value = result.stdout.trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function detectGitDefaults(cwd = process.cwd()): Promise<GitDefaults> {
  const root = (await git(["rev-parse", "--show-toplevel"], cwd)) ?? cwd;
  return {
    root,
    projectName: path.basename(root),
    remote: await git(["remote", "get-url", "origin"], root),
    branch: await git(["branch", "--show-current"], root)
  };
}
