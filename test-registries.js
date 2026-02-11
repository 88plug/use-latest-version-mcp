#!/usr/bin/env node

import { getRegistryClient } from './build/registries.js';

console.log('Testing registry clients...\n');

async function testRegistry(registry, packageName) {
  try {
    console.log(`Testing ${registry}: ${packageName}`);
    const client = getRegistryClient(registry);
    const version = await client.getLatestVersion(packageName);
    const info = await client.getPackageInfo(packageName);
    console.log(`  ✓ Latest version: ${version}`);
    console.log(`  ✓ Description: ${info.description?.substring(0, 60)}...`);
    console.log('');
    return true;
  } catch (error) {
    console.log(`  ✗ Error: ${error.message}`);
    console.log('');
    return false;
  }
}

async function runTests() {
  const tests = [
    { registry: 'npm', package: 'express' },
    { registry: 'pypi', package: 'requests' },
    { registry: 'github', package: 'facebook/react' },
    { registry: 'dockerhub', package: 'nginx' },
    { registry: 'crates', package: 'serde' },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await testRegistry(test.registry, test.package);
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Tests passed: ${passed}/${tests.length}`);
  console.log(`Tests failed: ${failed}/${tests.length}`);
  console.log(`${'='.repeat(50)}\n`);

  if (failed === 0) {
    console.log('✓ All tests passed! MCP server is ready to use.');
  } else {
    console.log('✗ Some tests failed. Check network connectivity.');
  }
}

runTests().catch(console.error);
