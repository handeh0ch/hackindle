CREATE TABLE legacy_handshakes (device_id uuid NOT NULL, source_id text NOT NULL, reset_generation bigint NOT NULL, baseline_id uuid NOT NULL, native_epoch uuid NOT NULL, digest text NOT NULL, PRIMARY KEY (device_id, source_id, reset_generation));
CREATE TABLE legacy_carry (source_id text NOT NULL, reporting_date date NOT NULL, native_pages bigint NOT NULL, native_seconds bigint NOT NULL, PRIMARY KEY (source_id, reporting_date));
CREATE TABLE legacy_lineages (source_id text PRIMARY KEY, native_epoch uuid NOT NULL);
