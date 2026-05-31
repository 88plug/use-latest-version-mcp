/**
 * Project Scanner
 * Scans project directories to find and parse all dependency and lock files
 */

import { readdirSync, statSync, existsSync } from 'fs';
import { join, relative, resolve, basename } from 'path';
import { parseDependencyFile, getParserForFile } from './dependency-parsers.js';
import { parseLockFile, getLockParserForFile } from './lock-file-parsers.js';

// ============================================================================
// Types
// ============================================================================

export interface ScannedFile {
  path: string;
  relativePath: string;
  type: 'dependency' | 'lock';
  parser: string;
  registry: string;
  size: number;
  modified: Date;
}

export interface ScannedDependency {
  name: string;
  version?: string;
  constraint?: string;
  registry: string;
  source: string;
  sourceType: 'dependency' | 'lock';
  type?: 'production' | 'development' | 'peer' | 'optional';
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
}

export interface ScanResult {
  projectPath: string;
  scannedAt: Date;
  files: ScannedFile[];
  dependencies: ScannedDependency[];
  errors: string[];
  warnings: string[];
  summary: {
    totalFiles: number;
    dependencyFiles: number;
    lockFiles: number;
    totalDependencies: number;
    uniqueDependencies: number;
    registries: string[];
  };
}

export interface ScanOptions {
  maxDepth?: number;
  excludePatterns?: string[];
  includeLockFiles?: boolean;
  followSymlinks?: boolean;
  /** Parse the contents of found files. Set false to only locate files. Default true. */
  parse?: boolean;
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  maxDepth: 10,
  excludePatterns: [
    'node_modules',
    '.git',
    'dist',
    'build',
    'target',
    'vendor',
    '__pycache__',
    '.venv',
    'venv',
    'env',
    '.next',
    '.nuxt',
    'coverage',
    '.cache',
  ],
  includeLockFiles: true,
  followSymlinks: false,
};

// ============================================================================
// File Patterns
// ============================================================================

const DEPENDENCY_FILE_PATTERNS = [
  'package.json',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'pom.xml',
  'pyproject.toml',
  '*.csproj',
];

const LOCK_FILE_PATTERNS = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Pipfile.lock',
  'poetry.lock',
  'go.sum',
  'Cargo.lock',
  'Gemfile.lock',
];

// ============================================================================
// Scanner Class
// ============================================================================

export class ProjectScanner {
  private options: ScanOptions;

  constructor(options: ScanOptions = {}) {
    // Drop keys explicitly set to `undefined` so a caller that forwards an
    // optional it didn't set (e.g. OutdatedChecker passing
    // `includeLockFiles: this.options.includeLockFiles` when it's undefined, or
    // the scan_project tool passing `maxDepth: undefined`) does not clobber the
    // DEFAULT_SCAN_OPTIONS value.
    const provided = Object.fromEntries(
      Object.entries(options).filter(([, v]) => v !== undefined)
    ) as ScanOptions;
    this.options = {
      ...DEFAULT_SCAN_OPTIONS,
      ...provided,
      // Merge exclude patterns instead of replacing
      excludePatterns: provided.excludePatterns
        ? [...DEFAULT_SCAN_OPTIONS.excludePatterns!, ...provided.excludePatterns]
        : DEFAULT_SCAN_OPTIONS.excludePatterns,
    };
  }

  /**
   * Scan a project directory for dependency and lock files
   */
  scan(projectPath: string): ScanResult {
    const result: ScanResult = {
      projectPath: resolve(projectPath),
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
    };

    // Validate project path
    if (!existsSync(projectPath)) {
      result.errors.push(`Project path does not exist: ${projectPath}`);
      return result;
    }

    const stats = statSync(projectPath);
    if (!stats.isDirectory()) {
      result.errors.push(`Project path is not a directory: ${projectPath}`);
      return result;
    }

    // Scan directory recursively
    this.scanDirectory(projectPath, projectPath, 0, result);

    // Parse all found files (skippable when only the file list is needed)
    if (this.options.parse !== false) {
      this.parseFiles(result);
    }

    // Calculate summary
    this.calculateSummary(result);

    return result;
  }

  /**
   * Recursively scan a directory
   */
  private scanDirectory(
    dirPath: string,
    projectRoot: string,
    currentDepth: number,
    result: ScanResult
  ): void {
    // Check max depth (allow scanning at maxDepth, but don't go deeper)
    if (this.options.maxDepth !== undefined && currentDepth > this.options.maxDepth) {
      return;
    }

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        const relativePath = relative(projectRoot, fullPath);

        // Skip excluded patterns
        if (this.shouldExclude(relativePath)) {
          continue;
        }

        // Handle symlinks
        if (entry.isSymbolicLink()) {
          if (!this.options.followSymlinks) {
            continue;
          }
          try {
            const targetStats = statSync(fullPath);
            if (targetStats.isDirectory()) {
              this.scanDirectory(fullPath, projectRoot, currentDepth + 1, result);
            } else if (targetStats.isFile()) {
              this.processFile(fullPath, relativePath, result);
            }
          } catch (error) {
            result.warnings.push(`Failed to follow symlink: ${relativePath}`);
          }
          continue;
        }

        // Handle directories
        if (entry.isDirectory()) {
          this.scanDirectory(fullPath, projectRoot, currentDepth + 1, result);
          continue;
        }

        // Handle files
        if (entry.isFile()) {
          this.processFile(fullPath, relativePath, result);
        }
      }
    } catch (error) {
      result.errors.push(`Failed to scan directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Process a single file
   */
  private processFile(filePath: string, relativePath: string, result: ScanResult): void {
    const fileName = basename(filePath);

    // Check if it's a dependency file
    const depParser = getParserForFile(fileName);
    if (depParser) {
      const stats = statSync(filePath);
      result.files.push({
        path: filePath,
        relativePath,
        type: 'dependency',
        parser: depParser.name,
        registry: depParser.registry,
        size: stats.size,
        modified: stats.mtime,
      });
      return;
    }

    // Check if it's a lock file
    if (this.options.includeLockFiles) {
      const lockParser = getLockParserForFile(fileName);
      if (lockParser) {
        const stats = statSync(filePath);
        result.files.push({
          path: filePath,
          relativePath,
          type: 'lock',
          parser: lockParser.name,
          registry: lockParser.registry,
          size: stats.size,
          modified: stats.mtime,
        });
      }
    }
  }

  /**
   * Parse all found files
   */
  private parseFiles(result: ScanResult): void {
    for (const file of result.files) {
      try {
        if (file.type === 'dependency') {
          const depResult = parseDependencyFile(file.path);
          result.dependencies.push(
            ...depResult.dependencies.map((dep) => ({
              ...dep,
              sourceType: 'dependency' as const,
            }))
          );
          result.errors.push(...depResult.errors);
          result.warnings.push(...depResult.warnings);
        } else if (file.type === 'lock') {
          const lockResult = parseLockFile(file.path);
          result.dependencies.push(
            ...lockResult.dependencies.map((dep) => ({
              ...dep,
              sourceType: 'lock' as const,
            }))
          );
          result.errors.push(...lockResult.errors);
          result.warnings.push(...lockResult.warnings);
        }
      } catch (error) {
        result.errors.push(`Failed to parse ${file.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(result: ScanResult): void {
    result.summary.totalFiles = result.files.length;
    result.summary.dependencyFiles = result.files.filter((f) => f.type === 'dependency').length;
    result.summary.lockFiles = result.files.filter((f) => f.type === 'lock').length;
    result.summary.totalDependencies = result.dependencies.length;

    // Count unique dependencies
    const uniqueDeps = new Map<string, boolean>();
    for (const dep of result.dependencies) {
      const key = `${dep.name}@${dep.registry}`;
      uniqueDeps.set(key, true);
    }
    result.summary.uniqueDependencies = uniqueDeps.size;

    // Get unique registries
    const registries = new Set<string>();
    for (const dep of result.dependencies) {
      registries.add(dep.registry);
    }
    result.summary.registries = Array.from(registries).sort();
  }

  /**
   * Check if a path should be excluded
   */
  private shouldExclude(relativePath: string): boolean {
    const parts = relativePath.split(/[/\\]/);
    for (const pattern of this.options.excludePatterns || []) {
      if (parts.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all supported dependency file patterns
   */
  static getDependencyFilePatterns(): string[] {
    return [...DEPENDENCY_FILE_PATTERNS];
  }

  /**
   * Get all supported lock file patterns
   */
  static getLockFilePatterns(): string[] {
    return [...LOCK_FILE_PATTERNS];
  }

  /**
   * Get all supported file patterns
   */
  static getAllFilePatterns(): string[] {
    return [...DEPENDENCY_FILE_PATTERNS, ...LOCK_FILE_PATTERNS];
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Scan a project directory with default options
 */
export function scanProject(projectPath: string, options?: ScanOptions): ScanResult {
  const scanner = new ProjectScanner(options);
  return scanner.scan(projectPath);
}

/**
 * Quick scan to find dependency files only (no parsing)
 */
export function findDependencyFiles(projectPath: string, options?: ScanOptions): string[] {
  const scanner = new ProjectScanner({ ...options, includeLockFiles: false, parse: false });
  const result = scanner.scan(projectPath);
  return result.files.map((f) => f.path);
}

/**
 * Quick scan to find lock files only (no parsing)
 */
export function findLockFiles(projectPath: string, options?: ScanOptions): string[] {
  const scanner = new ProjectScanner({ ...options, includeLockFiles: true, parse: false });
  const result = scanner.scan(projectPath);
  return result.files.filter((f) => f.type === 'lock').map((f) => f.path);
}
