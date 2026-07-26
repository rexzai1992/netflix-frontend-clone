# StreamFlix operations manual

## Cloudflare resources (account: izzulfitreee)

| Resource | Name | Notes |
| --- | --- | --- |
| Worker | `streamflix` | Serves site, API, and media |
| D1 database | `streamflix` | id in wrangler.jsonc |
| R2 bucket | `streamflix-media` | `catalog/`, `uploads/`, `generated/` prefixes |
| Secrets | `ADMIN_PASSWORD`, `SESSION_SECRET`, optional `STRIPE_*` | `wrangler secret put <NAME>` |

No credentials live in the repo; D1/R2 access is exclusively via Worker bindings.

## Deployment flow

```
git branch → npm run check (tsc + build + tests) → preview → migrate D1 → deploy → verify
```

1. Work on a branch; open a PR into `master`.
2. `npm run check` must pass (it boots a local wrangler dev and exercises the API).
3. Preview deploy: `npx wrangler versions upload` gives a preview URL without
   shifting production traffic; or run `npm run dev` locally.
4. Apply any new migrations **before** deploying code that needs them:
   `npx wrangler d1 migrations apply streamflix --remote`
   (Write migrations to be backward-compatible with the currently deployed code.)
5. `npm run deploy`
6. Verify: `curl https://streamflix.izzulfitreee.workers.dev/api/health` and
   `STUDIO_ADMIN_PASSWORD=… npm run test:e2e`

## Rollback

- Code: `npx wrangler rollback` (or `npx wrangler deployments list` then
  `npx wrangler rollback --version-id <id>`). Workers keep prior versions; this is instant.
- Database: migrations are forward-only. To recover data, restore from a backup
  (below) with `npx wrangler d1 execute streamflix --remote --file <backup>.sql`.
  D1 also supports Time Travel: `npx wrangler d1 time-travel restore streamflix --timestamp <ISO>`
  (30-day window) — prefer this for accidental data loss.

## Backups

- **D1**: `npx wrangler d1 export streamflix --remote --output backups/streamflix-$(date +%F).sql`
  Run before every migration and on a weekly schedule. Keep backups out of git
  (`backups/` is gitignored) — they contain user emails and password hashes.
- **R2**: media under `catalog/` and `generated/` is reproducible from source
  (Blender open movies + generation scripts). `uploads/` is admin-provided and
  should be synced periodically, e.g. with rclone (S3 API credentials) or
  `wrangler r2 object get` per key from the media manager listing.
- Retention: keep at least 4 weekly D1 exports and one monthly R2 sync.

## Monitoring

- Observability is enabled in wrangler.jsonc — logs and errors appear in the
  Cloudflare dashboard (Workers → streamflix → Logs), or live via `npx wrangler tail`.
- Health endpoint: `GET /api/health` (checks D1). Point an uptime monitor
  (e.g. a Cloudflare Worker cron or UptimeRobot) at it.
- Failed uploads: studio → Media panel shows pending/stale multipart uploads;
  "Abort stale uploads" clears them. Upload failures are also in the audit log.
- Budget alerts: set R2 storage and Workers request notifications under
  Cloudflare dashboard → Notifications (recommended: R2 ≥ 8 GB, requests ≥ 80%
  of free-tier daily quota if on the free plan).

## Caching

- API catalog responses: `max-age=30, stale-while-revalidate=120`.
- Images: `public, max-age=31536000, immutable` (keys are versioned).
- Video: `private, max-age=3600` — never publicly cacheable (subscriber-gated).
- Everything else (auth, admin, account): `no-store`.

## Admin access hardening (recommended next step)

Put Cloudflare Access in front of `/admin/*`: dashboard → Zero Trust → Access →
Applications → add `streamflix.izzulfitreee.workers.dev/admin*`, allow only your
email. The application password then becomes the second factor.

## Stripe go-live checklist

1. Create monthly/yearly recurring prices in Stripe; note the price IDs.
2. `wrangler secret put STRIPE_SECRET_KEY / STRIPE_PRICE_MONTHLY / STRIPE_PRICE_YEARLY`
3. Add a webhook endpoint `https://<domain>/api/billing/webhook` for events
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`; `wrangler secret put STRIPE_WEBHOOK_SECRET`.
4. Existing dev-mode subscriptions keep working until they expire; Stripe
   checkout takes over for new subscriptions automatically.
