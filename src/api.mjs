import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export async function signIn(email, password) {
  if (!supabase)
    throw Error(
      "The database connection is not configured. Contact your administrator.",
    );
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    if (/fetch|network/i.test(error.message))
      throw new Error(
        "Cannot reach the server. Check your connection and try again.",
      );
    throw error;
  }
  const { data: profile, error: err } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();
  if (err) {
    await supabase.auth.signOut({ scope: "local" });
    throw new Error(
      err.code === "PGRST116"
        ? "This account has no workspace assignment. Contact your administrator."
        : err.message,
    );
  }
  return profile;
}
export async function readTable(table) {
  const { data, error } = await supabase.from(table).select("*");
  if (error) throw error;
  return data;
}
export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}
export async function createEmployee(input) {
  const { data, error } = await supabase.functions.invoke("employee-admin", {
    body: input,
  });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context.json();
      message = body.error || message;
    } catch {}
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data.employee;
}
