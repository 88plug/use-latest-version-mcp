#!/usr/bin/env node
/**
 * index-deepwiki.mjs — trigger DeepWiki indexing for this repo's PUBLIC wiki
 * (the page the README's "Ask DeepWiki" badge links to).
 *
 * Why this exists / what's actually possible (researched against Cognition's API):
 *   - The PUBLIC deepwiki.com/<owner>/<repo> page is generated on demand. Its
 *     trigger (api.devin.ai/ada/...) is gated by a Google reCAPTCHA, so there is
 *     NO key-free, captcha-free HTTP endpoint to start it. The status endpoint
 *     (ada/public_repo_indexing_status) IS open and is what we poll here.
 *   - The fully-scriptable REST API
 *     (PUT /v3beta1/organizations/{org}/repositories/{path}/indexing, Bearer cog_…)
 *     indexes repos into your PRIVATE Devin org's DeepWiki — a different surface
 *     from the free public page — and needs a paid Devin service-user token.
 *
 * So for the public badge the realistic automation is a real browser:
 * reCAPTCHA v2 usually passes invisibly for a genuine browser/profile; if it
 * challenges, this script pauses (headful) for you to solve it once, then polls
 * the public status API until indexing completes.
 *
 * Usage:
 *   node scripts/index-deepwiki.mjs                 # this repo, default email
 *   REPO=owner/name EMAIL=you@x.com node scripts/index-deepwiki.mjs
 *   HEADLESS=1 node scripts/index-deepwiki.mjs      # try invisible-pass only
 *   CHROME_USER_DATA_DIR=~/.config/google-chrome node scripts/index-deepwiki.mjs
 *       ^ use your real Chrome profile (best chance reCAPTCHA passes invisibly)
 *
 * Requires Playwright (not a project dependency — install on demand):
 *   npm i -D playwright && npx playwright install chromium
 */

const REPO = process.env.REPO || '88plug/use-latest-version-mcp';
const EMAIL = process.env.EMAIL || 'andrew@88plug.com';
const HEADLESS = process.env.HEADLESS === '1';
const USER_DATA_DIR = process.env.CHROME_USER_DATA_DIR || '';
const STATUS_URL = `https://api.devin.ai/ada/public_repo_indexing_status?repo_name=${encodeURIComponent(REPO)}`;
const PAGE_URL = `https://deepwiki.com/${REPO}`;

const DONE = new Set(['indexed', 'completed', 'complete', 'ready', 'success', 'done']);

async function status() {
  try {
    const r = await fetch(STATUS_URL, { headers: { accept: 'application/json' } });
    if (!r.ok) return `http_${r.status}`;
    const j = await r.json();
    return (j && (j.status ?? j.state)) || 'unknown';
  } catch (e) {
    return `error:${e.message}`;
  }
}

const log = (...a) => console.log('[deepwiki]', ...a);

async function main() {
  log(`repo=${REPO}`);
  let s = await status();
  log(`current status: ${s}`);
  if (DONE.has(String(s).toLowerCase())) {
    log('already indexed — nothing to do.');
    return;
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error(
      '\nPlaywright is not installed. Install it (it is intentionally NOT a\n' +
        'dependency of this package):\n\n' +
        '  npm i -D playwright && npx playwright install chromium\n'
    );
    process.exit(2);
  }

  const launchOpts = { headless: HEADLESS, channel: 'chrome' };
  let ctx, page;
  try {
    if (USER_DATA_DIR) {
      ctx = await chromium.launchPersistentContext(USER_DATA_DIR, launchOpts);
      page = ctx.pages()[0] || (await ctx.newPage());
    } else {
      const browser = await chromium.launch(launchOpts).catch(() => chromium.launch({ headless: HEADLESS }));
      ctx = await browser.newContext();
      page = await ctx.newPage();
    }
  } catch (e) {
    console.error('Could not launch Chrome/Chromium:', e.message);
    process.exit(2);
  }

  log(`opening ${PAGE_URL}`);
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });

  // Fill the notify email and submit the index request.
  const email = page.getByRole('textbox', { name: /email/i });
  await email.waitFor({ timeout: 30000 }).catch(() => {});
  if (await email.count()) {
    await email.fill(EMAIL);
    log(`filled email: ${EMAIL}`);
  }
  const btn = page.getByRole('button', { name: /index repository/i });
  if (await btn.count()) {
    await btn.click().catch(() => {});
    log('clicked "Index Repository".');
  } else {
    log('no Index button found — the page may already be indexing.');
  }

  // If a reCAPTCHA challenge is showing, the human must solve it (headful).
  const captcha = page.frameLocator('iframe[title*="recaptcha" i], iframe[src*="recaptcha"]');
  const challengeVisible = await captcha.locator('table, .rc-imageselect').first().isVisible().catch(() => false);
  if (challengeVisible || !HEADLESS) {
    log('If a CAPTCHA is shown in the browser window, solve it now. Waiting for indexing to start…');
  }
  if (HEADLESS && challengeVisible) {
    log('reCAPTCHA challenged in headless mode — rerun without HEADLESS=1 (a real/profile browser) to solve it once.');
  }

  // Poll the public status API until indexing reaches a terminal state.
  const deadline = Date.now() + 12 * 60 * 1000; // 12 min
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15000));
    s = await status();
    log(`status: ${s}`);
    if (DONE.has(String(s).toLowerCase())) {
      log(`✅ indexed — https://deepwiki.com/${REPO}`);
      await ctx.close().catch(() => {});
      return;
    }
  }
  log('timed out waiting for indexing to complete. Check https://deepwiki.com/' + REPO);
  await ctx.close().catch(() => {});
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
