#!/usr/bin/env node

/**
 * Test script for version compatibility features
 * Tests the new MCP tools: check_compatibility, detect_conflicts, suggest_upgrade_path, find_compatible_version
 */

import { parseSemVer, compareVersions, satisfiesConstraint, parseConstraint, detectConflicts, generateUpgradePath, getBreakingChanges, calculateUpgradeRisk, suggestSafeUpgrade, findCompatibleVersion } from './build/version-compatibility.js';

console.log('=== Version Compatibility Feature Tests ===\n');

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

// ============================================================================
// Test 1: Semantic Version Parsing
// ============================================================================
console.log('\n--- Semantic Version Parsing ---');

test('parseSemVer: standard version', () => {
  const result = parseSemVer('1.2.3');
  assert(result.major === 1, 'major should be 1');
  assert(result.minor === 2, 'minor should be 2');
  assert(result.patch === 3, 'patch should be 3');
  assert(result.prerelease === undefined, 'prerelease should be undefined');
});

test('parseSemVer: with prerelease', () => {
  const result = parseSemVer('1.2.3-alpha.1');
  assert(result.major === 1, 'major should be 1');
  assert(result.prerelease === 'alpha.1', 'prerelease should be alpha.1');
});

test('parseSemVer: simple version', () => {
  const result = parseSemVer('2.0');
  assert(result.major === 2, 'major should be 2');
  assert(result.minor === 0, 'minor should default to 0');
  assert(result.patch === 0, 'patch should default to 0');
});

test('parseSemVer: major only', () => {
  const result = parseSemVer('3');
  assert(result.major === 3, 'major should be 3');
  assert(result.minor === 0, 'minor should default to 0');
  assert(result.patch === 0, 'patch should default to 0');
});

// ============================================================================
// Test 2: Version Comparison
// ============================================================================
console.log('\n--- Version Comparison ---');

test('compareVersions: greater than', () => {
  assert(compareVersions('1.2.3', '1.2.2') > 0, '1.2.3 > 1.2.2');
});

test('compareVersions: less than', () => {
  assert(compareVersions('1.2.2', '1.2.3') < 0, '1.2.2 < 1.2.3');
});

test('compareVersions: equal', () => {
  assert(compareVersions('1.2.3', '1.2.3') === 0, '1.2.3 == 1.2.3');
});

test('compareVersions: prerelease handling', () => {
  assert(compareVersions('1.2.3', '1.2.3-alpha') > 0, 'stable > prerelease');
});

// ============================================================================
// Test 3: Constraint Parsing
// ============================================================================
console.log('\n--- Constraint Parsing ---');

test('parseConstraint: caret', () => {
  const result = parseConstraint('^1.2.3');
  assert(result.type === 'caret', 'type should be caret');
  assert(result.version === '1.2.3', 'version should be 1.2.3');
});

test('parseConstraint: tilde', () => {
  const result = parseConstraint('~1.2.3');
  assert(result.type === 'tilde', 'type should be tilde');
});

test('parseConstraint: greater than', () => {
  const result = parseConstraint('>1.2.3');
  assert(result.type === 'greater', 'type should be greater');
});

test('parseConstraint: greater or equal', () => {
  const result = parseConstraint('>=1.2.3');
  assert(result.type === 'greater-equal', 'type should be greater-equal');
});

test('parseConstraint: range with dash', () => {
  const result = parseConstraint('1.2.3 - 2.0.0');
  assert(result.type === 'range', 'type should be range');
  assert(result.min === '1.2.3', 'min should be 1.2.3');
  assert(result.max === '2.0.0', 'max should be 2.0.0');
});

test('parseConstraint: exact', () => {
  const result = parseConstraint('1.2.3');
  assert(result.type === 'exact', 'type should be exact');
});

test('parseConstraint: any', () => {
  const result = parseConstraint('*');
  assert(result.type === 'any', 'type should be any');
});

// ============================================================================
// Test 4: Constraint Satisfaction
// ============================================================================
console.log('\n--- Constraint Satisfaction ---');

test('satisfiesConstraint: caret satisfied', () => {
  const constraint = parseConstraint('^1.2.3');
  assert(satisfiesConstraint('1.2.4', constraint) === true, '1.2.4 should satisfy ^1.2.3');
});

test('satisfiesConstraint: caret not satisfied', () => {
  const constraint = parseConstraint('^1.2.3');
  assert(satisfiesConstraint('2.0.0', constraint) === false, '2.0.0 should not satisfy ^1.2.3');
});

test('satisfiesConstraint: caret allows minor bump below next major', () => {
  const constraint = parseConstraint('^1.2.3');
  // ^1.2.3 => >=1.2.3 <2.0.0; 1.3.0 and 1.9.9 must satisfy
  assert(satisfiesConstraint('1.3.0', constraint) === true, '1.3.0 should satisfy ^1.2.3');
  assert(satisfiesConstraint('1.9.9', constraint) === true, '1.9.9 should satisfy ^1.2.3');
  assert(satisfiesConstraint('1.2.2', constraint) === false, '1.2.2 should not satisfy ^1.2.3');
});

test('satisfiesConstraint: caret 0.x pins minor', () => {
  const constraint = parseConstraint('^0.2.3');
  // ^0.2.3 => >=0.2.3 <0.3.0
  assert(satisfiesConstraint('0.2.5', constraint) === true, '0.2.5 should satisfy ^0.2.3');
  assert(satisfiesConstraint('0.3.0', constraint) === false, '0.3.0 should not satisfy ^0.2.3');
  assert(satisfiesConstraint('0.2.2', constraint) === false, '0.2.2 should not satisfy ^0.2.3');
});

test('satisfiesConstraint: tilde satisfied', () => {
  const constraint = parseConstraint('~1.2.3');
  assert(satisfiesConstraint('1.2.5', constraint) === true, '1.2.5 should satisfy ~1.2.3');
});

test('satisfiesConstraint: tilde not satisfied', () => {
  const constraint = parseConstraint('~1.2.3');
  assert(satisfiesConstraint('1.3.0', constraint) === false, '1.3.0 should not satisfy ~1.2.3');
});

test('satisfiesConstraint: greater than', () => {
  const constraint = parseConstraint('>1.2.3');
  assert(satisfiesConstraint('1.2.4', constraint) === true, '1.2.4 should satisfy >1.2.3');
  assert(satisfiesConstraint('1.2.3', constraint) === false, '1.2.3 should not satisfy >1.2.3');
});

test('satisfiesConstraint: range with dash', () => {
  const constraint = parseConstraint('1.2.3 - 2.0.0');
  assert(satisfiesConstraint('1.5.0', constraint) === true, '1.5.0 should satisfy 1.2.3 - 2.0.0');
  assert(satisfiesConstraint('2.0.0', constraint) === true, '2.0.0 should satisfy 1.2.3 - 2.0.0');
  assert(satisfiesConstraint('2.0.1', constraint) === false, '2.0.1 should not satisfy 1.2.3 - 2.0.0');
});

test('satisfiesConstraint: any', () => {
  const constraint = parseConstraint('*');
  assert(satisfiesConstraint('1.2.3', constraint) === true, 'any version should satisfy *');
});

// ============================================================================
// Test 5: Conflict Detection
// ============================================================================
console.log('\n--- Conflict Detection ---');

test('detectConflicts: no conflicts', () => {
  const dependencies = [
    { name: 'express', version: '4.18.2', registry: 'npm' },
    { name: 'lodash', version: '4.17.21', registry: 'npm' },
  ];
  const conflicts = detectConflicts(dependencies);
  assert(conflicts.length === 0, 'should have no conflicts');
});

test('detectConflicts: version conflict', () => {
  const dependencies = [
    { name: 'express', version: '4.18.2', registry: 'npm' },
    { name: 'express', version: '4.17.1', registry: 'npm' },
  ];
  const conflicts = detectConflicts(dependencies);
  assert(conflicts.length === 1, 'should have 1 conflict');
  assert(conflicts[0].package === 'npm:express', 'conflict should be for npm:express');
  assert(conflicts[0].conflicts.length === 2, 'should have 2 versions');
});

test('detectConflicts: multiple conflicts', () => {
  const dependencies = [
    { name: 'express', version: '4.18.2', registry: 'npm' },
    { name: 'express', version: '4.17.1', registry: 'npm' },
    { name: 'lodash', version: '4.17.21', registry: 'npm' },
    { name: 'lodash', version: '3.10.1', registry: 'npm' },
  ];
  const conflicts = detectConflicts(dependencies);
  assert(conflicts.length === 2, 'should have 2 conflicts');
});

// ============================================================================
// Test 6: Upgrade Path Generation
// ============================================================================
console.log('\n--- Upgrade Path Generation ---');

test('generateUpgradePath: simple upgrade', () => {
  const path = generateUpgradePath('express', 'npm', '1.0.0', '2.0.0', []);
  assert(path.package === 'express', 'package should be express');
  assert(path.currentVersion === '1.0.0', 'currentVersion should be 1.0.0');
  assert(path.targetVersion === '2.0.0', 'targetVersion should be 2.0.0');
  assert(path.steps.length === 1, 'should have 1 step');
  assert(path.steps[0].fromVersion === '1.0.0', 'step fromVersion should be 1.0.0');
  assert(path.steps[0].toVersion === '2.0.0', 'step toVersion should be 2.0.0');
});

test('generateUpgradePath: with breaking changes', () => {
  const path = generateUpgradePath('express', 'npm', '1.0.0', '2.0.0', []);
  assert(path.breakingChanges === undefined, 'breakingChanges should be undefined (not a property)');
  assert(path.totalBreakingChanges > 0, 'should have breaking changes');
  assert(path.estimatedRisk === 'high', 'should be high risk');
});

// ============================================================================
// Test 7: Breaking Change Detection
// ============================================================================
console.log('\n--- Breaking Change Detection ---');

test('getBreakingChanges: major version bump', () => {
  const changes = getBreakingChanges('1.0.0', '2.0.0');
  assert(changes.length === 1, 'should have 1 breaking change');
  assert(changes[0].includes('Major version upgrade'), 'should mention major version upgrade');
});

test('getBreakingChanges: minor version bump', () => {
  const changes = getBreakingChanges('1.0.0', '1.1.0');
  assert(changes.length === 1, 'should have 1 breaking change');
  assert(changes[0].includes('Minor version upgrade'), 'should mention minor version upgrade');
});

test('getBreakingChanges: patch version bump', () => {
  const changes = getBreakingChanges('1.0.0', '1.0.1');
  assert(changes.length === 0, 'should have no breaking changes');
});

// ============================================================================
// Test 8: Risk Calculation
// ============================================================================
console.log('\n--- Risk Calculation ---');

test('calculateUpgradeRisk: patch upgrade', () => {
  const risk = calculateUpgradeRisk('1.0.0', '1.0.1');
  assert(risk === 'low', 'patch upgrade should be low risk');
});

test('calculateUpgradeRisk: minor upgrade', () => {
  const risk = calculateUpgradeRisk('1.0.0', '1.1.0');
  assert(risk === 'medium', 'minor upgrade should be medium risk');
});

test('calculateUpgradeRisk: major upgrade', () => {
  const risk = calculateUpgradeRisk('1.0.0', '2.0.0');
  assert(risk === 'high', 'major upgrade should be high risk');
});

// ============================================================================
// Test 9: Find Compatible Version
// ============================================================================
console.log('\n--- Find Compatible Version ---');

test('findCompatibleVersion: find version satisfying constraints', () => {
  const availableVersions = ['1.0.0', '1.0.1', '1.1.0', '2.0.0'];
  const constraints = [parseConstraint('^1.0.0')];
  const result = findCompatibleVersion('express', 'npm', availableVersions, constraints);
  assert(result === '1.1.0', 'should return 1.1.0 (highest satisfying ^1.0.0)');
});

test('findCompatibleVersion: no compatible version', () => {
  const availableVersions = ['2.0.0', '2.1.0'];
  const constraints = [parseConstraint('^1.0.0')];
  const result = findCompatibleVersion('express', 'npm', availableVersions, constraints);
  assert(result === null, 'should return null when no version satisfies constraints');
});

test('findCompatibleVersion: multiple constraints', () => {
  const availableVersions = ['1.0.0', '1.0.1', '1.1.0', '1.2.0', '2.0.0'];
  const constraints = [
    parseConstraint('^1.0.0'),
    parseConstraint('>=1.1.0')
  ];
  const result = findCompatibleVersion('express', 'npm', availableVersions, constraints);
  assert(result === '1.2.0', 'should return 1.2.0 (highest satisfying both constraints)');
});

// ============================================================================
// Test 10: Suggest Safe Upgrade
// ============================================================================
console.log('\n--- Suggest Safe Upgrade ---');

test('suggestSafeUpgrade: basic suggestion', () => {
  const dependencies = [];
  const suggestion = suggestSafeUpgrade('express', '1.0.0', dependencies, 'medium');
  assert(suggestion.version === '1.0.0', 'should suggest current version');
  assert(suggestion.risk === 'low', 'risk should be low (no upgrade)');
  assert(suggestion.compatible === true, 'should be compatible');
});

// ============================================================================
// Summary
// ============================================================================
console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed === 0) {
  console.log('\n✅ All tests passed!');
  process.exit(0);
} else {
  console.log(`\n❌ ${failed} test(s) failed`);
  process.exit(1);
}
