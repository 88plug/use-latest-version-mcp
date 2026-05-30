/**
 * Global Version Optimizer
 * Optimizes versions across entire project to ensure compatibility
 */

import { scanProject, ScanResult, ScannedDependency } from './project-scanner.js';
import { getRegistryClient } from './registries.js';
import {
  findCompatibleVersion,
  parseConstraint,
  compareVersions,
  VersionConstraint,
} from './version-compatibility.js';

// ============================================================================
// Types
// ============================================================================

export interface OptimizationPlan {
  package: string;
  registry: string;
  currentVersion: string;
  currentConstraint?: string;
  suggestedVersion: string;
  suggestedConstraint?: string;
  action: 'keep' | 'upgrade' | 'downgrade' | 'remove';
  reason: string;
  risk: 'low' | 'medium' | 'high';
  affectedFiles: string[];
  transitiveImpact?: string[];
}

export interface OptimizationOptions {
  projectPath: string;
  maxDepth?: number;
  excludePatterns?: string[];
  includeLockFiles?: boolean;
  followSymlinks?: boolean;
  preferLatest?: boolean;
  allowDowngrade?: boolean;
  maxRisk?: 'low' | 'medium' | 'high';
  parallelChecks?: number;
  timeout?: number;
  includeTransitive?: boolean;
  optimizeLockFiles?: boolean;
}

export interface OptimizationResult {
  projectPath: string;
  optimizedAt: Date;
  summary: {
    totalDependencies: number;
    packagesOptimized: number;
    packagesKept: number;
    packagesRemoved: number;
    conflictsResolved: number;
    outdatedUpdated: number;
    registries: string[];
    highRiskChanges: number;
    mediumRiskChanges: number;
    lowRiskChanges: number;
  };
  plan: OptimizationPlan[];
  errors: string[];
  warnings: string[];
  scanResult: ScanResult;
}

// ============================================================================
// Global Version Optimizer Class
// ============================================================================

export class GlobalVersionOptimizer {
  private options: OptimizationOptions;

  constructor(options: OptimizationOptions) {
    this.options = {
      preferLatest: true,
      allowDowngrade: false,
      maxRisk: 'medium',
      parallelChecks: 5,
      timeout: 10000,
      includeTransitive: false,
      optimizeLockFiles: true,
      ...options,
    };
  }

  /**
   * Optimize versions across the entire project
   */
  async optimize(): Promise<OptimizationResult> {
    const result: OptimizationResult = {
      projectPath: this.options.projectPath,
      optimizedAt: new Date(),
      summary: {
        totalDependencies: 0,
        packagesOptimized: 0,
        packagesKept: 0,
        packagesRemoved: 0,
        conflictsResolved: 0,
        outdatedUpdated: 0,
        registries: [],
        highRiskChanges: 0,
        mediumRiskChanges: 0,
        lowRiskChanges: 0,
      },
      plan: [],
      errors: [],
      warnings: [],
      scanResult: {
        projectPath: '',
        scannedAt: new Date(),
        files: [],
        dependencies: [],
        errors: [],
        warnings: [],
        summary: {
          totalFiles: 0,
          dependencyFiles: 0,
          lockFiles: 0,
          totalDependencies: 0,
          uniqueDependencies: 0,
          registries: [],
        },
      },
    };

    // Scan the project
    const scanResult = scanProject(this.options.projectPath, {
      maxDepth: this.options.maxDepth,
      excludePatterns: this.options.excludePatterns,
      includeLockFiles: this.options.includeLockFiles,
      followSymlinks: this.options.followSymlinks,
    });

    result.scanResult = scanResult;
    result.summary.totalDependencies = scanResult.dependencies.length;
    result.errors.push(...scanResult.errors);
    result.warnings.push(...scanResult.warnings);

    // Group dependencies by package and registry
    const groupedDeps = this.groupDependencies(scanResult.dependencies);

    // Optimize each package
    const plans: OptimizationPlan[] = [];

    // Process in parallel batches
    const batchSize = this.options.parallelChecks || 5;
    const packages = Array.from(groupedDeps.entries());

    for (let i = 0; i < packages.length; i += batchSize) {
      const batch = packages.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(([key, deps]) => this.optimizePackage(key, deps))
      );

      for (const batchResult of batchResults) {
        if (batchResult.status === 'fulfilled') {
          plans.push(batchResult.value);
        } else {
          result.errors.push(
            `Failed to optimize package: ${batchResult.reason instanceof Error ? batchResult.reason.message : String(batchResult.reason)}`
          );
        }
      }
    }

    result.plan = plans;

    // Calculate summary
    result.summary.packagesOptimized = plans.filter((p) => p.action === 'upgrade' || p.action === 'downgrade').length;
    result.summary.packagesKept = plans.filter((p) => p.action === 'keep').length;
    result.summary.packagesRemoved = plans.filter((p) => p.action === 'remove').length;
    result.summary.conflictsResolved = plans.filter((p) => p.reason.includes('conflict')).length;
    result.summary.outdatedUpdated = plans.filter((p) => p.reason.includes('outdated')).length;
    result.summary.registries = Array.from(
      new Set([...scanResult.summary.registries, ...plans.map((p) => p.registry)])
    ).sort();
    result.summary.highRiskChanges = plans.filter((p) => p.risk === 'high').length;
    result.summary.mediumRiskChanges = plans.filter((p) => p.risk === 'medium').length;
    result.summary.lowRiskChanges = plans.filter((p) => p.risk === 'low').length;

    return result;
  }

  /**
   * Group dependencies by package and registry
   */
  private groupDependencies(dependencies: ScannedDependency[]): Map<string, ScannedDependency[]> {
    const grouped = new Map<string, ScannedDependency[]>();

    for (const dep of dependencies) {
      const key = `${dep.name}@${dep.registry}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(dep);
    }

    return grouped;
  }

  /**
   * Optimize a single package
   */
  private async optimizePackage(
    key: string,
    dependencies: ScannedDependency[]
  ): Promise<OptimizationPlan> {
    // Key is `${name}@${registry}` (see groupDependencies). Split on the LAST '@'
    // so scoped npm names like `@scope/pkg` keep their leading '@'.
    const sep = key.lastIndexOf('@');
    const packageName = key.slice(0, sep);
    const registry = key.slice(sep + 1);

    // Get unique versions and constraints
    const uniqueVersions = [...new Set(dependencies.map((d) => d.version).filter((v): v is string => !!v))];
    const constraints = [...new Set(dependencies.map((d) => d.constraint).filter((c): c is string => !!c))];
    const affectedFiles = [...new Set(dependencies.map((d) => d.source))];

    // Get current version (highest)
    const currentVersion = uniqueVersions.reduce((max, v) =>
      compareVersions(v, max) > 0 ? v : max
    );

    // Get current constraint (most permissive)
    const currentConstraint = this.getMostPermissiveConstraint(constraints);

    // Get latest version from registry
    let latestVersion: string | null = null;
    try {
      latestVersion = await this.getLatestVersionWithTimeout(packageName, registry);
    } catch (error) {
      // Ignore errors, will use current version
    }

    // Determine action
    let action: 'keep' | 'upgrade' | 'downgrade' | 'remove';
    let suggestedVersion: string;
    let suggestedConstraint: string | undefined;
    let reason: string;
    let risk: 'low' | 'medium' | 'high';

    // Check if there are conflicts
    const hasConflict = uniqueVersions.length > 1;

    // Check if outdated
    const isOutdated = latestVersion && compareVersions(latestVersion, currentVersion) > 0;

    if (hasConflict) {
      // Resolve conflict
      const parsedConstraints = constraints.map(parseConstraint);
      const availableVersions = latestVersion
        ? [...uniqueVersions, latestVersion]
        : uniqueVersions;

      const compatibleVersion = findCompatibleVersion(packageName, registry, availableVersions, parsedConstraints);

      if (compatibleVersion) {
        suggestedVersion = compatibleVersion;
        suggestedConstraint = this.suggestConstraint(compatibleVersion, parsedConstraints);

        if (compareVersions(suggestedVersion, currentVersion) > 0) {
          action = 'upgrade';
          reason = `Resolve conflict: upgrade to ${suggestedVersion} (compatible with all constraints)`;
          risk = this.calculateRisk(currentVersion, suggestedVersion);
        } else if (compareVersions(suggestedVersion, currentVersion) < 0) {
          if (this.options.allowDowngrade) {
            action = 'downgrade';
            reason = `Resolve conflict: downgrade to ${suggestedVersion} (compatible with all constraints)`;
            risk = 'medium';
          } else {
            action = 'keep';
            suggestedVersion = currentVersion;
            reason = `Keep ${currentVersion} (conflict exists, downgrade not allowed)`;
            risk = 'high';
          }
        } else {
          action = 'keep';
          reason = `Keep ${currentVersion} (conflict resolved by updating constraints)`;
          risk = 'low';
        }
      } else {
        // No compatible version found
        if (this.options.preferLatest && latestVersion) {
          suggestedVersion = latestVersion;
          action = 'upgrade';
          reason = `Resolve conflict: upgrade to ${latestVersion} (may require constraint updates)`;
          risk = 'high';
        } else {
          suggestedVersion = currentVersion;
          action = 'keep';
          reason = `Keep ${currentVersion} (conflict exists, no compatible version found)`;
          risk = 'high';
        }
      }
    } else if (isOutdated) {
      // Update outdated package
      suggestedVersion = latestVersion!;
      suggestedConstraint = this.suggestConstraint(suggestedVersion, constraints.map(parseConstraint));

      action = 'upgrade';
      reason = `Update outdated package: ${currentVersion} → ${suggestedVersion}`;
      risk = this.calculateRisk(currentVersion, suggestedVersion);
    } else {
      // Keep current version
      suggestedVersion = currentVersion;
      suggestedConstraint = currentConstraint;
      action = 'keep';
      reason = `Keep ${currentVersion} (already latest)`;
      risk = 'low';
    }

    return {
      package: packageName,
      registry,
      currentVersion,
      currentConstraint,
      suggestedVersion,
      suggestedConstraint,
      action,
      reason,
      risk,
      affectedFiles,
    };
  }

  /**
   * Get the most permissive constraint from a list
   */
  private getMostPermissiveConstraint(constraints: string[]): string | undefined {
    if (constraints.length === 0) {
      return undefined;
    }

    if (constraints.length === 1) {
      return constraints[0];
    }

    // For now, return the first constraint
    // In a full implementation, we would merge constraints intelligently
    return constraints[0];
  }

  /**
   * Suggest a constraint for a version
   */
  private suggestConstraint(version: string, constraints: VersionConstraint[]): string | undefined {
    if (constraints.length === 0) {
      return undefined;
    }

    // For now, generate a caret constraint for the suggested version
    // In a full implementation, we would generate a constraint that satisfies all
    return `^${version}`;
  }

  /**
   * Calculate risk of a version change
   */
  private calculateRisk(currentVersion: string, suggestedVersion: string): 'low' | 'medium' | 'high' {
    const comparison = compareVersions(suggestedVersion, currentVersion);

    if (comparison > 0) {
      // Upgrade - check if major version change
      const currentParts = currentVersion.split('.').map(Number);
      const suggestedParts = suggestedVersion.split('.').map(Number);

      if (suggestedParts[0] > currentParts[0]) {
        return 'high';
      } else if (suggestedParts[1] > currentParts[1]) {
        return 'medium';
      } else {
        return 'low';
      }
    } else if (comparison < 0) {
      // Downgrade - always medium or high risk
      return 'medium';
    } else {
      // No change
      return 'low';
    }
  }

  /**
   * Get latest version with timeout
   */
  private async getLatestVersionWithTimeout(
    packageName: string,
    registry: string
  ): Promise<string> {
    const timeout = this.options.timeout || 10000;

    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout checking ${packageName} on ${registry}`)), timeout);
    });

    try {
      const client = getRegistryClient(registry);
      return await Promise.race([
        client.getLatestVersion(packageName),
        timeoutPromise,
      ]);
    } catch (error) {
      return '';
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Optimize versions across a project
 */
export async function optimizeVersions(options: OptimizationOptions): Promise<OptimizationResult> {
  const optimizer = new GlobalVersionOptimizer(options);
  return optimizer.optimize();
}

/**
 * Quick optimization with default options
 */
export async function quickOptimize(projectPath: string): Promise<OptimizationResult> {
  return optimizeVersions({ projectPath });
}

/**
 * Get a summary of optimization plan
 */
export function getOptimizationSummary(result: OptimizationResult): string {
  const lines: string[] = [];

  lines.push(`=== Global Version Optimization Summary ===`);
  lines.push(`Project: ${result.projectPath}`);
  lines.push(`Optimized: ${result.optimizedAt.toISOString()}`);
  lines.push('');
  lines.push(`Summary:`);
  lines.push(`  Total Dependencies: ${result.summary.totalDependencies}`);
  lines.push(`  Packages Optimized: ${result.summary.packagesOptimized}`);
  lines.push(`  Packages Kept: ${result.summary.packagesKept}`);
  lines.push(`  Packages Removed: ${result.summary.packagesRemoved}`);
  lines.push(`  Conflicts Resolved: ${result.summary.conflictsResolved}`);
  lines.push(`  Outdated Updated: ${result.summary.outdatedUpdated}`);
  lines.push(`  Registries: ${result.summary.registries.join(', ')}`);
  lines.push('');
  lines.push(`Risk Breakdown:`);
  lines.push(`  High Risk: ${result.summary.highRiskChanges}`);
  lines.push(`  Medium Risk: ${result.summary.mediumRiskChanges}`);
  lines.push(`  Low Risk: ${result.summary.lowRiskChanges}`);
  lines.push('');

  if (result.errors.length > 0) {
    lines.push(`Errors (${result.errors.length}):`);
    result.errors.forEach((error) => lines.push(`  - ${error}`));
    lines.push('');
  }

  if (result.warnings.length > 0) {
    lines.push(`Warnings (${result.warnings.length}):`);
    result.warnings.forEach((warning) => lines.push(`  - ${warning}`));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get optimization plan as JSON
 */
export function getOptimizationAsJSON(result: OptimizationResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Get optimization plan as Markdown
 */
export function getOptimizationAsMarkdown(result: OptimizationResult): string {
  const lines: string[] = [];

  lines.push(`# Global Version Optimization Report`);
  lines.push('');
  lines.push(`**Project:** ${result.projectPath}`);
  lines.push(`**Optimized:** ${result.optimizedAt.toISOString()}`);
  lines.push('');

  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Dependencies | ${result.summary.totalDependencies} |`);
  lines.push(`| Packages Optimized | ${result.summary.packagesOptimized} |`);
  lines.push(`| Packages Kept | ${result.summary.packagesKept} |`);
  lines.push(`| Packages Removed | ${result.summary.packagesRemoved} |`);
  lines.push(`| Conflicts Resolved | ${result.summary.conflictsResolved} |`);
  lines.push(`| Outdated Updated | ${result.summary.outdatedUpdated} |`);
  lines.push('');

  lines.push(`## Risk Breakdown`);
  lines.push('');
  lines.push(`| Risk Level | Count |`);
  lines.push(`|------------|-------|`);
  lines.push(`| High | ${result.summary.highRiskChanges} |`);
  lines.push(`| Medium | ${result.summary.mediumRiskChanges} |`);
  lines.push(`| Low | ${result.summary.lowRiskChanges} |`);
  lines.push('');

  lines.push(`## Optimization Plan`);
  lines.push('');
  lines.push(`| Package | Registry | Current | Suggested | Action | Risk |`);
  lines.push(`|---------|----------|---------|-----------|--------|------|`);

  for (const plan of result.plan) {
    lines.push(
      `| ${plan.package} | ${plan.registry} | ${plan.currentVersion} | ${plan.suggestedVersion} | ${plan.action} | ${plan.risk} |`
    );
  }

  lines.push('');

  if (result.errors.length > 0) {
    lines.push(`## Errors`);
    lines.push('');
    result.errors.forEach((error) => lines.push(`- ${error}`));
    lines.push('');
  }

  if (result.warnings.length > 0) {
    lines.push(`## Warnings`);
    lines.push('');
    result.warnings.forEach((warning) => lines.push(`- ${warning}`));
    lines.push('');
  }

  return lines.join('\n');
}
