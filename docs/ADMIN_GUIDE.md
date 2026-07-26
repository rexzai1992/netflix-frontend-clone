# StreamFlix admin guide

Sign in at `/admin/` with the admin password. Sessions last 12 hours.

## Titles (Library)

- **Add title** creates a movie or show. The id is derived from the title.
- Fields: title, type, year, maturity rating, duration text, match score,
  description, published state, and collection membership.
- **Homepage hero**: exactly one title is featured at a time — setting a title
  as hero automatically un-features the previous one.
- Media slots: poster (2:3), backdrop (16:9), title logo, video (MP4 H.264/AAC
  recommended), captions (WebVTT). Each slot supports upload, replace, and
  remove. Uploads show progress and can be cancelled or retried; images can be
  cropped to the right aspect before publishing.
- Deleting a title does not delete its files — use the Media panel's cleanup.

## Collections

- Create, rename, publish/unpublish, delete, and reorder collections — the
  order here is the order of rows on the homepage.
- Open a collection to reorder its titles or add/remove titles; this is how a
  title moves between homepage sections.

## Site

- Site name, hero kicker, landing title/subtitle, SEO description.
- Landing backdrop image and social-share image uploads.
- Changes appear on the public site immediately (within the 30s API cache).

## Media

- Lists every file in storage with size and an **In use / Unused** badge.
- Delete individual unused files, or **Clean up unused uploads** to remove all
  admin-uploaded files that no title or setting references.
- **Abort stale uploads** discards multipart uploads that never finished.

## Activity

Audit log of every admin action (and viewer signups/billing events): who, what,
when. Use it to trace unexpected content changes.

## Security

- Change the admin password here (minimum 12 characters). Changing it signs
  out every other admin session.
- Viewer passwords are never visible; viewers change their own on /account/.

## Billing modes

- Without Stripe secrets configured, the site runs **demo billing**: viewers
  "subscribe" through a clearly-labelled demo checkout with no real payment.
- With Stripe configured (see docs/OPERATIONS.md), real checkout and webhooks
  take over automatically.
