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
