# Migrated Changes & Modern Stickery Layout

This directory contains the files modified during migration and UI enhancement for LinkPop.

## File Manifest

| Path                                         | Purpose                                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metadata.json`                              | Project identity, title, description, and server-side capability flags.                                                                              |
| `package.json`                               | Dev script updated to bind to `0.0.0.0` on port `3000`.                                                                                              |
| `eslint.config.js`                           | Lint rules configured for clean compilation without false regex or typing errors.                                                                    |
| `src/styles.css`                             | Sticker design system: `.sticker-badge`, `.washi-tape`, `.bg-notebook-dots`, `@keyframes sticker-wiggle`, and polished shadows.                      |
| `src/routes/index.tsx`                       | Modern stickery layout: 3-zone top bar contract, StepHeader sticker badges, enhanced stat badges, notebook paste area, and redesigned command cards. |
| `src/integrations/supabase/client.ts`        | Graceful fallback credentials for the client so missing env vars do not throw unhandled runtime crashes.                                             |
| `src/integrations/supabase/client.server.ts` | Graceful fallback credentials for the server-side admin client.                                                                                      |
| `src/lib/commands.ts`                        | Removed unused eslint directives.                                                                                                                    |
| `src/lib/name-lines.ts`                      | Cleaned up regex lint comments.                                                                                                                      |
| `src/lib/names.server.ts`                    | Cleaned up server-side probing regex lint comments.                                                                                                  |

## Removed Files

- `bunfig.toml` (removed to standardize on Node.js/npm runtime).

## How to Apply to Another Repository

Copy the files directly over your existing repository root:

```bash
cp -r changes/* /path/to/target/
```

Or merge the specific files you need.
