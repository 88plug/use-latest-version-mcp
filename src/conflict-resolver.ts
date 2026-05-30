/**
 * Conflict Resolver
 * Detects and resolves dependency conflicts in projects
 */

import { scanProject, ScanResult, ScannedDependency } from './project-scanner.js';
import { getRegistryClient } from './registries.js';
import {
  detectConflicts,
  findCompatibleVersion,
  parseConstraint,
  satisfiesConstraint,
  compareVersions,
  Dependency,
  VersionConstraint,
} from './version-compatibility.js';

// ============================================================================
// Types
// ============================================================================

export interface ConflictResolution {
  package: string;
  registry: string;
  currentVersions: string[];
  suggestedVersion: string;
  resolutionType: 'upgrade' | 'downgrade' | 'keep' | 'remove';
  affectedFiles: string[];
  reason: string;
  risk: 'low' | 'medium' | 'high';
}

export interface ConflictResolutionOptions {
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
}

export interface ConflictResolutionResult {
  projectPath: string;
  resolvedAt: Date;
  summary: {
    totalDependencies: number;
    conflictsFound: number;
    conflictsResolved: number;
    packagesChecked: number;
    registries: string[];
    highRiskResolutions: number;
    mediumRiskResolutions: number;
    lowRiskResolutions: number;
  };
  conflicts: ConflictResolution[];
  errors: string[];
  warnings: string[];
  scanResult: ScanResult;
}

// ============================================================================
// Conflict Resolver Class
// ============================================================================

export class ConflictResolver {
  private options: ConflictResolutionOptions;

  constructor(options: ConflictResolutionOptions) {
    this.options = {
      preferLatest: true,
      allowDowngrade: false,
      maxRisk: 'medium',
      parallelChecks: 5,
      timeout: 10000,
      ...options,
    };
  }

  /**
   * Resolve conflicts in the project
   */
  async resolve(): Promise<ConflictResolutionResult> {
    const result: ConflictResolutionResult = {
      projectPath: this.options.projectPath,
      resolvedAt: new Date(),
      summary: {
        totalDependencies: 0,
        conflictsFound: 0,
        conflictsResolved: 0,
        packagesChecked: 0,
        registries: [],
        highRiskResolutions: 0,
        mediumRiskResolutions: 0,
        lowRiskResolutions: 0,
      },
      conflicts: [],
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

    // Get unique dependencies (by name and registry)
    const uniqueDeps = this.getUniqueDependencies(scanResult.dependencies);
    result.summary.packagesChecked = uniqueDeps.length;

    // Detect conflicts
    const conflicts = detectConflicts(
      uniqueDeps.map((dep) => ({
        name: dep.name,
        registry: dep.registry,
        version: dep.version,
        constraint: dep.constraint ? parseConstraint(dep.constraint) : undefined,
        source: dep.source,
      }))
    );

    result.summary.conflictsFound = conflicts.length;

    // Resolve each conflict
    const resolutions: ConflictResolution[] = [];

    // Process in parallel batches
    const batchSize = this.options.parallelChecks || 5;
    for (let i = 0; i < conflicts.length; i += batchSize) {
      const batch = conflicts.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((conflict) => this.resolveConflict(conflict, scanResult.dependencies))
      );

      for (const batchResult of batchResults) {
        if (batchResult.status === 'fulfilled') {
          resolutions.push(batchResult.value);
        } else {
          result.errors.push(
            `Failed to resolve conflict: ${batchResult.reason instanceof Error ? batchResult.reason.message : String(batchResult.reason)}`
          );
        }
      }
    }

    result.conflicts = resolutions;
    result.summary.conflictsResolved = resolutions.length;

    // Calculate summary
    result.summary.registries = Array.from(
      new Set([...scanResult.summary.registries, ...resolutions.map((r) => r.registry)])
    ).sort();
    result.summary.highRiskResolutions = resolutions.filter((r) => r.risk === 'high').length;
    result.summary.mediumRiskResolutions = resolutions.filter((r) => r.risk === 'medium').length;
    result.summary.lowRiskResolutions = resolutions.filter((r) => r.risk === 'low').length;

    return result;
  }

  /**
   * Get unique dependencies (by name and registry)
   */
  private getUniqueDependencies(dependencies: ScannedDependency[]): ScannedDependency[] {
    const uniqueMap = new Map<string, ScannedDependency[]>();

    for (const dep of dependencies) {
      const key = `${dep.name}@${dep.registry}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, []);
      }
      uniqueMap.get(key)!.push(dep);
    }

    // Return all dependencies (including duplicates for conflict detection)
    return dependencies;
  }

  /**
   * Resolve a single conflict
   */
  private async resolveConflict(
    conflict: { package: string; conflicts: string[]; reason: string },
    allDependencies: ScannedDependency[]
  ): Promise<ConflictResolution> {
    const [registry, packageName] = conflict.package.split(':');

    // Get all dependencies for this package
    const packageDeps = allDependencies.filter(
      (dep) => dep.name === packageName && dep.registry === registry
    );

    // Get unique versions
    const uniqueVersions = [...new Set(packageDeps.map((d) => d.version).filter((v): v is string => !!v))];

    // Get affected files
    const affectedFiles = [...new Set(packageDeps.map((d) => d.source))];

    // Get constraints
    const constraints = packageDeps
      .map((d) => d.constraint)
      .filter((c): c is string => !!c)
      .map(parseConstraint);

    // Get available versions from registry
    let availableVersions: string[] = [];
    try {
      const client = getRegistryClient(registry);
      const latestVersion = await this.getLatestVersionWithTimeout(packageName, registry);
      if (latestVersion) {
        // For now, just use the latest version
        // In a full implementation, we would fetch all available versions
        availableVersions = [...uniqueVersions, latestVersion];
      } else {
        availableVersions = uniqueVersions;
      }
    } catch (error) {
      availableVersions = uniqueVersions;
    }

    // Find compatible version
    const compatibleVersion = findCompatibleVersion(packageName, registry, availableVersions, constraints);

    // Determine resolution
    let suggestedVersion: string;
    let resolutionType: 'upgrade' | 'downgrade' | 'keep' | 'remove';
    let reason: string;
    let risk: 'low' | 'medium' | 'high';

    // Get the latest version from available versions (if we fetched from registry)
    const latestVersion = availableVersions.length > uniqueVersions.length
      ? availableVersions[availableVersions.length - 1]
      : null;

    if (compatibleVersion) {
      suggestedVersion = compatibleVersion;

      // Determine resolution type
      const maxCurrentVersion = uniqueVersions.reduce((max, v) =>
        compareVersions(v, max) > 0 ? v : max
      );

      if (compareVersions(suggestedVersion, maxCurrentVersion) > 0) {
        resolutionType = 'upgrade';
        reason = `Upgrade to ${suggestedVersion} to satisfy all constraints`;
        risk = this.calculateResolutionRisk(uniqueVersions, suggestedVersion);
      } else if (compareVersions(suggestedVersion, maxCurrentVersion) < 0) {
        if (this.options.allowDowngrade) {
          resolutionType = 'downgrade';
          reason = `Downgrade to ${suggestedVersion} to satisfy all constraints`;
          risk = this.calculateResolutionRisk(uniqueVersions, suggestedVersion);
        } else {
          resolutionType = 'keep';
          suggestedVersion = maxCurrentVersion;
          reason = `Keep ${maxCurrentVersion} (downgrade not allowed)`;
          risk = 'low';
        }
      } else {
        // Versions are equal - check if we're resolving a conflict by choosing latest
        if (this.options.preferLatest && uniqueVersions.length > 1) {
          // Multiple versions exist - we're resolving conflict by choosing latest
          resolutionType = 'upgrade';
          reason = `Upgrade to ${suggestedVersion} (resolve conflict with latest compatible version)`;
          risk = this.calculateResolutionRisk(uniqueVersions, suggestedVersion);
        } else if (this.options.preferLatest && latestVersion && compareVersions(suggestedVersion, latestVersion) >= 0) {
          resolutionType = 'upgrade';
          reason = `Upgrade to ${suggestedVersion} (latest compatible version)`;
          risk = this.calculateResolutionRisk(uniqueVersions, suggestedVersion);
        } else {
          resolutionType = 'keep';
          reason = `Keep ${suggestedVersion} (already compatible)`;
          risk = 'low';
        }
      }
    } else {
      // No compatible version found
      if (this.options.preferLatest) {
        // Prefer latest - use the latest available version
        if (latestVersion) {
          suggestedVersion = latestVersion;
          resolutionType = 'upgrade';
          reason = `Upgrade to ${suggestedVersion} (latest version, may require constraint updates)`;
          risk = 'high';
        } else {
          // No latest version available, use max current
          suggestedVersion = uniqueVersions.reduce((max, v) =>
            compareVersions(v, max) > 0 ? v : max
          );
          resolutionType = 'keep';
          reason = `Keep ${suggestedVersion} (no compatible version found)`;
          risk = 'high';
        }
      } else {
        suggestedVersion = uniqueVersions.reduce((min, v) =>
          compareVersions(v, min) < 0 ? v : min
        );
        resolutionType = 'keep';
        reason = `Keep ${suggestedVersion} (no compatible version found)`;
        risk = 'high';
      }
    }

    return {
      package: packageName,
      registry,
      currentVersions: uniqueVersions,
      suggestedVersion,
      resolutionType,
      affectedFiles,
      reason,
      risk,
    };
  }

  /**
   * Calculate resolution risk
   */
  private calculateResolutionRisk(currentVersions: string[], suggestedVersion: string): 'low' | 'medium' | 'high' {
    const maxCurrentVersion = currentVersions.reduce((max, v) =>
      compareVersions(v, max) > 0 ? v : max
    );

    const comparison = compareVersions(suggestedVersion, maxCurrentVersion);

    if (comparison > 0) {
      // Upgrade - check if major version change
      const currentParts = maxCurrentVersion.split('.').map(Number);
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
 * Resolve conflicts in a project
 */
export async function resolveConflicts(options: ConflictResolutionOptions): Promise<ConflictResolutionResult> {
  const resolver = new ConflictResolver(options);
  return resolver.resolve();
}

/**
 * Quick conflict resolution with default options
 */
export async function quickResolveConflicts(projectPath: string): Promise<ConflictResolutionResult> {
  return resolveConflicts({ projectPath });
}

/**
 * Get a summary of conflict resolutions
 */
export function getConflictResolutionSummary(result: ConflictResolutionResult): string {
  const lines: string[] = [];

  lines.push(`=== Conflict Resolution Summary ===`);
  lines.push(`Project: ${result.projectPath}`);
  lines.push(`Resolved: ${result.resolvedAt.toISOString()}`);
  lines.push('');

  lines.push(`Summary:`);
  lines.push(`  Total Dependencies: ${result.summary.totalDependencies}`);
  lines.push(`  Conflicts Found: ${result.summary.conflictsFound}`);
  lines.push(`  Conflicts Resolved: ${result.summary.conflictsResolved}`);
  lines.push(`  Packages Checked: ${result.summary.packagesChecked}`);
  lines.push('');

  lines.push(`Resolution Risk:`);
  lines.push(`  High Risk: ${result.summary.highRiskResolutions}`);
  lines.push(`  Medium Risk: ${result.summary.mediumRiskResolutions}`);
  lines.push(`  Low Risk: ${result.summary.lowRiskResolutions}`);
  lines.push('');

  if (result.conflicts.length > 0) {
    lines.push(`Conflict Resolutions:`);
    for (const conflict of result.conflicts) {
      const riskEmoji = conflict.risk === 'high' ? '🔴' : conflict.risk === 'medium' ? '🟡' : '🟢';
      const typeEmoji = conflict.resolutionType === 'upgrade' ? '⬆️' : conflict.resolutionType === 'downgrade' ? '⬇️' : '✅';
      lines.push(`  ${riskEmoji} ${typeEmoji} ${conflict.package} (${conflict.registry})`);
      lines.push(`     Current: ${conflict.currentVersions.join(', ')}`);
      lines.push(`     Suggested: ${conflict.suggestedVersion}`);
      lines.push(`     Reason: ${conflict.reason}`);
      lines.push(`     Affected Files: ${conflict.affectedFiles.join(', ')}`);
    }
  } else {
    lines.push(`✅ No conflicts found!`);
  }

  if (result.errors.length > 0) {
    lines.push('');
    lines.push(`Errors:`);
    for (const error of result.errors) {
      lines.push(`  ❌ ${error}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push(`Warnings:`);
    for (const warning of result.warnings) {
      lines.push(`  ⚠️  ${warning}`);
    }
  }

  return lines.join('\n');
}

/**
 * Get conflict resolutions as JSON
 */
export function getConflictResolutionAsJSON(result: ConflictResolutionResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Get conflict resolutions as Markdown table
 */
export function getConflictResolutionAsMarkdown(result: ConflictResolutionResult): string {
  const lines: string[] = [];

  lines.push(`# Conflict Resolution Report`);
  lines.push('');
  lines.push(`**Project:** ${result.projectPath}`);
  lines.push(`**Resolved:** ${result.resolvedAt.toISOString()}`);
  lines.push('');

  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Dependencies | ${result.summary.totalDependencies} |`);
  lines.push(`| Conflicts Found | ${result.summary.conflictsFound} |`);
  lines.push(`| Conflicts Resolved | ${result.summary.conflictsResolved} |`);
  lines.push(`| Packages Checked | ${result.summary.packagesChecked} |`);
  lines.push('');

  lines.push(`## Resolution Risk`);
  lines.push('');
  lines.push(`| Risk Level | Count |`);
  lines.push(`|------------|-------|`);
  lines.push(`| 🔴 High | ${result.summary.highRiskResolutions} |`);
  lines.push(`| 🟡 Medium | ${result.summary.mediumRiskResolutions} |`);
  lines.push(`| 🟢 Low | ${result.summary.lowRiskResolutions} |`);
  lines.push('');

  if (result.conflicts.length > 0) {
    lines.push(`## Conflict Resolutions`);
    lines.push('');
    lines.push(`| Package | Registry | Current Versions | Suggested | Type | Risk |`);
    lines.push(`|---------|----------|-----------------|-----------|------|------|`);

    for (const conflict of result.conflicts) {
      const riskEmoji = conflict.risk === 'high' ? '🔴' : conflict.risk === 'medium' ? '🟡' : '🟢';
      const typeEmoji = conflict.resolutionType === 'upgrade' ? '⬆️' : conflict.resolutionType === 'downgrade' ? '⬇️' : '✅';
      lines.push(
        `| ${conflict.package} | ${conflict.registry} | ${conflict.currentVersions.join(', ')} | ${conflict.suggestedVersion} | ${typeEmoji} ${conflict.resolutionType} | ${riskEmoji} ${conflict.risk} |`
      );
    }
  } else {
    lines.push(`## ✅ No conflicts found!`);
  }

  if (result.errors.length > 0) {
    lines.push('');
    lines.push(`## Errors`);
    lines.push('');
    for (const error of result.errors) {
      lines.push(`- ❌ ${error}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push(`## Warnings`);
    lines.push('');
    for (const warning of result.warnings) {
      lines.push(`- ⚠️  ${warning}`);
    }
  }

  return lines.join('\n');
}
