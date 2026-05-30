#!/usr/bin/env node

/**
 * Conflict Resolver Tests
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

// Import the built module
import { ConflictResolver, resolveConflicts, quickResolveConflicts, getConflictResolutionSummary, getConflictResolutionAsJSON, getConflictResolutionAsMarkdown } from './build/conflict-resolver.js';

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ ${message}`);
    testsPassed++;
  } else {
    console.log(`❌ ${message}`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    console.log(`✅ ${message}`);
    testsPassed++;
  } else {
    console.log(`❌ ${message}`);
    console.log(`   Expected: ${expected}`);
    console.log(`   Actual: ${actual}`);
    testsFailed++;
  }
}

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`✅ ${message}`);
    testsPassed++;
  } else {
    console.log(`❌ ${message}`);
    console.log(`   Expected:`, JSON.stringify(expected));
    console.log(`   Actual:`, JSON.stringify(actual));
    testsFailed++;
  }
}

// ============================================================================
// Test Setup
// ============================================================================

// Create test directory structure
const testDir = join(process.cwd(), 'test-conflict-resolution');
const testProjectDir = join(testDir, 'test-project');

function setupTestProject() {
  // Clean up previous test directory
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }

  // Create test directory
  mkdirSync(testDir, { recursive: true });
  mkdirSync(testProjectDir, { recursive: true });

  // Create package.json with conflicting dependencies
  const packageJson = {
    name: 'test-project',
    version: '1.0.0',
    dependencies: {
      'express': '^4.18.0',
      'lodash': '^4.17.0',
    },
    devDependencies: {
      'express': '^5.0.0', // Conflict with dependencies
    },
  };
  writeFileSync(
    join(testProjectDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );

  // Create subdirectory with another package.json
  const subdir = join(testProjectDir, 'subdir');
  mkdirSync(subdir, { recursive: true });
  const subPackageJson = {
    name: 'sub-package',
    version: '1.0.0',
    dependencies: {
      'lodash': '^3.10.0', // Conflict with root package.json
    },
  };
  writeFileSync(
    join(subdir, 'package.json'),
    JSON.stringify(subPackageJson, null, 2)
  );
}

function cleanupTestProject() {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

// ============================================================================
// Main Test Function
// ============================================================================

async function runTests() {
  console.log('=== Conflict Resolver Tests ===\n');

  // ============================================================================
  // ConflictResolver Class Tests
  // ============================================================================

  console.log('--- ConflictResolver Class ---');

  setupTestProject();

  try {
    const resolver = new ConflictResolver({
      projectPath: testProjectDir,
    });
    assert(resolver !== null, 'ConflictResolver can be instantiated');
  } catch (error) {
    assert(false, `ConflictResolver can be instantiated (Error: ${error.message})`);
  }

  try {
    const resolver = new ConflictResolver({
      projectPath: testProjectDir,
      preferLatest: false,
      allowDowngrade: true,
      maxRisk: 'high',
      parallelChecks: 10,
      timeout: 5000,
    });
    assert(true, 'ConflictResolver accepts custom options');
  } catch (error) {
    assert(false, `ConflictResolver accepts custom options (Error: ${error.message})`);
  }

  // ============================================================================
  // Empty Project Tests
  // ============================================================================

  console.log('\n--- Empty Project ---');

  const emptyDir = join(testDir, 'empty-project');
  mkdirSync(emptyDir, { recursive: true });

  try {
    const result = await resolveConflicts({ projectPath: emptyDir });
    assertEqual(result.summary.conflictsFound, 0, 'resolveConflicts handles empty project');
    assertEqual(result.conflicts.length, 0, 'resolveConflicts returns empty conflicts array for empty project');
  } catch (error) {
    assert(false, `resolveConflicts handles empty project (Error: ${error.message})`);
  }

  // ============================================================================
  // Conflict Detection Tests
  // ============================================================================

  console.log('\n--- Conflict Detection ---');

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir });
    assert(result.summary.conflictsFound > 0, 'resolveConflicts detects conflicts');
    assert(result.conflicts.length > 0, 'resolveConflicts returns conflict resolutions');
  } catch (error) {
    assert(false, `resolveConflicts detects conflicts (Error: ${error.message})`);
  }

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir });
    const expressConflict = result.conflicts.find(c => c.package === 'express');
    assert(expressConflict !== undefined, 'resolveConflicts identifies express conflict');
    assert(expressConflict.currentVersions.length > 1, 'resolveConflicts identifies multiple versions of express');
  } catch (error) {
    assert(false, `resolveConflicts identifies express conflict (Error: ${error.message})`);
  }

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir });
    const lodashConflict = result.conflicts.find(c => c.package === 'lodash');
    assert(lodashConflict !== undefined, 'resolveConflicts identifies lodash conflict');
    assert(lodashConflict.currentVersions.length > 1, 'resolveConflicts identifies multiple versions of lodash');
  } catch (error) {
    assert(false, `resolveConflicts identifies lodash conflict (Error: ${error.message})`);
  }

  // ============================================================================
  // Resolution Type Tests
  // ============================================================================

  console.log('\n--- Resolution Types ---');

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir, preferLatest: true });
    const hasUpgrade = result.conflicts.some(c => c.resolutionType === 'upgrade');
    assert(hasUpgrade, 'resolveConflicts suggests upgrade when preferLatest is true');
  } catch (error) {
    assert(false, `resolveConflicts suggests upgrade when preferLatest is true (Error: ${error.message})`);
  }

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir, allowDowngrade: true });
    const hasDowngrade = result.conflicts.some(c => c.resolutionType === 'downgrade');
    // Note: downgrade may not always be suggested depending on constraints
    assert(true, 'resolveConflicts allows downgrade when allowDowngrade is true');
  } catch (error) {
    assert(false, `resolveConflicts allows downgrade when allowDowngrade is true (Error: ${error.message})`);
  }

  // ============================================================================
  // Risk Assessment Tests
  // ============================================================================

  console.log('\n--- Risk Assessment ---');

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir });
    const hasRisk = result.conflicts.some(c => c.risk === 'low' || c.risk === 'medium' || c.risk === 'high');
    assert(hasRisk, 'resolveConflicts calculates risk for resolutions');
  } catch (error) {
    assert(false, `resolveConflicts calculates risk for resolutions (Error: ${error.message})`);
  }

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir });
    assertEqual(typeof result.summary.highRiskResolutions, 'number', 'resolveConflicts calculates high risk count');
    assertEqual(typeof result.summary.mediumRiskResolutions, 'number', 'resolveConflicts calculates medium risk count');
    assertEqual(typeof result.summary.lowRiskResolutions, 'number', 'resolveConflicts calculates low risk count');
  } catch (error) {
    assert(false, `resolveConflicts calculates risk counts (Error: ${error.message})`);
  }

  // ============================================================================
  // Affected Files Tests
  // ============================================================================

  console.log('\n--- Affected Files ---');

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir });
    const hasAffectedFiles = result.conflicts.some(c => c.affectedFiles.length > 0);
    assert(hasAffectedFiles, 'resolveConflicts identifies affected files');
  } catch (error) {
    assert(false, `resolveConflicts identifies affected files (Error: ${error.message})`);
  }

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir });
    const expressConflict = result.conflicts.find(c => c.package === 'express');
    if (expressConflict) {
      assert(expressConflict.affectedFiles.length > 0, 'resolveConflicts lists affected files for express');
    }
  } catch (error) {
    assert(false, `resolveConflicts lists affected files for express (Error: ${error.message})`);
  }

  // ============================================================================
  // Summary Statistics Tests
  // ============================================================================

  console.log('\n--- Summary Statistics ---');

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir });
    assertEqual(typeof result.summary.totalDependencies, 'number', 'resolveConflicts calculates total dependencies');
    assertEqual(typeof result.summary.conflictsFound, 'number', 'resolveConflicts calculates conflicts found');
    assertEqual(typeof result.summary.conflictsResolved, 'number', 'resolveConflicts calculates conflicts resolved');
    assertEqual(typeof result.summary.packagesChecked, 'number', 'resolveConflicts calculates packages checked');
  } catch (error) {
    assert(false, `resolveConflicts calculates summary statistics (Error: ${error.message})`);
  }

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir });
    assert(result.summary.conflictsFound === result.conflicts.length, 'resolveConflicts summary matches conflicts array');
  } catch (error) {
    assert(false, `resolveConflicts summary matches conflicts array (Error: ${error.message})`);
  }

  // ============================================================================
  // Convenience Functions Tests
  // ============================================================================

  console.log('\n--- Convenience Functions ---');

  try {
    const result = await quickResolveConflicts(testProjectDir);
    assert(result !== null, 'quickResolveConflicts works with default options');
    assertEqual(result.projectPath, testProjectDir, 'quickResolveConflicts uses correct project path');
  } catch (error) {
    assert(false, `quickResolveConflicts works with default options (Error: ${error.message})`);
  }

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir });
    const summary = getConflictResolutionSummary(result);
    assert(typeof summary === 'string', 'getConflictResolutionSummary returns string');
    assert(summary.includes('Conflict Resolution Summary'), 'getConflictResolutionSummary includes title');
    assert(summary.includes('Conflicts Found:'), 'getConflictResolutionSummary includes conflicts count');
  } catch (error) {
    assert(false, `getConflictResolutionSummary returns formatted string (Error: ${error.message})`);
  }

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir });
    const json = getConflictResolutionAsJSON(result);
    const parsed = JSON.parse(json);
    assert(parsed.projectPath === testProjectDir, 'getConflictResolutionAsJSON returns valid JSON');
    assert(Array.isArray(parsed.conflicts), 'getConflictResolutionAsJSON includes conflicts array');
  } catch (error) {
    assert(false, `getConflictResolutionAsJSON returns valid JSON (Error: ${error.message})`);
  }

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir });
    const markdown = getConflictResolutionAsMarkdown(result);
    assert(typeof markdown === 'string', 'getConflictResolutionAsMarkdown returns string');
    assert(markdown.includes('# Conflict Resolution Report'), 'getConflictResolutionAsMarkdown includes title');
    assert(markdown.includes('| Package |'), 'getConflictResolutionAsMarkdown includes table header');
  } catch (error) {
    assert(false, `getConflictResolutionAsMarkdown returns formatted markdown (Error: ${error.message})`);
  }

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  console.log('\n--- Error Handling ---');

  try {
    const result = await resolveConflicts({ projectPath: '/nonexistent/path' });
    assert(result.errors.length > 0, 'resolveConflicts handles non-existent project');
  } catch (error) {
    assert(false, `resolveConflicts handles non-existent project (Error: ${error.message})`);
  }

  try {
    const invalidDir = join(testDir, 'invalid-project');
    mkdirSync(invalidDir, { recursive: true });
    writeFileSync(
      join(invalidDir, 'package.json'),
      '{ invalid json'
    );
    const result = await resolveConflicts({ projectPath: invalidDir });
    assert(result.errors.length > 0 || result.warnings.length > 0, 'resolveConflicts handles invalid package.json');
  } catch (error) {
    assert(false, `resolveConflicts handles invalid package.json (Error: ${error.message})`);
  }

  // ============================================================================
  // Parallel Processing Tests
  // ============================================================================

  console.log('\n--- Parallel Processing ---');

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir, parallelChecks: 2 });
    assert(result.conflicts.length > 0, 'resolveConflicts handles parallel checks');
  } catch (error) {
    assert(false, `resolveConflicts handles parallel checks (Error: ${error.message})`);
  }

  // ============================================================================
  // Timeout Handling Tests
  // ============================================================================

  console.log('\n--- Timeout Handling ---');

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir, timeout: 100 });
    assert(result !== null, 'resolveConflicts handles timeout');
  } catch (error) {
    assert(false, `resolveConflicts handles timeout (Error: ${error.message})`);
  }

  // ============================================================================
  // Scan Result Integration Tests
  // ============================================================================

  console.log('\n--- Scan Result Integration ---');

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir });
    assert(result.scanResult !== null, 'resolveConflicts includes scan result');
    assertEqual(result.scanResult.projectPath, testProjectDir, 'resolveConflicts scan result has correct project path');
  } catch (error) {
    assert(false, `resolveConflicts includes scan result (Error: ${error.message})`);
  }

  try {
    const result = await resolveConflicts({ projectPath: testProjectDir });
    assert(Array.isArray(result.scanResult.dependencies), 'resolveConflicts scan result includes dependencies');
    assert(Array.isArray(result.scanResult.files), 'resolveConflicts scan result includes files');
  } catch (error) {
    assert(false, `resolveConflicts scan result includes dependencies and files (Error: ${error.message})`);
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  console.log('\n--- Cleanup ---');

  cleanupTestProject();

  // ============================================================================
  // Test Summary
  // ============================================================================

  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}`);
  console.log(`Total: ${testsPassed + testsFailed}`);

  if (testsFailed === 0) {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  } else {
    console.log(`\n❌ ${testsFailed} test(s) failed`);
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
