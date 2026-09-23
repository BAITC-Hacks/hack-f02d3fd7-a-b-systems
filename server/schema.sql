CREATE TABLE IF NOT EXISTS app_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  skill_id text PRIMARY KEY,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS role_profiles (
  role text NOT NULL,
  grade text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (role, grade)
);

CREATE TABLE IF NOT EXISTS events (
  event_id text PRIMARY KEY,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  employee_id text PRIMARY KEY,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_history (
  record_id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employees(employee_id),
  event_id text NOT NULL REFERENCES events(event_id),
  data jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS history_employee_idx ON activity_history(employee_id);
CREATE INDEX IF NOT EXISTS history_event_idx ON activity_history(event_id);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  username text NOT NULL,
  email text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN', 'HR', 'EMPLOYEE')),
  employee_id text UNIQUE REFERENCES employees(employee_id) ON DELETE SET NULL,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_role_link CHECK (role <> 'EMPLOYEE' OR employee_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON user_sessions(expires_at);

-- Demo learning is kept separate from the organizer's skills/events/history dataset.
CREATE TABLE IF NOT EXISTS learning_modules (
  module_id text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  skill_id text NOT NULL REFERENCES skills(skill_id),
  gain integer NOT NULL CHECK (gain > 0),
  max_level integer NOT NULL CHECK (max_level BETWEEN 1 AND 5),
  pass_percent integer NOT NULL CHECK (pass_percent BETWEEN 1 AND 100),
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS learning_lessons (
  lesson_id text PRIMARY KEY,
  module_id text NOT NULL REFERENCES learning_modules(module_id),
  position integer NOT NULL,
  title text NOT NULL,
  lead text NOT NULL,
  points jsonb NOT NULL,
  tip text NOT NULL,
  UNIQUE (module_id, position)
);
CREATE TABLE IF NOT EXISTS quiz_questions (
  question_id text PRIMARY KEY,
  module_id text NOT NULL REFERENCES learning_modules(module_id),
  position integer NOT NULL,
  prompt text NOT NULL,
  options jsonb NOT NULL,
  correct_index integer NOT NULL CHECK (correct_index >= 0),
  UNIQUE (module_id, position)
);
CREATE TABLE IF NOT EXISTS learning_progress (
  employee_id text NOT NULL REFERENCES employees(employee_id),
  module_id text NOT NULL REFERENCES learning_modules(module_id),
  status text NOT NULL CHECK (status IN ('in_progress', 'completed')),
  lesson_index integer NOT NULL DEFAULT 0 CHECK (lesson_index >= 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  score_percent integer CHECK (score_percent BETWEEN 0 AND 100),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  effective_date date,
  PRIMARY KEY (employee_id, module_id)
);
CREATE TABLE IF NOT EXISTS learning_attempts (
  attempt_id uuid PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employees(employee_id),
  module_id text NOT NULL REFERENCES learning_modules(module_id),
  answers jsonb NOT NULL,
  correct_count integer NOT NULL,
  score_percent integer NOT NULL CHECK (score_percent BETWEEN 0 AND 100),
  passed boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learning_attempts_employee_idx ON learning_attempts(employee_id, attempted_at DESC);
CREATE TABLE IF NOT EXISTS achievements (
  achievement_id text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  icon text NOT NULL
);
CREATE TABLE IF NOT EXISTS employee_achievements (
  employee_id text NOT NULL REFERENCES employees(employee_id),
  achievement_id text NOT NULL REFERENCES achievements(achievement_id),
  awarded_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  PRIMARY KEY (employee_id, achievement_id)
);
