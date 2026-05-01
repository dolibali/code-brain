# Brain Sync Recipe

`brain_sync_task` is the shared agent recipe for writing BrainCode knowledge without turning the service into a thick memory manager.

## Default Loop

1. Confirm you are working on a meaningful, stable task outcome.
2. `search` for existing issue, practice, decision, architecture, or change pages.
3. `get_page` for any slug that may need an update.
4. Write a `change` page first with `put_page`.
5. If the task produced a durable fact, update or create a long-lived page with `put_page`.
6. Connect the pages with `link_pages`.
7. Optionally run `search` or `get_links` again to verify the knowledge graph.

## Write Rules

- Prefer updating an existing page over creating a near-duplicate.
- Do not skip `search` and directly create a new long-lived page unless you are certain no matching page exists.
- Do not rely on `put_page` to merge partial content.
- Do not rely on `link_pages` to infer relations from the page body.
- Treat `main_branch` as the default branch where shared memory should usually be written.
- Treat `project` as the stable identity across machines.
- Use repo-relative paths in `scope_refs`; never write local absolute paths into shared pages.

## Slug Guidance

- Long-lived pages: `issue/<slug>`, `practice/<slug>`, `architecture/<slug>`, `decision/<slug>`
- Change pages: `change/<year>/<yyyy-mm-dd>-<slug>`
- Prefer descriptive English slugs such as `issue/electron-sandbox-crash`
- Avoid generic slugs such as `change-1` or `fix-page`

## Page Writing Tips

- Keep the title human-readable.
- Put the stable conclusion in the Compiled Truth section.
- Use `## Timeline` for historical details and evidence.
- Keep frontmatter valid and complete.
