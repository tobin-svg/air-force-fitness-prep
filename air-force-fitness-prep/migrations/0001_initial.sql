CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY,
  plan_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'partial', 'missed', 'rest', 'rough')),
  rough_day INTEGER NOT NULL DEFAULT 0 CHECK (rough_day IN (0, 1)),
  note TEXT
);

CREATE TABLE IF NOT EXISTS sets (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL REFERENCES days(date) ON DELETE CASCADE,
  exercise TEXT NOT NULL CHECK (exercise IN ('pushups', 'situps', 'crunches', 'plank', 'run', 'run_time', 'stretch')),
  value REAL NOT NULL CHECK (value > 0),
  unit TEXT NOT NULL CHECK (unit IN ('reps', 'seconds', 'miles', 'minutes')),
  timestamp TEXT NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0 CHECK (undone IN (0, 1))
);
CREATE INDEX IF NOT EXISTS sets_date_timestamp ON sets(date, timestamp DESC);

CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tests_date ON tests(date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS message_log (
  date TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);
