function requireAdmin(profile) {
  if (!profile || profile.role !== "admin")
    throw new Error("Administrator access required");
  return profile.id;
}
function employeeInput(body) {
  const name = String(body?.name || "").trim(),
    email = String(body?.email || "")
      .trim()
      .toLowerCase(),
    password = String(body?.password || ""),
    restaurant_id = body?.restaurant_id;
  if (body?.role && body.role !== "manager")
    throw new Error("Employees must have the manager role.");
  if (name.length < 2 || name.length > 120)
    throw new Error("Enter an employee name between 2 and 120 characters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new Error("Enter a valid employee email.");
  if (password.length < 12 || new TextEncoder().encode(password).length > 72)
    throw new Error(
      "Use a password with at least 12 characters and at most 72 bytes.",
    );
  if (
    !["embassy-vasant", "embassy-elan", "kampai", "basque"].includes(
      restaurant_id,
    )
  )
    throw new Error("Choose one of the four restaurants.");
  return { name, email, password, restaurant_id };
}

import { createClient } from "npm:@supabase/supabase-js@2";
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
  if (!token) return reply({ error: "Sign in as an administrator." }, 401);
  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: identity, error: authError } =
    await service.auth.getUser(token);
  if (authError || !identity.user)
    return reply({ error: "Your session expired. Sign in again." }, 401);
  const { data: actor } = await service
    .from("profiles")
    .select("id,role")
    .eq("id", identity.user.id)
    .single();
  try {
    requireAdmin(actor);
  } catch {
    return reply({ error: "Administrator access required" }, 403);
  }
  let input;
  try {
    const raw = await req.text();
    if (raw.length > 16384)
      return reply({ error: "Request is too large" }, 413);
    input = employeeInput(JSON.parse(raw));
  } catch (e) {
    return reply(
      { error: e instanceof Error ? e.message : "Invalid employee details" },
      400,
    );
  }
  const { data: created, error } = await service.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.name },
  });
  if (error || !created.user)
    return reply({ error: error?.message || "Could not create employee" }, 400);
  const { error: profileError } = await service.rpc("register_employee", {
    p_id: created.user.id,
    p_name: input.name,
    p_email: input.email,
    p_restaurant: input.restaurant_id,
    p_actor: actor!.id,
  });
  if (profileError) {
    await service.auth.admin.deleteUser(created.user.id);
    return reply(
      {
        error:
          "Employee setup failed; no account was activated. Please try again.",
      },
      500,
    );
  }
  return reply({
    employee: {
      id: created.user.id,
      name: input.name,
      email: input.email,
      restaurant_id: input.restaurant_id,
      role: "manager",
    },
  });
});
