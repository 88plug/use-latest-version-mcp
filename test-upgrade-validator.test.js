/**
 * Tests for Upgrade Validator
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { UpgradeValidator } from './src/upgrade-validator.js';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

describe('UpgradeValidator', () => {
  let testDir;
  let validator;

  beforeEach(() => {
    // Create temporary test directory
    testDir = `/tmp/test-upgrade-validator-${Date.now()}`;
    mkdirSync(testDir, { recursive: true });

    validator = new UpgradeValidator({
      projectPath: testDir,
      checkBreakingChanges: true,
      checkCircularDependencies: true,
      checkDependents: true,
      checkDependencies: true,
      strictMode: false,
      allowMajorVersionChanges: true
    });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Constructor', () => {
    it('should create validator with default options', () => {
      const v = new UpgradeValidator({ projectPath: testDir });
      expect(v.options.projectPath).toBe(testDir);
      expect(v.options.checkBreakingChanges).toBe(true);
      expect(v.options.checkCircularDependencies).toBe(true);
      expect(v.options.strictMode).toBe(false);
      expect(v.options.allowMajorVersionChanges).toBe(true);
    });

    it('should create validator with custom options', () => {
      const v = new UpgradeValidator({
        projectPath: testDir,
        strictMode: true,
        allowMajorVersionChanges: false,
        maxDepth: 5
      });
      expect(v.options.strictMode).toBe(true);
      expect(v.options.allowMajorVersionChanges).toBe(false);
      expect(v.options.maxDepth).toBe(5);
    });
  });

  describe('validateUpgrade', () => {
    it('should validate a valid upgrade', async () => {
      const report = await validator.validateUpgrade('express', '4.18.0', '4.19.0');
      expect(report.package).toBe('express');
      expect(report.oldVersion).toBe('4.18.0');
      expect(report.newVersion).toBe('4.19.0');
      expect(report.valid).toBe(true);
      expect(report.canUpgrade).toBe(true);
      expect(report.canDowngrade).toBe(false);
    });

    it('should validate a downgrade', async () => {
      const report = await validator.validateUpgrade('express', '4.19.0', '4.18.0');
      expect(report.package).toBe('express');
      expect(report.canUpgrade).toBe(false);
      expect(report.canDowngrade).toBe(true);
    });

    it('should validate a removal', async () => {
      const report = await validator.validateUpgrade('express', '4.18.0', 'removed');
      expect(report.canRemove).toBe(true);
      expect(report.newVersion).toBe('removed');
    });

    it('should detect invalid old version', async () => {
      const report = await validator.validateUpgrade('express', 'invalid', '4.19.0');
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('Invalid old version'))).toBe(true);
    });

    it('should detect invalid new version', async () => {
      const report = await validator.validateUpgrade('express', '4.18.0', 'invalid');
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('Invalid new version'))).toBe(true);
    });

    it('should detect major version breaking change', async () => {
      const report = await validator.validateUpgrade('express', '4.18.0', '5.0.0');
      expect(report.breakingChanges.length).toBeGreaterThan(0);
      expect(report.breakingChanges[0].type).toBe('major');
      expect(report.warnings.length).toBeGreaterThan(0);
    });

    it('should not flag a minor version change as breaking', async () => {
      // A minor bump is backward-compatible under semver, so it is not a breaking change.
      const report = await validator.validateUpgrade('express', '4.18.0', '4.19.0');
      expect(report.breakingChanges.length).toBe(0);
    });

    it('should not detect breaking change for patch version', async () => {
      const report = await validator.validateUpgrade('express', '4.18.0', '4.18.1');
      expect(report.breakingChanges.length).toBe(0);
    });

    it('should handle Python version format', async () => {
      const report = await validator.validateUpgrade('django', '3.2', '4.0');
      expect(report.valid).toBe(true);
      expect(report.breakingChanges.length).toBeGreaterThan(0);
    });

    it('should handle Go version format', async () => {
      const report = await validator.validateUpgrade('github.com/gin-gonic/gin', 'v1.9.0', 'v1.10.0');
      expect(report.valid).toBe(true);
    });

    it('should handle wildcard versions', async () => {
      const report = await validator.validateUpgrade('express', '*', '4.19.0');
      expect(report.valid).toBe(true);
    });

    it('should handle latest version', async () => {
      const report = await validator.validateUpgrade('express', 'latest', '4.19.0');
      expect(report.valid).toBe(true);
    });
  });

  describe('validatePlan', () => {
    it('should validate an empty plan', async () => {
      const result = await validator.validatePlan([]);
      expect(result.valid).toBe(true);
      expect(result.canApply).toBe(true);
      expect(result.totalPackages).toBe(0);
      expect(result.reports).toEqual([]);
    });

    it('should validate a simple plan', async () => {
      const plan = [
        { package: 'express', currentVersion: '4.18.0', suggestedVersion: '4.19.0', action: 'upgrade' }
      ];
      const result = await validator.validatePlan(plan);
      expect(result.valid).toBe(true);
      expect(result.canApply).toBe(true);
      expect(result.totalPackages).toBe(1);
      expect(result.validPackages).toBe(1);
      expect(result.invalidPackages).toBe(0);
    });

    it('should validate a plan with multiple packages', async () => {
      const plan = [
        { package: 'express', currentVersion: '4.18.0', suggestedVersion: '4.19.0', action: 'upgrade' },
        { package: 'lodash', currentVersion: '4.17.21', suggestedVersion: '4.17.22', action: 'upgrade' },
        { package: 'react', currentVersion: '18.2.0', suggestedVersion: '18.3.0', action: 'upgrade' }
      ];
      const result = await validator.validatePlan(plan);
      expect(result.valid).toBe(true);
      expect(result.totalPackages).toBe(3);
      expect(result.validPackages).toBe(3);
    });

    it('should detect invalid packages in plan', async () => {
      const plan = [
        { package: 'express', currentVersion: 'invalid', suggestedVersion: '4.19.0', action: 'upgrade' }
      ];
      const result = await validator.validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.canApply).toBe(false);
      expect(result.invalidPackages).toBe(1);
      expect(result.errors).toBeGreaterThan(0);
    });

    it('should calculate summary correctly', async () => {
      const plan = [
        { package: 'express', currentVersion: '4.18.0', suggestedVersion: '4.19.0', action: 'upgrade' },
        { package: 'lodash', currentVersion: '4.17.22', suggestedVersion: '4.17.21', action: 'downgrade' },
        { package: 'old-package', currentVersion: '1.0.0', suggestedVersion: 'removed', action: 'remove' }
      ];
      const result = await validator.validatePlan(plan);
      expect(result.summary.canUpgrade).toBe(1);
      expect(result.summary.canDowngrade).toBe(1);
      expect(result.summary.canRemove).toBe(1);
      expect(result.summary.blocked).toBe(0);
    });

    it('should collect all breaking changes from plan', async () => {
      const plan = [
        { package: 'express', currentVersion: '4.18.0', suggestedVersion: '5.0.0', action: 'upgrade' },
        { package: 'react', currentVersion: '18.2.0', suggestedVersion: '19.0.0', action: 'upgrade' }
      ];
      const result = await validator.validatePlan(plan);
      expect(result.breakingChanges.length).toBe(2);
      expect(result.breakingChanges.every(b => b.type === 'major')).toBe(true);
    });

    it('should count warnings correctly', async () => {
      const plan = [
        { package: 'express', currentVersion: '4.18.0', suggestedVersion: '5.0.0', action: 'upgrade' },
        { package: 'react', currentVersion: '18.2.0', suggestedVersion: '19.0.0', action: 'upgrade' }
      ];
      const result = await validator.validatePlan(plan);
      expect(result.warnings).toBeGreaterThan(0);
    });
  });

  describe('detectCircularDependencies', () => {
    it('should detect no circular dependencies in simple plan', () => {
      const plan = [
        { package: 'express', currentVersion: '4.18.0', suggestedVersion: '4.19.0', action: 'upgrade', dependencies: ['lodash'] },
        { package: 'lodash', currentVersion: '4.17.21', suggestedVersion: '4.17.22', action: 'upgrade', dependencies: [] }
      ];
      const cycles = validator.detectCircularDependencies(plan);
      expect(cycles).toEqual([]);
    });

    it('should detect circular dependency', () => {
      const plan = [
        { package: 'a', currentVersion: '1.0.0', suggestedVersion: '2.0.0', action: 'upgrade', dependencies: ['b'] },
        { package: 'b', currentVersion: '1.0.0', suggestedVersion: '2.0.0', action: 'upgrade', dependencies: ['c'] },
        { package: 'c', currentVersion: '1.0.0', suggestedVersion: '2.0.0', action: 'upgrade', dependencies: ['a'] }
      ];
      const cycles = validator.detectCircularDependencies(plan);
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0]).toContain('a -> b -> c -> a');
    });

    it('should detect self-referencing dependency', () => {
      const plan = [
        { package: 'a', currentVersion: '1.0.0', suggestedVersion: '2.0.0', action: 'upgrade', dependencies: ['a'] }
      ];
      const cycles = validator.detectCircularDependencies(plan);
      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should detect multiple circular dependencies', () => {
      const plan = [
        { package: 'a', currentVersion: '1.0.0', suggestedVersion: '2.0.0', action: 'upgrade', dependencies: ['b'] },
        { package: 'b', currentVersion: '1.0.0', suggestedVersion: '2.0.0', action: 'upgrade', dependencies: ['a'] },
        { package: 'c', currentVersion: '1.0.0', suggestedVersion: '2.0.0', action: 'upgrade', dependencies: ['d'] },
        { package: 'd', currentVersion: '1.0.0', suggestedVersion: '2.0.0', action: 'upgrade', dependencies: ['c'] }
      ];
      const cycles = validator.detectCircularDependencies(plan);
      expect(cycles.length).toBe(2);
    });

    it('should handle plan without dependencies', () => {
      const plan = [
        { package: 'express', currentVersion: '4.18.0', suggestedVersion: '4.19.0', action: 'upgrade' }
      ];
      const cycles = validator.detectCircularDependencies(plan);
      expect(cycles).toEqual([]);
    });
  });

  describe('detectBreakingChange', () => {
    it('should detect major version change', () => {
      const breaking = validator.detectBreakingChange('express', '4.18.0', '5.0.0');
      expect(breaking).not.toBeNull();
      expect(breaking.type).toBe('major');
      expect(breaking.package).toBe('express');
      expect(breaking.fromVersion).toBe('4.18.0');
      expect(breaking.toVersion).toBe('5.0.0');
    });

    it('should not detect a minor version change as breaking', () => {
      // Minor bumps are backward-compatible under semver: detectBreakingChange returns null.
      const breaking = validator.detectBreakingChange('express', '4.18.0', '4.19.0');
      expect(breaking).toBeNull();
    });

    it('should not detect breaking change for patch version', () => {
      const breaking = validator.detectBreakingChange('express', '4.18.0', '4.18.1');
      expect(breaking).toBeNull();
    });

    it('should handle Python version format', () => {
      const breaking = validator.detectBreakingChange('django', '3.2', '4.0');
      expect(breaking).not.toBeNull();
      expect(breaking.type).toBe('major');
    });

    it('should handle Go version format', () => {
      const breaking = validator.detectBreakingChange('gin', 'v1.9.0', 'v2.0.0');
      expect(breaking).not.toBeNull();
      expect(breaking.type).toBe('major');
    });

    it('should return null for invalid versions', () => {
      const breaking = validator.detectBreakingChange('express', 'invalid', '4.19.0');
      expect(breaking).toBeNull();
    });
  });

  describe('checkBreakingChanges', () => {
    it('should return empty array for empty plan', () => {
      const breaking = validator.checkBreakingChanges([]);
      expect(breaking).toEqual([]);
    });

    it('should detect breaking changes in plan', () => {
      const plan = [
        { package: 'express', currentVersion: '4.18.0', suggestedVersion: '5.0.0', action: 'upgrade' },
        { package: 'react', currentVersion: '18.2.0', suggestedVersion: '19.0.0', action: 'upgrade' }
      ];
      const breaking = validator.checkBreakingChanges(plan);
      expect(breaking.length).toBe(2);
    });

    it('should skip removed packages', () => {
      const plan = [
        { package: 'express', currentVersion: '4.18.0', suggestedVersion: 'removed', action: 'remove' }
      ];
      const breaking = validator.checkBreakingChanges(plan);
      expect(breaking).toEqual([]);
    });
  });

  describe('Strict Mode', () => {
    it('should block major version changes in strict mode', async () => {
      const strictValidator = new UpgradeValidator({
        projectPath: testDir,
        strictMode: true,
        allowMajorVersionChanges: false
      });

      const report = await strictValidator.validateUpgrade('express', '4.18.0', '5.0.0');
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.severity === 'error')).toBe(true);
      expect(report.issues.some(i => i.message.includes('Major version change not allowed'))).toBe(true);
    });

    it('should allow minor version changes in strict mode', async () => {
      const strictValidator = new UpgradeValidator({
        projectPath: testDir,
        strictMode: true,
        allowMajorVersionChanges: false
      });

      const report = await strictValidator.validateUpgrade('express', '4.18.0', '4.19.0');
      expect(report.valid).toBe(true);
    });
  });

  describe('Dependency Impact', () => {
    it('should check dependency impact with package.json', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          express: '^4.18.0',
          lodash: '^4.17.21'
        }
      };
      writeFileSync(join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      const report = await validator.validateUpgrade('express', '4.18.0', '4.19.0');
      expect(report.dependencies).toBeDefined();
      expect(Array.isArray(report.dependencies)).toBe(true);
    });

    it('should check dependent impact with package.json', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          express: '^4.18.0'
        }
      };
      writeFileSync(join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      const report = await validator.validateUpgrade('express', '4.18.0', '5.0.0');
      expect(report.dependents).toBeDefined();
      expect(Array.isArray(report.dependents)).toBe(true);
    });
  });

  describe('Version Parsing', () => {
    it('should parse semver version', () => {
      const version = validator.parseVersion('4.18.0');
      expect(version).toEqual({ major: 4, minor: 18, patch: 0 });
    });

    it('should parse semver with prerelease', () => {
      const version = validator.parseVersion('4.18.0-beta.1');
      expect(version).toEqual({ major: 4, minor: 18, patch: 0 });
    });

    it('should parse Python version', () => {
      const version = validator.parseVersion('3.2');
      expect(version).toEqual({ major: 3, minor: 2, patch: 0 });
    });

    it('should parse Python version with patch', () => {
      const version = validator.parseVersion('3.2.1');
      expect(version).toEqual({ major: 3, minor: 2, patch: 1 });
    });

    it('should parse Go version', () => {
      const version = validator.parseVersion('v1.9.0');
      expect(version).toEqual({ major: 1, minor: 9, patch: 0 });
    });

    it('should return null for invalid version', () => {
      const version = validator.parseVersion('invalid');
      expect(version).toBeNull();
    });
  });

  describe('Version Validation', () => {
    it('should validate semver version', () => {
      expect(validator.isValidVersion('4.18.0')).toBe(true);
    });

    it('should validate wildcard version', () => {
      expect(validator.isValidVersion('*')).toBe(true);
    });

    it('should validate latest version', () => {
      expect(validator.isValidVersion('latest')).toBe(true);
    });

    it('should validate removed version', () => {
      expect(validator.isValidVersion('removed')).toBe(true);
    });

    it('should validate Python version', () => {
      expect(validator.isValidVersion('3.2')).toBe(true);
    });

    it('should validate Go version', () => {
      expect(validator.isValidVersion('v1.9.0')).toBe(true);
    });

    it('should validate version range', () => {
      expect(validator.isValidVersion('^4.18.0')).toBe(true);
    });
  });

  describe('Version Comparison', () => {
    it('should detect upgrade correctly', () => {
      expect(validator.canUpgrade('4.18.0', '4.19.0')).toBe(true);
      expect(validator.canUpgrade('4.18.0', '5.0.0')).toBe(true);
      expect(validator.canUpgrade('4.18.0', '4.18.1')).toBe(true);
    });

    it('should not detect upgrade for downgrade', () => {
      expect(validator.canUpgrade('4.19.0', '4.18.0')).toBe(false);
    });

    it('should detect downgrade correctly', () => {
      expect(validator.canDowngrade('4.19.0', '4.18.0')).toBe(true);
      expect(validator.canDowngrade('5.0.0', '4.18.0')).toBe(true);
    });

    it('should not detect downgrade for upgrade', () => {
      expect(validator.canDowngrade('4.18.0', '4.19.0')).toBe(false);
    });

    it('should handle same version', () => {
      expect(validator.canUpgrade('4.18.0', '4.18.0')).toBe(false);
      expect(validator.canDowngrade('4.18.0', '4.18.0')).toBe(false);
    });
  });

  describe('Constraint Satisfaction', () => {
    it('should satisfy wildcard constraint', () => {
      expect(validator.satisfiesConstraint('4.19.0', '*')).toBe(true);
    });

    it('should satisfy latest constraint', () => {
      expect(validator.satisfiesConstraint('4.19.0', 'latest')).toBe(true);
    });

    it('should satisfy exact version constraint', () => {
      expect(validator.satisfiesConstraint('4.19.0', '4.19.0')).toBe(true);
    });

    it('should satisfy caret constraint', () => {
      expect(validator.satisfiesConstraint('4.19.0', '^4.18.0')).toBe(true);
    });

    it('rejects a major version that violates a caret constraint', () => {
      // ^4.18.0 means >=4.18.0 <5.0.0, so 5.0.0 must NOT satisfy it.
      expect(validator.satisfiesConstraint('5.0.0', '^4.18.0')).toBe(false);
    });

    it('should satisfy tilde constraint', () => {
      expect(validator.satisfiesConstraint('4.18.1', '~4.18.0')).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    it('should validate complete upgrade plan', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          express: '^4.18.0',
          lodash: '^4.17.21',
          react: '^18.2.0'
        }
      };
      writeFileSync(join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      const plan = [
        { package: 'express', currentVersion: '4.18.0', suggestedVersion: '4.19.0', action: 'upgrade' },
        { package: 'lodash', currentVersion: '4.17.21', suggestedVersion: '4.17.22', action: 'upgrade' },
        { package: 'react', currentVersion: '18.2.0', suggestedVersion: '18.3.0', action: 'upgrade' }
      ];

      const result = await validator.validatePlan(plan);
      expect(result.valid).toBe(true);
      expect(result.canApply).toBe(true);
      expect(result.totalPackages).toBe(3);
      expect(result.validPackages).toBe(3);
    });

    it('should detect issues in problematic plan', async () => {
      const plan = [
        { package: 'express', currentVersion: 'invalid', suggestedVersion: '4.19.0', action: 'upgrade' },
        { package: 'a', currentVersion: '1.0.0', suggestedVersion: '2.0.0', action: 'upgrade', dependencies: ['b'] },
        { package: 'b', currentVersion: '1.0.0', suggestedVersion: '2.0.0', action: 'upgrade', dependencies: ['a'] }
      ];

      const result = await validator.validatePlan(plan);
      expect(result.valid).toBe(false);
      expect(result.canApply).toBe(false);
      expect(result.errors).toBeGreaterThan(0);
      expect(result.circularDependencies.length).toBeGreaterThan(0);
    });
  });
});
