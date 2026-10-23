CREATE TABLE outbox_events (
  id            uuid PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  payload_json  jsonb NOT NULL,
  locked_until  timestamptz NULL,
  attempts      int NOT NULL DEFAULT 0
) WITH (fillfactor = 70);

CREATE INDEX ON outbox_events (created_at);
