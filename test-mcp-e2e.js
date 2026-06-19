#!/usr/bin/env node
/**
 * Live end-to-end eval harness for the use-latest-version MCP server.
 * Drives createMcpServer() over the in-memory transport (exactly how a real MCP
 * client would) and exercises every tool against real registries and real
 * project writes. Network failures are reported as WARN (non-fatal); only
 * genuine tool defects count as FAIL. Throwaway — not committed.
 */
import { createMcpServer } from './build/server-factory.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let pass = 0, fail = 0, warn = 0;
const failures = [], warnings = [];
const ok = (n) => { console.log(`✅ ${n}`); pass++; };
const bad = (n, m) => { console.log(`❌ ${n}\n     ${m}`); fail++; failures.push(`${n} :: ${m}`); };
const flaky = (n, m) => { console.log(`⚠️  ${n} (network/non-deterministic)\n     ${String(m).slice(0,160)}`); warn++; warnings.push(`${n} :: ${m}`); };

const NET = /timed out|ETIMEDOUT|ENOTFOUND|ECONNRESET|EAI_AGAIN|fetch failed|socket|network|Circuit breaker is OPEN|aborted|503|502|429/i;
const looksVersion = (v) => typeof v === 'string' && (/^v?\d+(\.\d+)*([.-].+)?$/.test(v) || v === 'latest');

async function call(client, name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? '';
  let json = null; try { json = JSON.parse(text); } catch {}
  return { res, text, json, isError: res.isError === true };
}

// validate(r) returns true=pass, {flaky,msg} or {msg} otherwise.
async function check(client, label, name, args, validate) {
  try {
    const r = await call(client, name, args);
    if (r.isError && NET.test(String(r.json?.error || r.text))) return flaky(label, r.json?.error || r.text);
    const v = validate(r);
    if (v === true) ok(label);
    else if (v && v.flaky) flaky(label, v.msg);
    else bad(label, (v && v.msg) || `unexpected: ${r.text?.slice(0,200)}`);
  } catch (e) {
    if (NET.test(String(e.message))) flaky(label, e.message);
    else bad(label, e.message);
  }
}

async function expectError(client, label, name, args, re) {
  try {
    const r = await call(client, name, args);
    const msg = String(r.json?.error || r.text);
    if (NET.test(msg)) return flaky(label, msg);
    if (r.isError && (!re || re.test(msg))) return ok(label);
    if (r.isError) return bad(label, `errored but message unexpected: ${msg.slice(0,150)}`);
    return bad(label, `expected an error, got: ${r.text?.slice(0,150)}`);
  } catch (e) {
    // A throw at the protocol layer (e.g. schema validation) is still a graceful rejection.
    if (NET.test(e.message)) return flaky(label, e.message);
    return ok(label);
  }
}

const server = createMcpServer();
const [ct, st] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'eval', version: '1.0.0' }, { capabilities: {} });
await server.connect(st);
await client.connect(ct);

console.log('=== A. Version lookups across ecosystems (live) ===');
const REG = [
  ['npm', 'express'], ['npm', '@types/node'], ['pypi', 'requests'], ['crates', 'serde'],
  ['rubygems', 'rails'], ['go', 'github.com/gorilla/mux'], ['nuget', 'Newtonsoft.Json'],
  ['packagist', 'laravel/framework'], ['maven', 'com.google.guava:guava'], ['hex', 'phoenix'],
  ['github', 'facebook/react'], ['pub.dev', 'http'],
];
for (const [registry, pkg] of REG) {
  await check(client, `get_latest_version ${registry}/${pkg}`, 'get_latest_version', { package_name: pkg, registry },
    (r) => r.json && looksVersion(r.json.latestVersion) ? true : { msg: `bad version: ${r.text?.slice(0,140)}` });
}

console.log('\n=== B. info / compare / install / batch (live) ===');
await check(client, 'get_package_info npm/express', 'get_package_info', { package_name: 'express', registry: 'npm' },
  (r) => r.json && looksVersion(r.json.latestVersion) && r.json.registry === 'npm' ? true : { msg: r.text?.slice(0,140) });
await check(client, 'compare_versions express 4.0.0 < latest', 'compare_versions', { package_name: 'express', current_version: '4.0.0', registry: 'npm' },
  (r) => r.json && r.json.status === 'update-available' && r.json.needsUpdate === true ? true : { msg: JSON.stringify(r.json) });
await check(client, 'compare_versions absurd-high ahead', 'compare_versions', { package_name: 'express', current_version: '999.0.0', registry: 'npm' },
  (r) => r.json && r.json.status === 'ahead-of-latest' ? true : { msg: JSON.stringify(r.json) });
await check(client, 'get_install_command pypi', 'get_install_command', { package_name: 'requests', registry: 'pypi' },
  (r) => r.json && /pip install requests==/.test(r.json.installCommand || '') ? true : { msg: r.text?.slice(0,160) });
await check(client, 'get_install_command npm -D', 'get_install_command', { package_name: 'typescript', registry: 'npm', dev: true },
  (r) => r.json && /npm install -D typescript@/.test(r.json.installCommand || '') ? true : { msg: r.text?.slice(0,160) });
await check(client, 'check_multiple_packages mixed ok+error', 'check_multiple_packages',
  { packages: [{ package_name: 'express', registry: 'npm' }, { package_name: 'zzz-not-a-real-pkg-9183', registry: 'npm' }] },
  (r) => {
    if (!Array.isArray(r.json)) return { msg: 'not an array' };
    const good = r.json.find((x) => x.package === 'express');
    const err = r.json.find((x) => x.status === 'error');
    if (!good?.latestVersion && NET.test(JSON.stringify(r.json))) return { flaky: true, msg: 'network' };
    return good?.latestVersion && err ? true : { msg: JSON.stringify(r.json).slice(0,200) };
  });

console.log('\n=== C. compatibility / conflicts / find / upgrade-path ===');
await check(client, 'check_compatibility partial (no net)', 'check_compatibility',
  { package_name: 'x', version: '1.5.0', dependencies: [{ name: 'a', constraint: '^1.0.0' }, { name: 'b', constraint: '>=2.0.0' }] },
  (r) => r.json && r.json.compatible === false && r.json.dependencies?.length === 2 && r.json.dependencies[0].compatible === true && r.json.dependencies[1].compatible === false ? true : { msg: JSON.stringify(r.json) });
await check(client, 'detect_conflicts lodash (no net)', 'detect_conflicts',
  { dependencies: [{ name: 'lodash', constraint: '4.17.0' }, { name: 'lodash', constraint: '3.10.0' }] },
  (r) => r.json && r.json.hasConflicts === true ? true : { msg: JSON.stringify(r.json) });
await check(client, 'detect_conflicts none', 'detect_conflicts',
  { dependencies: [{ name: 'lodash', constraint: '4.17.0' }, { name: 'react', constraint: '18.0.0' }] },
  (r) => r.json && r.json.hasConflicts === false ? true : { msg: JSON.stringify(r.json) });
await check(client, 'find_compatible_version express ^4.17.0 (live)', 'find_compatible_version',
  { package_name: 'express', registry: 'npm', constraints: [{ name: 'express', constraint: '^4.17.0' }] },
  (r) => r.json && r.json.compatible === true && /^4\./.test(r.json.compatibleVersion || '') ? true : { msg: JSON.stringify(r.json).slice(0,200) });
await check(client, 'suggest_upgrade_path express 3.0.0->latest (live)', 'suggest_upgrade_path',
  { package_name: 'express', registry: 'npm', current_version: '3.0.0' },
  (r) => r.json && Array.isArray(r.json.upgradePath?.steps) && r.json.upgradePath.steps.length >= 1 && r.json.risk === 'high' ? true : { msg: JSON.stringify(r.json).slice(0,200) });

console.log('\n=== D. Adversarial / graceful errors ===');
await expectError(client, 'get_latest_version nonexistent → error', 'get_latest_version', { package_name: 'zzz-nope-9999-not-real-pkg', registry: 'npm' }, /not found/i);
await expectError(client, 'unsupported registry → error', 'get_latest_version', { package_name: 'x', registry: 'totally-bogus-registry' }, /Unsupported registry|enum|invalid/i);
await expectError(client, 'maven bad coords → error', 'get_latest_version', { package_name: 'guava', registry: 'maven' }, /groupId:artifactId/i);
await expectError(client, 'unknown tool name → error', 'this_tool_does_not_exist', {}, /Unknown tool|not found|Method/i);

console.log('\n=== E. Full project flow (scan → outdated → resolve → optimize → validate → apply real write) ===');
const proj = mkdtempSync(join(tmpdir(), 'ulv-e2e-'));
try {
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'root', dependencies: { express: '4.17.0', lodash: '4.17.20' } }, null, 2));
  mkdirSync(join(proj, 'packages', 'a'), { recursive: true });
  writeFileSync(join(proj, 'packages', 'a', 'package.json'), JSON.stringify({ name: 'a', dependencies: { lodash: '3.10.1' } }, null, 2));
  writeFileSync(join(proj, 'requirements.txt'), 'requests==2.20.0\n');

  await check(client, 'scan_project finds multi-ecosystem deps', 'scan_project', { project_path: proj },
    (r) => {
      if (!r.json?.dependencies) return { msg: r.text?.slice(0,160) };
      const names = r.json.dependencies.map((d) => d.name);
      return names.includes('express') && names.includes('requests') && r.json.dependencies.some((d) => d.registry === 'pypi') ? true : { msg: `deps: ${names.join(',')}` };
    });

  await check(client, 'check_outdated flags old express+requests (live)', 'check_outdated', { project_path: proj },
    (r) => {
      if (!r.json?.outdatedPackages) return { msg: r.text?.slice(0,160) };
      const out = r.json.outdatedPackages.map((p) => p.name);
      if (r.json.errors?.some((e) => NET.test(e))) return { flaky: true, msg: r.json.errors.join('; ').slice(0,160) };
      return out.includes('express') ? true : { msg: `outdated: ${out.join(',')} | errs: ${(r.json.errors||[]).join(';').slice(0,120)}` };
    });

  await check(client, 'resolve_conflicts finds lodash conflict (live)', 'resolve_conflicts', { project_path: proj },
    (r) => {
      if (!r.json?.conflicts) return { msg: r.text?.slice(0,160) };
      const c = r.json.conflicts.find((x) => x.package === 'lodash');
      if (!c && r.json.warnings?.some((w) => NET.test(w))) return { flaky: true, msg: r.json.warnings.join(';').slice(0,140) };
      return c && c.currentVersions.length >= 2 ? true : { msg: `conflicts: ${JSON.stringify(r.json.conflicts).slice(0,200)}` };
    });

  let optPlan = null;
  await check(client, 'optimize_versions returns a plan (live)', 'optimize_versions', { project_path: proj, include_lock_files: false },
    (r) => {
      if (!r.json?.plan) return { msg: r.text?.slice(0,160) };
      optPlan = r.json.plan;
      const ex = r.json.plan.find((p) => p.package === 'express');
      if (!ex && r.json.warnings?.some((w) => NET.test(w))) return { flaky: true, msg: 'net' };
      return r.json.plan.length >= 1 ? true : { msg: `empty plan; warns: ${(r.json.warnings||[]).join(';').slice(0,120)}` };
    });

  await check(client, 'validate_upgrade_plan on a minor-bump plan', 'validate_upgrade_plan',
    { project_path: proj, plan: [{ package: 'express', registry: 'npm', currentVersion: '4.17.0', suggestedVersion: '4.18.0', action: 'upgrade', reason: 'eval', risk: 'low', affectedFiles: ['package.json'] }] },
    (r) => r.json && r.json.valid === true && r.json.canApply === true && r.json.breakingChanges.length === 0 ? true : { msg: JSON.stringify(r.json).slice(0,200) });

  // optimize -> apply (dry-run) round trip: exercises affectedFiles normalization on a real plan.
  if (optPlan && optPlan.length) {
    await check(client, 'apply_upgrades dry-run of the real optimize plan (path normalization)', 'apply_upgrades',
      { project_path: proj, plan: optPlan, dry_run: true },
      (r) => r.json && r.json.dryRun === true && (r.json.errors?.length ?? 0) === 0 ? true : { msg: `errors: ${JSON.stringify(r.json?.errors)}` });
  } else {
    flaky('apply_upgrades dry-run of the real optimize plan', 'no plan from optimize (network) — skipped');
  }

  // Real write: deterministic, no network.
  await check(client, 'apply_upgrades REAL write bumps express in package.json', 'apply_upgrades',
    { project_path: proj, dry_run: false, plan: [{ package: 'express', registry: 'npm', currentVersion: '4.17.0', suggestedVersion: '4.18.2', action: 'upgrade', reason: 'eval', risk: 'low', affectedFiles: ['package.json'] }] },
    (r) => {
      if (!r.json) return { msg: r.text?.slice(0,160) };
      const disk = JSON.parse(readFileSync(join(proj, 'package.json'), 'utf-8'));
      const backups = existsSync(join(proj, '.dependency-backups')) ? readdirSync(join(proj, '.dependency-backups')) : [];
      if (r.json.summary.packagesUpgraded !== 1) return { msg: `packagesUpgraded=${r.json.summary.packagesUpgraded}` };
      if (disk.dependencies.express !== '4.18.2') return { msg: `disk express=${disk.dependencies.express}` };
      if (backups.length < 1) return { msg: 'no backup file created' };
      return true;
    });

  // Real write to requirements.txt (txt writer path).
  await check(client, 'apply_upgrades REAL write bumps requests in requirements.txt', 'apply_upgrades',
    { project_path: proj, dry_run: false, plan: [{ package: 'requests', registry: 'pypi', currentVersion: '2.20.0', suggestedVersion: '2.31.0', action: 'upgrade', reason: 'eval', risk: 'low', affectedFiles: ['requirements.txt'] }] },
    (r) => {
      if (!r.json) return { msg: r.text?.slice(0,160) };
      const txt = readFileSync(join(proj, 'requirements.txt'), 'utf-8');
      return /requests==2\.31\.0/.test(txt) ? true : { msg: `requirements.txt now: ${txt.trim()}` };
    });

  // Remove action.
  await check(client, 'apply_upgrades REAL remove drops lodash from root package.json', 'apply_upgrades',
    { project_path: proj, dry_run: false, plan: [{ package: 'lodash', registry: 'npm', currentVersion: '4.17.20', suggestedVersion: 'removed', action: 'remove', reason: 'eval', risk: 'low', affectedFiles: ['package.json'] }] },
    (r) => {
      if (!r.json) return { msg: r.text?.slice(0,160) };
      const disk = JSON.parse(readFileSync(join(proj, 'package.json'), 'utf-8'));
      return !('lodash' in disk.dependencies) && r.json.summary.packagesRemoved === 1 ? true : { msg: `deps now: ${JSON.stringify(disk.dependencies)}, removed=${r.json.summary.packagesRemoved}` };
    });

  // apply to a nonexistent file → graceful error, not crash.
  await check(client, 'apply_upgrades missing file surfaces error (no crash)', 'apply_upgrades',
    { project_path: proj, dry_run: false, plan: [{ package: 'x', registry: 'npm', currentVersion: '1.0.0', suggestedVersion: '2.0.0', action: 'upgrade', reason: 'eval', risk: 'low', affectedFiles: ['does/not/exist.json'] }] },
    (r) => r.json && (r.json.errors?.length ?? 0) >= 1 && r.json.summary.packagesUpgraded === 0 ? true : { msg: JSON.stringify(r.json?.summary) });

} finally {
  rmSync(proj, { recursive: true, force: true });
}

console.log('\n=== F. Bad-input robustness ===');
// scan_project reports a bad path in-band (errors[]), not as a tool error — by design.
await check(client, 'scan_project missing path reports in-band error (no throw)', 'scan_project', { project_path: '/no/such/path/xyz-eval' },
  (r) => r.json && r.isError !== true && Array.isArray(r.json.errors) && r.json.errors.some((e) => /does not exist|not a directory/i.test(e)) ? true : { msg: JSON.stringify(r.json?.errors).slice(0,160) });
await check(client, 'validate_upgrade_plan empty plan is valid', 'validate_upgrade_plan', { project_path: tmpdir(), plan: [] },
  (r) => r.json && r.json.valid === true && r.json.totalPackages === 0 ? true : { msg: JSON.stringify(r.json).slice(0,160) });

console.log('\n========================================');
console.log(`PASS: ${pass}   FAIL: ${fail}   WARN(network): ${warn}`);
if (failures.length) { console.log('\nFAILURES:'); failures.forEach((f) => console.log(' - ' + f)); }
if (warnings.length) { console.log('\nWARNINGS (network/non-deterministic, non-fatal):'); warnings.forEach((w) => console.log(' - ' + w)); }
console.log('========================================');

await client.close();
await server.close();
process.exit(fail > 0 ? 1 : 0);
