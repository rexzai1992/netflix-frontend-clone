PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS content (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('movie', 'show')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  year INTEGER,
  maturity_rating TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '',
  match_score INTEGER NOT NULL DEFAULT 0 CHECK (match_score BETWEEN 0 AND 100),
  poster_key TEXT,
  backdrop_key TEXT,
  logo_key TEXT,
  video_key TEXT,
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1))
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, content_id)
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_content_published_order
  ON content(published, sort_order, updated_at);
CREATE INDEX IF NOT EXISTS idx_collection_items_order
  ON collection_items(collection_id, sort_order);

INSERT OR IGNORE INTO site_settings (key, value) VALUES
  ('site_name', 'StreamFlix'),
  ('hero_kicker', '#2 in India Today'),
  ('landing_title', 'Unlimited movies, TV shows, and more.'),
  ('landing_subtitle', 'Watch anywhere. Cancel anytime.');

INSERT OR IGNORE INTO collections (id, title, slug, sort_order) VALUES
  ('featured', 'Featured Now', 'featured', 0),
  ('trending', 'Trending Now', 'trending', 10),
  ('popular', 'Popular on StreamFlix', 'popular', 20),
  ('movies', 'Movies', 'movies', 30),
  ('shows', 'TV Shows', 'shows', 40);

INSERT OR IGNORE INTO content
  (id, type, title, description, year, maturity_rating, duration, match_score, poster_key, backdrop_key, logo_key, video_key, featured, published, sort_order)
VALUES
  ('never-have-i-ever', 'show', 'Never Have I Ever', 'Getting the grades? Too easy. Getting through grief? Too hard. This year, there is just one goal on her mind: getting the guy.', 2020, '13+', '4 Seasons', 96, 'seed/never-have-i-ever/poster.jpg', 'seed/never-have-i-ever/backdrop.webp', 'seed/never-have-i-ever/logo.webp', 'seed/never-have-i-ever/trailer.mp4', 1, 1, 10),
  ('murder-mystery', 'movie', 'Murder Mystery', 'On a long-awaited trip to Europe, a New York City cop and his wife scramble to solve a baffling murder aboard a billionaire yacht.', 2019, '13+', '1h 37m', 94, 'seed/murder-mystery/poster.jpg', 'seed/murder-mystery/backdrop.jpg', 'seed/murder-mystery/logo.webp', 'seed/murder-mystery/trailer.mp4', 0, 1, 20),
  ('were-the-millers', 'movie', 'We''re the Millers', 'A small-time pot dealer creates a fake family as part of his plan to move a huge shipment across the border.', 2013, '18+', '1h 50m', 91, 'seed/were-the-millers/poster.webp', 'seed/were-the-millers/backdrop.jpg', 'seed/were-the-millers/logo.webp', 'seed/were-the-millers/trailer.mp4', 0, 1, 30),
  ('extraction', 'movie', 'Extraction', 'A hardened mercenary accepts his most dangerous mission yet: rescuing the kidnapped son of an international crime lord.', 2020, '18+', '1h 56m', 89, 'seed/extraction/poster.jpg', 'seed/extraction/poster.jpg', NULL, 'seed/murder-mystery/trailer.mp4', 0, 1, 40),
  ('horrible-bosses', 'movie', 'Horrible Bosses', 'Three friends conspire to remove the bosses making their working lives miserable.', 2011, '18+', '1h 38m', 86, 'seed/horrible-bosses/poster.webp', 'seed/horrible-bosses/poster.webp', NULL, 'seed/never-have-i-ever/trailer.mp4', 0, 1, 50),
  ('kabir-singh', 'movie', 'Kabir Singh', 'A brilliant but self-destructive surgeon spirals after the love of his life is forced to marry another man.', 2019, '18+', '2h 52m', 84, 'seed/kabir-singh/poster.webp', 'seed/kabir-singh/poster.webp', NULL, 'seed/never-have-i-ever/trailer.mp4', 0, 1, 60),
  ('sex-education', 'show', 'Sex Education', 'Insecure Otis has all the answers when it comes to sex advice, thanks to his therapist mother.', 2019, '18+', '4 Seasons', 92, 'seed/sex-education/poster.webp', 'seed/sex-education/poster.webp', 'seed/sex-education/logo.webp', 'seed/never-have-i-ever/trailer.mp4', 0, 1, 70);

INSERT OR IGNORE INTO collection_items (collection_id, content_id, sort_order) VALUES
  ('featured', 'never-have-i-ever', 10),
  ('featured', 'murder-mystery', 20),
  ('trending', 'never-have-i-ever', 10),
  ('trending', 'murder-mystery', 20),
  ('trending', 'were-the-millers', 30),
  ('trending', 'extraction', 40),
  ('trending', 'sex-education', 50),
  ('popular', 'horrible-bosses', 10),
  ('popular', 'kabir-singh', 20),
  ('popular', 'extraction', 30),
  ('popular', 'were-the-millers', 40),
  ('movies', 'murder-mystery', 10),
  ('movies', 'were-the-millers', 20),
  ('movies', 'extraction', 30),
  ('movies', 'horrible-bosses', 40),
  ('movies', 'kabir-singh', 50),
  ('shows', 'never-have-i-ever', 10),
  ('shows', 'sex-education', 20);
