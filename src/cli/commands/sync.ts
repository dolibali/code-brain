import type { Command } from "commander";
import { SyncHttpClient, resolveRemoteSyncConfig } from "../../sync/http-client.js";
import { getSyncStatus, pullFromRemote, pushToRemote } from "../../sync/local-sync.js";
import { withService } from "../helpers.js";

export function registerSyncCommands(program: Command): void {
  const sync = program.command("sync").description("Manually pull from or push to a remote BrainCode server");

  sync
    .command("pull")
    .description("Pull remote truth into the local read cache")
    .action(async (_, command: Command) => {
      await withService(command, async (service) => {
        const client = new SyncHttpClient(resolveRemoteSyncConfig(service.config));
        const result = await pullFromRemote(service, client);
        console.log(`downloaded: ${result.downloaded}`);
        console.log(`pruned: ${result.pruned}`);
        console.log(`reindexed_projects: ${result.reindexedProjects}`);
        console.log(`reindexed_pages: ${result.reindexedPages}`);
      });
    });

  sync
    .command("push")
    .description("Push local cache changes to the remote truth source, overwriting remote pages with local content")
    .action(async (_, command: Command) => {
      await withService(command, async (service) => {
        const client = new SyncHttpClient(resolveRemoteSyncConfig(service.config));
        const result = await pushToRemote(service, client);
        console.log(`uploaded: ${result.uploaded}`);
      });
    });

  sync
    .command("status")
    .description("Compare local cache and remote truth source")
    .action(async (_, command: Command) => {
      await withService(command, async (service) => {
        const client = new SyncHttpClient(resolveRemoteSyncConfig(service.config));
        const status = await getSyncStatus(service, client);
        console.log(`same: ${status.same}`);
        console.log(`changed: ${status.changed.length}`);
        console.log(`local_only: ${status.localOnly.length}`);
        console.log(`remote_only: ${status.remoteOnly.length}`);
      });
    });
}
