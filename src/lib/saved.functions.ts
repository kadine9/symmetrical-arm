import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Saved link batches are keyed by a random per-browser key (no login).
// The table is only reachable from the server, never directly from the browser.
const key = z.string().min(20).max(100);

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

export const listSaved = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ deviceKey: key }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: rows, error } = await db
      .from("saved_batches")
      .select("id,title,content,link_count,created_at")
      .eq("device_key", data.deviceKey)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const saveBatch = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        deviceKey: key,
        title: z.string().trim().min(1).max(120),
        content: z.string().min(1).max(500_000),
        linkCount: z.number().int().min(0).max(100_000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { error } = await db.from("saved_batches").insert({
      device_key: data.deviceKey,
      title: data.title,
      content: data.content,
      link_count: data.linkCount,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBatch = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ deviceKey: key, id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { error } = await db
      .from("saved_batches")
      .delete()
      .eq("id", data.id)
      .eq("device_key", data.deviceKey);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Auto-save: create or update this browser's single "Auto-saved" batch.
export const autoSave = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        deviceKey: key,
        id: z.string().uuid().nullable(),
        content: z.string().max(500_000),
        linkCount: z.number().int().min(0).max(100_000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    if (data.id) {
      const { data: row, error } = await db
        .from("saved_batches")
        .update({ content: data.content, link_count: data.linkCount })
        .eq("id", data.id)
        .eq("device_key", data.deviceKey)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (row) return { id: row.id };
    }
    const { data: row, error } = await db
      .from("saved_batches")
      .insert({
        device_key: data.deviceKey,
        title: "Auto-saved (latest paste)",
        content: data.content,
        link_count: data.linkCount,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });
