import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'csv-parse/sync';
import { effectiveSkills, eligibleRecommendations, trajectory } from './domain.js';
import type { DataState, Employee, Event, History } from './types.js';

const data = path.resolve(process.cwd(), 'data');
const employeesFile = JSON.parse(readFileSync(path.join(data, 'employees.json'), 'utf8'));
const eventsFile = JSON.parse(readFileSync(path.join(data, 'events.json'), 'utf8'));
const skillsFile = JSON.parse(readFileSync(path.join(data, 'skills.json'), 'utf8'));
const historyRows = parse(readFileSync(path.join(data, 'activity_history.csv'), 'utf8'), { columns: true }) as Record<string, string>[];
const state: DataState = {
  asOf: employeesFile.meta.as_of_date,
  employees: employeesFile.employees,
  events: eventsFile.events,
  skills: skillsFile.skills,
  profiles: skillsFile.role_profiles,
  history: historyRows.map(row => ({ ...row, completion_pct: Number(row.completion_pct),
    due_date: row.due_date || null, score: row.score ? Number(row.score) : null,
    feedback_rating: row.feedback_rating ? Number(row.feedback_rating) : null })) as History[],
};

test('recommendations for the supplied dataset obey eligibility and never include mandatory activities', () => {
  for (const employee of state.employees) {
    const skills = effectiveSkills(employee, state.history, state.events);
    const finished = new Set(state.history.filter(row => row.employee_id === employee.employee_id && row.status === 'completed')
      .map(row => row.event_id));
    for (const item of eligibleRecommendations(employee, state)) {
      const event = item.event;
      assert.equal(event.mandatory, false);
      assert.notEqual(event.type, 'compliance');
      assert.ok(event.target_roles.includes(employee.role));
      assert.ok(event.target_grades.includes(employee.grade));
      assert.ok(Object.entries(event.prerequisites).every(([id, level]) => (skills[id] ?? 0) >= level));
      assert.ok(!finished.has(event.event_id) || event.event_id === 'EV_036');
      assert.ok(item.closes.some(skill => skill.to > skill.from));
      assert.ok(item.score > 0);
    }
  }
});

test('completion after the last review raises a skill once and respects max_level', () => {
  const employee: Employee = { ...state.employees[0], employee_id: 'TEST', skills: { SK_SYSTEM_DESIGN: 2 }, last_review_date: '2026-09-01' };
  const event: Event = { ...state.events[0], event_id: 'TEST_EVENT', develops_skills: [{ skill_id: 'SK_SYSTEM_DESIGN', gain: 2, max_level: 3 }] };
  const row: History = { record_id: 'TEST_ROW', employee_id: 'TEST', event_id: 'TEST_EVENT', date: '2026-10-01',
    due_date: null, status: 'completed', completion_pct: 100, score: null, feedback_rating: null, assigned_by: 'self' };
  assert.equal(effectiveSkills(employee, [row], [event]).SK_SYSTEM_DESIGN, 3);
  assert.equal(effectiveSkills({ ...employee, last_review_date: '2026-10-02' }, [row], [event]).SK_SYSTEM_DESIGN, 2);
});

test('demo course completion improves the mapped skill and career readiness without modifying events', () => {
  const employee = state.employees.find(item => item.employee_id === 'E0021')!;
  const before = effectiveSkills(employee, state.history, state.events);
  const completion = { employee_id: employee.employee_id, module_id: 'LM_PERIPHERALS_01',
    effective_date: state.asOf, skill_id: 'SK_TROUBLESHOOTING', gain: 1, max_level: 3 };
  const afterState: DataState = { ...state, learningCompletions: [completion] };
  const after = effectiveSkills(employee, afterState.history, afterState.events, afterState.learningCompletions);
  assert.equal(before.SK_TROUBLESHOOTING, 2);
  assert.equal(after.SK_TROUBLESHOOTING, 3);
  assert.ok(trajectory(employee, afterState).readiness > trajectory(employee, state).readiness);
  assert.equal(effectiveSkills(employee, state.history, state.events, [completion, completion]).SK_TROUBLESHOOTING, 3);
  assert.equal(effectiveSkills({ ...employee, last_review_date: '2026-10-02' }, state.history, state.events,
    [completion]).SK_TROUBLESHOOTING, employee.skills.SK_TROUBLESHOOTING);
});

test('critical promotion gap wins over repeatedly missed presentation activities', () => {
  const employee: Employee = { ...state.employees[0], employee_id: 'JURY', role: 'Backend Engineer', grade: 'Middle',
    career_goal: { target_role: 'Backend Engineer', target_grade: 'Senior' },
    skills: { SK_SYSTEM_DESIGN: 2, SK_PUBLIC_SPEAKING: 1 }, last_review_date: '2026-09-30' };
  const makeEvent = (id: string, skill_id: string): Event => ({ ...state.events[5], event_id: id,
    mandatory: false, type: 'workshop', format: 'online', target_roles: ['Backend Engineer'], target_grades: ['Middle'],
    develops_skills: [{ skill_id, gain: 1, max_level: 5 }], prerequisites: {}, upcoming_sessions: ['2026-10-10'] });
  const system = makeEvent('SYSTEM', 'SK_SYSTEM_DESIGN');
  const speaking = makeEvent('SPEAKING', 'SK_PUBLIC_SPEAKING');
  const missed = Array.from({ length: 3 }, (_, index): History => ({ record_id: `MISS_${index}`, employee_id: 'JURY',
    event_id: 'SPEAKING', date: `2026-0${index + 1}-01`, due_date: null, status: 'no_show', completion_pct: 0,
    score: null, feedback_rating: null, assigned_by: 'self' }));
  const local: DataState = { ...state, employees: [employee], events: [system, speaking], history: missed };
  assert.equal(eligibleRecommendations(employee, local)[0]?.event.event_id, 'SYSTEM');
  assert.ok(trajectory(employee, local).criticalRemaining > 0);
});
