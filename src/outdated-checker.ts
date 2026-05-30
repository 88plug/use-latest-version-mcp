/**
 * Outdated Package Checker
 * Checks for outdated packages in a project and provides upgrade recommendations
 */

import { scanProject, ScanResult, ScannedDependency } from './project-scanner.js';
import { getRegistryClient } from './registries.js';
import {
  checkCompatibility,
  detectConflicts,
  generateUpgradePath,
  suggestSafeUpgrade,
  calculateUpgradeRisk,
  parseSemVer,
  compareVersions,
} from './version-compatibility.js';

// ============================================================================
// Types
// ============================================================================

export interface OutdatedPackage {
  name: string;
  currentVersion: string;
  latestVersion: string;
  registry: string;
  source: string;
  sourceType: 'dependency' | 'lock';
  type?: 'production' | 'development' | 'peer' | 'optional';
  constraint?: string;
  upgradeAvailable: boolean;
  majorUpgrade: boolean;
  minorUpgrade: boolean;
  patchUpgrade: boolean;
  upgradeRisk: 'low' | 'medium' | 'high';
  upgradePath?: string[];
  safeVersion?: string;
  conflicts?: string[];
  breakingChanges?: string[];
  resolved?: string;
  integrity?: string;
}

export interface OutdatedCheckOptions {
  projectPath: string;
  maxDepth?: number;
  excludePatterns?: string[];
  includeLockFiles?: boolean;
  followSymlinks?: boolean;
  checkDevDependencies?: boolean;
  checkPeerDependencies?: boolean;
  checkOptionalDependencies?: boolean;
  includePreRelease?: boolean;
  parallelChecks?: number;
  timeout?: number;
}

export interface OutdatedCheckResult {
  projectPath: string;
  checkedAt: Date;
  summary: {
    totalDependencies: number;
    outdatedPackages: number;
    upToDatePackages: number;
    packagesChecked: number;
    packagesSkipped: number;
    registries: string[];
    highRiskUpgrades: number;
    mediumRiskUpgrades: number;
    lowRiskUpgrades: number;
  };
  outdatedPackages: OutdatedPackage[];
  upToDatePackages: Array<{
    name: string;
    version: string;
    registry: string;
  }>;
  errors: string[];
  warnings: string[];
  scanResult: ScanResult;
}

// ============================================================================
// Outdated Checker Class
// ============================================================================

export class OutdatedChecker {
  private options: OutdatedCheckOptions;

  constructor(options: OutdatedCheckOptions) {
    this.options = {
      checkDevDependencies: true,
      checkPeerDependencies: true,
      checkOptionalDependencies: true,
      includePreRelease: false,
      parallelChecks: 5,
      timeout: 10000,
      ...options,
    };
  }

  /**
   * Check for outdated packages in the project
   */
  async check(): Promise<OutdatedCheckResult> {
    const result: OutdatedCheckResult = {
      projectPath: this.options.projectPath,
      checkedAt: new Date(),
      summary: {
        totalDependencies: 0,
        outdatedPackages: 0,
        upToDatePackages: 0,
        packagesChecked: 0,
        packagesSkipped: 0,
        registries: [],
        highRiskUpgrades: 0,
        mediumRiskUpgrades: 0,
        lowRiskUpgrades: 0,
      },
      outdatedPackages: [],
      upToDatePackages: [],
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

    // Filter dependencies based on options
    const dependenciesToCheck = this.filterDependencies(scanResult.dependencies);

    // Get unique dependencies (by name and registry)
    const uniqueDeps = this.getUniqueDependencies(dependenciesToCheck);

    result.summary.packagesChecked = uniqueDeps.length;
    result.summary.packagesSkipped = scanResult.dependencies.length - dependenciesToCheck.length;

    // Check each dependency for updates
    const outdatedPackages: OutdatedPackage[] = [];
    const upToDatePackages: Array<{ name: string; version: string; registry: string }> = [];

    // Process in parallel batches
    const batchSize = this.options.parallelChecks || 5;
    for (let i = 0; i < uniqueDeps.length; i += batchSize) {
      const batch = uniqueDeps.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((dep) => this.checkDependency(dep))
      );

      for (const batchResult of batchResults) {
        if (batchResult.status === 'fulfilled') {
          const checkResult = batchResult.value;
          if (checkResult.upgradeAvailable) {
            outdatedPackages.push(checkResult);
          } else {
            upToDatePackages.push({
              name: checkResult.name,
              version: checkResult.currentVersion,
              registry: checkResult.registry,
            });
          }
        } else {
          result.errors.push(
            `Failed to check package: ${batchResult.reason instanceof Error ? batchResult.reason.message : String(batchResult.reason)}`
          );
        }
      }
    }

    result.outdatedPackages = outdatedPackages;
    result.upToDatePackages = upToDatePackages;

    // Calculate summary
    result.summary.outdatedPackages = outdatedPackages.length;
    result.summary.upToDatePackages = upToDatePackages.length;
    result.summary.registries = Array.from(
      new Set([...scanResult.summary.registries, ...outdatedPackages.map((p) => p.registry)])
    ).sort();
    result.summary.highRiskUpgrades = outdatedPackages.filter((p) => p.upgradeRisk === 'high').length;
    result.summary.mediumRiskUpgrades = outdatedPackages.filter((p) => p.upgradeRisk === 'medium').length;
    result.summary.lowRiskUpgrades = outdatedPackages.filter((p) => p.upgradeRisk === 'low').length;

    return result;
  }

  /**
   * Filter dependencies based on options
   */
  private filterDependencies(dependencies: ScannedDependency[]): ScannedDependency[] {
    return dependencies.filter((dep) => {
      // Filter by dependency type
      if (!this.options.checkDevDependencies && dep.type === 'development') {
        return false;
      }
      if (!this.options.checkPeerDependencies && dep.type === 'peer') {
        return false;
      }
      if (!this.options.checkOptionalDependencies && dep.type === 'optional') {
        return false;
      }

      // Filter out packages without versions
      if (!dep.version) {
        return false;
      }

      return true;
    });
  }

  /**
   * Get unique dependencies (by name and registry)
   */
  private getUniqueDependencies(dependencies: ScannedDependency[]): ScannedDependency[] {
    const uniqueMap = new Map<string, ScannedDependency>();

    for (const dep of dependencies) {
      const key = `${dep.name}@${dep.registry}`;
      // Prefer lock file versions over dependency file versions
      const existing = uniqueMap.get(key);
      if (!existing || (dep.sourceType === 'lock' && existing.sourceType === 'dependency')) {
        uniqueMap.set(key, dep);
      }
    }

    return Array.from(uniqueMap.values());
  }

  /**
   * Check a single dependency for updates
   */
  private async checkDependency(dep: ScannedDependency): Promise<OutdatedPackage> {
    const currentVersion = dep.version || '';
    const latestVersion = await this.getLatestVersionWithTimeout(dep.name, dep.registry);

    const currentParsed = parseSemVer(currentVersion) || { major: 0, minor: 0, patch: 0, prerelease: '', build: '' };
    const latestParsed = parseSemVer(latestVersion) || { major: 0, minor: 0, patch: 0, prerelease: '', build: '' };

    const comparison = compareVersions(currentVersion, latestVersion);
    const upgradeAvailable = comparison < 0;

    const outdatedPackage: OutdatedPackage = {
      name: dep.name,
      currentVersion,
      latestVersion,
      registry: dep.registry,
      source: dep.source,
      sourceType: dep.sourceType,
      type: dep.type,
      constraint: dep.constraint,
      upgradeAvailable,
      majorUpgrade: upgradeAvailable && latestParsed.major > currentParsed.major,
      minorUpgrade:
        upgradeAvailable &&
        latestParsed.major === currentParsed.major &&
        latestParsed.minor > currentParsed.minor,
      patchUpgrade:
        upgradeAvailable &&
        latestParsed.major === currentParsed.major &&
        latestParsed.minor === currentParsed.minor &&
        latestParsed.patch > currentParsed.patch,
      upgradeRisk: 'low',
      resolved: dep.resolved,
      integrity: dep.integrity,
    };

    if (upgradeAvailable) {
      // Calculate upgrade risk
      outdatedPackage.upgradeRisk = calculateUpgradeRisk(currentVersion, latestVersion);

      // Get upgrade path
      try {
        const upgradePath = generateUpgradePath(
          dep.name,
          dep.registry,
          currentVersion,
          latestVersion,
          [{ name: dep.name, version: latestVersion, registry: dep.registry }]
        );
        outdatedPackage.upgradePath = upgradePath.steps.map(s => s.toVersion);
      } catch (error) {
        // Ignore upgrade path errors
      }

      // Get safe version
      try {
        const safeVersion = suggestSafeUpgrade(
          dep.name,
          currentVersion,
          [{ name: dep.name, version: latestVersion, registry: dep.registry }]
        );
        outdatedPackage.safeVersion = safeVersion.version || undefined;
      } catch (error) {
        // Ignore safe version errors
      }

      // Check for conflicts
      try {
        const conflicts = detectConflicts([
          { name: dep.name, version: latestVersion, registry: dep.registry },
        ]);
        if (conflicts.length > 0) {
          outdatedPackage.conflicts = conflicts.map((c) => `${c.package}: ${c.reason}`);
        }
      } catch (error) {
        // Ignore conflict detection errors
      }

      // Check for breaking changes
      try {
        const compatibility = checkCompatibility(
          dep.name,
          dep.registry,
          latestVersion,
          [{ name: dep.name, version: latestVersion, registry: dep.registry }],
          []
        );
        if (!compatibility.compatible && compatibility.issues.length > 0) {
          outdatedPackage.breakingChanges = compatibility.issues;
        }
      } catch (error) {
        // Ignore compatibility check errors
      }
    }

    return outdatedPackage;
  }

  /**
   * Get latest version with timeout
   */
  private async getLatestVersionWithTimeout(
    packageName: string,
    registry: string
  ): Promise<string> {
    const timeout = this.options.timeout || 10000;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<string>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Timeout checking ${packageName} on ${registry}`)),
        timeout
      );
    });

    try {
      const client = getRegistryClient(registry);
      // Let failures propagate: the caller records them in result.errors instead
      // of silently treating an unreachable registry as "up to date".
      return await Promise.race([
        client.getLatestVersion(packageName),
        timeoutPromise,
      ]);
    } finally {
      // Clear the timer so a fast success does not leave a dangling timeout
      // that later rejects unhandled.
      if (timer) clearTimeout(timer);
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Check for outdated packages in a project
 */
export async function checkOutdated(options: OutdatedCheckOptions): Promise<OutdatedCheckResult> {
  const checker = new OutdatedChecker(options);
  return checker.check();
}

/**
 * Quick check for outdated packages with default options
 */
export async function quickCheckOutdated(projectPath: string): Promise<OutdatedCheckResult> {
  return checkOutdated({ projectPath });
}

/**
 * Get a summary of outdated packages
 */
export function getOutdatedSummary(result: OutdatedCheckResult): string {
  const lines: string[] = [];

  lines.push(`=== Outdated Packages Summary ===`);
  lines.push(`Project: ${result.projectPath}`);
  lines.push(`Checked: ${result.checkedAt.toISOString()}`);
  lines.push('');

  lines.push(`Summary:`);
  lines.push(`  Total Dependencies: ${result.summary.totalDependencies}`);
  lines.push(`  Outdated Packages: ${result.summary.outdatedPackages}`);
  lines.push(`  Up-to-Date Packages: ${result.summary.upToDatePackages}`);
  lines.push(`  Packages Checked: ${result.summary.packagesChecked}`);
  lines.push(`  Packages Skipped: ${result.summary.packagesSkipped}`);
  lines.push('');

  lines.push(`Upgrade Risk:`);
  lines.push(`  High Risk: ${result.summary.highRiskUpgrades}`);
  lines.push(`  Medium Risk: ${result.summary.mediumRiskUpgrades}`);
  lines.push(`  Low Risk: ${result.summary.lowRiskUpgrades}`);
  lines.push('');

  if (result.outdatedPackages.length > 0) {
    lines.push(`Outdated Packages:`);
    for (const pkg of result.outdatedPackages) {
      const riskEmoji = pkg.upgradeRisk === 'high' ? '🔴' : pkg.upgradeRisk === 'medium' ? '🟡' : '🟢';
      lines.push(`  ${riskEmoji} ${pkg.name} (${pkg.registry})`);
      lines.push(`     ${pkg.currentVersion} → ${pkg.latestVersion}`);
      if (pkg.safeVersion && pkg.safeVersion !== pkg.latestVersion) {
        lines.push(`     Safe version: ${pkg.safeVersion}`);
      }
      if (pkg.conflicts && pkg.conflicts.length > 0) {
        lines.push(`     Conflicts: ${pkg.conflicts.join(', ')}`);
      }
    }
  } else {
    lines.push(`✅ All packages are up to date!`);
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
 * Get outdated packages as JSON
 */
export function getOutdatedAsJSON(result: OutdatedCheckResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Get outdated packages as Markdown table
 */
export function getOutdatedAsMarkdown(result: OutdatedCheckResult): string {
  const lines: string[] = [];

  lines.push(`# Outdated Packages Report`);
  lines.push('');
  lines.push(`**Project:** ${result.projectPath}`);
  lines.push(`**Checked:** ${result.checkedAt.toISOString()}`);
  lines.push('');

  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Dependencies | ${result.summary.totalDependencies} |`);
  lines.push(`| Outdated Packages | ${result.summary.outdatedPackages} |`);
  lines.push(`| Up-to-Date Packages | ${result.summary.upToDatePackages} |`);
  lines.push(`| Packages Checked | ${result.summary.packagesChecked} |`);
  lines.push(`| Packages Skipped | ${result.summary.packagesSkipped} |`);
  lines.push('');

  lines.push(`## Upgrade Risk`);
  lines.push('');
  lines.push(`| Risk Level | Count |`);
  lines.push(`|------------|-------|`);
  lines.push(`| 🔴 High | ${result.summary.highRiskUpgrades} |`);
  lines.push(`| 🟡 Medium | ${result.summary.mediumRiskUpgrades} |`);
  lines.push(`| 🟢 Low | ${result.summary.lowRiskUpgrades} |`);
  lines.push('');

  if (result.outdatedPackages.length > 0) {
    lines.push(`## Outdated Packages`);
    lines.push('');
    lines.push(`| Package | Registry | Current | Latest | Risk | Safe Version |`);
    lines.push(`|---------|----------|---------|--------|------|--------------|`);

    for (const pkg of result.outdatedPackages) {
      const riskEmoji = pkg.upgradeRisk === 'high' ? '🔴' : pkg.upgradeRisk === 'medium' ? '🟡' : '🟢';
      const safeVersion = pkg.safeVersion && pkg.safeVersion !== pkg.latestVersion ? pkg.safeVersion : '-';
      lines.push(
        `| ${pkg.name} | ${pkg.registry} | ${pkg.currentVersion} | ${pkg.latestVersion} | ${riskEmoji} ${pkg.upgradeRisk} | ${safeVersion} |`
      );
    }
  } else {
    lines.push(`## ✅ All packages are up to date!`);
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
