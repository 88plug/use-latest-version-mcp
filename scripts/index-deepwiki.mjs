#!/usr/bin/env node
/**
 * index-deepwiki.mjs — trigger DeepWiki indexing for one or many public repos
 * (the page each README's "Ask DeepWiki" badge links to).
 *
 * The honest mechanics (verified against Cognition's API):
 *   - The PUBLIC deepwiki.com/<owner>/<repo> page is generated on demand and its
 *     trigger is gated by reCAPTCHA v2 — there is NO key-free HTTP endpoint and no
 *     public tool that bypasses it. Only the read endpoints are open:
 *       GET https://api.devin.ai/ada/public_repo_indexing_status?repo_name=o/r
 *       GET https://api.devin.ai/ada/list_public_indexes?search_repo=o/r
 *   - reCAPTCHA v2 passes INVISIBLY for a genuine, trusted browser (your real
 *     Chrome profile + residential IP). So run this ON YOUR MACHINE: it clicks
 *     "Index Repository" and the captcha typically never challenges → hands-free.
 *     From a datacenter/CI IP it WILL challenge (by design) — can't be automated
 *     there without a captcha-solving service, which this intentionally does not do.
 *   - After the first index, DeepWiki re-crawls on its own; no per-commit retrigger.
 *
 * Run all marketplace repos in one trusted session (best: your real profile):
 *   CHROME_USER_DATA_DIR="$HOME/.config/google-chrome" REPO=all \
 *     node scripts/index-deepwiki.mjs
 * Or one/some repos:
 *   REPO=88plug/use-latest-version-mcp node scripts/index-deepwiki.mjs
 *   REPO=88plug/amnesia,88plug/searxng-mcp node scripts/index-deepwiki.mjs
 *
 * Requires Playwright (not a project dependency — install on demand):
 *   npm i -D playwright && npx playwright install chromium
 */

const ALL = [
  'claude-code-plugins', 'searxng-mcp', 'total-recall', 'amnesia', 'deepwiki',
  'scientific-method', 'drive-remote-terminal', 'project-prospector', 'screen-mcp',
  'recover-from-false-positive', 'caveman-plus', 'use-latest-version-mcp',
].map((r) => `88plug/${r}`);

const arg = (process.env.REPO || '88plug/use-latest-version-mcp').trim();
const REPOS = arg.toLowerCase() === 'all' ? ALL : arg.split(',').map((s) => s.trim()).filter(Boolean);
const EMAIL = process.env.EMAIL || 'andrew@88plug.com';
const HEADLESS = process.env.HEADLESS === '1';
const USER_DATA_DIR = process.env.CHROME_USER_DATA_DIR || '';
const PER_REPO_TIMEOUT_MS = parseInt(process.env.INDEX_TIMEOUT_MS || '720000', 10); // 12 min

const DONE = new Set(['indexed', 'completed', 'complete', 'ready', 'success', 'done']);
const log = (...a) => console.log('[deepwiki]', ...a);

async function statusOf(repo) {
  try {
    const r = await fetch(`https://api.devin.ai/ada/public_repo_indexing_status?repo_name=${encodeURIComponent(repo)}`,
      { headers: { accept: 'application/json' } });
    if (!r.ok) return `http_${r.status}`;
    const j = await r.json();
    return (j && (j.status ?? j.state)) || 'unknown';
  } catch (e) {
    return `error:${e.message}`;
  }
}

async function triggerOne(page, repo) {
  let s = await statusOf(repo);
  if (DONE.has(String(s).toLowerCase())) { log(`${repo}: already indexed`); return true; }

  log(`${repo}: opening deepwiki…`);
  await page.goto(`https://deepwiki.com/${repo}`, { waitUntil: 'domcontentloaded' });

  const email = page.getByRole('textbox', { name: /email/i });
  await email.waitFor({ timeout: 20000 }).catch(() => {});
  if (await email.count()) { await email.fill(EMAIL); }
  const btn = page.getByRole('button', { name: /index repository/i });
  if (await btn.count()) { await btn.click().catch(() => {}); log(`${repo}: clicked Index Repository`); }
  else { log(`${repo}: no Index button (already indexing?)`); }

  // Detect a visible captcha challenge (means this browser/IP is not trusted).
  const captcha = page.frameLocator('iframe[src*="recaptcha"]');
  const challenged = await captcha.locator('.rc-imageselect, table').first().isVisible().catch(() => false);
  if (challenged) {
    if (HEADLESS) { log(`${repo}: reCAPTCHA challenged in headless mode — rerun on your real browser/profile.`); return false; }
    log(`${repo}: solve the CAPTCHA shown in the window to start indexing…`);
  }

  const deadline = Date.now() + PER_REPO_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15000));
    s = await statusOf(repo);
    log(`${repo}: status=${s}`);
    if (DONE.has(String(s).toLowerCase())) { log(`${repo}: ✅ indexed`); return true; }
  }
  log(`${repo}: ⏱ timed out (check https://deepwiki.com/${repo})`);
  return false;
}

async function main() {
  log(`repos: ${REPOS.join(', ')}`);
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch {
    console.error('\nPlaywright not installed:\n  npm i -D playwright && npx playwright install chromium\n');
    process.exit(2);
  }

  const opts = { headless: HEADLESS, channel: 'chrome' };
  let ctx, page;
  if (USER_DATA_DIR) {
    ctx = await chromium.launchPersistentContext(USER_DATA_DIR, opts);
    page = ctx.pages()[0] || (await ctx.newPage());
  } else {
    const browser = await chromium.launch(opts).catch(() => chromium.launch({ headless: HEADLESS }));
    ctx = await browser.newContext();
    page = await ctx.newPage();
  }

  const results = {};
  for (const repo of REPOS) {
    try { results[repo] = await triggerOne(page, repo); }
    catch (e) { log(`${repo}: error ${e.message}`); results[repo] = false; }
  }
  await ctx.close().catch(() => {});

  const ok = Object.values(results).filter(Boolean).length;
  log(`\nDONE: ${ok}/${REPOS.length} indexed/confirmed.`);
  for (const [r, v] of Object.entries(results)) log(`  ${v ? '✅' : '❌'} ${r}`);
  process.exit(ok === REPOS.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
