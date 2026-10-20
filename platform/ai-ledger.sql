-- Additive migration in the existing MU account database. UTC calendar months.
CREATE TABLE IF NOT EXISTS ModdockAiPeriods (
 owner TEXT NOT NULL REFERENCES AspNetUsers(Id),
 start TEXT NOT NULL, end TEXT NOT NULL,
 limit_tokens INTEGER NOT NULL CHECK(limit_tokens = 1000000),
 used INTEGER NOT NULL DEFAULT 0 CHECK(used >= 0),
 reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0),
 PRIMARY KEY(owner, start)
);
CREATE TABLE IF NOT EXISTS ModdockAiCalls (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, task TEXT NOT NULL, period TEXT NOT NULL,
 input_budget INTEGER NOT NULL CHECK(input_budget >= 0),
 output_budget INTEGER NOT NULL CHECK(output_budget > 0),
 input_tokens INTEGER, output_tokens INTEGER, provider_id TEXT,
 state TEXT NOT NULL CHECK(state IN ('reserved','unresolved','settled')),
 evidence_sha256 TEXT,
 expires INTEGER NOT NULL, created INTEGER NOT NULL,
 FOREIGN KEY(owner, period) REFERENCES ModdockAiPeriods(owner, start)
);
CREATE INDEX IF NOT EXISTS IX_ModdockAiCallsOwnerTask ON ModdockAiCalls(owner, task);
CREATE INDEX IF NOT EXISTS IX_ModdockAiCallsState ON ModdockAiCalls(state, expires);
CREATE UNIQUE INDEX IF NOT EXISTS IX_ModdockAiCallsProvider ON ModdockAiCalls(provider_id) WHERE provider_id IS NOT NULL;
