export function refreshPolicyDraft(previous, rid, type, policies) {
  // Polling and realtime updates must never replace work in progress.
  if (previous?.dirty && previous.rid === rid && previous.type === type)
    return previous;
  const existing = policies.find(
    (p) => p.restaurant_id === rid && p.type === type && p.current !== false,
  );
  return {
    rid, type, dirty: false,
    form: existing ? {
      ...existing,
      incident_rule: existing.incident_rule || existing.approvals?.incident_rule,
      handover_rule: existing.handover_rule || existing.approvals?.handover_rule,
    } : {
      restaurant_id: rid, type, start_time: "", end_time: "", reward: "",
      baseline: "", enabled: false, timezone: "Asia/Kolkata",
      operating_days: [], approvals: {},
    },
  };
}
