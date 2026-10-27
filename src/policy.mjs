export function stateOf(o, now = new Date()) {
  if (!o?.enabled) return "Policy not configured";
  if (o.submitted_at) return "Submitted";
  if (+now < +new Date(o.opens_at)) return "Not yet open";
  return +now < +new Date(o.deadline) ? "Open" : "Missed";
}
export function ledgerEntry(ledger, o, reason) {
  if (!ledger.some((e) => e.occurrence_id === o.id))
    ledger.push({
      occurrence_id: o.id,
      manager_id: o.manager_id,
      restaurant_id: o.restaurant_id,
      reason,
      amount: reason === "missed" ? -20 : o.reward,
    });
  return ledger;
}
export function score(baseline, ledger) {
  return baseline == null
    ? null
    : baseline + ledger.reduce((n, e) => n + e.amount, 0);
}
export function weekStart(now, offset = 330) {
  const d = new Date(+now + offset * 60000);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
export function configuredWeekStart(now, timezone, resetTime) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const [hour, minute] = resetTime.split(":").map(Number);
  const local = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  );
  return weekStart(new Date(local - (hour * 60 + minute) * 60000), 0);
}
export function resolveWindow(date, start, end, offset = 330) {
  const a = Date.parse(`${date}T${start}:00Z`) - offset * 60000;
  let b = Date.parse(`${date}T${end}:00Z`) - offset * 60000;
  if (b <= a) b += 86400000;
  return {
    opens_at: new Date(a).toISOString(),
    deadline: new Date(b).toISOString(),
  };
}
export function canAccess(profile, restaurantId) {
  return profile?.role === "admin" || profile?.restaurant_id === restaurantId;
}
export function validateResponses(rows, responses) {
  for (let i = 0; i < rows.length; i++) {
    const r = responses[i];
    if (!["D", "I", "NA"].includes(r?.status) || !r?.initials?.trim())
      return `Complete status and checker initials for item ${i + 1}.`;
    if (r.status === "I" && (!r.action?.trim() || !r.owner?.trim() || !r.due))
      return `Add an action, owner and due time for issue ${i + 1}.`;
  }
  return null;
}
