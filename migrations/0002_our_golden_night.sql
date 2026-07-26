INSERT OR IGNORE INTO content
  (id, type, title, description, year, maturity_rating, duration, match_score,
   poster_key, backdrop_key, logo_key, video_key, featured, published, sort_order)
VALUES
  (
    'our-golden-night',
    'movie',
    'Our Golden Night',
    'On their anniversary, a couple retraces the small moments that transformed an ordinary meeting into a lifetime worth celebrating.',
    2026,
    'PG',
    '1h 42m',
    98,
    'generated/our-golden-night/hero.png',
    'generated/our-golden-night/hero.png',
    NULL,
    NULL,
    1,
    1,
    1
  );

INSERT OR IGNORE INTO collection_items (collection_id, content_id, sort_order) VALUES
  ('featured', 'our-golden-night', 1),
  ('trending', 'our-golden-night', 1),
  ('movies', 'our-golden-night', 1);

INSERT INTO site_settings (key, value, updated_at)
VALUES ('hero_kicker', 'A celebration worth remembering', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = CURRENT_TIMESTAMP;
