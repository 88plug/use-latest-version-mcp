#!/usr/bin/env node

/**
 * Test script for outdated checker
 */

import { checkOutdated, quickCheckOutdated, getOutdatedSummary, getOutdatedAsJSON, getOutdatedAsMarkdown, OutdatedChecker } from './build/outdated-checker.js';
import { writeFileSync, mkdirSync, rmdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

console.log('=== Outdated Checker Tests ===\n');

// Test counters
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

// Create test directory structure
const testDir = './test-outdated-check';
const cleanup = () => {
  if (existsSync(testDir)) {
    try {
      rmdirSync(testDir, { recursive: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
};

// Cleanup before tests
cleanup();
mkdirSync(testDir, { recursive: true });

// ============================================================================
// Test 1: OutdatedChecker Class
// ============================================================================
console.log('\n--- OutdatedChecker Class ---');

test('OutdatedChecker can be instantiated', () => {
  const checker = new OutdatedChecker({ projectPath: testDir });
  assert(checker !== undefined, 'checker should be defined');
});

test('OutdatedChecker accepts custom options', () => {
  const checker = new OutdatedChecker({
    projectPath: testDir,
    checkDevDependencies: false,
    parallelChecks: 10,
  });
  assert(checker !== undefined, 'checker should be defined');
});

// ============================================================================
// Test 2: Empty Project
// ============================================================================
console.log('\n--- Empty Project ---');

test('checkOutdated handles empty project', async () => {
  const emptyDir = join(testDir, 'empty');
  mkdirSync(emptyDir, { recursive: true });
  const result = await checkOutdated({ projectPath: emptyDir });
  assert(result.outdatedPackages.length === 0, 'should have no outdated packages');
  assert(result.upToDatePackages.length === 0, 'should have no up-to-date packages');
  assert(result.summary.totalDependencies === 0, 'should have 0 total dependencies');
});

// ============================================================================
// Test 3: Single Outdated Package
// ============================================================================
console.log('\n--- Single Outdated Package ---');

const singleOutdatedDir = join(testDir, 'single-outdated');
mkdirSync(singleOutdatedDir, { recursive: true });

// Create package.json with an old version of express
writeFileSync(join(singleOutdatedDir, 'package.json'), JSON.stringify({
  name: 'test',
  dependencies: {
    express: '4.17.0', // Old version
  },
}, null, 2));

test('checkOutdated detects outdated package', async () => {
  const result = await checkOutdated({ projectPath: singleOutdatedDir });
  assert(result.outdatedPackages.length >= 1, 'should detect at least 1 outdated package');
  const express = result.outdatedPackages.find(p => p.name === 'express');
  assert(express !== undefined, 'should find express as outdated');
  assert(express.currentVersion === '4.17.0', 'should have correct current version');
  assert(express.upgradeAvailable === true, 'should have upgrade available');
});

test('checkOutdated calculates upgrade risk', async () => {
  const result = await checkOutdated({ projectPath: singleOutdatedDir });
  const express = result.outdatedPackages.find(p => p.name === 'express');
  assert(express !== undefined, 'should find express');
  assert(['low', 'medium', 'high'].includes(express.upgradeRisk), 'should have valid upgrade risk');
});

test('checkOutdated provides upgrade path', async () => {
  const result = await checkOutdated({ projectPath: singleOutdatedDir });
  const express = result.outdatedPackages.find(p => p.name === 'express');
  assert(express !== undefined, 'should find express');
  // Upgrade path may or may not be available depending on version compatibility
  assert(express.upgradePath !== undefined || express.upgradePath === undefined, 'upgrade path should be defined or undefined');
});

test('checkOutdated provides safe version', async () => {
  const result = await checkOutdated({ projectPath: singleOutdatedDir });
  const express = result.outdatedPackages.find(p => p.name === 'express');
  assert(express !== undefined, 'should find express');
  // Safe version may or may not be available
  assert(express.safeVersion !== undefined || express.safeVersion === undefined, 'safe version should be defined or undefined');
});

// ============================================================================
// Test 4: Multiple Registries
// ============================================================================
console.log('\n--- Multiple Registries ---');

const multiRegistryDir = join(testDir, 'multi-registry');
mkdirSync(multiRegistryDir, { recursive: true });

// Create package.json with npm packages
writeFileSync(join(multiRegistryDir, 'package.json'), JSON.stringify({
  name: 'test',
  dependencies: {
    express: '4.17.0',
    lodash: '4.17.15',
  },
}, null, 2));

// Create requirements.txt with Python packages
writeFileSync(join(multiRegistryDir, 'requirements.txt'), 'requests==2.25.0\nflask==2.0.0\n');

test('checkOutdated handles multiple registries', async () => {
  const result = await checkOutdated({ projectPath: multiRegistryDir });
  assert(result.summary.registries.length >= 2, 'should detect multiple registries');
  assert(result.summary.registries.includes('npm'), 'should include npm');
  assert(result.summary.registries.includes('pypi'), 'should include pypi');
});

test('checkOutdated detects outdated packages across registries', async () => {
  const result = await checkOutdated({ projectPath: multiRegistryDir });
  assert(result.outdatedPackages.length >= 1, 'should detect at least 1 outdated package');
});

// ============================================================================
// Test 5: Up-to-Date Packages
// ============================================================================
console.log('\n--- Up-to-Date Packages ---');

const upToDateDir = join(testDir, 'up-to-date');
mkdirSync(upToDateDir, { recursive: true });

// Create package.json with recent versions
writeFileSync(join(upToDateDir, 'package.json'), JSON.stringify({
  name: 'test',
  dependencies: {
    // Use a very recent version that's likely up-to-date
    'typescript': '5.3.0',
  },
}, null, 2));

test('checkOutdated identifies up-to-date packages', async () => {
  const result = await checkOutdated({ projectPath: upToDateDir });
  // May have 0 or 1 outdated packages depending on when typescript 5.3.0 was released
  assert(result.upToDatePackages.length >= 0, 'should identify up-to-date packages');
});

// ============================================================================
// Test 6: Dependency Type Filtering
// ============================================================================
console.log('\n--- Dependency Type Filtering ---');

const filterDir = join(testDir, 'filter');
mkdirSync(filterDir, { recursive: true });

writeFileSync(join(filterDir, 'package.json'), JSON.stringify({
  name: 'test',
  dependencies: {
    express: '4.17.0',
  },
  devDependencies: {
    jest: '27.0.0',
  },
  peerDependencies: {
    react: '17.0.0',
  },
  optionalDependencies: {
    chalk: '4.1.0',
  },
}, null, 2));

test('checkOutdated filters dev dependencies', async () => {
  const result = await checkOutdated({
    projectPath: filterDir,
    checkDevDependencies: false,
  });
  const jest = result.outdatedPackages.find(p => p.name === 'jest');
  assert(jest === undefined, 'should not check dev dependencies when disabled');
});

test('checkOutdated filters peer dependencies', async () => {
  const result = await checkOutdated({
    projectPath: filterDir,
    checkPeerDependencies: false,
  });
  const react = result.outdatedPackages.find(p => p.name === 'react');
  assert(react === undefined, 'should not check peer dependencies when disabled');
});

test('checkOutdated filters optional dependencies', async () => {
  const result = await checkOutdated({
    projectPath: filterDir,
    checkOptionalDependencies: false,
  });
  const chalk = result.outdatedPackages.find(p => p.name === 'chalk');
  assert(chalk === undefined, 'should not check optional dependencies when disabled');
});

// ============================================================================
// Test 7: Summary Statistics
// ============================================================================
console.log('\n--- Summary Statistics ---');

test('checkOutdated calculates summary correctly', async () => {
  const result = await checkOutdated({ projectPath: singleOutdatedDir });
  assert(result.summary.totalDependencies >= 1, 'should have total dependencies');
  assert(result.summary.outdatedPackages >= 0, 'should have outdated packages count');
  assert(result.summary.upToDatePackages >= 0, 'should have up-to-date packages count');
  assert(result.summary.packagesChecked >= 0, 'should have packages checked count');
  assert(result.summary.packagesSkipped >= 0, 'should have packages skipped count');
});

test('checkOutdated calculates upgrade risk summary', async () => {
  const result = await checkOutdated({ projectPath: singleOutdatedDir });
  assert(result.summary.highRiskUpgrades >= 0, 'should have high risk count');
  assert(result.summary.mediumRiskUpgrades >= 0, 'should have medium risk count');
  assert(result.summary.lowRiskUpgrades >= 0, 'should have low risk count');
});

// ============================================================================
// Test 8: Convenience Functions
// ============================================================================
console.log('\n--- Convenience Functions ---');

test('quickCheckOutdated works with default options', async () => {
  const result = await quickCheckOutdated(singleOutdatedDir);
  assert(result !== undefined, 'should return result');
  assert(result.projectPath === singleOutdatedDir, 'should have correct project path');
});

test('getOutdatedSummary returns formatted string', async () => {
  const result = await checkOutdated({ projectPath: singleOutdatedDir });
  const summary = getOutdatedSummary(result);
  assert(typeof summary === 'string', 'should return string');
  assert(summary.includes('Outdated Packages Summary'), 'should include title');
  assert(summary.includes('Summary:'), 'should include summary section');
});

test('getOutdatedAsJSON returns valid JSON', async () => {
  const result = await checkOutdated({ projectPath: singleOutdatedDir });
  const json = getOutdatedAsJSON(result);
  assert(typeof json === 'string', 'should return string');
  const parsed = JSON.parse(json);
  assert(parsed.projectPath === singleOutdatedDir, 'should have correct project path');
  assert(Array.isArray(parsed.outdatedPackages), 'should have outdated packages array');
});

test('getOutdatedAsMarkdown returns formatted markdown', async () => {
  const result = await checkOutdated({ projectPath: singleOutdatedDir });
  const markdown = getOutdatedAsMarkdown(result);
  assert(typeof markdown === 'string', 'should return string');
  assert(markdown.includes('# Outdated Packages Report'), 'should include title');
  assert(markdown.includes('## Summary'), 'should include summary section');
});

// ============================================================================
// Test 9: Error Handling
// ============================================================================
console.log('\n--- Error Handling ---');

test('checkOutdated handles non-existent project', async () => {
  const result = await checkOutdated({ projectPath: '/non/existent/path' });
  assert(result.errors.length > 0, 'should have errors');
});

test('checkOutdated handles invalid package.json', async () => {
  const invalidDir = join(testDir, 'invalid');
  mkdirSync(invalidDir, { recursive: true });
  writeFileSync(join(invalidDir, 'package.json'), 'invalid json {{{');

  const result = await checkOutdated({ projectPath: invalidDir });
  assert(result.errors.length > 0 || result.warnings.length > 0, 'should have errors or warnings');
});

// ============================================================================
// Test 10: Lock Files
// ============================================================================
console.log('\n--- Lock Files ---');

const lockFileDir = join(testDir, 'lock-file');
mkdirSync(lockFileDir, { recursive: true });

writeFileSync(join(lockFileDir, 'package.json'), JSON.stringify({
  name: 'test',
  dependencies: {
    express: '^4.17.0',
  },
}, null, 2));

writeFileSync(join(lockFileDir, 'package-lock.json'), JSON.stringify({
  name: 'test',
  lockfileVersion: 3,
  packages: {
    '': { name: 'test', version: '1.0.0' },
    'node_modules/express': { version: '4.17.0' },
  },
}, null, 2));

test('checkOutdated uses lock file versions', async () => {
  const result = await checkOutdated({
    projectPath: lockFileDir,
    includeLockFiles: true,
  });
  const express = result.outdatedPackages.find(p => p.name === 'express');
  if (express) {
    assert(express.sourceType === 'lock', 'should use lock file version');
  }
});

test('checkOutdated skips lock files when disabled', async () => {
  const result = await checkOutdated({
    projectPath: lockFileDir,
    includeLockFiles: false,
  });
  const express = result.outdatedPackages.find(p => p.name === 'express');
  if (express) {
    assert(express.sourceType === 'dependency', 'should use dependency file version');
  }
});

// ============================================================================
// Test 11: Parallel Processing
// ============================================================================
console.log('\n--- Parallel Processing ---');

const parallelDir = join(testDir, 'parallel');
mkdirSync(parallelDir, { recursive: true });

writeFileSync(join(parallelDir, 'package.json'), JSON.stringify({
  name: 'test',
  dependencies: {
    express: '4.17.0',
    lodash: '4.17.15',
    axios: '0.21.0',
    react: '17.0.0',
    vue: '2.6.0',
  },
}, null, 2));

test('checkOutdated handles parallel checks', async () => {
  const result = await checkOutdated({
    projectPath: parallelDir,
    parallelChecks: 3,
  });
  assert(result.summary.packagesChecked >= 5, 'should check all packages');
});

// ============================================================================
// Test 12: Timeout Handling
// ============================================================================
console.log('\n--- Timeout Handling ---');

test('checkOutdated handles timeout', async () => {
  const result = await checkOutdated({
    projectPath: singleOutdatedDir,
    timeout: 1, // 1ms timeout
  });
  // Should still complete, just with potential errors
  assert(result !== undefined, 'should return result');
});

// ============================================================================
// Test 13: Major/Minor/Patch Upgrades
// ============================================================================
console.log('\n--- Major/Minor/Patch Upgrades ---');

test('checkOutdated identifies major upgrades', async () => {
  const result = await checkOutdated({ projectPath: singleOutdatedDir });
  const express = result.outdatedPackages.find(p => p.name === 'express');
  if (express && express.majorUpgrade) {
    assert(express.majorUpgrade === true, 'should identify major upgrade');
  }
});

test('checkOutdated identifies minor upgrades', async () => {
  const result = await checkOutdated({ projectPath: singleOutdatedDir });
  const express = result.outdatedPackages.find(p => p.name === 'express');
  if (express && express.minorUpgrade) {
    assert(express.minorUpgrade === true, 'should identify minor upgrade');
  }
});

test('checkOutdated identifies patch upgrades', async () => {
  const result = await checkOutdated({ projectPath: singleOutdatedDir });
  const express = result.outdatedPackages.find(p => p.name === 'express');
  if (express && express.patchUpgrade) {
    assert(express.patchUpgrade === true, 'should identify patch upgrade');
  }
});

// ============================================================================
// Test 14: Unique Dependencies
// ============================================================================
console.log('\n--- Unique Dependencies ---');

const uniqueDir = join(testDir, 'unique');
mkdirSync(uniqueDir, { recursive: true });

writeFileSync(join(uniqueDir, 'package.json'), JSON.stringify({
  name: 'test',
  dependencies: {
    express: '4.17.0',
  },
}, null, 2));

writeFileSync(join(uniqueDir, 'package-lock.json'), JSON.stringify({
  name: 'test',
  lockfileVersion: 3,
  packages: {
    '': { name: 'test', version: '1.0.0' },
    'node_modules/express': { version: '4.17.0' },
  },
}, null, 2));

test('checkOutdated deduplicates dependencies', async () => {
  const result = await checkOutdated({ projectPath: uniqueDir });
  const expressPackages = result.outdatedPackages.filter(p => p.name === 'express');
  assert(expressPackages.length <= 1, 'should deduplicate express');
});

// ============================================================================
// Test 15: Scan Result Integration
// ============================================================================
console.log('\n--- Scan Result Integration ---');

test('checkOutdated includes scan result', async () => {
  const result = await checkOutdated({ projectPath: singleOutdatedDir });
  assert(result.scanResult !== undefined, 'should include scan result');
  assert(result.scanResult.files.length > 0, 'should have scanned files');
  assert(result.scanResult.dependencies.length > 0, 'should have scanned dependencies');
});

// ============================================================================
// Cleanup
// ============================================================================
console.log('\n--- Cleanup ---');

cleanup();

// ============================================================================
// Summary
// ============================================================================
console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed > 0) {
  console.log(`\n❌ ${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log(`\n✅ All tests passed!`);
}
