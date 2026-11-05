<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- Saved link batches are keyed by a random per-browser key and accessed only via server functions (src/lib/saved.functions.ts) with the admin client; the table has no browser policies, so there is no login yet.
- Download destination and custom wget assignments are composed in a pure download-plan module and stored in the existing browser/workspace snapshot, so grouping choices persist without changing saved link storage.
- "Get real names" looks up file names server-side (src/lib/names.functions.ts → names.server.ts: HEAD, then a 1-byte ranged GET, Content-Disposition) because browsers can't read that header cross-origin. Names are written into the paste box on the line above each link (src/lib/name-lines.ts) so parsing and grouping pick them up.
- Cross-device sync uses a private workspace link (#w=CODE); only a SHA-256 of the code is stored in sync_blobs, reached through the sync_pull/sync_push/sync_delete RPCs (src/lib/useSync.ts).
