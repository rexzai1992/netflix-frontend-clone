# StreamFlix Content Studio

This fork is deployed as a Cloudflare Worker with:

- A responsive, API-driven movie and TV catalog
- A password-protected content studio at `/admin/`
- Cloudflare D1 for titles, descriptions, settings, collections, and ordering
- Cloudflare R2 for posters, backdrops, title logos, and videos
- Resumable multipart uploads and byte-range video playback

Production: <https://netflix-content-studio.izzulfitreee.workers.dev>

## Change content

1. Open the production `/admin/` page.
2. Sign in with the admin password.
3. Select an existing title or choose **Add title**.
4. Update the text, publishing state, homepage position, and collections.
5. Upload or replace the poster, backdrop, title logo, and video.
6. Save. Published changes appear without redeploying the website.

Use MP4 with H.264/AAC for the widest browser video compatibility. Supported
images are JPEG, PNG, WebP, and AVIF; supported videos are MP4 and WebM.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run build
npx wrangler d1 migrations apply netflix-content-studio --local
npm run dev
```

The deployable static output is generated in `dist/`. Videos are intentionally
excluded from the static bundle because they are stored in R2.

## Validation and deployment

```bash
npm run check
npm run build
npm run test:e2e
npx wrangler d1 migrations apply netflix-content-studio --remote
npx wrangler deploy
```

Production secrets are configured with:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

Never commit `.dev.vars`, passwords, API tokens, or R2 credentials. The original
sample contains third-party branding and trailers; replace them with media you
are authorized to publish before promoting the site publicly.

## Original project

<p align="center"><a href="https://github.com/nastyox/Rando.js#nastyox"><img src="http://randojs.com/images/shapeShifterGray.gif" alt="Gray shape shifter" height="60"/></a></p>
<h1 align="center">Netflix Frontend Clone</h1>
<p align="center">Video streaming website Netflix Frontend clone, Built with Pure CSS3 using Flexbox, JS dependencies: OwlCarousel and JQuery</p>

<p align="center">
	<a href="https://github.com/Rajesh-Royal/netflix-frontend-clone"><img src="https://github.com/Rajesh-Royal/netflix-frontend-clone/blob/master/images/directory%20size.png" height="30"/></a>
    <a href="https://twitter.com/intent/tweet?text=Video streaming website Netflix Frontend clone. Frontend - HTML5, CSS3, JS.&url=https://github.com/Rajesh-Royal/netflix-frontend-clone&hashtags=javascript,opensource,js,webdev,developers"><img src="http://randojs.com/images/tweetShield.svg" alt="Tweet" height="30"/></a>
</p><br/><br/>

<button> hello </button>

<p align="center"><a href="https://bit.ly/3ieQxBG"><img src="https://github.com/Rajesh-Royal/netflix-frontend-clone/blob/master/images/final%20screenshot%20readme%20preview.jpg" width="100%"/></a><a href="#nastyox"></a></p><br/>

### Demo links 🚁😊🚁

##### Login/landing page
https://netflix-frontend-clone-theta.vercel.app/

##### User Dashboard
https://netflix-frontend-clone-theta.vercel.app/user_dashboard/browse.html

## Preview screen
![img description](https://github.com/Rajesh-Royal/netflix-clone-cideigniter/blob/master/images/screenshot.jpg)


### License 

 ###### <a href="https://github.com/Rajesh-Royal/netflix-frontend-clone/blob/master/LICENSE" target="_blank">GNU GENERAL PUBLIC LICENSE</a>
 Version 3, 29 June 2007
