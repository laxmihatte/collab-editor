import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';

/**
 * Records the two-browser demo used in the README.
 *
 * Two independent browser contexts sign in as different people and open the
 * same note. Playwright records each context to its own video; ffmpeg stacks
 * them side by side afterwards. That is the only way to show collaboration
 * honestly — one recording of one browser cannot prove anything synced.
 */

const BASE = process.env.BASE || 'https://localhost';
const OUT = process.env.OUT || './recordings';
const W = 1100;
const H = 760;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

async function signIn(email, name, dir) {
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    // Caddy is using its local CA here; in production this is a real cert.
    ignoreHTTPSErrors: true,
    recordVideo: { dir, size: { width: W, height: H } },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] PAGE ERROR:`, e.message));
  page.on('console', (m) => m.type() === 'error' && console.log(`[${name}] CONSOLE:`, m.text()));

  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'demo-password');
  await page.click('button[type=submit]');
  await page.waitForURL('**/notes', { timeout: 20000 });
  return { context, page };
}

const ada = await signIn('demo@notecraft.dev', 'ada', `${OUT}/left`);
const sam = await signIn('classmate@notecraft.dev', 'sam', `${OUT}/right`);

// Both open the same note.
for (const who of [ada, sam]) {
  await who.page.click('text=Dijkstra');
  await who.page.waitForTimeout(1200);
}
await ada.page.waitForTimeout(2000);

// Ada types at the end of the note; Sam is watching the preview.
const editor = ada.page.locator('.cm-content');
await editor.click();
await ada.page.keyboard.press('Control+End');
await ada.page.keyboard.press('End');

const lines = [
  '',
  '## Worked example',
  '',
  'Shortest path from A: run it and see.',
  '',
];
for (const line of lines) {
  await ada.page.keyboard.type(line, { delay: 28 });
  await ada.page.keyboard.press('Enter');
}
await ada.page.waitForTimeout(1500);

// Sam reacts — viewers and editors can both react.
await sam.page.click('button[title="Add a reaction"] >> nth=0').catch(() => {});
await sam.page.waitForTimeout(1200);

// Sam runs the code block from the note.
await sam.page.click('text=Run code');
await sam.page.waitForTimeout(900);
await sam.page.click('button:has-text("Run Python")');
await sam.page.waitForTimeout(4000);

// Ada scrolls the preview to show the rendered result.
await ada.page.mouse.move(800, 400);
await ada.page.mouse.wheel(0, 400);
await ada.page.waitForTimeout(2500);

await ada.context.close();
await sam.context.close();
await browser.close();
console.log('recorded to', OUT);
