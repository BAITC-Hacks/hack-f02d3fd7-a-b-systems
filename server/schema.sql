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
