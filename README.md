# StreamFlix

A subscription streaming platform on Cloudflare Workers:

- Public catalog with search, collections, and a featured hero
- Viewer accounts with subscriptions (Stripe, or a built-in demo billing mode)
- Video streaming gated on an active subscription, served from R2 with byte-range support
- My List and Continue Watching synced to each account
- A password-protected content studio at `/admin/` for managing every part of the site
- Cloudflare D1 for data, R2 for media — no other infrastructure

Production: <https://streamflix.izzulfitreee.workers.dev>

All bundled sample films are Blender Foundation open movies (CC-BY); *Our Golden Night*
is an original StreamFlix title. Attribution is shown in the site footer.

## Architecture

```
Cloudflare Worker (src/worker/)
├── index.ts    router, security headers + CSP, error handling
├── auth.ts     viewer + admin sessions (D1-backed, revocable, CSRF)
├── billing.ts  plans, Stripe checkout/webhooks, dev billing mode
├── me.ts       my list, continue watching, password change
├── public.ts   catalog API
├── admin.ts    content/collections/settings/media/audit admin API
├── uploads.ts  multipart R2 uploads, magic-byte validation, cleanup
└── media.ts    R2 media serving with subscription gating

D1 database: streamflix        (migrations/ — apply with wrangler d1 migrations)
R2 bucket:   streamflix-media  (catalog/  = seeded licensed media,
                                uploads/  = admin-uploaded media,
                                generated/ = generated artwork)
Static site: dist/ (built from src/site/ by scripts/build.mjs)
```

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # then edit values
npm run build
npx wrangler d1 migrations apply streamflix --local
npm run dev
```

## Validation and deployment

```bash
npm run check      # typecheck + build + unit/integration tests (spins up wrangler dev)
npm run deploy     # check + build + wrangler deploy
npm run test:e2e   # Playwright smoke test against the live site
```

Remote migrations: `npx wrangler d1 migrations apply streamflix --remote`

## Secrets (wrangler secret put …)

| Secret | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Bootstrap admin password (changeable afterwards in the studio Security panel) |
| `SESSION_SECRET` | ≥32 random chars; peppers password hashes |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY` | Optional; unset = demo billing mode (no real payments) |

## Media requirements

- **Video**: MP4 (H.264 + AAC) strongly recommended; WebM accepted. ≤2 GB.
- **Images**: JPEG, PNG, WebP, or AVIF. ≤15 MB. Posters 2:3, backdrops 16:9.
- **Captions**: WebVTT (`.vtt`).
- Uploads are validated server-side (type, size, magic bytes) and stored under
  versioned keys, so replacing media never serves stale files.

## Documentation

- [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) — using the content studio
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — deploys, backups, rollback, monitoring

## License note

This repository began as a fork of a GPL-3.0 front-end clone; the original static
front-end has been removed and replaced. The GPL-3.0 license is retained (see LICENSE).
