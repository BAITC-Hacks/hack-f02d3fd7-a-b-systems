export type Grade = 'Junior' | 'Middle' | 'Senior' | 'Lead';

export interface Employee {
  employee_id: string;
  full_name: string;
  department: string;
  role: string;
  grade: Grade;
  manager_id: string | null;
  hire_date: string;
  tenure_months: number;
  work_format: string;
  preferred_language: string;
  career_goal: { target_role: string; target_grade: Grade } | null;
  skills: Record<string, number>;
  last_review_date: string;
}

export interface Skill {
  skill_id: string;
  name: string;
  type: string;
  category: string;
  description: string;
}

export interface RoleProfile {
  role: string;
  grade: Grade;
  required_skills: Record<string, number>;
  critical_skills: string[];
}

export interface Event {
  event_id: string;
  title: string;
  description: string;
  type: string;
  format: string;
  duration_hours: number;
  mandatory: boolean;
  target_roles: string[];
  target_grades: Grade[];
  develops_skills: { skill_id: string; gain: number; max_level: number }[];
  prerequisites: Record<string, number>;
  upcoming_sessions: string[];
}

export type ActivityStatus = 'completed' | 'in_progress' | 'dropped' | 'no_show' | 'declined' | 'overdue';

export interface History {
  record_id: string;
  employee_id: string;
  event_id: string;
  date: string;
  due_date: string | null;
  status: ActivityStatus;
  completion_pct: number;
  score: number | null;
  feedback_rating: number | null;
  assigned_by: 'self' | 'manager' | 'hr';
}

export interface LearningCompletion {
  employee_id: string;
  module_id: string;
  effective_date: string;
  skill_id: string;
  gain: number;
  max_level: number;
}

export interface DataState {
  asOf: string;
  employees: Employee[];
  events: Event[];
  skills: Skill[];
  profiles: RoleProfile[];
  history: History[];
  learningCompletions?: LearningCompletion[];
}

export interface Gap {
  skill_id: string;
  name: string;
  current: number;
  required: number;
  gap: number;
  critical: boolean;
}

export interface Recommendation {
  event: Event;
  score: number;
  closes: { skill_id: string; name: string; from: number; to: number; required: number; critical: boolean }[];
  historyNote: string;
  why: string;
  nextSession: string | null;
}
