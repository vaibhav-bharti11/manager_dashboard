import { createClient } from "npm:@supabase/supabase-js@2";
import { validateEvidence } from "./validation.mjs";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return reply({ error: "Sign in as the assigned manager." }, 401);
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: identity, error: authError } = await db.auth.getUser(token);
  if (authError || !identity.user)
    return reply({ error: "Session expired. Sign in again." }, 401);
  const { data: actor } = await db
    .from("profiles")
    .select("id,role,restaurant_id")
    .eq("id", identity.user.id)
    .single();
  if (actor?.role !== "manager")
    return reply(
      { error: "Only the assigned restaurant manager can upload evidence." },
      403,
    );
  if (Number(req.headers.get("content-length") || 0) > 11 * 1024 * 1024)
    return reply({ error: "The file must be 10 MB or smaller." }, 413);
  let file: File;
  let occurrenceId: string;
  let bytes: Uint8Array;
  let ext: string;
  try {
    const form = await req.formData();
    file = form.get("file") as File;
    occurrenceId = String(form.get("occurrence_id") || "");
    if (!(file instanceof File)) throw new Error("Select a file to upload.");
    bytes = new Uint8Array(await file.arrayBuffer());
    ext = validateEvidence(bytes, file.type, file.size);
  } catch (e) {
    return reply(
      { error: e instanceof Error ? e.message : "Invalid upload" },
      400,
    );
  }
  const { data: o } = await db
    .from("occurrences")
    .select(
      "id,restaurant_id,manager_id,opens_at,deadline,enabled,submitted_at,missed_at",
    )
    .eq("id", occurrenceId)
    .eq("manager_id", actor.id)
    .eq("restaurant_id", actor.restaurant_id)
    .maybeSingle();
  if (!o) return reply({ error: "Report unavailable" }, 404);
  if (
    !o.enabled ||
    o.submitted_at ||
    o.missed_at ||
    Date.now() < Date.parse(o.opens_at) ||
    Date.now() >= Date.parse(o.deadline)
  )
    return reply({ error: "Upload window is closed" }, 409);
  const path = `${o.restaurant_id}/${o.id}/${crypto.randomUUID()}.${ext}`;
  const { error: storageError } = await db.storage
    .from("incident-evidence")
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (storageError)
    return reply({ error: "File storage failed. Please retry." }, 500);
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const { data: id, error: registerError } = await db.rpc("register_evidence", {
    p_actor: actor.id,
    p_occurrence: o.id,
    p_path: path,
    p_name: file.name.replace(/[\\/\x00-\x1f]/g, "_"),
    p_mime: file.type,
    p_size: file.size,
    p_sha256: hash,
  });
  if (registerError) {
    await db.storage.from("incident-evidence").remove([path]);
    return reply({ error: registerError.message }, 409);
  }
  return reply({
    evidence: {
      id,
      object_path: path,
      file_name: file.name,
      mime_type: file.type,
      byte_size: file.size,
      sha256: hash,
    },
  });
});
