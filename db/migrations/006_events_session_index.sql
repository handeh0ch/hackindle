-- Session lists look up the start, end and segments of each session by session id.
-- Without this index the query scans all events per session, so its cost grows with
-- the square of the number of sessions (about 65 s at 3,000 sessions on PostgreSQL 18).
-- The expression must match server/sessions.js exactly for the planner to use it.
CREATE INDEX events_session ON events (source_id, ((content->>'session_id')::uuid), (content->>'type'));
