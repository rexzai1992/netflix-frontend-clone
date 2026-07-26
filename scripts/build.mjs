import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const root = new URL("../", import.meta.url);
const site = new URL("../src/site/", import.meta.url);
const dist = new URL("../dist/", import.meta.url);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const copy = async (from, to, options = {}) => {
  const target = new URL(to, dist);
  await mkdir(dirname(target.pathname), { recursive: true });
  await cp(new URL(from, root), target, { recursive: true, ...options });
};

// The browse shell renders every catalog view; data-view selects the page.
const shell = await readFile(new URL("catalog.html", site), "utf8");
const pages = {
  "user_dashboard/browse.html": "home",
  "user_dashboard/movies.html": "movies",
  "user_dashboard/tvshow.html": "shows",
  "user_dashboard/latest.html": "latest",
  "user_dashboard/mylist.html": "mylist",
  "user_dashboard/search.html": "search",
};

for (const [path, view] of Object.entries(pages)) {
  const target = new URL(path, dist);
  await mkdir(dirname(target.pathname), { recursive: true });
  await writeFile(target, shell.replace('data-view="home"', `data-view="${view}"`));
}

await copy("src/site/detail.html", "user_dashboard/single.html");
await copy("src/site/landing.html", "index.html");
await copy("src/site/login.html", "login.html");
await copy("src/site/signup.html", "signup.html");
await copy("src/site/account.html", "account/index.html");
await copy("src/site/admin.html", "admin/index.html");
await copy("src/site/admin.css", "admin/admin.css");
await copy("src/site/admin.js", "admin/admin.js");

// All shared styles/scripts live under /content/.
for (const entry of await readdir(site)) {
  if (entry.startsWith("admin.")) continue;
  if (entry.endsWith(".css") || entry.endsWith(".js") || entry.endsWith(".svg")) {
    await copy(`src/site/${entry}`, `content/${entry}`);
  }
}

console.log("Built deployable site in dist/");
