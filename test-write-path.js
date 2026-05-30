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
