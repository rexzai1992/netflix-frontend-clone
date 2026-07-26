import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl =
  process.env.STUDIO_BASE_URL ||
  "https://netflix-content-studio.izzulfitreee.workers.dev";
const adminPassword = process.env.STUDIO_ADMIN_PASSWORD;
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource")
    ) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const expectedLoggedOutCheck =
      response.url().endsWith("/api/admin/session") && response.status() === 401;
    const expectedFavicon =
      new URL(response.url()).pathname === "/favicon.ico" && response.status() === 404;
    if (response.status() >= 400 && !expectedLoggedOutCheck && !expectedFavicon) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto(`${baseUrl}/user_dashboard/browse.html`, {
    waitUntil: "networkidle",
  });
  await page.locator(".content-card").first().waitFor();
  assert.equal(await page.locator(".content-card").count() > 5, true);
  assert.match(await page.locator("#hero-title").textContent(), /Our Golden Night/);
  await page.screenshot({ path: "/tmp/streamflix-public.png", fullPage: true });

  await page.goto(`${baseUrl}/admin/`, { waitUntil: "networkidle" });
  if (adminPassword) {
    const loginResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/login") &&
        response.request().method() === "POST",
    );
    await page.locator('input[name="password"]').fill(adminPassword);
    await page.locator("#login-form").getByRole("button", { name: "Sign in" }).click();
    const response = await loginResponse;
    assert.equal(response.status(), 200, await response.text());
    try {
      await page.locator(".library-card").first().waitFor({ timeout: 10_000 });
    } catch (error) {
      const diagnostics = {
        loginMessage: await page.locator("#login-message").textContent(),
        loginHidden: await page.locator("#login-screen").getAttribute("hidden"),
        studioHidden: await page.locator("#studio").getAttribute("hidden"),
        cookies: (await page.context().cookies()).map(({ name, domain }) => ({ name, domain })),
        errors,
      };
      await page.screenshot({ path: "/tmp/streamflix-admin-debug.png", fullPage: true });
      throw new Error(`Admin library did not load: ${JSON.stringify(diagnostics)}`, {
        cause: error,
      });
    }
    assert.equal(await page.locator(".library-card").count(), 8);
  }
  await page.screenshot({ path: "/tmp/streamflix-admin.png", fullPage: true });

  assert.deepEqual(errors, []);
  console.log(`Live browser smoke passed at ${baseUrl}`);
} finally {
  await browser.close();
}
