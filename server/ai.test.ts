import assert from 'node:assert/strict';
import test from 'node:test';
import { rankWithOpenAI } from './ai.js';
import type { Employee, Recommendation } from './types.js';

test('OpenAI response can only select eligible shortlist IDs', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-placeholder';
  globalThis.fetch = async () => new Response(JSON.stringify({ output: [
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ event_ids: ['UNKNOWN', 'EV_005', 'EV_005'] }) }] },
  ] }), { status: 200 });
  try {
    const employee = { employee_id: 'TEST', role: 'Backend Engineer', grade: 'Middle', career_goal: null } as Employee;
    const item = { event: { event_id: 'EV_005', title: 'System Design' }, score: 12,
      closes: [], historyNote: 'No previous participation' } as Recommendation;
    assert.deepEqual(await rankWithOpenAI(employee, [item]), ['EV_005']);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
