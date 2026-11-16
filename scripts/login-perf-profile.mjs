import { chromium } from 'playwright';
import path from 'node:path';
import readline from 'node:readline/promises';

const root = process.cwd();
const url = process.argv[2] ?? 'http://localhost:3100/dashboard';
const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
const email = await prompt.question('Test account email: ');
const password = await prompt.question('Test account password: ');
prompt.close();
const context = await chromium.launchPersistentContext(path.join(root, '.perf-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1366, height: 768 },
});
try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(new URL('/login', url).href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.count()) {
    await emailInput.fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
  }
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  console.log(`Saved signed-in session for ${email} in .perf-profile.`);
} finally {
  await context.close();
}
