#!/usr/bin/env node

/**
 * Node-runnable tests for the upgrade write-path correctness fixes
 * (upgrade-applier + upgrade-validator). The repo's existing *.test.js files for
 * these modules are Bun-only; these run under plain node.
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { applyUpgrades, applySingleUpgrade } from './build/upgrade-applier.js';
import { UpgradeValidator } from './build/upgrade-validator.js';
import { optimizeVersions } from './build/global-version-optimizer.js';
import { readFileSync } from 'fs';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

const TEST_DIR = join(process.cwd(), 'test-temp-write-path');
function setup() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(
    join(TEST_DIR, 'package.json'),
    JSON.stringify({ name: 'root', dependencies: { 'left-pad': '^1.0.0' } }, null, 2)
  );
}

console.log('=== Upgrade Write-Path Tests ===\n');
setup();

await test('applyUpgrades counts kept packages (UA-2)', async () => {
  const plan = [
    {
      package: 'left-pad',
      registry: 'npm',
      currentVersion: '1.0.0',
      suggestedVersion: '1.0.0',
      action: 'keep',
      reason: 'already current',
      risk: 'low',
      affectedFiles: [join(TEST_DIR, 'package.json')],
    },
  ];
  const result = await applyUpgrades(TEST_DIR, plan, { dryRun: true, createBackup: false });
  assert(result.summary.packagesKept === 1, `packagesKept should be 1, was ${result.summary.packagesKept}`);
});

await test('applySingleUpgrade returns the real apply result, not a canned one (UA-3)', async () => {
  // affectedFiles are resolved relative to projectPath.
  const result = await applySingleUpgrade(TEST_DIR, 'package.json', 'left-pad', '1.3.0', {
    dryRun: true,
    createBackup: false,
  });
  // The old canned result always claimed totalChanges:1 with empty diffs; the
  // real result computes an actual diff for the modified file.
  assert(result.dryRun === true, 'dryRun should be reflected as true');
  assert(result.summary.totalChanges === 1, `should report the real change count, got ${result.summary.totalChanges}`);
  assert(result.diffs.length === 1, `a real dry-run should produce one file diff, got ${result.diffs.length}`);
  assert(result.errors.length === 0, 'no errors on a resolvable file');
  // File must NOT have been written (dry run).
  const content = (await import('fs')).readFileSync(join(TEST_DIR, 'package.json'), 'utf8');
  assert(content.includes('^1.0.0'), 'dry run must not modify the file on disk');
});

await test('applySingleUpgrade surfaces real failures instead of fake success (UA-3)', async () => {
  // A path the applier cannot resolve previously returned a canned success;
  // the real result must report the error.
  const result = await applySingleUpgrade(TEST_DIR, 'does-not-exist/package.json', 'left-pad', '1.3.0', {
    dryRun: true,
    createBackup: false,
  });
  assert(result.errors.length > 0, 'a missing file must produce an error, not a fabricated success');
  assert(result.summary.packagesUpgraded === 0, 'must not claim a package was upgraded when it failed');
});

await test('applier routes requirements.txt by extension, not content (UA-4)', async () => {
  // Contains '[' / ']' (extras) which content-sniffing wrongly read as TOML.
  writeFileSync(
    join(TEST_DIR, 'requirements.txt'),
    'requests[security]==2.28.0\nflask==2.0.0\n'
  );
  const result = await applySingleUpgrade(TEST_DIR, 'requirements.txt', 'flask', '3.0.0', {
    dryRun: true,
    createBackup: false,
  });
  // Correct txt routing yields exactly one change; TOML routing would yield zero.
  assert(result.errors.length === 0, `no errors, got ${JSON.stringify(result.errors)}`);
  assert(result.summary.totalChanges === 1, `expected 1 change via txt routing, got ${result.summary.totalChanges}`);
});

await test('UpgradeValidator does not flag a minor bump as breaking (UV-1)', async () => {
  const validator = new UpgradeValidator({ projectPath: TEST_DIR });
  const plan = [
    {
      package: 'left-pad',
      registry: 'npm',
      currentVersion: '1.0.0',
      suggestedVersion: '1.1.0',
      action: 'upgrade',
      reason: 'minor bump',
      risk: 'low',
      affectedFiles: [join(TEST_DIR, 'package.json')],
    },
  ];
  const result = await validator.validatePlan(plan);
  assert(result.breakingChanges.length === 0, `minor bump should yield 0 breaking changes, got ${result.breakingChanges.length}`);
});

await test('UpgradeValidator still flags a major bump as breaking (UV-1 control)', async () => {
  const validator = new UpgradeValidator({ projectPath: TEST_DIR });
  const plan = [
    {
      package: 'left-pad',
      registry: 'npm',
      currentVersion: '1.0.0',
      suggestedVersion: '2.0.0',
      action: 'upgrade',
      reason: 'major bump',
      risk: 'high',
      affectedFiles: [join(TEST_DIR, 'package.json')],
    },
  ];
  const result = await validator.validatePlan(plan);
  assert(result.breakingChanges.length === 1, `major bump should yield 1 breaking change, got ${result.breakingChanges.length}`);
  assert(result.breakingChanges[0].type === 'major', 'breaking change should be of type major');
});

// ---------------------------------------------------------------------------
// Eval-round regression tests (applier file writers + optimizer robustness)
// ---------------------------------------------------------------------------
const mkdir = (p) => { mkdirSync(p, { recursive: true }); return p; };

await test('applier updates Maven pom.xml by artifactId, not groupId:artifactId (XML-1)', async () => {
  const d = mkdir(join(TEST_DIR, 'mvn'));
  writeFileSync(join(d, 'pom.xml'),
    '<project><dependencies>\n' +
    '  <dependency><groupId>org.springframework</groupId><artifactId>spring-core</artifactId><version>5.3.0</version></dependency>\n' +
    '</dependencies></project>\n');
  const r = await applyUpgrades(d, [{
    package: 'org.springframework:spring-core', registry: 'maven', currentVersion: '5.3.0',
    suggestedVersion: '6.1.0', action: 'upgrade', reason: 'eval', risk: 'medium', affectedFiles: ['pom.xml'],
  }], { dryRun: false, createBackup: false });
  const xml = readFileSync(join(d, 'pom.xml'), 'utf-8');
  assert(/<version>6\.1\.0<\/version>/.test(xml), `pom version should be updated, got: ${xml.replace(/\n/g,' ')}`);
});

await test('applier updates Cargo.toml inline-table dependency, preserving features (TOML-1)', async () => {
  const d = mkdir(join(TEST_DIR, 'cargo'));
  writeFileSync(join(d, 'Cargo.toml'), '[dependencies]\nserde = { version = "1.0.150", features = ["derive"] }\n');
  const r = await applyUpgrades(d, [{
    package: 'serde', registry: 'crates', currentVersion: '1.0.150', suggestedVersion: '1.0.200',
    action: 'upgrade', reason: 'eval', risk: 'low', affectedFiles: ['Cargo.toml'],
  }], { dryRun: false, createBackup: false });
  const toml = readFileSync(join(d, 'Cargo.toml'), 'utf-8');
  assert(/version = "1\.0\.200"/.test(toml), `version should update, got: ${toml.trim()}`);
  assert(/features = \["derive"\]/.test(toml), `features must be preserved, got: ${toml.trim()}`);
});

await test('applier preserves PEP 508 extras in requirements.txt (TXT-1)', async () => {
  const d = mkdir(join(TEST_DIR, 'reqs'));
  writeFileSync(join(d, 'requirements.txt'), 'requests[security]==2.28.0\nflask==2.0.0\n');
  const r = await applyUpgrades(d, [{
    package: 'requests', registry: 'pypi', currentVersion: '2.28.0', suggestedVersion: '2.31.0',
    action: 'upgrade', reason: 'eval', risk: 'low', affectedFiles: ['requirements.txt'],
  }], { dryRun: false, createBackup: false });
  const txt = readFileSync(join(d, 'requirements.txt'), 'utf-8');
  assert(/requests\[security\]==2\.31\.0/.test(txt), `extras must survive, got: ${txt.trim()}`);
});

await test('applier updates single-line go.mod require and keeps // indirect (GOMOD-1)', async () => {
  const d = mkdir(join(TEST_DIR, 'gomod'));
  writeFileSync(join(d, 'go.mod'),
    'module example\n\ngo 1.21\n\n' +
    'require github.com/gorilla/mux v1.8.0\n\n' +
    'require (\n\tgithub.com/stretchr/testify v1.8.0 // indirect\n)\n');
  const r = await applyUpgrades(d, [
    { package: 'github.com/gorilla/mux', registry: 'go', currentVersion: '1.8.0', suggestedVersion: '1.8.1', action: 'upgrade', reason: 'eval', risk: 'low', affectedFiles: ['go.mod'] },
    { package: 'github.com/stretchr/testify', registry: 'go', currentVersion: '1.8.0', suggestedVersion: '1.9.0', action: 'upgrade', reason: 'eval', risk: 'low', affectedFiles: ['go.mod'] },
  ], { dryRun: false, createBackup: false });
  const mod = readFileSync(join(d, 'go.mod'), 'utf-8');
  assert(/require github\.com\/gorilla\/mux v1\.8\.1/.test(mod), `single-line require should update, got: ${mod.replace(/\n/g,'\\n')}`);
  assert(/github\.com\/stretchr\/testify v1\.9\.0 \/\/ indirect/.test(mod), `// indirect must be preserved, got: ${mod.replace(/\n/g,'\\n')}`);
});

await test('applier counts a package once even across multiple files (COUNT-1)', async () => {
  const d = mkdir(join(TEST_DIR, 'count'));
  mkdir(join(d, 'a')); mkdir(join(d, 'b'));
  writeFileSync(join(d, 'a', 'package.json'), JSON.stringify({ dependencies: { lodash: '4.17.20' } }, null, 2));
  writeFileSync(join(d, 'b', 'package.json'), JSON.stringify({ dependencies: { lodash: '4.17.20' } }, null, 2));
  const r = await applyUpgrades(d, [{
    package: 'lodash', registry: 'npm', currentVersion: '4.17.20', suggestedVersion: '4.17.21',
    action: 'upgrade', reason: 'eval', risk: 'low', affectedFiles: ['a/package.json', 'b/package.json'],
  }], { dryRun: false, createBackup: false });
  assert(r.summary.packagesUpgraded === 1, `one package across 2 files should count once, got ${r.summary.packagesUpgraded}`);
  assert(r.summary.filesModified === 2, `but two files are modified, got ${r.summary.filesModified}`);
});

await test('apply rolls back ALL files and stops on a mid-plan failure (ROLLBACK-1)', async () => {
  const d = mkdir(join(TEST_DIR, 'rb'));
  writeFileSync(join(d, 'good.json'), JSON.stringify({ dependencies: { a: '1.0.0' } }, null, 2));
  writeFileSync(join(d, 'bad.json'), '{ not valid json');
  writeFileSync(join(d, 'after.json'), JSON.stringify({ dependencies: { c: '1.0.0' } }, null, 2));
  const r = await applyUpgrades(d, [
    { package: 'a', registry: 'npm', currentVersion: '1.0.0', suggestedVersion: '2.0.0', action: 'upgrade', reason: 'e', risk: 'low', affectedFiles: ['good.json'] },
    { package: 'b', registry: 'npm', currentVersion: '1.0.0', suggestedVersion: '2.0.0', action: 'upgrade', reason: 'e', risk: 'low', affectedFiles: ['bad.json'] },
    { package: 'c', registry: 'npm', currentVersion: '1.0.0', suggestedVersion: '2.0.0', action: 'upgrade', reason: 'e', risk: 'low', affectedFiles: ['after.json'] },
  ], { dryRun: false, createBackup: true, rollbackOnError: true });
  const good = JSON.parse(readFileSync(join(d, 'good.json'), 'utf-8'));
  const after = JSON.parse(readFileSync(join(d, 'after.json'), 'utf-8'));
  assert(good.dependencies.a === '1.0.0', `good.json must be rolled back to original, got ${good.dependencies.a}`);
  assert(after.dependencies.c === '1.0.0', `after.json must NOT have been mutated post-rollback, got ${after.dependencies.c}`);
  assert(r.errors.length >= 1, 'failure should be reported');
});

await test('optimizeVersions does not crash on a range-only dependency (OPT-1)', async () => {
  const d = mkdir(join(TEST_DIR, 'opt'));
  writeFileSync(join(d, 'package.json'), JSON.stringify({ dependencies: { 'some-pkg': '>=1.0.0' } }, null, 2));
  // timeout:1 makes the registry lookup fail fast → fully offline + deterministic.
  const r = await optimizeVersions({ projectPath: d, includeLockFiles: false, timeout: 1 });
  assert(Array.isArray(r.plan), 'should return a plan array, not throw');
  assert(!r.errors.some((e) => /Reduce of empty array/.test(e)), `must not crash on constraint-only deps, errors: ${JSON.stringify(r.errors)}`);
});

rmSync(TEST_DIR, { recursive: true, force: true });

console.log(`\n=== Test Summary ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed > 0) {
  console.log('\n❌ Some tests failed');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
