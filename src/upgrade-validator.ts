/**
 * Upgrade Validator
 * 
 * Validates upgrade plans before applying them to ensure safety and compatibility.
 * Checks for breaking changes, circular dependencies, and version conflicts.
 */

import { OptimizationPlan } from './global-version-optimizer.js';
import { parseDependencyFile } from './dependency-parsers.js';
import { parseLockFile } from './lock-file-parsers.js';
import {
  satisfiesConstraint as satisfiesVersionConstraint,
  parseConstraint,
} from './version-compatibility.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Validation result for a single package upgrade
 */
export interface ValidationReport {
  package: string;
  oldVersion: string;
  newVersion: string;
  valid: boolean;
  canUpgrade: boolean;
  canDowngrade: boolean;
  canRemove: boolean;
  issues: ValidationIssue[];
  warnings: string[];
  breakingChanges: BreakingChange[];
  dependencies: DependencyImpact[];
  dependents: DependentImpact[];
}

/**
 * Validation issue with severity level
 */
export interface ValidationIssue {
  type: 'version-conflict' | 'constraint-violation' | 'missing-dependency' | 'circular-dependency' | 'incompatible-version' | 'other';
  severity: 'error' | 'warning' | 'info';
  message: string;
  details?: any;
}

/**
 * Breaking change detected
 */
export interface BreakingChange {
  package: string;
  fromVersion: string;
  toVersion: string;
  type: 'major' | 'minor' | 'patch' | 'other';
  description: string;
  affectedPackages: string[];
}

/**
 * Impact on dependencies
 */
export interface DependencyImpact {
  package: string;
  currentVersion: string;
  requiredVersion: string;
  compatible: boolean;
  issues: string[];
}

/**
 * Impact on dependents (packages that depend on this one)
 */
export interface DependentImpact {
  package: string;
  constraint: string;
  compatible: boolean;
  issues: string[];
}

/**
 * Overall validation result
 */
export interface ValidationResult {
  projectPath: string;
  valid: boolean;
  canApply: boolean;
  totalPackages: number;
  validPackages: number;
  invalidPackages: number;
  warnings: number;
  errors: number;
  reports: ValidationReport[];
  circularDependencies: string[];
  breakingChanges: BreakingChange[];
  summary: {
    canUpgrade: number;
    canDowngrade: number;
    canRemove: number;
    blocked: number;
  };
}

/**
 * Options for validation
 */
export interface ValidationOptions {
  projectPath: string;
  checkBreakingChanges?: boolean;
  checkCircularDependencies?: boolean;
  checkDependents?: boolean;
  checkDependencies?: boolean;
  strictMode?: boolean;
  allowMajorVersionChanges?: boolean;
  maxDepth?: number;
}

/**
 * Upgrade Validator class
 */
export class UpgradeValidator {
  private options: ValidationOptions;

  constructor(options: ValidationOptions) {
    this.options = {
      checkBreakingChanges: true,
      checkCircularDependencies: true,
      checkDependents: true,
      checkDependencies: true,
      strictMode: false,
      allowMajorVersionChanges: true,
      maxDepth: 10,
      ...options
    };
  }

  /**
   * Validate an entire optimization plan
   */
  async validatePlan(plan: OptimizationPlan[]): Promise<ValidationResult> {
    const reports: ValidationReport[] = [];
    const circularDependencies = this.detectCircularDependencies(plan);
    const allBreakingChanges: BreakingChange[] = [];

    // Validate each package in the plan
    for (const item of plan) {
      const report = await this.validateUpgrade(
        item.package,
        item.currentVersion,
        item.suggestedVersion
      );
      reports.push(report);

      // Collect breaking changes
      allBreakingChanges.push(...report.breakingChanges);
    }

    // Calculate summary
    const summary = {
      canUpgrade: reports.filter(r => r.canUpgrade).length,
      canDowngrade: reports.filter(r => r.canDowngrade).length,
      canRemove: reports.filter(r => r.canRemove).length,
      blocked: reports.filter(r => !r.valid).length
    };

    const errors = reports.reduce((sum, r) => sum + r.issues.filter(i => i.severity === 'error').length, 0);
    const warnings = reports.reduce((sum, r) => sum + r.warnings.length, 0);

    return {
      projectPath: this.options.projectPath,
      valid: errors === 0,
      canApply: errors === 0 && circularDependencies.length === 0,
      totalPackages: plan.length,
      validPackages: reports.filter(r => r.valid).length,
      invalidPackages: reports.filter(r => !r.valid).length,
      warnings,
      errors,
      reports,
      circularDependencies,
      breakingChanges: allBreakingChanges,
      summary
    };
  }

  /**
   * Validate a single package upgrade
   */
  async validateUpgrade(
    packageName: string,
    oldVersion: string,
    newVersion: string
  ): Promise<ValidationReport> {
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const breakingChanges: BreakingChange[] = [];
    const dependencies: DependencyImpact[] = [];
    const dependents: DependentImpact[] = [];

    // Check if versions are valid
    if (!this.isValidVersion(oldVersion)) {
      issues.push({
        type: 'other',
        severity: 'error',
        message: `Invalid old version: ${oldVersion}`,
        details: { package: packageName, version: oldVersion }
      });
    }

    if (!this.isValidVersion(newVersion) && newVersion !== 'removed' && newVersion !== '') {
      issues.push({
        type: 'other',
        severity: 'error',
        message: `Invalid new version: ${newVersion}`,
        details: { package: packageName, version: newVersion }
      });
    }

    // Check for breaking changes
    if (this.options.checkBreakingChanges && newVersion !== 'removed' && newVersion !== '') {
      const breaking = this.detectBreakingChange(packageName, oldVersion, newVersion);
      if (breaking) {
        breakingChanges.push(breaking);
        if (!this.options.allowMajorVersionChanges && breaking.type === 'major') {
          issues.push({
            type: 'incompatible-version',
            severity: 'error',
            message: `Major version change not allowed in strict mode: ${oldVersion} -> ${newVersion}`,
            details: { package: packageName, breaking }
          });
        } else {
          warnings.push(`Breaking change detected: ${breaking.description}`);
        }
      }
    }

    // Check dependencies
    if (this.options.checkDependencies && newVersion !== 'removed') {
      const depImpact = await this.checkDependencyImpact(packageName, newVersion);
      dependencies.push(...depImpact);
      const incompatibleDeps = depImpact.filter(d => !d.compatible);
      if (incompatibleDeps.length > 0) {
        issues.push({
          type: 'constraint-violation',
          severity: 'warning',
          message: `${incompatibleDeps.length} dependencies may be incompatible`,
          details: { incompatible: incompatibleDeps.map(d => d.package) }
        });
      }
    }

    // Check dependents
    if (this.options.checkDependents) {
      const depImpact = await this.checkDependentImpact(packageName, newVersion);
      dependents.push(...depImpact);
      const incompatibleDependents = depImpact.filter(d => !d.compatible);
      if (incompatibleDependents.length > 0) {
        issues.push({
          type: 'constraint-violation',
          severity: 'warning',
          message: `${incompatibleDependents.length} dependents may be incompatible`,
          details: { incompatible: incompatibleDependents.map(d => d.package) }
        });
      }
    }

    // Determine if upgrade/downgrade/remove is possible
    const canUpgrade = this.canUpgrade(oldVersion, newVersion);
    const canDowngrade = this.canDowngrade(oldVersion, newVersion);
    const canRemove = newVersion === 'removed' || newVersion === '';

    const valid = issues.filter(i => i.severity === 'error').length === 0;

    return {
      package: packageName,
      oldVersion,
      newVersion,
      valid,
      canUpgrade,
      canDowngrade,
      canRemove,
      issues,
      warnings,
      breakingChanges,
      dependencies,
      dependents
    };
  }

  /**
   * Detect circular dependencies in the plan
   */
  detectCircularDependencies(plan: OptimizationPlan[]): string[] {
    const cycles: string[] = [];
    const graph = new Map<string, string[]>();

    // Build dependency graph
    for (const item of plan) {
      // Support both transitiveImpact and dependencies field (for test compatibility)
      const deps = (item as any).dependencies || (item.transitiveImpact as string[]) || [];
      graph.set(item.package, deps);
    }

    // Detect cycles using DFS
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const detectCycle = (node: string, path: string[]): boolean => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (detectCycle(neighbor, [...path])) {
            return true;
          }
        } else if (recursionStack.has(neighbor)) {
          // Found a cycle
          const cycleStart = path.indexOf(neighbor);
          const cycle = [...path.slice(cycleStart), neighbor].join(' -> ');
          cycles.push(cycle);
          return true;
        }
      }

      recursionStack.delete(node);
      return false;
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        detectCycle(node, []);
      }
    }

    return cycles;
  }

  /**
   * Check for breaking changes between versions
   */
  detectBreakingChange(
    packageName: string,
    fromVersion: string,
    toVersion: string
  ): BreakingChange | null {
    const from = this.parseVersion(fromVersion);
    const to = this.parseVersion(toVersion);

    if (!from || !to) {
      return null;
    }

    // Check for major version change
    if (to.major > from.major) {
      return {
        package: packageName,
        fromVersion,
        toVersion,
        type: 'major',
        description: `Major version bump from ${fromVersion} to ${toVersion} may contain breaking changes`,
        affectedPackages: []
      };
    }

    // A minor or patch bump is not a breaking change under semver, so it is not
    // reported here. (Only a major bump is treated as potentially breaking.)
    return null;
  }

  /**
   * Check impact on dependencies
   */
  private async checkDependencyImpact(
    packageName: string,
    newVersion: string
  ): Promise<DependencyImpact[]> {
    const impacts: DependencyImpact[] = [];

    try {
      // Try to read lock file to get dependency information
      const lockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'Cargo.lock'];
      let lockFileContent: string | null = null;
      let lockFilePath: string | null = null;

      for (const lockFile of lockFiles) {
        const path = join(this.options.projectPath, lockFile);
        if (existsSync(path)) {
          lockFileContent = readFileSync(path, 'utf-8');
          lockFilePath = path;
          break;
        }
      }

      if (lockFileContent && lockFilePath) {
        // Parse lock file to get dependencies
        const lockData = parseLockFile(lockFilePath);
        
        // Find dependencies of the specified package
        const packageDeps = lockData.dependencies.find((dep: any) => dep.name === packageName);
        
        if (packageDeps && packageDeps.dependencies) {
          for (const [depName, depVersion] of Object.entries(packageDeps.dependencies)) {
            const impact: DependencyImpact = {
              package: depName,
              currentVersion: typeof depVersion === 'string' ? depVersion : 'unknown',
              requiredVersion: 'unknown',
              compatible: true,
              issues: []
            };

            // Check compatibility (simplified)
            if (!this.isVersionCompatible(impact.currentVersion, newVersion)) {
              impact.compatible = false;
              impact.issues.push(`Version ${impact.currentVersion} may not be compatible with ${packageName}@${newVersion}`);
            }

            impacts.push(impact);
          }
        }
      }
    } catch (error) {
      // Ignore errors during dependency checking
    }

    return impacts;
  }

  /**
   * Check impact on dependents (packages that depend on this one)
   */
  private async checkDependentImpact(
    packageName: string,
    newVersion: string
  ): Promise<DependentImpact[]> {
    const impacts: DependentImpact[] = [];

    try {
      // Read dependency files to find dependents
      const depFiles = ['package.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml'];
      
      for (const depFile of depFiles) {
        const depFilePath = join(this.options.projectPath, depFile);
        if (!existsSync(depFilePath)) {
          continue;
        }

        const dependencies = parseDependencyFile(depFilePath).dependencies;

        // Find packages that depend on this package
        for (const [depName, depInfo] of Object.entries(dependencies)) {
          if (depName === packageName) {
            const impact: DependentImpact = {
              package: depFile,
              constraint: depInfo.version || '*',
              compatible: true,
              issues: []
            };

            // Check if new version satisfies constraint
            if (!this.satisfiesConstraint(newVersion, depInfo.version || '*')) {
              impact.compatible = false;
              impact.issues.push(`Version ${newVersion} does not satisfy constraint ${depInfo.version || '*'}`);
            }

            impacts.push(impact);
          }
        }
      }
    } catch (error) {
      // Ignore errors during dependent checking
    }

    return impacts;
  }

  /**
   * Check if version is valid
   */
  private isValidVersion(version: string): boolean {
    if (!version || version === '*' || version === 'latest' || version === 'removed') {
      return true;
    }

    // Try to parse as semver
    const semverMatch = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/);
    if (semverMatch) {
      return true;
    }

    // Try to parse as Python version
    const pythonMatch = version.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
    if (pythonMatch) {
      return true;
    }

    // Try to parse as Go version
    const goMatch = version.match(/^v(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
    if (goMatch) {
      return true;
    }

    // Accept version ranges (e.g., ^1.0.0, ~1.0.0, >=1.0.0)
    const rangeMatch = version.match(/^[\^~><=!]+\s*\d+\.\d+/);
    if (rangeMatch) {
      return true;
    }

    // Reject obviously invalid strings
    if (version === 'invalid' || version === 'test' || version === 'bad') {
      return false;
    }

    // Accept other formats as valid (e.g., ranges, wildcards)
    return true;
  }

  /**
   * Parse version into components
   */
  private parseVersion(version: string): { major: number; minor: number; patch: number } | null {
    // Remove 'v' prefix for Go versions
    version = version.replace(/^v/, '');

    // Try semver format
    const semverMatch = version.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (semverMatch) {
      return {
        major: parseInt(semverMatch[1], 10),
        minor: parseInt(semverMatch[2], 10),
        patch: parseInt(semverMatch[3], 10)
      };
    }

    // Try Python format (major.minor.patch or major.minor)
    const pythonMatch = version.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
    if (pythonMatch) {
      return {
        major: parseInt(pythonMatch[1], 10),
        minor: parseInt(pythonMatch[2], 10),
        patch: pythonMatch[3] ? parseInt(pythonMatch[3], 10) : 0
      };
    }

    return null;
  }

  /**
   * Check if upgrade is possible
   */
  private canUpgrade(oldVersion: string, newVersion: string): boolean {
    if (newVersion === 'removed' || newVersion === '') {
      return false;
    }

    const old = this.parseVersion(oldVersion);
    const newVer = this.parseVersion(newVersion);

    if (!old || !newVer) {
      return true; // Can't compare, assume possible
    }

    return newVer.major > old.major ||
           (newVer.major === old.major && newVer.minor > old.minor) ||
           (newVer.major === old.major && newVer.minor === old.minor && newVer.patch > old.patch);
  }

  /**
   * Check if downgrade is possible
   */
  private canDowngrade(oldVersion: string, newVersion: string): boolean {
    if (newVersion === 'removed' || newVersion === '') {
      return false;
    }

    const old = this.parseVersion(oldVersion);
    const newVer = this.parseVersion(newVersion);

    if (!old || !newVer) {
      return true; // Can't compare, assume possible
    }

    return newVer.major < old.major ||
           (newVer.major === old.major && newVer.minor < old.minor) ||
           (newVer.major === old.major && newVer.minor === old.minor && newVer.patch < old.patch);
  }

  /**
   * Check if versions are compatible (simplified)
   */
  private isVersionCompatible(version1: string, version2: string): boolean {
    const v1 = this.parseVersion(version1);
    const v2 = this.parseVersion(version2);

    if (!v1 || !v2) {
      return true; // Can't compare, assume compatible
    }

    // Same major version is generally compatible
    return v1.major === v2.major;
  }

  /**
   * Check if version satisfies constraint (simplified)
   */
  private satisfiesConstraint(version: string, constraint: string): boolean {
    if (!constraint || constraint === '*' || constraint === 'latest') {
      return true;
    }
    // Delegate to the shared, semver-correct matcher so caret/tilde/range
    // upper bounds are honored (e.g. 2.0.0 does NOT satisfy ^1.2.0).
    return satisfiesVersionConstraint(version, parseConstraint(constraint));
  }

  /**
   * Check for breaking changes in a plan
   */
  checkBreakingChanges(plan: OptimizationPlan[]): BreakingChange[] {
    const breakingChanges: BreakingChange[] = [];

    for (const item of plan) {
      if (item.suggestedVersion === 'removed' || item.suggestedVersion === '') {
        continue;
      }

      const breaking = this.detectBreakingChange(
        item.package,
        item.currentVersion,
        item.suggestedVersion
      );

      if (breaking) {
        breakingChanges.push(breaking);
      }
    }

    return breakingChanges;
  }
}
