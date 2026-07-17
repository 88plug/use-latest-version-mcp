#!/usr/bin/env node
/**
 * index-deepwiki.mjs — trigger DeepWiki indexing for one or many public repos
 * (the page each README's "Ask DeepWiki" badge links to).
 *
 * Mechanics, reverse-engineered from deepwiki.com's frontend and verified:
 *   - Trigger:  POST https://api.devin.ai/ada/index_public_repo
 *                 ?repo_name=<owner/repo>&email_to_notify=<email>&recaptcha_token=<tok>
 *   - Status:   GET  https://api.devin.ai/ada/public_repo_indexing_status?repo_name=<o/r>
 *   - The recaptcha_token is MANDATORY server-side (no token => HTTP 400
 *     {"detail":"reCAPTCHA validation failed"}). It is reCAPTCHA **v2 invisible**
 *     (site key 6LeK1G0rAAAAAGVDKn-92dkphJzZvEobSLCyZJg4): on a TRUSTED browser
 *     it returns a token via callback with NO challenge (so this runs hands-free);
 *     on a datacenter/headless/low-reputation context it falls back to an image
 *     challenge, which this script does NOT try to solve (that would be defeating
 *     an anti-bot control). => run this on YOUR machine / real profile.
 *   - After the first index, DeepWiki re-crawls on its own; no per-commit retrigger.
 *
 * Index every marketplace repo in one trusted session (best: real Chrome profile):
 *   CHROME_USER_DATA_DIR="$HOME/.config/google-chrome" REPO=all \
 *     node scripts/index-deepwiki.mjs
 * One/some repos:
 *   REPO=88plug/use-latest-version-mcp node scripts/index-deepwiki.mjs
 *
 * Requires Playwright (not a project dependency):
 *   npm i -D playwright && npx playwright install chromium
 */

const API = 'https://api.devin.ai';
const SITEKEY = '6LeK1G0rAAAAAGVDKn-92dkphJzZvEobSLCyZJg4';
const ALL = [
  'claude-code-plugins', 'searxng-mcp', 'total-recall', 'amnesia', 'deepwiki',
  'scientific-method', 'drive-remote-terminal', 'project-prospector', 'screen-mcp',
  'recover-from-false-positive', 'caveman-plus', 'use-latest-version-mcp',
].map((r) => `88plug/${r}`);

const arg = (process.env.REPO || '88plug/use-latest-version-mcp').trim();
const REPOS = arg.toLowerCase() === 'all' ? ALL : arg.split(',').map((s) => s.trim()).filter(Boolean);
const EMAIL = process.env.EMAIL || 'notify@example.com';
const HEADLESS = process.env.HEADLESS === '1';
const USER_DATA_DIR = process.env.CHROME_USER_DATA_DIR || '';
const PER_REPO_TIMEOUT_MS = parseInt(process.env.INDEX_TIMEOUT_MS || '720000', 10);

const DONE = new Set(['indexed', 'completed', 'complete', 'ready', 'success', 'done']);
const log = (...a) => console.log('[deepwiki]', ...a);

async function statusOf(repo) {
  try {
    const r = await fetch(`${API}/ada/public_repo_indexing_status?repo_name=${encodeURIComponent(repo)}`,
      { headers: { accept: 'application/json' } });
    if (!r.ok) return `http_${r.status}`;
    return ((await r.json())?.status) || 'unknown';
  } catch (e) { return `error:${e.message}`; }
}

// Get a reCAPTCHA v2-invisible token from within the deepwiki.com page context
// (the token is domain-bound, so it must be minted on that origin). Resolves null
// if the widget challenges (low score) or times out.
async function getToken(page) {
  return page.evaluate(({ sitekey, timeoutMs }) => new Promise((resolve) => {
    const done = (v) => resolve(v || null);
    const t = setTimeout(() => done(null), timeoutMs);
    const run = () => {
      try {
        const div = document.createElement('div');
        div.style.display = 'none';
        document.body.appendChild(div);
        const id = window.grecaptcha.render(div, {
          sitekey, size: 'invisible',
          callback: (tok) => { clearTimeout(t); done(tok); },
          'error-callback': () => { clearTimeout(t); done(null); },
        });
        window.grecaptcha.execute(id);
      } catch { clearTimeout(t); done(null); }
    };
    if (window.grecaptcha && window.grecaptcha.render) {
      window.grecaptcha.ready ? window.grecaptcha.ready(run) : run();
    } else { done(null); }
  }), { sitekey: SITEKEY, timeoutMs: 25000 });
}

async function triggerOne(page, repo) {
  let s = await statusOf(repo);
  if (DONE.has(String(s).toLowerCase())) { log(`${repo}: already indexed`); return true; }

  log(`${repo}: loading deepwiki + minting invisible token…`);
  await page.goto(`https://deepwiki.com/${repo}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500); // let grecaptcha load

  const token = await getToken(page);
  if (token) {
    // POST from the page (same-origin behavior, matches the site exactly).
    const res = await page.evaluate(async ({ api, repo, email, token }) => {
      const u = `${api}/ada/index_public_repo?repo_name=${encodeURIComponent(repo)}`
        + `&email_to_notify=${encodeURIComponent(email)}&recaptcha_token=${encodeURIComponent(token)}`;
      const r = await fetch(u, { method: 'POST' });
      return { status: r.status, body: await r.text().catch(() => '') };
    }, { api: API, repo, email: EMAIL, token });
    log(`${repo}: index_public_repo -> HTTP ${res.status} ${res.body.slice(0, 120)}`);
  } else {
    // No silent token (challenged / untrusted context): fall back to the page form
    // so a human can solve the image challenge if running headful.
    log(`${repo}: no silent token (low-reputation context). Falling back to the form…`);
    const email = page.getByRole('textbox', { name: /email/i });
    if (await email.count()) await email.fill(EMAIL).catch(() => {});
    const btn = page.getByRole('button', { name: /index repository/i });
    if (await btn.count()) await btn.click().catch(() => {});
    if (!HEADLESS) log(`${repo}: solve the CAPTCHA in the window if one appears.`);
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
  catch { console.error('\nPlaywright not installed:\n  npm i -D playwright && npx playwright install chromium\n'); process.exit(2); }

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
