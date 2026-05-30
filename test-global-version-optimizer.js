import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  GlobalVersionOptimizer,
  optimizeVersions,
  quickOptimize,
  getOptimizationSummary,
  getOptimizationAsJSON,
  getOptimizationAsMarkdown
} from './build/global-version-optimizer.js';

// Test utilities
const TEST_DIR = join(process.cwd(), 'test-temp-optimizer');

function setupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// Test runner
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

// Tests
console.log('=== Global Version Optimizer Tests ===\n');

setupTestDir();

// Test 1: Class instantiation with default options
test('GlobalVersionOptimizer instantiates with default options', () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  assert(optimizer !== null, 'Optimizer should be created');
  assertEqual(optimizer.options.parallelChecks, 5, 'Default parallelChecks should be 5');
  assertEqual(optimizer.options.timeout, 10000, 'Default timeout should be 10000');
  assertEqual(optimizer.options.preferLatest, true, 'Default preferLatest should be true');
  assertEqual(optimizer.options.allowDowngrade, false, 'Default allowDowngrade should be false');
  assertEqual(optimizer.options.maxRisk, 'medium', 'Default maxRisk should be medium');
});

// Test 2: Class instantiation with custom options
test('GlobalVersionOptimizer instantiates with custom options', () => {
  const optimizer = new GlobalVersionOptimizer({
    projectPath: TEST_DIR,
    parallelChecks: 10,
    timeout: 60000,
    preferLatest: false,
    allowDowngrade: true,
    maxRisk: 'high'
  });
  assertEqual(optimizer.options.parallelChecks, 10, 'Custom parallelChecks should be 10');
  assertEqual(optimizer.options.timeout, 60000, 'Custom timeout should be 60000');
  assertEqual(optimizer.options.preferLatest, false, 'Custom preferLatest should be false');
  assertEqual(optimizer.options.allowDowngrade, true, 'Custom allowDowngrade should be true');
  assertEqual(optimizer.options.maxRisk, 'high', 'Custom maxRisk should be high');
});

// Test 3: Optimize empty project
test('Optimize empty project returns empty plan', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  assert(result !== undefined, 'Result should be defined');
  assertEqual(result.plan.length, 0, 'Plan should have no packages');
  assertEqual(result.summary.totalDependencies, 0, 'Total dependencies should be 0');
  assertEqual(result.summary.conflictsResolved, 0, 'Conflicts resolved should be 0');
  assertEqual(result.summary.outdatedUpdated, 0, 'Outdated updated should be 0');
});

// Test 4: Optimize project
test('Optimize project', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  assert(result !== undefined, 'Result should be defined');
  assert(result.plan !== undefined, 'Plan should be defined');
});

// Test 5: Result structure
test('Result has correct structure', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  assert(result.projectPath !== undefined, 'Result should have projectPath');
  assert(result.optimizedAt !== undefined, 'Result should have optimizedAt');
  assert(result.summary !== undefined, 'Result should have summary');
  assert(result.plan !== undefined, 'Result should have plan');
  assert(result.errors !== undefined, 'Result should have errors');
  assert(result.warnings !== undefined, 'Result should have warnings');
  assert(result.scanResult !== undefined, 'Result should have scanResult');
});

// Test 6: Summary structure
test('Summary has correct structure', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  assert(result.summary.totalDependencies !== undefined, 'Summary should have totalDependencies');
  assert(result.summary.packagesOptimized !== undefined, 'Summary should have packagesOptimized');
  assert(result.summary.packagesKept !== undefined, 'Summary should have packagesKept');
  assert(result.summary.packagesRemoved !== undefined, 'Summary should have packagesRemoved');
  assert(result.summary.conflictsResolved !== undefined, 'Summary should have conflictsResolved');
  assert(result.summary.outdatedUpdated !== undefined, 'Summary should have outdatedUpdated');
  assert(result.summary.registries !== undefined, 'Summary should have registries');
  assert(result.summary.highRiskChanges !== undefined, 'Summary should have highRiskChanges');
  assert(result.summary.mediumRiskChanges !== undefined, 'Summary should have mediumRiskChanges');
  assert(result.summary.lowRiskChanges !== undefined, 'Summary should have lowRiskChanges');
});

// Test 7: Plan structure
test('Plan has correct structure', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  assert(Array.isArray(result.plan), 'Plan should be an array');
});

// Test 8: Package plan structure
test('Package plan has correct structure', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  for (const pkg of result.plan) {
    assert(pkg.package !== undefined, 'Package should have name');
    assert(pkg.registry !== undefined, 'Package should have registry');
    assert(pkg.currentVersion !== undefined, 'Package should have currentVersion');
    assert(pkg.suggestedVersion !== undefined, 'Package should have suggestedVersion');
    assert(pkg.action !== undefined, 'Package should have action');
    assert(pkg.reason !== undefined, 'Package should have reason');
    assert(pkg.risk !== undefined, 'Package should have risk');
    assert(pkg.affectedFiles !== undefined, 'Package should have affectedFiles');
  }
});

// Test 9: Action types are valid
test('Action types are valid', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  const validActions = ['keep', 'upgrade', 'downgrade', 'remove'];
  for (const pkg of result.plan) {
    assert(validActions.includes(pkg.action), `Action ${pkg.action} should be valid`);
  }
});

// Test 10: Risk levels are valid
test('Risk levels are valid', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  const validRisks = ['high', 'medium', 'low'];
  for (const pkg of result.plan) {
    assert(validRisks.includes(pkg.risk), `Risk ${pkg.risk} should be valid`);
  }
});

// Test 11: Affected files are absolute paths
test('Affected files are absolute paths', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  for (const pkg of result.plan) {
    for (const file of pkg.affectedFiles) {
      assert(file.startsWith('/'), `File ${file} should be absolute path`);
    }
  }
});

// Test 12: Registry information preserved
test('Registry information is preserved', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  for (const pkg of result.plan) {
    assert(pkg.registry !== undefined, `Package ${pkg.package} should have registry`);
  }
});

// Test 13: Version format consistency
test('Version format is consistent', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  for (const pkg of result.plan) {
    assert(pkg.currentVersion !== undefined, `Package ${pkg.package} should have currentVersion`);
    assert(pkg.suggestedVersion !== undefined, `Package ${pkg.package} should have suggestedVersion`);
  }
});

// Test 14: Timestamp is recent
test('Timestamp is recent', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  const now = Date.now();
  const timestamp = new Date(result.optimizedAt).getTime();
  assert(Math.abs(now - timestamp) < 5000, 'Timestamp should be recent');
});

// Test 15: Errors array
test('Errors is an array', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  assert(Array.isArray(result.errors), 'Errors should be an array');
});

// Test 16: Warnings array
test('Warnings is an array', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  assert(Array.isArray(result.warnings), 'Warnings should be an array');
});

// Test 17: Scan result is included
test('Scan result is included', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  assert(result.scanResult !== undefined, 'Scan result should be defined');
  assert(result.scanResult.projectPath !== undefined, 'Scan result should have projectPath');
});

// Test 18: Convenience function optimizeVersions
test('Convenience function optimizeVersions', async () => {
  const result = await optimizeVersions({ projectPath: TEST_DIR });
  assert(result !== undefined, 'Result should be defined');
  assert(result.plan !== undefined, 'Plan should be defined');
});

// Test 19: Convenience function quickOptimize
test('Convenience function quickOptimize', async () => {
  const result = await quickOptimize(TEST_DIR);
  assert(result !== undefined, 'Result should be defined');
  assert(Array.isArray(result.plan), 'Plan should be an array');
});

// Test 20: Convenience function getOptimizationSummary
test('Convenience function getOptimizationSummary', async () => {
  const result = await optimizeVersions({ projectPath: TEST_DIR });
  const summary = getOptimizationSummary(result);
  assert(typeof summary === 'string', 'Summary should be a string');
  assert(summary.length > 0, 'Summary should not be empty');
});

// Test 21: Convenience function getOptimizationAsJSON
test('Convenience function getOptimizationAsJSON', async () => {
  const result = await optimizeVersions({ projectPath: TEST_DIR });
  const json = getOptimizationAsJSON(result);
  assert(typeof json === 'string', 'JSON should be a string');
  const parsed = JSON.parse(json);
  assert(parsed.plan !== undefined, 'Parsed JSON should have plan');
});

// Test 22: Convenience function getOptimizationAsMarkdown
test('Convenience function getOptimizationAsMarkdown', async () => {
  const result = await optimizeVersions({ projectPath: TEST_DIR });
  const markdown = getOptimizationAsMarkdown(result);
  assert(typeof markdown === 'string', 'Markdown should be a string');
  assert(markdown.includes('#'), 'Markdown should include headers');
});

// Test 23: Summary includes key information
test('Summary includes key information', async () => {
  const result = await optimizeVersions({ projectPath: TEST_DIR });
  const summary = getOptimizationSummary(result);
  assert(summary.includes('Total Dependencies'), 'Summary should include total dependencies');
  assert(summary.includes('Packages Optimized'), 'Summary should include packages optimized');
});

// Test 24: JSON output is valid
test('JSON output is valid', async () => {
  const result = await optimizeVersions({ projectPath: TEST_DIR });
  const json = getOptimizationAsJSON(result);
  const parsed = JSON.parse(json);
  assert(parsed.plan !== undefined, 'Parsed JSON should have plan');
  assert(parsed.summary !== undefined, 'Parsed JSON should have summary');
});

// Test 25: Markdown output is valid
test('Markdown output is valid', async () => {
  const result = await optimizeVersions({ projectPath: TEST_DIR });
  const markdown = getOptimizationAsMarkdown(result);
  assert(typeof markdown === 'string', 'Markdown should be a string');
  assert(markdown.includes('#'), 'Markdown should include headers');
  assert(markdown.includes('##'), 'Markdown should include subheaders');
});

// Test 26: Parallel processing option
test('Parallel processing option is respected', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR, parallelChecks: 3 });
  assertEqual(optimizer.options.parallelChecks, 3, 'Parallel checks should be 3');
});

// Test 27: Timeout option
test('Timeout option is respected', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR, timeout: 5000 });
  assertEqual(optimizer.options.timeout, 5000, 'Timeout should be 5000');
});

// Test 28: Prefer latest option
test('Prefer latest option is respected', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR, preferLatest: false });
  assertEqual(optimizer.options.preferLatest, false, 'Prefer latest should be false');
});

// Test 29: Allow downgrade option
test('Allow downgrade option is respected', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR, allowDowngrade: true });
  assertEqual(optimizer.options.allowDowngrade, true, 'Allow downgrade should be true');
});

// Test 30: Max risk option
test('Max risk option is respected', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR, maxRisk: 'low' });
  assertEqual(optimizer.options.maxRisk, 'low', 'Max risk should be low');
});

// Test 31: Include transitive option
test('Include transitive option is respected', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR, includeTransitive: true });
  assertEqual(optimizer.options.includeTransitive, true, 'Include transitive should be true');
});

// Test 32: Optimize lock files option
test('Optimize lock files option is respected', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR, optimizeLockFiles: false });
  assertEqual(optimizer.options.optimizeLockFiles, false, 'Optimize lock files should be false');
});

// Test 33: Max depth option
test('Max depth option is respected', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR, maxDepth: 3 });
  assertEqual(optimizer.options.maxDepth, 3, 'Max depth should be 3');
});

// Test 34: Exclude patterns option
test('Exclude patterns option is respected', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR, excludePatterns: ['node_modules'] });
  assert(Array.isArray(optimizer.options.excludePatterns), 'Exclude patterns should be an array');
});

// Test 35: Include lock files option
test('Include lock files option is respected', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR, includeLockFiles: false });
  assertEqual(optimizer.options.includeLockFiles, false, 'Include lock files should be false');
});

// Test 36: Follow symlinks option
test('Follow symlinks option is respected', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR, followSymlinks: true });
  assertEqual(optimizer.options.followSymlinks, true, 'Follow symlinks should be true');
});

// Test 37: Result project path matches input
test('Result project path matches input', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  assertEqual(result.projectPath, TEST_DIR, 'Project path should match');
});

// Test 38: Scan result project path matches input
test('Scan result project path matches input', async () => {
  const optimizer = new GlobalVersionOptimizer({ projectPath: TEST_DIR });
  const result = await optimizer.optimize();
  assertEqual(result.scanResult.projectPath, TEST_DIR, 'Scan result project path should match');
});

// Test 39: Registries array is sorted
test('Registries array is sorted', async () => {
  const result = await optimizeVersions({ projectPath: TEST_DIR });
  const registries = result.summary.registries;
  const sorted = [...registries].sort();
  assertDeepEqual(registries, sorted, 'Registries should be sorted');
});

// Test 40: Summary counts are consistent
test('Summary counts are consistent', async () => {
  const result = await optimizeVersions({ projectPath: TEST_DIR });
  const totalActions = result.summary.packagesOptimized + result.summary.packagesKept + result.summary.packagesRemoved;
  assertEqual(totalActions, result.plan.length, 'Total actions should match plan length');
});

// Test 41: Risk counts are consistent
test('Risk counts are consistent', async () => {
  const result = await optimizeVersions({ projectPath: TEST_DIR });
  const totalRisk = result.summary.highRiskChanges + result.summary.mediumRiskChanges + result.summary.lowRiskChanges;
  assertEqual(totalRisk, result.plan.length, 'Total risk counts should match plan length');
});

// Test 42: Transitive impact is optional
test('Transitive impact is optional', async () => {
  const result = await optimizeVersions({ projectPath: TEST_DIR });
  for (const pkg of result.plan) {
    // transitiveImpact is optional, so we just check it's either undefined or an array
    assert(pkg.transitiveImpact === undefined || Array.isArray(pkg.transitiveImpact), 'Transitive impact should be undefined or an array');
  }
});

// Test 43: Current constraint is optional
test('Current constraint is optional', async () => {
  const result = await optimizeVersions({ projectPath: TEST_DIR });
  for (const pkg of result.plan) {
    // currentConstraint is optional
    assert(pkg.currentConstraint === undefined || typeof pkg.currentConstraint === 'string', 'Current constraint should be undefined or a string');
  }
});

// Test 44: Suggested constraint is optional
test('Suggested constraint is optional', async () => {
  const result = await optimizeVersions({ projectPath: TEST_DIR });
  for (const pkg of result.plan) {
    // suggestedConstraint is optional
    assert(pkg.suggestedConstraint === undefined || typeof pkg.suggestedConstraint === 'string', 'Suggested constraint should be undefined or a string');
  }
});

// Test 45: Affected files is an array
test('Affected files is an array', async () => {
  const result = await optimizeVersions({ projectPath: TEST_DIR });
  for (const pkg of result.plan) {
    assert(Array.isArray(pkg.affectedFiles), 'Affected files should be an array');
  }
});

// Cleanup
cleanupTestDir();

// Summary
console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed === 0) {
  console.log('\n✅ All tests passed!');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
}
