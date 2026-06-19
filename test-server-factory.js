#!/usr/bin/env node

/**
 * End-to-end test for the shared MCP server factory.
 * Connects a real MCP client to createMcpServer() over an in-memory transport
 * and verifies the full tool set is exposed (the same set for both transports)
 * and that the new scan_project tool works against this repository.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, getInstallCommand } from './build/server-factory.js';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

const EXPECTED_TOOLS = [
  'get_latest_version',
  'get_package_info',
  'get_install_command',
  'compare_versions',
  'check_multiple_packages',
  'check_compatibility',
  'detect_conflicts',
  'suggest_upgrade_path',
  'find_compatible_version',
  'scan_project',
  'check_outdated',
  'resolve_conflicts',
  'optimize_versions',
  'validate_upgrade_plan',
  'apply_upgrades',
];

console.log('=== MCP Server Factory E2E Tests ===\n');

const server = createMcpServer();
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });

await server.connect(serverTransport);
await client.connect(clientTransport);

await test('lists exactly the expected tool set', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert(names.length === EXPECTED_TOOLS.length, `expected ${EXPECTED_TOOLS.length} tools, got ${names.length}: ${names.join(', ')}`);
  for (const expected of EXPECTED_TOOLS) {
    assert(names.includes(expected), `missing tool: ${expected}`);
  }
});

await test('exposes the four tools the HTTP transport previously dropped', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const t of ['check_compatibility', 'detect_conflicts', 'suggest_upgrade_path', 'find_compatible_version']) {
    assert(names.includes(t), `tool ${t} should be exposed`);
  }
});

await test('get_install_command accepts a non-core registry (enum widened)', async () => {
  const res = await client.callTool({
    name: 'get_install_command',
    arguments: { package_name: 'Newtonsoft.Json', registry: 'nuget' },
  });
  // It will hit the network for the version; we only assert the call is accepted
  // (not rejected by the input schema) and returns content.
  assert(Array.isArray(res.content) && res.content.length > 0, 'should return content');
});

await test('scan_project inventories this repo (package.json dependencies)', async () => {
  const res = await client.callTool({
    name: 'scan_project',
    arguments: { project_path: process.cwd(), include_lock_files: false, max_depth: 1 },
  });
  const payload = JSON.parse(res.content[0].text);
  assert(Array.isArray(payload.dependencies), 'scan result should have a dependencies array');
  const names = payload.dependencies.map((d) => d.name);
  assert(names.includes('express'), 'should find express from package.json');
  assert(names.includes('helmet'), 'should find helmet from package.json');
});

await test('getInstallCommand npm has no double space and supports -D', async () => {
  assert(
    getInstallCommand('express', 'npm', '5.2.1', false) === 'npm install express@5.2.1',
    `non-dev npm command should have no double space, got "${getInstallCommand('express', 'npm', '5.2.1', false)}"`
  );
  assert(
    getInstallCommand('express', 'npm', '5.2.1', true) === 'npm install -D express@5.2.1',
    'dev npm command should include -D'
  );
});

await test('detect_conflicts works end-to-end (no network)', async () => {
  const res = await client.callTool({
    name: 'detect_conflicts',
    arguments: {
      dependencies: [
        { name: 'lodash', constraint: '4.17.0' },
        { name: 'lodash', constraint: '3.10.0' },
      ],
    },
  });
  const payload = JSON.parse(res.content[0].text);
  assert(payload.hasConflicts === true, 'should detect a lodash version conflict');
});

await test('resolve_conflicts is wired and returns a structured result (empty project, no network)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ulv-rc-'));
  try {
    const res = await client.callTool({
      name: 'resolve_conflicts',
      arguments: { project_path: dir },
    });
    const payload = JSON.parse(res.content[0].text);
    assert(Array.isArray(payload.conflicts), 'result should have a conflicts array');
    assert(payload.conflicts.length === 0, 'an empty project has no conflicts');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('optimize_versions is wired and returns a plan (empty project, no network)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ulv-opt-'));
  try {
    const res = await client.callTool({
      name: 'optimize_versions',
      arguments: { project_path: dir },
    });
    const payload = JSON.parse(res.content[0].text);
    assert(Array.isArray(payload.plan), 'result should have a plan array');
    assert(payload.plan.length === 0, 'an empty project yields an empty plan');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('validate_upgrade_plan passes a minor bump (no network)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ulv-val-'));
  try {
    const res = await client.callTool({
      name: 'validate_upgrade_plan',
      arguments: {
        project_path: dir,
        plan: [
          {
            package: 'express',
            registry: 'npm',
            currentVersion: '4.18.0',
            suggestedVersion: '4.19.0',
            action: 'upgrade',
            reason: 'minor bump',
            risk: 'low',
            affectedFiles: ['package.json'],
          },
        ],
      },
    });
    const payload = JSON.parse(res.content[0].text);
    assert(payload.valid === true, 'a minor bump plan should be valid');
    assert(payload.canApply === true, 'a minor bump plan should be applyable');
    assert(payload.breakingChanges.length === 0, 'a minor bump is not a breaking change');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('apply_upgrades dry-run reports the change without writing (no network)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ulv-apply-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { lodash: '4.17.21' } }, null, 2));
    const res = await client.callTool({
      name: 'apply_upgrades',
      arguments: {
        project_path: dir,
        dry_run: true,
        plan: [
          {
            package: 'lodash',
            registry: 'npm',
            currentVersion: '4.17.21',
            suggestedVersion: '4.17.22',
            action: 'upgrade',
            reason: 'patch bump',
            risk: 'low',
            affectedFiles: ['package.json'],
          },
        ],
      },
    });
    const payload = JSON.parse(res.content[0].text);
    assert(payload.dryRun === true, 'should report a dry run');
    assert(payload.summary.totalChanges === 1, `dry run should compute one change, got ${payload.summary.totalChanges}`);
    assert(payload.summary.packagesUpgraded === 1, `should classify it as an upgrade, got ${payload.summary.packagesUpgraded}`);
    const onDisk = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    assert(onDisk.dependencies.lodash === '4.17.21', 'dry run must NOT modify the file on disk');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n=== Test Summary ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

await client.close();
await server.close();

if (failed > 0) {
  console.log('\n❌ Some tests failed');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
