import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRecovery, requestErrorMessage } from '../src/network.mjs';

test('briefing submission recovers once after a lost response using the same occurrence and data', async () => {
  const calls = [];
  const body = JSON.stringify({ p_occurrence: 'briefing-occurrence', p_data: { briefing_by: 'Manager', manager_ack: true } });
  const fetcher = fetchWithRecovery(async request => {
    calls.push({ url: request.url, method: request.method, body: await request.text(), authorization: request.headers.get('authorization') });
    if (calls.length === 1) throw new TypeError('Failed to fetch');
    return Response.json({ id: 'existing-submitted-report' });
  });
  const response = await fetcher('https://project.supabase.co/rest/v1/rpc/submit_report', {
    method: 'POST', headers: { authorization: 'Bearer test-session', 'Content-Type': 'application/json' }, body,
  });
  assert.equal((await response.json()).id, 'existing-submitted-report');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
});

test('evidence metadata reads and draft saves recover from transient connection failures', async () => {
  for (const [path, method] of [['/rest/v1/evidence?occurrence_id=eq.id', 'GET'], ['/rest/v1/rpc/save_draft', 'POST']]) {
    let calls = 0;
    const fetcher = fetchWithRecovery(async () => {
      if (++calls === 1) throw new TypeError('Failed to fetch');
      return Response.json([]);
    });
    assert.equal((await fetcher('https://project.supabase.co' + path, { method })).status, 200);
    assert.equal(calls, 2);
  }
});

test('non-idempotent uploads, account actions and policy changes are never replayed', async () => {
  for (const path of ['/functions/v1/report-evidence', '/functions/v1/employee-admin', '/rest/v1/rpc/configure_policy']) {
    let calls = 0;
    const fetcher = fetchWithRecovery(async () => { calls++; throw new TypeError('Failed to fetch'); });
    await assert.rejects(fetcher('https://project.supabase.co' + path, { method: 'POST', body: 'data' }), /Failed to fetch/);
    assert.equal(calls, 1);
  }
});

test('server validation, expired sessions and cancellations are not retried', async () => {
  for (const status of [400, 401, 403, 409, 500]) {
    let calls = 0;
    const fetcher = fetchWithRecovery(async () => { calls++; return new Response('server response', { status }); });
    assert.equal((await fetcher('https://project.supabase.co/rest/v1/rpc/submit_report', { method: 'POST' })).status, status);
    assert.equal(calls, 1);
  }
  let calls = 0;
  const fetcher = fetchWithRecovery(async () => { calls++; throw new DOMException('Cancelled', 'AbortError'); });
  await assert.rejects(fetcher('https://project.supabase.co/rest/v1/evidence'), /Cancelled/);
  assert.equal(calls, 1);
});

test('persistent outages stop after two attempts and provide a readable error', async () => {
  let calls = 0;
  const fetcher = fetchWithRecovery(async () => { calls++; throw new TypeError('Failed to fetch'); });
  await assert.rejects(fetcher('https://project.supabase.co/rest/v1/rpc/submit_report', { method: 'POST' }), /Failed to fetch/);
  assert.equal(calls, 2);
  assert.match(requestErrorMessage({ message: 'TypeError: Failed to fetch' }), /connection.*try again/i);
  assert.equal(requestErrorMessage(new Error('Submission window is closed')), 'Submission window is closed');
});
