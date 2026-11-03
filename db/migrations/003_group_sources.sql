CREATE TEMPORARY TABLE ungrouped_sources ON COMMIT DROP AS
SELECT s.source_id, gen_random_uuid() AS book_id, s.metadata->>'title' AS title
FROM sources s LEFT JOIN book_sources bs ON bs.source_id = s.source_id
WHERE bs.source_id IS NULL;
INSERT INTO books (book_id, title) SELECT book_id, title FROM ungrouped_sources;
INSERT INTO book_sources (source_id, book_id) SELECT source_id, book_id FROM ungrouped_sources;
CREATE INDEX events_finished_source ON events (source_id) WHERE content->>'type' = 'book_finished';
CREATE TABLE match_decisions (
  source_id text NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
  candidate_book_id uuid NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('confirm', 'reject')),
  PRIMARY KEY (source_id, candidate_book_id)
);
CREATE INDEX events_source_type ON events (source_id, (content->>'type'));
ALTER TABLE device ALTER COLUMN token_hash DROP NOT NULL;
