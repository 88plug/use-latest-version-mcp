/**
 * Lock File Parsers
 * Parses lock files to extract exact installed versions of dependencies
 */

import { readFileSync } from 'fs';
import { basename } from 'path';

// Parsed lock file dependency information
export interface LockDependency {
  name: string;
  version: string;
  registry: string;
  resolved?: string; // Full URL/path where package was resolved
  integrity?: string; // Hash/checksum for verification
  dependencies?: Record<string, string>; // Nested dependencies
  source: string; // File path where this dependency was found
}

// Lock file parser result
export interface LockParserResult {
  dependencies: LockDependency[];
  errors: string[];
  warnings: string[];
}

// Lock file parser interface
export interface LockFileParser {
  name: string;
  filePatterns: string[];
  registry: string;
  parse(content: string, filePath: string): LockParserResult;
}

// ============================================================================
// npm (package-lock.json)
// ============================================================================

export class NpmLockParser implements LockFileParser {
  name = 'npm';
  filePatterns = ['package-lock.json'];
  registry = 'npm';

  parse(content: string, filePath: string): LockParserResult {
    const result: LockParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const lockfile = JSON.parse(content);

      // lockfileVersion 2/3 carry BOTH `packages` (authoritative) and a legacy
      // `dependencies` mirror. Prefer `packages` and only fall back to
      // `dependencies` for v1 lockfiles, so packages are not counted twice.
      if (lockfile.packages) {
        for (const [path, pkg] of Object.entries(lockfile.packages)) {
          if (path === '') continue; // Skip root package

          const pkgData = pkg as any;
          const name = path.split('node_modules/').pop() || path;

          result.dependencies.push({
            name,
            version: pkgData.version,
            registry: this.registry,
            resolved: pkgData.resolved,
            integrity: pkgData.integrity,
            dependencies: pkgData.dependencies,
            source: filePath,
          });
        }
      } else if (lockfile.dependencies) {
        // npm v1 format (flat dependencies)
        for (const [name, dep] of Object.entries(lockfile.dependencies)) {
          const depData = dep as any;
          result.dependencies.push({
            name,
            version: depData.version,
            registry: this.registry,
            resolved: depData.resolved,
            integrity: depData.integrity,
            dependencies: depData.dependencies,
            source: filePath,
          });
        }
      }
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }
}

// ============================================================================
// Yarn (yarn.lock)
// ============================================================================

export class YarnLockParser implements LockFileParser {
  name = 'yarn';
  filePatterns = ['yarn.lock'];
  registry = 'npm';

  parse(content: string, filePath: string): LockParserResult {
    const result: LockParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const lines = content.split('\n');
      let currentBlock: string[] = [];
      let inBlock = false;

      for (const line of lines) {
        const trimmed = line.trim();

        // Start of a new block (package names)
        if (/^[a-zA-Z0-9@_\-/.]+@/.test(trimmed) || trimmed.startsWith('#')) {
          if (inBlock && currentBlock.length > 0) {
            this.parseYarnBlock(currentBlock, result, filePath);
          }
          currentBlock = [trimmed];
          inBlock = true;
        } else if (inBlock) {
          currentBlock.push(trimmed);
        }
      }

      // Parse last block
      if (inBlock && currentBlock.length > 0) {
        this.parseYarnBlock(currentBlock, result, filePath);
      }
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  private parseYarnBlock(block: string[], result: LockParserResult, filePath: string): void {
    let name: string | undefined;
    let version: string | undefined;
    let resolved: string | undefined;
    let integrity: string | undefined;

    for (const line of block) {
      if (line.startsWith('#')) continue;

      // Parse package name (first line)
      if (!name && line.includes('@')) {
        const match = line.match(/^([a-zA-Z0-9@_\-/.]+)@/);
        if (match) {
          name = match[1].replace(/^npm:/, '');
        }
      }

      // Parse version
      const versionMatch = line.match(/^version\s+"([^"]+)"/);
      if (versionMatch) {
        version = versionMatch[1];
      }

      // Parse resolved URL
      const resolvedMatch = line.match(/^resolved\s+"([^"]+)"/);
      if (resolvedMatch) {
        resolved = resolvedMatch[1];
      }

      // Parse integrity
      const integrityMatch = line.match(/^integrity\s+(.+)/);
      if (integrityMatch) {
        integrity = integrityMatch[1];
      }
    }

    if (name && version) {
      result.dependencies.push({
        name,
        version,
        registry: this.registry,
        resolved,
        integrity,
        source: filePath,
      });
    }
  }
}

// ============================================================================
// pnpm (pnpm-lock.yaml)
// ============================================================================

export class PnpmLockParser implements LockFileParser {
  name = 'pnpm';
  filePatterns = ['pnpm-lock.yaml'];
  registry = 'npm';

  parse(content: string, filePath: string): LockParserResult {
    const result: LockParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const lines = content.split('\n');
      let inPackages = false;

      for (const line of lines) {
        const trimmed = line.trim();

        // Check for packages section
        if (trimmed === 'packages:') {
          inPackages = true;
          continue;
        }
        // Exit packages section when we hit a non-indented line (not starting with space)
        if (inPackages && trimmed && !line.startsWith(' ')) {
          inPackages = false;
          continue;
        }

        // Parse package-key entries. pnpm keys vary by lockfile version:
        //   v6:  /name@version:           e.g. /@babel/core@7.21.0:
        //   v9:  name@version:            (no leading slash, scoped keys quoted)
        // and may carry a peer-deps suffix in parens: /react-dom@18.2.0(react@18.2.0):
        // Package keys are indented and end with ':'; sub-fields (resolution,
        // engines, ...) do not contain an '@' after a non-zero index.
        if (inPackages && line.startsWith('  ') && trimmed.endsWith(':')) {
          let key = trimmed.slice(0, -1).trim();
          // Strip surrounding quotes (v9 quotes scoped keys).
          if (
            (key.startsWith("'") && key.endsWith("'")) ||
            (key.startsWith('"') && key.endsWith('"'))
          ) {
            key = key.slice(1, -1);
          }
          // Drop the leading slash present in v5/v6 keys.
          if (key.startsWith('/')) key = key.slice(1);
          // Drop any peer-deps suffix in parentheses.
          const paren = key.indexOf('(');
          if (paren !== -1) key = key.slice(0, paren);
          // Split name@version on the LAST '@' so scoped names keep their '@'.
          const at = key.lastIndexOf('@');
          if (at > 0) {
            const name = key.slice(0, at);
            const version = key.slice(at + 1);
            if (name && version) {
              result.dependencies.push({
                name,
                version,
                registry: this.registry,
                source: filePath,
              });
            }
          }
        }
      }
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }
}

// ============================================================================
// Python (Pipfile.lock)
// ============================================================================

export class PipfileLockParser implements LockFileParser {
  name = 'pypi';
  filePatterns = ['Pipfile.lock'];
  registry = 'pypi';

  parse(content: string, filePath: string): LockParserResult {
    const result: LockParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const lockfile = JSON.parse(content);

      // Parse default dependencies
      if (lockfile.default) {
        for (const [name, dep] of Object.entries(lockfile.default)) {
          const depData = dep as any;
          const version = this.extractVersion(depData.version || depData.git_version);
          if (version) {
            result.dependencies.push({
              name,
              version,
              registry: this.registry,
              resolved: depData.git,
              source: filePath,
            });
          }
        }
      }

      // Parse development dependencies
      if (lockfile.develop) {
        for (const [name, dep] of Object.entries(lockfile.develop)) {
          const depData = dep as any;
          const version = this.extractVersion(depData.version || depData.git_version);
          if (version) {
            result.dependencies.push({
              name,
              version,
              registry: this.registry,
              resolved: depData.git,
              source: filePath,
            });
          }
        }
      }
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  private extractVersion(version?: string): string | undefined {
    if (!version) return undefined;
    // Remove '==' prefix if present
    return version.replace(/^==/, '');
  }
}

// ============================================================================
// Python (poetry.lock)
// ============================================================================

export class PoetryLockParser implements LockFileParser {
  name = 'pypi';
  filePatterns = ['poetry.lock'];
  registry = 'pypi';

  parse(content: string, filePath: string): LockParserResult {
    const result: LockParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const lines = content.split('\n');
      let inPackage = false;
      let currentPackage: Record<string, string> = {};

      for (const line of lines) {
        const trimmed = line.trim();

        // Start of package section
        if (trimmed === '[[package]]') {
          if (inPackage && currentPackage.name && currentPackage.version) {
            result.dependencies.push({
              name: currentPackage.name,
              version: currentPackage.version,
              registry: this.registry,
              source: filePath,
            });
          }
          currentPackage = {};
          inPackage = true;
          continue;
        }

        // Parse package fields
        if (inPackage) {
          const nameMatch = trimmed.match(/^name\s*=\s*"([^"]+)"/);
          if (nameMatch) {
            currentPackage.name = nameMatch[1];
          }

          const versionMatch = trimmed.match(/^version\s*=\s*"([^"]+)"/);
          if (versionMatch) {
            currentPackage.version = versionMatch[1];
          }
        }
      }

      // Parse last package
      if (inPackage && currentPackage.name && currentPackage.version) {
        result.dependencies.push({
          name: currentPackage.name,
          version: currentPackage.version,
          registry: this.registry,
          source: filePath,
        });
      }
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }
}

// ============================================================================
// Go (go.sum)
// ============================================================================

export class GoSumParser implements LockFileParser {
  name = 'go';
  filePatterns = ['go.sum'];
  registry = 'go';

  parse(content: string, filePath: string): LockParserResult {
    const result: LockParserResult = { dependencies: [], errors: [], warnings: [] };
    const seen = new Map<string, boolean>();

    try {
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;

        // go.sum format: module_path version hash
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          const name = parts[0];
          // Remove 'v' prefix and '/go.mod' suffix
          let version = parts[1].replace(/^v/, '').replace(/\/go\.mod$/, '');

          // Deduplicate (go.sum has multiple entries per package)
          const key = `${name}@${version}`;
          if (!seen.has(key)) {
            seen.set(key, true);
            result.dependencies.push({
              name,
              version,
              registry: this.registry,
              source: filePath,
            });
          }
        }
      }
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }
}

// ============================================================================
// Rust (Cargo.lock)
// ============================================================================

export class CargoLockParser implements LockFileParser {
  name = 'crates';
  filePatterns = ['Cargo.lock'];
  registry = 'crates';

  parse(content: string, filePath: string): LockParserResult {
    const result: LockParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const lines = content.split('\n');
      let inPackage = false;
      let currentPackage: Record<string, string> = {};

      for (const line of lines) {
        const trimmed = line.trim();

        // Start of package section
        if (trimmed === '[[package]]') {
          if (inPackage && currentPackage.name && currentPackage.version) {
            result.dependencies.push({
              name: currentPackage.name,
              version: currentPackage.version,
              registry: this.registry,
              integrity: currentPackage.integrity,
              source: filePath,
            });
          }
          currentPackage = {};
          inPackage = true;
          continue;
        }

        // Parse package fields
        if (inPackage) {
          const nameMatch = trimmed.match(/^name\s*=\s*"([^"]+)"/);
          if (nameMatch) {
            currentPackage.name = nameMatch[1];
          }

          const versionMatch = trimmed.match(/^version\s*=\s*"([^"]+)"/);
          if (versionMatch) {
            currentPackage.version = versionMatch[1];
          }

          const checksumMatch = trimmed.match(/^checksum\s*=\s*"([^"]+)"/);
          if (checksumMatch) {
            currentPackage.integrity = checksumMatch[1];
          }
        }
      }

      // Parse last package
      if (inPackage && currentPackage.name && currentPackage.version) {
        result.dependencies.push({
          name: currentPackage.name,
          version: currentPackage.version,
          registry: this.registry,
          integrity: currentPackage.integrity,
          source: filePath,
        });
      }
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }
}

// ============================================================================
// Ruby (Gemfile.lock)
// ============================================================================

export class GemfileLockParser implements LockFileParser {
  name = 'rubygems';
  filePatterns = ['Gemfile.lock'];
  registry = 'rubygems';

  parse(content: string, filePath: string): LockParserResult {
    const result: LockParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const lines = content.split('\n');
      let inSpecs = false;

      for (const line of lines) {
        const trimmed = line.trim();

        // Check for specs section
        if (trimmed === 'specs:') {
          inSpecs = true;
          continue;
        }
        // Exit specs section when we hit a non-indented line (not starting with space)
        if (inSpecs && trimmed && !line.startsWith(' ')) {
          inSpecs = false;
          continue;
        }

        // Parse spec entries (only top-level specs with exactly 4 spaces)
        if (inSpecs && line.startsWith('    ') && !line.startsWith('      ')) {
          const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s+\(([^)]+)\)/);
          if (match) {
            const name = match[1];
            const version = match[2];
            result.dependencies.push({
              name,
              version,
              registry: this.registry,
              source: filePath,
            });
          }
        }
      }
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }
}

// ============================================================================
// Parser Registry
// ============================================================================

// ============================================================================
// PHP (composer.lock)
// ============================================================================

export class ComposerLockParser implements LockFileParser {
  name = 'packagist';
  filePatterns = ['composer.lock'];
  registry = 'packagist';

  parse(content: string, filePath: string): LockParserResult {
    const result: LockParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const lock = JSON.parse(content);
      for (const section of ['packages', 'packages-dev']) {
        const arr = lock[section];
        if (!Array.isArray(arr)) continue;
        for (const pkg of arr) {
          if (!pkg || !pkg.name || !pkg.version) continue;
          result.dependencies.push({
            name: pkg.name,
            version: String(pkg.version).replace(/^v/, ''),
            registry: this.registry,
            source: filePath,
          });
        }
      }
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }
}

// ============================================================================
// Dart / Flutter (pubspec.lock)
// ============================================================================

export class PubspecLockParser implements LockFileParser {
  name = 'pub.dev';
  filePatterns = ['pubspec.lock'];
  registry = 'pub.dev';

  parse(content: string, filePath: string): LockParserResult {
    const result: LockParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const lines = content.split('\n');
      let inPackages = false;
      let current: string | null = null;
      let version = '';
      let source = '';

      // Only `source: hosted` packages come from pub.dev with a resolvable
      // registry version; git/path deps are skipped.
      const flush = () => {
        if (current && version && source === 'hosted') {
          result.dependencies.push({
            name: current,
            version,
            registry: this.registry,
            source: filePath,
          });
        }
        current = null;
        version = '';
        source = '';
      };

      for (const raw of lines) {
        const line = raw.replace(/#.*$/, '');
        if (/^packages:\s*$/.test(line)) { inPackages = true; continue; }
        if (inPackages && /^\S/.test(line)) { flush(); inPackages = false; continue; }
        if (!inPackages) continue;

        const pkg = line.match(/^  ([A-Za-z0-9_.]+):\s*$/);
        if (pkg) { flush(); current = pkg[1]; continue; }
        const ver = line.match(/^    version:\s*["']?([^"'\s]+)["']?\s*$/);
        if (ver) { version = ver[1]; continue; }
        const src = line.match(/^    source:\s*(\S+)\s*$/);
        if (src) source = src[1];
      }
      flush();
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }
}

// ============================================================================
// Swift Package Manager (Package.resolved)
// ============================================================================

export class SwiftPackageResolvedParser implements LockFileParser {
  name = 'swift';
  filePatterns = ['Package.resolved'];
  registry = 'swift';

  parse(content: string, filePath: string): LockParserResult {
    const result: LockParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const data = JSON.parse(content);
      const pins = data.pins || data.object?.pins || [];
      for (const pin of pins) {
        const version = pin?.state?.version;
        if (!version) continue; // branch/revision pins have no semver
        const loc = pin.location || pin.repositoryURL || '';
        // Swift packages are identified to the registry as owner/repo (GitHub).
        const gh = String(loc).match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
        const name = gh ? gh[1] : pin.identity;
        if (!name) continue;
        result.dependencies.push({
          name,
          version: String(version),
          registry: this.registry,
          resolved: loc || undefined,
          source: filePath,
        });
      }
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }
}

// ============================================================================
// CocoaPods (Podfile.lock)
// ============================================================================

export class PodfileLockParser implements LockFileParser {
  name = 'cocoapods';
  filePatterns = ['Podfile.lock'];
  registry = 'cocoapods';

  parse(content: string, filePath: string): LockParserResult {
    const result: LockParserResult = { dependencies: [], errors: [], warnings: [] };
    const seen = new Set<string>();

    try {
      const lines = content.split('\n');
      let inPods = false;
      for (const raw of lines) {
        if (/^PODS:\s*$/.test(raw)) { inPods = true; continue; }
        if (inPods && /^\S/.test(raw)) { inPods = false; } // left the PODS: block
        if (!inPods) continue;

        // Top-level pod entries are at 2-space indent: `  - Name (version)[:]`.
        // Nested per-pod dependencies are deeper-indented and skipped.
        const m = raw.match(/^  -\s+([A-Za-z0-9_.+\-]+(?:\/[A-Za-z0-9_.+\-]+)*)\s+\(([^)]+)\)/);
        if (!m) continue;
        const root = m[1].split('/')[0]; // collapse subspecs (Pod/Subspec) to the root pod
        if (seen.has(root)) continue;
        seen.add(root);
        result.dependencies.push({
          name: root,
          version: m[2].trim(),
          registry: this.registry,
          source: filePath,
        });
      }
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }
}

export const LOCK_PARSERS: LockFileParser[] = [
  new NpmLockParser(),
  new YarnLockParser(),
  new PnpmLockParser(),
  new PipfileLockParser(),
  new PoetryLockParser(),
  new GoSumParser(),
  new CargoLockParser(),
  new GemfileLockParser(),
  new ComposerLockParser(),
  new PubspecLockParser(),
  new SwiftPackageResolvedParser(),
  new PodfileLockParser(),
];

/**
 * Get lock file parser for a file based on its name
 */
export function getLockParserForFile(fileName: string): LockFileParser | null {
  for (const parser of LOCK_PARSERS) {
    for (const pattern of parser.filePatterns) {
      if (fileName === pattern) {
        return parser;
      }
    }
  }
  return null;
}

/**
 * Parse a lock file
 */
export function parseLockFile(filePath: string): LockParserResult {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const fileName = basename(filePath);
    const parser = getLockParserForFile(fileName);

    if (!parser) {
      return {
        dependencies: [],
        errors: [`No lock file parser found for: ${fileName}`],
        warnings: [],
      };
    }

    return parser.parse(content, filePath);
  } catch (error) {
    return {
      dependencies: [],
      errors: [`Failed to read lock file ${filePath}: ${error instanceof Error ? error.message : String(error)}`],
      warnings: [],
    };
  }
}
