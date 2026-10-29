import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshPolicyDraft } from '../src/policyDraft.mjs';

test('background reloads preserve every unsaved policy field', () => {
  const draft = refreshPolicyDraft(null, 'a', 'opening', []);
  draft.dirty = true;
  Object.assign(draft.form, { start_time: '09:00', reward: 20, baseline: 100,
    operating_days: [1, 2], approvals: { calendar: true }, manager_id: 'manager' });
  const refreshed = refreshPolicyDraft(draft, 'a', 'opening', [
    { restaurant_id: 'a', type: 'opening', reward: 5 },
  ]);
  assert.equal(refreshed, draft);
  assert.equal(refreshed.form.reward, 20);
});

test('switching restaurant or report loads its own saved policy', () => {
  const draft = { ...refreshPolicyDraft(null, 'a', 'opening', []), dirty: true };
  const other = refreshPolicyDraft(draft, 'b', 'closing', [
    { restaurant_id: 'b', type: 'closing', reward: 8, approvals: { handover_rule: 'previous_service_day' } },
  ]);
  assert.equal(other.form.reward, 8);
  assert.equal(other.form.handover_rule, 'previous_service_day');
  assert.equal(other.dirty, false);
});

test('an untouched or successfully saved draft receives server updates', () => {
  const draft = refreshPolicyDraft(null, 'a', 'opening', []);
  const updated = refreshPolicyDraft(draft, 'a', 'opening', [
    { restaurant_id: 'a', type: 'opening', reward: 15, current: true },
  ]);
  assert.equal(updated.form.reward, 15);
  assert.equal(updated.dirty, false);
});
