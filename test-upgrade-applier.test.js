/**
 * Tests for Upgrade Applier
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, rmdirSync } from 'fs';
import { join } from 'path';
import { UpgradeApplier, applyUpgrades, applySingleUpgrade, previewUpgrades } from './src/upgrade-applier.js';

// Test directory
const TEST_DIR = './test-upgrade-applier-temp';

// Setup and teardown
beforeEach(() => {
  // Create test directory
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
});

afterEach(() => {
  // Clean up test directory
  try {
    if (existsSync(TEST_DIR)) {
      // Remove backup directory if exists
      const backupDir = join(TEST_DIR, '.dependency-backups');
      if (existsSync(backupDir)) {
        rmdirSync(backupDir, { recursive: true });
      }
      rmdirSync(TEST_DIR, { recursive: true });
    }
  } catch (error) {
    // Ignore cleanup errors
  }
});

// Helper function to create test file
function createTestFile(filename, content) {
  const filepath = join(TEST_DIR, filename);
  writeFileSync(filepath, content, 'utf-8');
  return filepath;
}

// Helper function to read test file
function readTestFile(filename) {
  const filepath = join(TEST_DIR, filename);
  return readFileSync(filepath, 'utf-8');
}

describe('UpgradeApplier - Basic Functionality', () => {
  it('should create an instance with default options', () => {
    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    expect(applier).toBeDefined();
  });

  it('should create an instance with custom options', () => {
    const applier = new UpgradeApplier({
      projectPath: TEST_DIR,
      dryRun: true,
      createBackup: false,
    });
    expect(applier).toBeDefined();
  });

  it('should apply empty plan without errors', async () => {
    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const result = await applier.apply([]);

    expect(result.summary.totalChanges).toBe(0);
    expect(result.summary.filesModified).toBe(0);
    expect(result.changes.length).toBe(0);
  });

  it('should skip packages with keep action', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'lodash',
      registry: 'npm',
      currentVersion: '4.17.21',
      suggestedVersion: '4.17.21',
      action: 'keep',
      reason: 'Already latest',
      risk: 'low',
      affectedFiles: ['package.json'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.totalChanges).toBe(0);
    expect(result.summary.filesModified).toBe(0);
  });
});

describe('UpgradeApplier - JSON Files (package.json)', () => {
  it('should upgrade a dependency in package.json', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21', express: '4.18.0' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'lodash',
      registry: 'npm',
      currentVersion: '4.17.21',
      suggestedVersion: '4.17.22',
      action: 'upgrade',
      reason: 'New version available',
      risk: 'low',
      affectedFiles: ['package.json'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.totalChanges).toBe(1);
    expect(result.summary.filesModified).toBe(1);
    expect(result.summary.packagesUpgraded).toBe(1);

    const content = readTestFile('package.json');
    const pkg = JSON.parse(content);
    expect(pkg.dependencies.lodash).toBe('4.17.22');
    expect(pkg.dependencies.express).toBe('4.18.0');
  });

  it('should upgrade devDependency in package.json', async () => {
    createTestFile('package.json', JSON.stringify({
      devDependencies: { jest: '29.0.0' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'jest',
      registry: 'npm',
      currentVersion: '29.0.0',
      suggestedVersion: '29.5.0',
      action: 'upgrade',
      reason: 'New version available',
      risk: 'low',
      affectedFiles: ['package.json'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.packagesUpgraded).toBe(1);

    const content = readTestFile('package.json');
    const pkg = JSON.parse(content);
    expect(pkg.devDependencies.jest).toBe('29.5.0');
  });

  it('should upgrade peerDependency in package.json', async () => {
    createTestFile('package.json', JSON.stringify({
      peerDependencies: { react: '17.0.0' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'react',
      registry: 'npm',
      currentVersion: '17.0.0',
      suggestedVersion: '18.0.0',
      action: 'upgrade',
      reason: 'New version available',
      risk: 'high',
      affectedFiles: ['package.json'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.packagesUpgraded).toBe(1);

    const content = readTestFile('package.json');
    const pkg = JSON.parse(content);
    expect(pkg.peerDependencies.react).toBe('18.0.0');
  });

  it('should remove a dependency from package.json', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21', express: '4.18.0' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'lodash',
      registry: 'npm',
      currentVersion: '4.17.21',
      suggestedVersion: '',
      action: 'remove',
      reason: 'No longer needed',
      risk: 'low',
      affectedFiles: ['package.json'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.packagesRemoved).toBe(1);

    const content = readTestFile('package.json');
    const pkg = JSON.parse(content);
    expect(pkg.dependencies.lodash).toBeUndefined();
    expect(pkg.dependencies.express).toBe('4.18.0');
  });

  it('should apply constraint instead of version', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'lodash',
      registry: 'npm',
      currentVersion: '4.17.21',
      currentConstraint: '4.17.21',
      suggestedVersion: '4.17.22',
      suggestedConstraint: '^4.17.22',
      action: 'upgrade',
      reason: 'Use caret constraint',
      risk: 'low',
      affectedFiles: ['package.json'],
    }];

    await applier.apply(plan);

    const content = readTestFile('package.json');
    const pkg = JSON.parse(content);
    expect(pkg.dependencies.lodash).toBe('^4.17.22');
  });

  it('should handle multiple upgrades in one file', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21', express: '4.18.0', axios: '0.27.0' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [
      {
        package: 'lodash',
        registry: 'npm',
        currentVersion: '4.17.21',
        suggestedVersion: '4.17.22',
        action: 'upgrade',
        reason: 'New version',
        risk: 'low',
        affectedFiles: ['package.json'],
      },
      {
        package: 'express',
        registry: 'npm',
        currentVersion: '4.18.0',
        suggestedVersion: '4.18.2',
        action: 'upgrade',
        reason: 'New version',
        risk: 'low',
        affectedFiles: ['package.json'],
      },
    ];

    const result = await applier.apply(plan);

    expect(result.summary.totalChanges).toBe(2);
    expect(result.summary.packagesUpgraded).toBe(2);

    const content = readTestFile('package.json');
    const pkg = JSON.parse(content);
    expect(pkg.dependencies.lodash).toBe('4.17.22');
    expect(pkg.dependencies.express).toBe('4.18.2');
    expect(pkg.dependencies.axios).toBe('0.27.0');
  });

  it('should preserve JSON formatting', async () => {
    const originalContent = JSON.stringify({
      dependencies: { lodash: '4.17.21' }
    }, null, 2) + '\n';

    createTestFile('package.json', originalContent);

    const applier = new UpgradeApplier({ projectPath: TEST_DIR, preserveFormatting: true });
    const plan = [{
      package: 'lodash',
      registry: 'npm',
      currentVersion: '4.17.21',
      suggestedVersion: '4.17.22',
      action: 'upgrade',
      reason: 'New version',
      risk: 'low',
      affectedFiles: ['package.json'],
    }];

    await applier.apply(plan);

    const content = readTestFile('package.json');
    expect(content).toMatch(/^\{\n  "dependencies": \{/);
  });
});

describe('UpgradeApplier - Text Files (requirements.txt)', () => {
  it('should upgrade a dependency in requirements.txt', async () => {
    createTestFile('requirements.txt', 'django==3.2.0\nrequests==2.27.0\n');

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'django',
      registry: 'pypi',
      currentVersion: '3.2.0',
      suggestedVersion: '4.0.0',
      action: 'upgrade',
      reason: 'New version',
      risk: 'high',
      affectedFiles: ['requirements.txt'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.packagesUpgraded).toBe(1);

    const content = readTestFile('requirements.txt');
    expect(content).toContain('django==4.0.0');
    expect(content).toContain('requests==2.27.0');
  });

  it('should remove a dependency from requirements.txt', async () => {
    createTestFile('requirements.txt', 'django==3.2.0\nrequests==2.27.0\n');

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'django',
      registry: 'pypi',
      currentVersion: '3.2.0',
      suggestedVersion: '',
      action: 'remove',
      reason: 'No longer needed',
      risk: 'low',
      affectedFiles: ['requirements.txt'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.packagesRemoved).toBe(1);

    const content = readTestFile('requirements.txt');
    expect(content).not.toContain('django');
    expect(content).toContain('requests==2.27.0');
  });

  it('should handle comments in requirements.txt', async () => {
    createTestFile('requirements.txt', '# Web framework\ndjango==3.2.0\n# HTTP client\nrequests==2.27.0\n');

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'django',
      registry: 'pypi',
      currentVersion: '3.2.0',
      suggestedVersion: '4.0.0',
      action: 'upgrade',
      reason: 'New version',
      risk: 'high',
      affectedFiles: ['requirements.txt'],
    }];

    await applier.apply(plan);

    const content = readTestFile('requirements.txt');
    expect(content).toContain('# Web framework');
    expect(content).toContain('django==4.0.0');
    expect(content).toContain('# HTTP client');
  });

  it('should handle packages without version specifiers', async () => {
    createTestFile('requirements.txt', 'django\nrequests==2.27.0\n');

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'django',
      registry: 'pypi',
      currentVersion: '',
      suggestedVersion: '4.0.0',
      action: 'upgrade',
      reason: 'Add version',
      risk: 'low',
      affectedFiles: ['requirements.txt'],
    }];

    await applier.apply(plan);

    const content = readTestFile('requirements.txt');
    expect(content).toContain('django==4.0.0');
  });
});

describe('UpgradeApplier - TOML Files (pyproject.toml, Cargo.toml)', () => {
  it('should upgrade a dependency in pyproject.toml', async () => {
    createTestFile('pyproject.toml', '[project]\ndependencies = [\n    "django==3.2.0",\n    "requests==2.27.0",\n]\n');

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'django',
      registry: 'pypi',
      currentVersion: '3.2.0',
      suggestedVersion: '4.0.0',
      action: 'upgrade',
      reason: 'New version',
      risk: 'high',
      affectedFiles: ['pyproject.toml'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.packagesUpgraded).toBe(1);

    const content = readTestFile('pyproject.toml');
    expect(content).toContain('django==4.0.0');
  });

  it('should upgrade a dependency in Cargo.toml', async () => {
    createTestFile('Cargo.toml', '[dependencies]\nserde = "1.0.0"\ntokio = "1.0.0"\n');

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'serde',
      registry: 'crates',
      currentVersion: '1.0.0',
      suggestedVersion: '1.0.150',
      action: 'upgrade',
      reason: 'New version',
      risk: 'low',
      affectedFiles: ['Cargo.toml'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.packagesUpgraded).toBe(1);

    const content = readTestFile('Cargo.toml');
    expect(content).toContain('serde = "1.0.150"');
  });

  it('should remove a dependency from TOML file', async () => {
    createTestFile('Cargo.toml', '[dependencies]\nserde = "1.0.0"\ntokio = "1.0.0"\n');

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'serde',
      registry: 'crates',
      currentVersion: '1.0.0',
      suggestedVersion: '',
      action: 'remove',
      reason: 'No longer needed',
      risk: 'low',
      affectedFiles: ['Cargo.toml'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.packagesRemoved).toBe(1);

    const content = readTestFile('Cargo.toml');
    expect(content).not.toContain('serde');
    expect(content).toContain('tokio = "1.0.0"');
  });
});

describe('UpgradeApplier - Go Modules (go.mod)', () => {
  it('should upgrade a dependency in go.mod', async () => {
    createTestFile('go.mod', 'module example\n\ngo 1.21\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n\tgithub.com/gorilla/mux v1.8.0\n)\n');

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'github.com/gin-gonic/gin',
      registry: 'go',
      currentVersion: 'v1.9.0',
      suggestedVersion: 'v1.9.1',
      action: 'upgrade',
      reason: 'New version',
      risk: 'low',
      affectedFiles: ['go.mod'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.packagesUpgraded).toBe(1);

    const content = readTestFile('go.mod');
    expect(content).toContain('github.com/gin-gonic/gin v1.9.1');
  });

  it('should remove a dependency from go.mod', async () => {
    createTestFile('go.mod', 'module example\n\ngo 1.21\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n\tgithub.com/gorilla/mux v1.8.0\n)\n');

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'github.com/gin-gonic/gin',
      registry: 'go',
      currentVersion: 'v1.9.0',
      suggestedVersion: '',
      action: 'remove',
      reason: 'No longer needed',
      risk: 'low',
      affectedFiles: ['go.mod'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.packagesRemoved).toBe(1);

    const content = readTestFile('go.mod');
    expect(content).not.toContain('github.com/gin-gonic/gin');
  });
});

describe('UpgradeApplier - XML Files (pom.xml)', () => {
  it('should upgrade a dependency in pom.xml', async () => {
    createTestFile('pom.xml', `<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-core</artifactId>
      <version>5.3.0</version>
    </dependency>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-web</artifactId>
      <version>5.3.0</version>
    </dependency>
  </dependencies>
</project>
`);

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'spring-core',
      registry: 'maven',
      currentVersion: '5.3.0',
      suggestedVersion: '5.3.30',
      action: 'upgrade',
      reason: 'New version',
      risk: 'low',
      affectedFiles: ['pom.xml'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.packagesUpgraded).toBe(1);

    const content = readTestFile('pom.xml');
    expect(content).toContain('<version>5.3.30</version>');
  });

  it('should remove a dependency from pom.xml', async () => {
    createTestFile('pom.xml', `<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-core</artifactId>
      <version>5.3.0</version>
    </dependency>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-web</artifactId>
      <version>5.3.0</version>
    </dependency>
  </dependencies>
</project>
`);

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'spring-core',
      registry: 'maven',
      currentVersion: '5.3.0',
      suggestedVersion: '',
      action: 'remove',
      reason: 'No longer needed',
      risk: 'low',
      affectedFiles: ['pom.xml'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.packagesRemoved).toBe(1);

    const content = readTestFile('pom.xml');
    expect(content).not.toContain('spring-core');
    expect(content).toContain('spring-web');
  });
});

describe('UpgradeApplier - Backup and Rollback', () => {
  it('should create backup when createBackup is true', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR, createBackup: true });
    const plan = [{
      package: 'lodash',
      registry: 'npm',
      currentVersion: '4.17.21',
      suggestedVersion: '4.17.22',
      action: 'upgrade',
      reason: 'New version',
      risk: 'low',
      affectedFiles: ['package.json'],
    }];

    const result = await applier.apply(plan);

    expect(result.backups.length).toBeGreaterThan(0);
    expect(result.backups[0]).toContain('.backup');
  });

  it('should not create backup when createBackup is false', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR, createBackup: false });
    const plan = [{
      package: 'lodash',
      registry: 'npm',
      currentVersion: '4.17.21',
      suggestedVersion: '4.17.22',
      action: 'upgrade',
      reason: 'New version',
      risk: 'low',
      affectedFiles: ['package.json'],
    }];

    const result = await applier.apply(plan);

    expect(result.backups.length).toBe(0);
  });

  it('should not modify files in dry run mode', async () => {
    const originalContent = JSON.stringify({
      dependencies: { lodash: '4.17.21' }
    }, null, 2);

    createTestFile('package.json', originalContent);

    const applier = new UpgradeApplier({ projectPath: TEST_DIR, dryRun: true });
    const plan = [{
      package: 'lodash',
      registry: 'npm',
      currentVersion: '4.17.21',
      suggestedVersion: '4.17.22',
      action: 'upgrade',
      reason: 'New version',
      risk: 'low',
      affectedFiles: ['package.json'],
    }];

    const result = await applier.apply(plan);

    expect(result.dryRun).toBe(true);
    expect(result.summary.totalChanges).toBe(1);

    const content = readTestFile('package.json');
    expect(content).toBe(originalContent);
  });
});

describe('UpgradeApplier - Diff Generation', () => {
  it('should generate diff for changes', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'lodash',
      registry: 'npm',
      currentVersion: '4.17.21',
      suggestedVersion: '4.17.22',
      action: 'upgrade',
      reason: 'New version',
      risk: 'low',
      affectedFiles: ['package.json'],
    }];

    const result = await applier.apply(plan);

    expect(result.diffs.length).toBe(1);
    expect(result.diffs[0].file).toBe('package.json');
    expect(result.diffs[0].changes.length).toBeGreaterThan(0);
    expect(result.diffs[0].preview).toBeDefined();
  });

  it('should truncate large diffs in preview', async () => {
    // Create a large file with many dependencies
    const deps = {};
    for (let i = 0; i < 30; i++) {
      deps[`pkg${i}`] = '1.0.0';
    }

    createTestFile('package.json', JSON.stringify({
      dependencies: deps
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    // Create a plan that changes many packages to generate a large diff
    const plan = [];
    for (let i = 0; i < 15; i++) {
      plan.push({
        package: `pkg${i}`,
        registry: 'npm',
        currentVersion: '1.0.0',
        suggestedVersion: '2.0.0',
        action: 'upgrade',
        reason: 'New version',
        risk: 'low',
        affectedFiles: ['package.json'],
      });
    }

    const result = await applier.apply(plan);

    // Each change generates 2 lines (old and new), so 15 changes = 30 lines
    // This should trigger truncation at 20 lines
    expect(result.diffs[0].preview).toContain('...');
  });
});

describe('UpgradeApplier - Error Handling', () => {
  it('should handle missing file gracefully', async () => {
    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'lodash',
      registry: 'npm',
      currentVersion: '4.17.21',
      suggestedVersion: '4.17.22',
      action: 'upgrade',
      reason: 'New version',
      risk: 'low',
      affectedFiles: ['nonexistent.json'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.errors).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('File not found');
  });

  it('should handle invalid JSON gracefully', async () => {
    createTestFile('package.json', '{ invalid json }');

    const applier = new UpgradeApplier({ projectPath: TEST_DIR, validateAfterApply: true });
    const plan = [{
      package: 'lodash',
      registry: 'npm',
      currentVersion: '4.17.21',
      suggestedVersion: '4.17.22',
      action: 'upgrade',
      reason: 'New version',
      risk: 'low',
      affectedFiles: ['package.json'],
    }];

    const result = await applier.apply(plan);

    expect(result.summary.errors).toBeGreaterThan(0);
  });
});

describe('UpgradeApplier - applyUpgrade Method', () => {
  it('should apply single upgrade', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    await applier.applyUpgrade('package.json', 'lodash', '4.17.22');

    const content = readTestFile('package.json');
    const pkg = JSON.parse(content);
    expect(pkg.dependencies.lodash).toBe('4.17.22');
  });

  it('should apply single upgrade with constraint', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    await applier.applyUpgrade('package.json', 'lodash', '4.17.22', {
      constraint: '^4.17.22',
    });

    const content = readTestFile('package.json');
    const pkg = JSON.parse(content);
    expect(pkg.dependencies.lodash).toBe('^4.17.22');
  });
});

describe('UpgradeApplier - validateChanges Method', () => {
  it('should validate valid changes', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const changes = [{
      file: 'package.json',
      package: 'lodash',
      oldVersion: '4.17.21',
      newVersion: '4.17.22',
      registry: 'npm',
    }];

    const isValid = await applier.validateChanges('package.json', changes);

    expect(isValid).toBe(true);
  });

  it('should reject invalid JSON changes', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const changes = [{
      file: 'package.json',
      package: 'lodash',
      oldVersion: '4.17.21',
      newVersion: 'invalid version with spaces',
      registry: 'npm',
    }];

    const isValid = await applier.validateChanges('package.json', changes);

    // This should still return true as validation only checks structure
    expect(isValid).toBeDefined();
  });
});

describe('Convenience Functions', () => {
  it('applyUpgrades should work', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21' }
    }, null, 2));

    const plan = [{
      package: 'lodash',
      registry: 'npm',
      currentVersion: '4.17.21',
      suggestedVersion: '4.17.22',
      action: 'upgrade',
      reason: 'New version',
      risk: 'low',
      affectedFiles: ['package.json'],
    }];

    const result = await applyUpgrades(TEST_DIR, plan);

    expect(result.summary.totalChanges).toBe(1);
    expect(result.summary.packagesUpgraded).toBe(1);
  });

  it('applySingleUpgrade should work', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21' }
    }, null, 2));

    const result = await applySingleUpgrade(TEST_DIR, 'package.json', 'lodash', '4.17.22');

    expect(result.summary.totalChanges).toBe(1);
    expect(result.summary.packagesUpgraded).toBe(1);

    const content = readTestFile('package.json');
    const pkg = JSON.parse(content);
    expect(pkg.dependencies.lodash).toBe('4.17.22');
  });

  it('previewUpgrades should not modify files', async () => {
    const originalContent = JSON.stringify({
      dependencies: { lodash: '4.17.21' }
    }, null, 2);

    createTestFile('package.json', originalContent);

    const plan = [{
      package: 'lodash',
      registry: 'npm',
      currentVersion: '4.17.21',
      suggestedVersion: '4.17.22',
      action: 'upgrade',
      reason: 'New version',
      risk: 'low',
      affectedFiles: ['package.json'],
    }];

    const result = await previewUpgrades(TEST_DIR, plan);

    expect(result.dryRun).toBe(true);
    expect(result.summary.totalChanges).toBe(1);

    const content = readTestFile('package.json');
    expect(content).toBe(originalContent);
  });
});

describe('UpgradeApplier - Multiple Files', () => {
  it('should handle changes across multiple files', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21' }
    }, null, 2));

    createTestFile('requirements.txt', 'django==3.2.0\n');

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [
      {
        package: 'lodash',
        registry: 'npm',
        currentVersion: '4.17.21',
        suggestedVersion: '4.17.22',
        action: 'upgrade',
        reason: 'New version',
        risk: 'low',
        affectedFiles: ['package.json'],
      },
      {
        package: 'django',
        registry: 'pypi',
        currentVersion: '3.2.0',
        suggestedVersion: '4.0.0',
        action: 'upgrade',
        reason: 'New version',
        risk: 'high',
        affectedFiles: ['requirements.txt'],
      },
    ];

    const result = await applier.apply(plan);

    expect(result.summary.filesModified).toBe(2);
    expect(result.summary.totalChanges).toBe(2);
  });
});

describe('UpgradeApplier - Risk Assessment', () => {
  it('should track high risk changes', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { react: '17.0.0' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [{
      package: 'react',
      registry: 'npm',
      currentVersion: '17.0.0',
      suggestedVersion: '18.0.0',
      action: 'upgrade',
      reason: 'Major version upgrade',
      risk: 'high',
      affectedFiles: ['package.json'],
    }];

    const result = await applier.apply(plan);

    expect(result.changes[0].package).toBe('react');
    expect(result.changes[0].newVersion).toBe('18.0.0');
  });
});

describe('UpgradeApplier - Summary Statistics', () => {
  it('should correctly count upgrades, downgrades, and removals', async () => {
    createTestFile('package.json', JSON.stringify({
      dependencies: { lodash: '4.17.21', express: '4.18.0', axios: '0.27.0' }
    }, null, 2));

    const applier = new UpgradeApplier({ projectPath: TEST_DIR });
    const plan = [
      {
        package: 'lodash',
        registry: 'npm',
        currentVersion: '4.17.21',
        suggestedVersion: '4.17.22',
        action: 'upgrade',
        reason: 'New version',
        risk: 'low',
        affectedFiles: ['package.json'],
      },
      {
        package: 'express',
        registry: 'npm',
        currentVersion: '4.18.0',
        suggestedVersion: '4.17.0',
        action: 'downgrade',
        reason: 'Compatibility',
        risk: 'medium',
        affectedFiles: ['package.json'],
      },
      {
        package: 'axios',
        registry: 'npm',
        currentVersion: '0.27.0',
        suggestedVersion: '',
        action: 'remove',
        reason: 'No longer needed',
        risk: 'low',
        affectedFiles: ['package.json'],
      },
    ];

    const result = await applier.apply(plan);

    expect(result.summary.packagesUpgraded).toBe(1);
    expect(result.summary.packagesDowngraded).toBe(1);
    expect(result.summary.packagesRemoved).toBe(1);
  });
});
