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
  business_role text NOT NULL DEFAULT 'COMPANY_EMPLOYEE',
  employee_id text UNIQUE REFERENCES employees(employee_id) ON DELETE SET NULL,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_role_link CHECK (role <> 'EMPLOYEE' OR employee_id IS NOT NULL OR business_role='CONTACT_CLIENT')
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_role text NOT NULL DEFAULT 'COMPANY_EMPLOYEE';
ALTER TABLE users DROP CONSTRAINT IF EXISTS employee_role_link;
ALTER TABLE users ADD CONSTRAINT employee_role_link CHECK (role <> 'EMPLOYEE' OR employee_id IS NOT NULL OR business_role='CONTACT_CLIENT');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_business_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_business_role_check CHECK (business_role IN
      ('COMPANY_EMPLOYEE','HR_SPECIALIST','DEPARTMENT_MANAGER','CONTACT_CLIENT','CONTACT_OPERATOR','CONTACT_SUPERVISOR'));
  END IF;
END $$;
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

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name text,
  phone text,
  about text NOT NULL DEFAULT '',
  preferred_language text NOT NULL DEFAULT 'ru',
  birth_date date,
  avatar_data bytea,
  avatar_mime text,
  avatar_updated_at timestamptz,
  last_seen_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT avatar_size CHECK (avatar_data IS NULL OR octet_length(avatar_data)<=2097152)
);
CREATE TABLE IF NOT EXISTS login_history (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  login_identifier text NOT NULL,
  success boolean NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_history_user_idx ON login_history(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  field_name text,
  old_value text,
  new_value text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_time_idx ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_target_idx ON audit_logs(target_user_id,created_at DESC);
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('direct','group','work')),
  title text,
  work_kind text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_members (
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(chat_id,user_id)
);
CREATE INDEX IF NOT EXISTS chat_members_user_idx ON chat_members(user_id);
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_chat_time_idx ON messages(chat_id,created_at DESC);
CREATE TABLE IF NOT EXISTS ai_chat_summaries (
  id uuid PRIMARY KEY,
  chat_id uuid REFERENCES chats(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  scope text NOT NULL,
  covered_from timestamptz,
  covered_to timestamptz,
  covered_count integer NOT NULL,
  summary jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_chat_summaries_chat_idx ON ai_chat_summaries(chat_id,created_at DESC);

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
