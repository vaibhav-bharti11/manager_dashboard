export function requireAdmin(profile) {
  if (!profile || profile.role !== "admin")
    throw new Error("Administrator access required");
  return profile.id;
}
export function employeeInput(body) {
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
