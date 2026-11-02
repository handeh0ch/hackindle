ALTER TABLE annotations ADD CONSTRAINT annotations_global_id UNIQUE (annotation_id);
ALTER TABLE sources ADD COLUMN reset_generation bigint NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN progress jsonb;
ALTER TABLE device ADD COLUMN last_sync_at timestamptz;
CREATE TABLE annotation_identities (annotation_id uuid PRIMARY KEY, source_id text NOT NULL, digest text NOT NULL, barrier_generation bigint, content_version bigint NOT NULL);
CREATE TABLE event_identities (event_id uuid PRIMARY KEY, digest text NOT NULL);
CREATE TABLE legacy_raw_highwater (source_id text NOT NULL, reporting_date date NOT NULL, native_pages bigint NOT NULL, native_seconds bigint NOT NULL, PRIMARY KEY (source_id, reporting_date));
CREATE TABLE legacy_reset_baseline (source_id text NOT NULL, reporting_date date NOT NULL, native_pages bigint NOT NULL, native_seconds bigint NOT NULL, PRIMARY KEY (source_id, reporting_date));
