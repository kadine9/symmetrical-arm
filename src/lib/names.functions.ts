import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Browsers can't read Content-Disposition from other sites (CORS), so the
// HEAD requests are made here on the server. Network code lives in
// names.server.ts and is loaded inside the handler, like the admin client.
export const resolveNamesFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ urls: z.array(z.string().max(4000)).min(1).max(30) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { resolveMany } = await import("./names.server");
    return resolveMany(data.urls);
  });
