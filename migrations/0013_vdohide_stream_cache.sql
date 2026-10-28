-- VdoHide/Fembed resolution cache. No TTL by design: stale entries are
-- replaced only when playback fails or an admin explicitly refreshes them.
CREATE TABLE IF NOT EXISTS vdohide_stream_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hoshika_short_id TEXT NOT NULL,
  episode_num INTEGER NOT NULL,
  embed_url TEXT NOT NULL,
  resolved_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (hoshika_short_id, episode_num)
);
CREATE INDEX IF NOT EXISTS idx_vdohide_stream_cache_series
  ON vdohide_stream_cache(hoshika_short_id, episode_num);
