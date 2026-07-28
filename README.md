# StreamFlix

A private, streaming-service-style showcase site on Cloudflare Workers, built to
present one special title — *Our Golden Night* — inside a familiar cinematic
browsing experience.

- Anyone with the link can watch: no accounts, no sign-in, no payments
- Catalog with search, collections, and a featured hero
- Video served straight from R2 with byte-range seeking
- My List and Continue Watching kept in the browser (localStorage)
- A password-protected content studio at `/admin/` for managing every part of the site
- Cloudflare D1 for data, R2 for media — no other infrastructure

Production: <https://streamflix.izzulfitreee.workers.dev>

The supporting films are Blender Foundation open movies (CC-BY / CC-BY-SA);
*Our Golden Night* is an original title. Attribution is shown in the site footer.

> The account/subscription API still exists server-side (`src/worker/auth.ts`,
> `billing.ts`, `me.ts`) and is covered by tests, but nothing in the site uses it.
> See "Optional: re-enabling accounts" below.

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
| `ADMIN_PASSWORD` | Admin password for `/admin/` (changeable afterwards in the studio Security panel) |
| `SESSION_SECRET` | ≥32 random chars; signs admin sessions and peppers password hashes |

## Optional: re-enabling accounts

Visitors need no account, so the auth/billing code sits dormant. To turn it back on:

1. Restore the viewer sign-in/sign-up/account pages, which were removed in the
   commit that opened up access (`git log --diff-filter=D -- src/site/login.html`),
   re-add their copy lines in `scripts/build.mjs`, and link them from the header.
2. Restore the entitlement check in `src/worker/media.ts` (`serveMedia`) so video
   requires an active subscription.
3. For real payments, set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_MONTHLY`, and `STRIPE_PRICE_YEARLY`; without them billing runs in
   a clearly-labelled demo mode. See docs/OPERATIONS.md.

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
