import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const copy = async (from, to, options = {}) => {
  const target = new URL(to, dist);
  await mkdir(dirname(target.pathname), { recursive: true });
  await cp(new URL(from, root), target, { recursive: true, ...options });
};

await copy("assets/", "assets/");
await copy("images/", "images/", {
  filter: (source) => !source.includes("/videos/"),
});

for (const page of ["login.html", "register.html", "logout.html"]) {
  await copy(page, page);
}

const shell = await readFile(new URL("../src/site/catalog.html", import.meta.url), "utf8");
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
  await writeFile(target, shell.replace("data-view=\"home\"", `data-view="${view}"`));
}

await copy("src/site/detail.html", "user_dashboard/single.html");
await copy("src/site/catalog.css", "content/catalog.css");
await copy("src/site/catalog.js", "content/catalog.js");
await copy("src/site/admin.html", "admin/index.html");
await copy("src/site/admin.css", "admin/admin.css");
await copy("src/site/admin.js", "admin/admin.js");
await copy("src/site/landing.html", "index.html");
await copy("src/site/landing.js", "content/landing.js");

console.log("Built deployable site in dist/");
