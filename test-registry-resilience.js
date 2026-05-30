#!/usr/bin/env node

/**
 * Deterministic (offline) tests for the registry resilience layer.
 * Verifies that CachingRegistryClient memoizes successful lookups and does not
 * cache failures. The timeout-aware fetch wrapper is verified separately by a
 * live smoke check (REGISTRY_TIMEOUT_MS=1 aborts a real request).
 */

import { CachingRegistryClient, pickLatestStable } from './build/registries.js';

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

console.log('=== Registry Resilience Tests ===\n');

// Use a unique registry label per test so the shared process cache never
// collides across tests in this file.
function fakeClient(version) {
  let versionCalls = 0;
  let infoCalls = 0;
  return {
    client: {
      async getLatestVersion() {
        versionCalls++;
        return version;
      },
      async getPackageInfo() {
        infoCalls++;
        return { name: 'pkg', latestVersion: version, registry: 'fake' };
      },
    },
    get versionCalls() {
      return versionCalls;
    },
    get infoCalls() {
      return infoCalls;
    },
  };
}

await test('getLatestVersion is served from cache on the second call', async () => {
  const fake = fakeClient('1.2.3');
  const cached = new CachingRegistryClient(fake.client, 'res-test-version');
  const a = await cached.getLatestVersion('pkg');
  const b = await cached.getLatestVersion('pkg');
  assert(a === '1.2.3' && b === '1.2.3', 'both calls return the value');
  assert(fake.versionCalls === 1, `inner client should be called once, was ${fake.versionCalls}`);
});

await test('getPackageInfo is cached independently of getLatestVersion', async () => {
  const fake = fakeClient('4.5.6');
  const cached = new CachingRegistryClient(fake.client, 'res-test-info');
  const a = await cached.getPackageInfo('pkg');
  const b = await cached.getPackageInfo('pkg');
  assert(a.latestVersion === '4.5.6' && b.latestVersion === '4.5.6', 'both return info');
  assert(fake.infoCalls === 1, `inner getPackageInfo should be called once, was ${fake.infoCalls}`);
});

await test('failures are not cached (errors propagate, retried next time)', async () => {
  let calls = 0;
  const flaky = {
    async getLatestVersion() {
      calls++;
      if (calls === 1) throw new Error('transient registry failure');
      return '9.9.9';
    },
    async getPackageInfo() {
      return { name: 'pkg', latestVersion: '9.9.9', registry: 'fake' };
    },
  };
  const cached = new CachingRegistryClient(flaky, 'res-test-failure');
  let threw = false;
  try {
    await cached.getLatestVersion('pkg');
  } catch {
    threw = true;
  }
  assert(threw, 'first call should propagate the error');
  const v = await cached.getLatestVersion('pkg');
  assert(v === '9.9.9', 'second call should succeed (failure was not cached)');
  assert(calls === 2, `inner should be called twice, was ${calls}`);
});

await test('pickLatestStable skips prereleases (NuGet-style ascending list)', async () => {
  // Real Newtonsoft.Json-style list: stable releases then a trailing prerelease.
  assert(pickLatestStable(['13.0.1', '13.0.3', '13.0.5-beta1']) === '13.0.3',
    'should skip the trailing prerelease and return the latest stable');
  assert(pickLatestStable(['1.0.0', '1.1.0', '2.0.0']) === '2.0.0',
    'all-stable list returns the last');
  assert(pickLatestStable(['1.0.0', '2.0.0-rc.1', '1.5.0']) === '1.5.0',
    'prerelease anywhere is skipped');
});

await test('pickLatestStable falls back to last when all are prereleases', async () => {
  assert(pickLatestStable(['1.0.0-rc.1', '1.0.0-rc.2']) === '1.0.0-rc.2',
    'no stable version -> last entry');
});

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
