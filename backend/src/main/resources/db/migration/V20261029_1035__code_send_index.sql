-- Serves CodeSends.throttleQuery (docs/eng/auth.md · OTP mechanics): count(*) FILTER (target |
--   device_hash | ip_hash), count(*) FROM code_send WHERE channel = <literal> AND sent_at > now - 24 h
--   — one range scan over one channel's last day of sends (email sign-in starts, SMS OTP sends).
-- Plan before (30,000 rows, ANALYZE): Seq Scan on code_send, Filter on sent_at and channel (CodeSendPlanTest).
-- Plan after: Index/Bitmap Index Scan on code_send_channel_sent_at_idx (same test).
-- Write cost: one more index entry per code sent. Overlaps: none (the table has only its primary key).
-- The same index serves the 30-day purge (sent_at range across both channels: one range per channel,
-- acceptable for a daily job).
-- Needs human approval before merge (design · Queries and indexes).
CREATE INDEX code_send_channel_sent_at_idx ON code_send (channel, sent_at);
