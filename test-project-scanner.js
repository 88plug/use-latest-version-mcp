#!/usr/bin/env node

/**
 * Test script for project scanner
 */

import { scanProject, findDependencyFiles, findLockFiles, ProjectScanner } from './build/project-scanner.js';
import { writeFileSync, mkdirSync, rmSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

console.log('=== Project Scanner Tests ===\n');

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
const testDir = './test-project-scan';
const cleanup = () => {
  if (existsSync(testDir)) {
    try {
      // rmdirSync({recursive}) was removed in Node 22+; rmSync is the supported API.
      rmSync(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
};

// Cleanup before tests
cleanup();
mkdirSync(testDir, { recursive: true });

// ============================================================================
// Test 1: Scanner Class
// ============================================================================
console.log('\n--- Scanner Class ---');

test('ProjectScanner can be instantiated', () => {
  const scanner = new ProjectScanner();
  assert(scanner !== undefined, 'scanner should be defined');
});

test('ProjectScanner accepts custom options', () => {
  const scanner = new ProjectScanner({ maxDepth: 5 });
  assert(scanner !== undefined, 'scanner should be defined');
});

test('ProjectScanner.getDependencyFilePatterns returns patterns', () => {
  const patterns = ProjectScanner.getDependencyFilePatterns();
  assert(Array.isArray(patterns), 'should return array');
  assert(patterns.length > 0, 'should have patterns');
  assert(patterns.includes('package.json'), 'should include package.json');
});

test('ProjectScanner.getLockFilePatterns returns patterns', () => {
  const patterns = ProjectScanner.getLockFilePatterns();
  assert(Array.isArray(patterns), 'should return array');
  assert(patterns.length > 0, 'should have patterns');
  assert(patterns.includes('package-lock.json'), 'should include package-lock.json');
});

test('ProjectScanner.getAllFilePatterns returns all patterns', () => {
  const patterns = ProjectScanner.getAllFilePatterns();
  assert(Array.isArray(patterns), 'should return array');
  assert(patterns.length > 0, 'should have patterns');
  assert(patterns.includes('package.json'), 'should include package.json');
  assert(patterns.includes('package-lock.json'), 'should include package-lock.json');
});

// ============================================================================
// Test 2: Empty Directory
// ============================================================================
console.log('\n--- Empty Directory ---');

test('scanProject handles empty directory', () => {
  const emptyDir = join(testDir, 'empty');
  mkdirSync(emptyDir, { recursive: true });
  const result = scanProject(emptyDir);
  assert(result.files.length === 0, 'should have no files');
  assert(result.dependencies.length === 0, 'should have no dependencies');
  assert(result.errors.length === 0, 'should have no errors');
});

// ============================================================================
// Test 3: Non-existent Directory
// ============================================================================
console.log('\n--- Non-existent Directory ---');

test('scanProject handles non-existent directory', () => {
  const result = scanProject(join(testDir, 'nonexistent'));
  assert(result.files.length === 0, 'should have no files');
  assert(result.errors.length > 0, 'should have errors');
  assert(result.errors[0].includes('does not exist'), 'error should mention does not exist');
});

test('scanProject handles file instead of directory', () => {
  const filePath = join(testDir, 'not-a-dir.txt');
  writeFileSync(filePath, 'test');
  const result = scanProject(filePath);
  assert(result.files.length === 0, 'should have no files');
  assert(result.errors.length > 0, 'should have errors');
  assert(result.errors[0].includes('not a directory'), 'error should mention not a directory');
});

// ============================================================================
// Test 4: Single Dependency File
// ============================================================================
console.log('\n--- Single Dependency File ---');

const packageJson = {
  name: 'test-project',
  version: '1.0.0',
  dependencies: {
    express: '^4.18.0',
    lodash: '^4.17.0',
  },
};

const singleDepDir = join(testDir, 'single-dep');
mkdirSync(singleDepDir, { recursive: true });
writeFileSync(join(singleDepDir, 'package.json'), JSON.stringify(packageJson, null, 2));

test('scanProject finds package.json', () => {
  const result = scanProject(singleDepDir);
  assert(result.files.length === 1, 'should find 1 file');
  assert(result.files[0].type === 'dependency', 'should be dependency file');
  assert(result.files[0].parser === 'npm', 'should be npm parser');
});

test('scanProject parses dependencies from package.json', () => {
  const result = scanProject(singleDepDir);
  assert(result.dependencies.length === 2, 'should have 2 dependencies');
  assert(result.dependencies.some(d => d.name === 'express'), 'should have express');
  assert(result.dependencies.some(d => d.name === 'lodash'), 'should have lodash');
});

test('scanProject calculates summary correctly', () => {
  const result = scanProject(singleDepDir);
  assert(result.summary.totalFiles === 1, 'should have 1 total file');
  assert(result.summary.dependencyFiles === 1, 'should have 1 dependency file');
  assert(result.summary.lockFiles === 0, 'should have 0 lock files');
  assert(result.summary.totalDependencies === 2, 'should have 2 total dependencies');
  assert(result.summary.uniqueDependencies === 2, 'should have 2 unique dependencies');
  assert(result.summary.registries.includes('npm'), 'should include npm registry');
});

// ============================================================================
// Test 5: Multiple Dependency Files
// ============================================================================
console.log('\n--- Multiple Dependency Files ---');

const multiDepDir = join(testDir, 'multi-dep');
mkdirSync(multiDepDir, { recursive: true });

// npm
writeFileSync(join(multiDepDir, 'package.json'), JSON.stringify({
  name: 'test',
  dependencies: { express: '^4.18.0' },
}, null, 2));

// Python
writeFileSync(join(multiDepDir, 'requirements.txt'), 'requests==2.28.0\ndjango==3.2.0\n');

// Go
writeFileSync(join(multiDepDir, 'go.mod'), 'module test\n\ngo 1.21\n\nrequire github.com/gin-gonic/gin v1.9.1\n');

test('scanProject finds multiple dependency files', () => {
  const result = scanProject(multiDepDir);
  assert(result.files.length === 3, 'should find 3 files');
  assert(result.files.some(f => f.parser === 'npm'), 'should have npm file');
  assert(result.files.some(f => f.parser === 'pypi'), 'should have pypi file');
  assert(result.files.some(f => f.parser === 'go'), 'should have go file');
});

test('scanProject parses dependencies from multiple files', () => {
  const result = scanProject(multiDepDir);
  assert(result.dependencies.length === 4, 'should have 4 dependencies');
  assert(result.dependencies.some(d => d.name === 'express'), 'should have express');
  assert(result.dependencies.some(d => d.name === 'requests'), 'should have requests');
  assert(result.dependencies.some(d => d.name === 'django'), 'should have django');
  assert(result.dependencies.some(d => d.name === 'github.com/gin-gonic/gin'), 'should have gin');
});

test('scanProject detects multiple registries', () => {
  const result = scanProject(multiDepDir);
  assert(result.summary.registries.length === 3, 'should have 3 registries');
  assert(result.summary.registries.includes('npm'), 'should include npm');
  assert(result.summary.registries.includes('pypi'), 'should include pypi');
  assert(result.summary.registries.includes('go'), 'should include go');
});

// ============================================================================
// Test 6: Lock Files
// ============================================================================
console.log('\n--- Lock Files ---');

const lockDir = join(testDir, 'lock-files');
mkdirSync(lockDir, { recursive: true });

// package-lock.json
writeFileSync(join(lockDir, 'package-lock.json'), JSON.stringify({
  name: 'test',
  lockfileVersion: 3,
  packages: {
    '': { name: 'test', version: '1.0.0' },
    'node_modules/express': { version: '4.18.2' },
  },
}, null, 2));

// yarn.lock
writeFileSync(join(lockDir, 'yarn.lock'), 'express@^4.18.0:\n  version "4.18.2"\n');

test('scanProject finds lock files when includeLockFiles is true', () => {
  const result = scanProject(lockDir);
  assert(result.files.length === 2, 'should find 2 files');
  assert(result.files.some(f => f.type === 'lock'), 'should have lock file');
});

test('scanProject parses lock file dependencies', () => {
  const result = scanProject(lockDir);
  assert(result.dependencies.length === 2, 'should have 2 dependencies');
  assert(result.dependencies.every(d => d.sourceType === 'lock'), 'all should be from lock files');
});

test('scanProject skips lock files when includeLockFiles is false', () => {
  const result = scanProject(lockDir, { includeLockFiles: false });
  assert(result.files.length === 0, 'should find no files');
});

// ============================================================================
// Test 7: Directory Exclusion
// ============================================================================
console.log('\n--- Directory Exclusion ---');

const excludeDir = join(testDir, 'exclude-test');
mkdirSync(excludeDir, { recursive: true });

// Root package.json
writeFileSync(join(excludeDir, 'package.json'), JSON.stringify({
  name: 'root',
  dependencies: { express: '^4.18.0' },
}, null, 2));

// node_modules/package.json (should be excluded)
const nodeModulesDir = join(excludeDir, 'node_modules');
mkdirSync(nodeModulesDir, { recursive: true });
writeFileSync(join(nodeModulesDir, 'package.json'), JSON.stringify({
  name: 'excluded',
  dependencies: { lodash: '^4.17.0' },
}, null, 2));

test('scanProject excludes node_modules by default', () => {
  const result = scanProject(excludeDir);
  assert(result.files.length === 1, 'should find only 1 file');
  assert(result.files[0].relativePath === 'package.json', 'should be root package.json');
});

test('scanProject excludes .git by default', () => {
  const gitDir = join(excludeDir, '.git');
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, 'package.json'), JSON.stringify({ name: 'git' }, null, 2));
  
  const result = scanProject(excludeDir);
  assert(result.files.length === 1, 'should still find only 1 file');
});

test('scanProject respects custom exclude patterns', () => {
  const customDir = join(excludeDir, 'custom');
  mkdirSync(customDir, { recursive: true });
  writeFileSync(join(customDir, 'package.json'), JSON.stringify({ name: 'custom' }, null, 2));
  
  const result = scanProject(excludeDir, { excludePatterns: ['custom'] });
  assert(result.files.length === 1, 'should exclude custom directory');
});

// ============================================================================
// Test 8: Max Depth
// ============================================================================
console.log('\n--- Max Depth ---');

const depthDir = join(testDir, 'depth-test');
mkdirSync(depthDir, { recursive: true });
mkdirSync(join(depthDir, 'level1'), { recursive: true });
mkdirSync(join(depthDir, 'level1', 'level2'), { recursive: true });
mkdirSync(join(depthDir, 'level1', 'level2', 'level3'), { recursive: true });

writeFileSync(join(depthDir, 'package.json'), JSON.stringify({ name: 'root' }, null, 2));
writeFileSync(join(depthDir, 'level1', 'package.json'), JSON.stringify({ name: 'level1' }, null, 2));
writeFileSync(join(depthDir, 'level1', 'level2', 'package.json'), JSON.stringify({ name: 'level2' }, null, 2));
writeFileSync(join(depthDir, 'level1', 'level2', 'level3', 'package.json'), JSON.stringify({ name: 'level3' }, null, 2));

test('scanProject respects maxDepth', () => {
  const result = scanProject(depthDir, { maxDepth: 2 });
  assert(result.files.length === 3, 'should find 3 files (root, level1, level2)');
});

test('scanProject with unlimited depth finds all files', () => {
  const result = scanProject(depthDir, { maxDepth: 10 });
  assert(result.files.length === 4, 'should find all 4 files');
});

// ============================================================================
// Test 9: Convenience Functions
// ============================================================================
console.log('\n--- Convenience Functions ---');

test('findDependencyFiles returns only dependency files', () => {
  const files = findDependencyFiles(multiDepDir);
  assert(files.length === 3, 'should find 3 dependency files');
  assert(files.every(f => f.endsWith('package.json') || f.endsWith('requirements.txt') || f.endsWith('go.mod')), 'should be dependency files');
});

test('findLockFiles returns only lock files', () => {
  const files = findLockFiles(lockDir);
  assert(files.length === 2, 'should find 2 lock files');
  assert(files.every(f => f.endsWith('package-lock.json') || f.endsWith('yarn.lock')), 'should be lock files');
});

// ============================================================================
// Test 10: File Metadata
// ============================================================================
console.log('\n--- File Metadata ---');

test('scanProject includes file metadata', () => {
  const result = scanProject(singleDepDir);
  assert(result.files.length === 1, 'should have 1 file');
  const file = result.files[0];
  assert(file.path !== undefined, 'should have path');
  assert(file.relativePath !== undefined, 'should have relativePath');
  assert(file.type === 'dependency', 'should have type');
  assert(file.parser === 'npm', 'should have parser');
  assert(file.registry === 'npm', 'should have registry');
  assert(typeof file.size === 'number', 'should have size');
  assert(file.modified instanceof Date, 'should have modified date');
});

// ============================================================================
// Test 11: Error Handling
// ============================================================================
console.log('\n--- Error Handling ---');

test('scanProject handles invalid JSON in dependency file', () => {
  const invalidDir = join(testDir, 'invalid');
  mkdirSync(invalidDir, { recursive: true });
  writeFileSync(join(invalidDir, 'package.json'), '{ invalid json }');
  
  const result = scanProject(invalidDir);
  assert(result.files.length === 1, 'should find the file');
  assert(result.errors.length > 0, 'should have errors');
});

test('scanProject handles invalid lock file', () => {
  const invalidLockDir = join(testDir, 'invalid-lock');
  mkdirSync(invalidLockDir, { recursive: true });
  writeFileSync(join(invalidLockDir, 'package-lock.json'), '{ invalid json }');
  
  const result = scanProject(invalidLockDir);
  assert(result.files.length === 1, 'should find the file');
  assert(result.errors.length > 0, 'should have errors');
});

// ============================================================================
// Test 12: All File Types
// ============================================================================
console.log('\n--- All File Types ---');

const allTypesDir = join(testDir, 'all-types');
mkdirSync(allTypesDir, { recursive: true });

// Create all dependency file types
writeFileSync(join(allTypesDir, 'package.json'), JSON.stringify({ dependencies: { express: '^4.18.0' } }, null, 2));
writeFileSync(join(allTypesDir, 'requirements.txt'), 'requests==2.28.0\n');
writeFileSync(join(allTypesDir, 'go.mod'), 'module test\nrequire github.com/gin-gonic/gin v1.9.1\n');
writeFileSync(join(allTypesDir, 'Cargo.toml'), '[dependencies]\nserde = "1.0"\n');
writeFileSync(join(allTypesDir, 'Gemfile'), 'gem "rails"\n');
writeFileSync(join(allTypesDir, 'pom.xml'), '<dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId><version>3.0.0</version></dependency></dependencies>\n');
writeFileSync(join(allTypesDir, 'pyproject.toml'), '[project]\ndependencies = ["requests"]\n');

test('scanProject finds all dependency file types', () => {
  const result = scanProject(allTypesDir);
  assert(result.files.length === 7, 'should find 7 dependency files');
  const parsers = result.files.map(f => f.parser);
  assert(parsers.includes('npm'), 'should have npm');
  assert(parsers.includes('pypi'), 'should have pypi');
  assert(parsers.includes('go'), 'should have go');
  assert(parsers.includes('crates'), 'should have crates');
  assert(parsers.includes('rubygems'), 'should have rubygems');
  assert(parsers.includes('maven'), 'should have maven');
});

// ============================================================================
// Test 13: Unique Dependencies
// ============================================================================
console.log('\n--- Unique Dependencies ---');

const uniqueDir = join(testDir, 'unique');
mkdirSync(uniqueDir, { recursive: true });

// Same dependency in multiple files
writeFileSync(join(uniqueDir, 'package.json'), JSON.stringify({ dependencies: { express: '^4.18.0' } }, null, 2));
writeFileSync(join(uniqueDir, 'package-lock.json'), JSON.stringify({
  lockfileVersion: 3,
  packages: {
    '': { name: 'test', version: '1.0.0' },
    'node_modules/express': { version: '4.18.2' },
  },
}, null, 2));

test('scanProject counts unique dependencies correctly', () => {
  const result = scanProject(uniqueDir);
  assert(result.summary.totalDependencies === 2, 'should have 2 total dependencies');
  assert(result.summary.uniqueDependencies === 1, 'should have 1 unique dependency');
});

// ============================================================================
// Test 14: Scan Result Structure
// ============================================================================
console.log('\n--- Scan Result Structure ---');

test('scanProject returns complete result structure', () => {
  const result = scanProject(singleDepDir);
  assert(result.projectPath !== undefined, 'should have projectPath');
  assert(result.scannedAt instanceof Date, 'should have scannedAt date');
  assert(Array.isArray(result.files), 'should have files array');
  assert(Array.isArray(result.dependencies), 'should have dependencies array');
  assert(Array.isArray(result.errors), 'should have errors array');
  assert(Array.isArray(result.warnings), 'should have warnings array');
  assert(result.summary !== undefined, 'should have summary');
  assert(typeof result.summary.totalFiles === 'number', 'summary should have totalFiles');
  assert(typeof result.summary.dependencyFiles === 'number', 'summary should have dependencyFiles');
  assert(typeof result.summary.lockFiles === 'number', 'summary should have lockFiles');
  assert(typeof result.summary.totalDependencies === 'number', 'summary should have totalDependencies');
  assert(typeof result.summary.uniqueDependencies === 'number', 'summary should have uniqueDependencies');
  assert(Array.isArray(result.summary.registries), 'summary should have registries array');
});

// ============================================================================
// Cleanup
// ============================================================================
console.log('\n--- Cleanup ---');

cleanup();

// ============================================================================
// Undefined option override (regression)
// ============================================================================
console.log('\n--- Undefined Option Override ---');

const undefDir = join(testDir, 'undef-opt');
mkdirSync(undefDir, { recursive: true });
writeFileSync(join(undefDir, 'package.json'), JSON.stringify({ name: 'root', dependencies: { express: '^4.0.0' } }, null, 2));
writeFileSync(join(undefDir, 'package-lock.json'), JSON.stringify({ name: 'root', lockfileVersion: 3, packages: { '': { name: 'root' }, 'node_modules/express': { version: '4.18.2' } } }, null, 2));

test('explicit includeLockFiles:undefined does not disable lock scanning (default true)', () => {
  const result = scanProject(undefDir, { includeLockFiles: undefined });
  assert(result.summary.lockFiles >= 1, `lock files should still be scanned, got ${result.summary.lockFiles}`);
});

test('explicit maxDepth:undefined falls back to the default (not NaN/unbounded)', () => {
  const result = scanProject(undefDir, { maxDepth: undefined });
  assert(result.files.length >= 1, 'scan should still find the root files with undefined maxDepth');
});

// Final cleanup: the undef-opt regression block above recreates the scratch
// dir after cleanup(), so remove it once more to leave the tree clean.
rmSync(testDir, { recursive: true, force: true });

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
