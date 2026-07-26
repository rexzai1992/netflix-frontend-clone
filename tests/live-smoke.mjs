import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.STUDIO_BASE_URL || "https://streamflix.izzulfitreee.workers.dev";
const adminPassword = process.env.STUDIO_ADMIN_PASSWORD;
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    const expected =
      (path === "/api/admin/session" && response.status() === 401) ||
      (path === "/api/auth/session" && response.status() === 401) ||
      (path === "/favicon.ico" && response.status() === 404) ||
      // Video streaming is subscriber-only; anonymous 403s are correct.
      (path.startsWith("/media/") && response.status() === 403);
    if (response.status() >= 400 && !expected) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });

  // Landing page
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  const landingHtml = await page.content();
  assert.doesNotMatch(landingHtml, /netflix/i, "landing page must not mention Netflix");

  // Catalog
  await page.goto(`${baseUrl}/user_dashboard/browse.html`, { waitUntil: "networkidle" });
  await page.locator(".content-card").first().waitFor();
  assert.ok((await page.locator(".content-card").count()) > 5, "expected at least 6 cards");
  assert.match(await page.locator("#hero-title").textContent(), /Our Golden Night/);
  await page.screenshot({ path: "/tmp/streamflix-public.png", fullPage: true });

  // Admin studio
  await page.goto(`${baseUrl}/admin/`, { waitUntil: "networkidle" });
  if (adminPassword) {
    const loginResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/login") && response.request().method() === "POST",
    );
    await page.locator('input[name="password"]').fill(adminPassword);
    await page.locator("#login-form").getByRole("button", { name: /sign in/i }).click();
    const response = await loginResponse;
    assert.equal(response.status(), 200, await response.text());
    await page.locator(".library-card").first().waitFor({ timeout: 10_000 });
    assert.ok((await page.locator(".library-card").count()) >= 6, "expected a populated library");
    await page.screenshot({ path: "/tmp/streamflix-admin.png", fullPage: true });
  }

  assert.deepEqual(errors, []);
  console.log(`Live browser smoke passed at ${baseUrl}`);
} finally {
  await browser.close();
}
