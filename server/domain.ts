import type { DataState, Employee, Event, Gap, History, Recommendation, RoleProfile } from './types.js';

const grades = ['Junior', 'Middle', 'Senior', 'Lead'] as const;

export function effectiveSkills(employee: Employee, history: History[], events: Event[]): Record<string, number> {
  const result = { ...employee.skills };
  const byEvent = new Map(events.map(event => [event.event_id, event]));
  history
    .filter(row => row.employee_id === employee.employee_id && row.status === 'completed' && row.date > employee.last_review_date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.record_id.localeCompare(b.record_id))
    .forEach(row => {
      for (const effect of byEvent.get(row.event_id)?.develops_skills ?? []) {
        const current = result[effect.skill_id] ?? 0;
        result[effect.skill_id] = Math.max(current, Math.min(5, effect.max_level, current + effect.gain));
      }
    });
  return result;
}

export function targetProfile(employee: Employee, profiles: RoleProfile[]): RoleProfile | null {
  const goal = employee.career_goal;
  if (goal) {
    const explicit = profiles.find(profile => profile.role === goal.target_role && profile.grade === goal.target_grade);
    if (explicit) return explicit;
  }
  const next = grades[grades.indexOf(employee.grade) + 1];
  return profiles.find(profile => profile.role === employee.role && profile.grade === next) ??
    profiles.find(profile => profile.role === employee.role && profile.grade === employee.grade) ?? null;
}

export function skillGaps(employee: Employee, state: DataState): Gap[] {
  const target = targetProfile(employee, state.profiles);
  if (!target) return [];
  const current = effectiveSkills(employee, state.history, state.events);
  const names = new Map(state.skills.map(skill => [skill.skill_id, skill.name]));
  return Object.entries(target.required_skills)
    .map(([skill_id, required]) => ({
      skill_id,
      name: names.get(skill_id) ?? skill_id,
      current: current[skill_id] ?? 0,
      required,
      gap: Math.max(0, required - (current[skill_id] ?? 0)),
      critical: target.critical_skills.includes(skill_id),
    }))
    .sort((a, b) => Number(b.critical) - Number(a.critical) || b.gap - a.gap || a.name.localeCompare(b.name));
}

export function trajectory(employee: Employee, state: DataState) {
  const target = targetProfile(employee, state.profiles);
  const gaps = skillGaps(employee, state);
  const total = gaps.reduce((sum, gap) => sum + gap.required, 0);
  const remaining = gaps.reduce((sum, gap) => sum + gap.gap, 0);
  return {
    target: target ? { role: target.role, grade: target.grade } : null,
    readiness: total ? Math.round((1 - remaining / total) * 100) : 100,
    remaining: gaps.filter(gap => gap.gap > 0).length,
    criticalRemaining: gaps.filter(gap => gap.critical && gap.gap > 0).length,
    gaps,
  };
}

export function eligibleRecommendations(employee: Employee, state: DataState): Recommendation[] {
  const current = effectiveSkills(employee, state.history, state.events);
  const gaps = skillGaps(employee, state).filter(gap => gap.gap > 0);
  const bySkill = new Map(gaps.map(gap => [gap.skill_id, gap]));
  const personHistory = state.history.filter(row => row.employee_id === employee.employee_id);
  const completedSimilar = new Map<string, number>();
  for (const row of personHistory) {
    if (row.status === 'completed') {
      const type = state.events.find(event => event.event_id === row.event_id)?.type;
      if (type) completedSimilar.set(type, (completedSimilar.get(type) ?? 0) + 1);
    }
  }

  return state.events.flatMap(event => {
    if (event.mandatory || event.type === 'compliance' || !event.target_roles.includes(employee.role) ||
      !event.target_grades.includes(employee.grade)) return [];
    if (Object.entries(event.prerequisites).some(([skill, level]) => (current[skill] ?? 0) < level)) return [];
    const nextSession = event.format === 'self_paced' ? null :
      event.upcoming_sessions.filter(date => date >= state.asOf).sort()[0] ?? null;
    if (event.format !== 'self_paced' && !nextSession) return [];
    const sameEvent = personHistory.filter(row => row.event_id === event.event_id);
    if (event.event_id !== 'EV_036' && sameEvent.some(row => row.status === 'completed' || row.status === 'in_progress')) return [];

    const closes = event.develops_skills.flatMap(effect => {
      const gap = bySkill.get(effect.skill_id);
      if (!gap) return [];
      const from = current[effect.skill_id] ?? 0;
      const to = Math.max(from, Math.min(5, effect.max_level, from + effect.gain));
      if (to <= from) return [];
      return [{ skill_id: effect.skill_id, name: gap.name, from, to, required: gap.required, critical: gap.critical }];
    }).sort((a, b) => Number(b.critical) - Number(a.critical) ||
      (b.required - b.from) - (a.required - a.from));
    if (!closes.length) return [];

    const setbacks = sameEvent.filter(row => ['no_show', 'declined', 'dropped'].includes(row.status));
    const formatNoShows = personHistory.filter(row => row.status === 'no_show' &&
      state.events.find(other => other.event_id === row.event_id)?.format === event.format).length;
    const impact = closes.reduce((sum, item) => sum + Math.min(item.to - item.from, Math.max(0, item.required - item.from)) *
      (item.critical ? 12 : 5), 0);
    const setbackPenalty = setbacks.reduce((sum, row) => sum + (row.status === 'no_show' ? 10 : row.status === 'declined' ? 8 : 6), 0);
    const score = impact + Math.min(2, completedSimilar.get(event.type) ?? 0) - setbackPenalty -
      Math.min(6, formatNoShows * (event.format === 'self_paced' ? 0 : 1.5));
    if (score <= 0) return [];
    const historyNote = setbacks.length
      ? `Ранее по этой активности: ${setbacks.map(row => row.status).join(', ')}; формат учтён при выборе.`
      : completedSimilar.get(event.type)
        ? `Уже завершено ${completedSimilar.get(event.type)} активностей формата «${event.type}».`
        : 'Нет завершённых активностей этого типа; это новый шаг в траектории.';
    const primary = closes[0];
    const why = `${employee.grade} → ${targetProfile(employee, state.profiles)?.grade ?? employee.grade}: ` +
      `${primary.name} сейчас ${primary.from} из ${primary.required}, после активности до ${primary.to}` +
      `${primary.critical ? ' (критический навык)' : ''}. ${historyNote}`;
    return [{ event, score, closes, historyNote, why, nextSession }];
  }).sort((a, b) => b.score - a.score || a.event.event_id.localeCompare(b.event.event_id));
}
