/**
 * Version Compatibility Module
 * Handles version compatibility checking, dependency conflict detection, and upgrade path recommendations
 */

// Semantic version parsing
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

// Version constraint types
export type VersionConstraint =
  | { type: 'exact'; version: string }
  | { type: 'range'; min?: string; max?: string }
  | { type: 'caret'; version: string }  // ^1.2.3 -> >=1.2.3 <2.0.0
  | { type: 'tilde'; version: string }  // ~1.2.3 -> >=1.2.3 <1.3.0
  | { type: 'greater'; version: string } // >1.2.3
  | { type: 'greater-equal'; version: string } // >=1.2.3
  | { type: 'less'; version: string } // <1.2.3
  | { type: 'less-equal'; version: string } // <=1.2.3
  | { type: 'any' };

// Dependency information
export interface Dependency {
  name: string;
  registry?: string;
  version?: string;
  constraint?: VersionConstraint;
  source?: string;
}

// Conflict information
export interface Conflict {
  package: string;
  conflicts: string[];
  reason: string;
}

// Breaking change information
export interface BreakingChange {
  type: 'major' | 'minor' | 'patch';
  description: string;
}

// Upgrade risk level
export type UpgradeRisk = 'low' | 'medium' | 'high';

// Compatibility rule
export interface CompatibilityRule {
  package: string;
  registry: string;
  minVersion?: string;
  maxVersion?: string;
  incompatibleWith?: Array<{ package: string; registry: string; versions: string[] }>;
  requires?: Array<{ package: string; registry: string; minVersion?: string }>;
}

// Upgrade path step
export interface UpgradeStep {
  package: string;
  registry: string;
  fromVersion: string;
  toVersion: string;
  breakingChanges?: string[];
  notes?: string;
}

// Upgrade path recommendation
export interface UpgradePath {
  package: string;
  registry: string;
  currentVersion: string;
  targetVersion: string;
  steps: UpgradeStep[];
  estimatedRisk: 'low' | 'medium' | 'high';
  totalBreakingChanges: number;
}

// Parse semantic version
export function parseSemVer(version: string): SemVer | null {
  // Remove 'v' prefix if present
  version = version.replace(/^v/, '');

  // Handle non-semver versions (like 3.0rc1-2, scm-2, etc.)
  const semverRegex = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/;
  const match = version.match(semverRegex);

  if (!match) {
    // Try to parse simple versions like 1.2 or 1
    const simpleRegex = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
    const simpleMatch = version.match(simpleRegex);
    if (simpleMatch) {
      return {
        major: parseInt(simpleMatch[1], 10),
        minor: simpleMatch[2] ? parseInt(simpleMatch[2], 10) : 0,
        patch: simpleMatch[3] ? parseInt(simpleMatch[3], 10) : 0,
      };
    }
    return null;
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
    build: match[5],
  };
}

// Compare two semantic versions
export function compareVersions(a: string, b: string): number {
  const semverA = parseSemVer(a);
  const semverB = parseSemVer(b);

  if (!semverA || !semverB) {
    // Fallback to string comparison for non-semver versions
    return a.localeCompare(b);
  }

  // Compare major, minor, patch
  if (semverA.major !== semverB.major) {
    return semverA.major - semverB.major;
  }
  if (semverA.minor !== semverB.minor) {
    return semverA.minor - semverB.minor;
  }
  if (semverA.patch !== semverB.patch) {
    return semverA.patch - semverB.patch;
  }

  // Compare prerelease (prerelease versions are lower than release versions)
  if (!semverA.prerelease && semverB.prerelease) return 1;
  if (semverA.prerelease && !semverB.prerelease) return -1;
  if (semverA.prerelease && semverB.prerelease) {
    return semverA.prerelease.localeCompare(semverB.prerelease);
  }

  return 0;
}

// Check if version satisfies constraint
export function satisfiesConstraint(version: string, constraint: VersionConstraint): boolean {
  const semver = parseSemVer(version);
  if (!semver) return false;

  switch (constraint.type) {
    case 'exact':
      return version === constraint.version;

    case 'range': {
      if (constraint.min && compareVersions(version, constraint.min) < 0) return false;
      if (constraint.max && compareVersions(version, constraint.max) > 0) return false;
      return true;
    }

    case 'caret': {
      const c = parseSemVer(constraint.version);
      if (!c) return false;

      // Lower bound: version must be >= the constraint version.
      if (compareVersions(version, constraint.version) < 0) return false;

      // Upper bound is set by the left-most non-zero component:
      //   ^1.2.3 -> <2.0.0 ; ^0.2.3 -> <0.3.0 ; ^0.0.3 -> <0.0.4
      let upperBound: string;
      if (c.major > 0) {
        upperBound = `${c.major + 1}.0.0`;
      } else if (c.minor > 0) {
        upperBound = `0.${c.minor + 1}.0`;
      } else {
        upperBound = `0.0.${c.patch + 1}`;
      }
      return compareVersions(version, upperBound) < 0;
    }

    case 'tilde': {
      const constraintSemver = parseSemVer(constraint.version);
      if (!constraintSemver) return false;

      // ~1.2.3 -> >=1.2.3 <1.3.0
      if (semver.major !== constraintSemver.major) return false;
      if (semver.minor < constraintSemver.minor) return false;
      if (semver.minor > constraintSemver.minor) return false;
      if (semver.patch < constraintSemver.patch) return false;
      return true;
    }

    case 'greater':
      return compareVersions(version, constraint.version) > 0;

    case 'greater-equal':
      return compareVersions(version, constraint.version) >= 0;

    case 'less':
      return compareVersions(version, constraint.version) < 0;

    case 'less-equal':
      return compareVersions(version, constraint.version) <= 0;

    case 'any':
      return true;

    default:
      return false;
  }
}

// Parse version constraint string
export function parseConstraint(constraintStr: string): VersionConstraint {
  constraintStr = constraintStr.trim();

  if (constraintStr === '*' || constraintStr === 'latest' || constraintStr === 'any') {
    return { type: 'any' };
  }

  // Exact version
  if (/^\d+\.\d+\.\d+$/.test(constraintStr) || /^\d+\.\d+$/.test(constraintStr)) {
    return { type: 'exact', version: constraintStr };
  }

  // Caret constraint (^1.2.3)
  if (constraintStr.startsWith('^')) {
    return { type: 'caret', version: constraintStr.slice(1) };
  }

  // Tilde constraint (~1.2.3)
  if (constraintStr.startsWith('~')) {
    return { type: 'tilde', version: constraintStr.slice(1) };
  }

  // Greater than (>1.2.3)
  if (constraintStr.startsWith('>=')) {
    return { type: 'greater-equal', version: constraintStr.slice(2) };
  }
  if (constraintStr.startsWith('>')) {
    return { type: 'greater', version: constraintStr.slice(1) };
  }

  // Less than (<1.2.3)
  if (constraintStr.startsWith('<=')) {
    return { type: 'less-equal', version: constraintStr.slice(2) };
  }
  if (constraintStr.startsWith('<')) {
    return { type: 'less', version: constraintStr.slice(1) };
  }

  // Range (1.2.3 - 2.0.0)
  const rangeMatch = constraintStr.match(/^([\d.]+)\s*-\s*([\d.]+)$/);
  if (rangeMatch) {
    return { type: 'range', min: rangeMatch[1], max: rangeMatch[2] };
  }

  // Default to exact
  return { type: 'exact', version: constraintStr };
}

// Check for dependency conflicts
export function detectConflicts(
  dependencies: Dependency[]
): Array<{ package: string; conflicts: string[]; reason: string }> {
  const conflicts: Array<{ package: string; conflicts: string[]; reason: string }> = [];
  const packageMap = new Map<string, Dependency[]>();

  // Group dependencies by package name
  for (const dep of dependencies) {
    const key = `${dep.registry}:${dep.name}`;
    if (!packageMap.has(key)) {
      packageMap.set(key, []);
    }
    packageMap.get(key)!.push(dep);
  }

  // Check for conflicts within each package
  for (const [key, deps] of packageMap.entries()) {
    if (deps.length > 1) {
      // Multiple versions of the same package
      const versions = deps.map(d => d.version).filter((v): v is string => v !== undefined);
      const uniqueVersions = [...new Set(versions)];

      if (uniqueVersions.length > 1) {
        conflicts.push({
          package: key,
          conflicts: uniqueVersions,
          reason: `Multiple versions required: ${uniqueVersions.join(', ')}`,
        });
      }
    }
  }

  return conflicts;
}

// Get breaking changes between versions
export function getBreakingChanges(fromVersion: string, toVersion: string): string[] {
  const from = parseSemVer(fromVersion);
  const to = parseSemVer(toVersion);

  if (!from || !to) {
    return ['Unable to determine breaking changes for non-semver versions'];
  }

  const changes: string[] = [];

  // Major version change indicates potential breaking changes
  if (to.major > from.major) {
    changes.push(`Major version upgrade (${from.major}.${from.minor}.${from.patch} -> ${to.major}.${to.minor}.${to.patch}) may contain breaking changes`);
  }

  // Minor version change may contain breaking changes in some ecosystems
  if (to.minor > from.minor && to.major === from.major) {
    changes.push(`Minor version upgrade may contain new features or deprecations`);
  }

  return changes;
}

// Calculate upgrade risk
export function calculateUpgradeRisk(fromVersion: string, toVersion: string): 'low' | 'medium' | 'high' {
  const from = parseSemVer(fromVersion);
  const to = parseSemVer(toVersion);

  if (!from || !to) {
    return 'medium'; // Unknown risk for non-semver versions
  }

  // Major version upgrade = high risk
  if (to.major > from.major) {
    return 'high';
  }

  // Minor version upgrade = medium risk
  if (to.minor > from.minor) {
    return 'medium';
  }

  // Patch version upgrade = low risk
  return 'low';
}

// Generate upgrade path recommendation.
// When `availableVersions` is supplied (from a registry that can list them), a
// forward upgrade that crosses major versions is broken into steps that land on
// the highest available stable release at each intermediate major boundary, then
// on the requested target — the standard "step through the majors" strategy.
// Without it (or for a same-major bump) a single direct step is produced.
export function generateUpgradePath(
  packageName: string,
  registry: string,
  currentVersion: string,
  targetVersion: string,
  dependencies: Dependency[],
  availableVersions?: string[]
): UpgradePath {
  const steps: UpgradeStep[] = [];
  const from = parseSemVer(currentVersion);
  const to = parseSemVer(targetVersion);

  if (
    availableVersions &&
    availableVersions.length > 0 &&
    from &&
    to &&
    compareVersions(currentVersion, targetVersion) < 0
  ) {
    // Stable releases strictly above current and at/below target, ascending.
    const candidates = availableVersions
      .filter((v) => !v.includes('-'))
      .filter((v) => compareVersions(v, currentVersion) > 0 && compareVersions(v, targetVersion) <= 0)
      .sort((a, b) => compareVersions(a, b));

    const milestones: string[] = [];
    for (let major = from.major + 1; major < to.major; major++) {
      const inMajor = candidates.filter((v) => parseSemVer(v)?.major === major);
      if (inMajor.length > 0) {
        milestones.push(inMajor[inMajor.length - 1]); // highest stable in this major
      }
    }
    milestones.push(targetVersion); // always finish on the requested target

    let prev = currentVersion;
    for (const m of milestones) {
      if (m === prev) continue;
      steps.push({
        package: packageName,
        registry,
        fromVersion: prev,
        toVersion: m,
        breakingChanges: getBreakingChanges(prev, m),
      });
      prev = m;
    }
  }

  // Fallback / same-major: a single direct step.
  if (steps.length === 0) {
    steps.push({
      package: packageName,
      registry,
      fromVersion: currentVersion,
      toVersion: targetVersion,
      breakingChanges: getBreakingChanges(currentVersion, targetVersion),
      notes: dependencies.length > 0 ? `Must maintain compatibility with ${dependencies.length} dependencies` : undefined,
    });
  }

  const totalBreakingChanges = steps.reduce((sum, step) => sum + (step.breakingChanges?.length || 0), 0);

  return {
    package: packageName,
    registry,
    currentVersion,
    targetVersion,
    steps,
    estimatedRisk: calculateUpgradeRisk(currentVersion, targetVersion),
    totalBreakingChanges,
  };
}

// Check if package version is compatible with dependencies
export function checkCompatibility(
  packageName: string,
  registry: string,
  version: string,
  dependencies: Dependency[],
  compatibilityRules: CompatibilityRule[]
): { compatible: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check against compatibility rules
  for (const rule of compatibilityRules) {
    if (rule.package === packageName && rule.registry === registry) {
      if (rule.minVersion && compareVersions(version, rule.minVersion) < 0) {
        issues.push(`Version ${version} is below minimum required version ${rule.minVersion}`);
      }
      if (rule.maxVersion && compareVersions(version, rule.maxVersion) > 0) {
        issues.push(`Version ${version} exceeds maximum allowed version ${rule.maxVersion}`);
      }
      if (rule.incompatibleWith) {
        for (const incompatible of rule.incompatibleWith) {
          const dep = dependencies.find(
            d => d.name === incompatible.package && d.registry === incompatible.registry
          );
          if (dep && dep.version && incompatible.versions.includes(dep.version)) {
            issues.push(
              `Incompatible with ${incompatible.package}@${dep.version}`
            );
          }
        }
      }
    }
  }

  return {
    compatible: issues.length === 0,
    issues,
  };
}

// Find compatible version that satisfies all constraints
export function findCompatibleVersion(
  _packageName: string,
  _registry: string,
  availableVersions: string[],
  constraints: VersionConstraint[]
): string | null {
  // Exclude prereleases by default (matches npm/semver maxSatisfying): a normal
  // range like ^4.17.0 must not resolve to 5.0.0-beta.x just because the
  // prerelease sorts below the 5.0.0 upper bound.
  const stable = availableVersions.filter((v) => !v.includes('-'));
  // Sort versions in descending order (newest first)
  const sortedVersions = stable.sort((a, b) => compareVersions(b, a));

  for (const version of sortedVersions) {
    const satisfiesAll = constraints.every(constraint => satisfiesConstraint(version, constraint));
    if (satisfiesAll) {
      return version;
    }
  }

  return null;
}

// Get version distance (number of versions between two versions)
export function getVersionDistance(fromVersion: string, toVersion: string, availableVersions: string[]): number {
  const sortedVersions = [...availableVersions].sort((a, b) => compareVersions(a, b));
  const fromIndex = sortedVersions.findIndex(v => v === fromVersion);
  const toIndex = sortedVersions.findIndex(v => v === toVersion);

  if (fromIndex === -1 || toIndex === -1) {
    return -1;
  }

  return Math.abs(toIndex - fromIndex);
}

// Suggest safe upgrade target
export function suggestSafeUpgrade(
  _packageName: string,
  currentVersion: string,
  _dependencies: Dependency[],
  _maxRisk: 'low' | 'medium' | 'high' = 'medium'
): { version: string | null; risk: UpgradeRisk; compatible: boolean; reason: string } {
  // For now, return the current version as a safe suggestion
  // In a full implementation, we would check against dependencies and available versions
  const risk = calculateUpgradeRisk(currentVersion, currentVersion);

  return {
    version: currentVersion,
    risk,
    compatible: true,
    reason: `Current version ${currentVersion} is compatible with all dependencies`,
  };
}
