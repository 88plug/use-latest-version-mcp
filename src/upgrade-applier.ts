/**
 * Upgrade Applier
 * Applies suggested upgrades to dependency files
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'fs';
import { join, basename, relative } from 'path';
import { OptimizationPlan } from './global-version-optimizer.js';

// ============================================================================
// Types
// ============================================================================

export interface UpgradeChange {
  file: string;
  package: string;
  oldVersion: string;
  newVersion: string;
  oldConstraint?: string;
  newConstraint?: string;
  type: 'production' | 'development' | 'peer' | 'optional';
  registry: string;
}

export interface ApplyOptions {
  projectPath: string;
  dryRun?: boolean;
  createBackup?: boolean;
  backupDir?: string;
  maxRetries?: number;
  validateAfterApply?: boolean;
  rollbackOnError?: boolean;
  preserveFormatting?: boolean;
  updateLockFiles?: boolean;
}

export interface ApplyResult {
  projectPath: string;
  appliedAt: Date;
  dryRun: boolean;
  summary: {
    totalChanges: number;
    filesModified: number;
    packagesUpgraded: number;
    packagesDowngraded: number;
    packagesRemoved: number;
    packagesKept: number;
    errors: number;
    warnings: number;
  };
  changes: UpgradeChange[];
  backups: string[];
  errors: string[];
  warnings: string[];
  diffs: FileDiff[];
}

export interface FileDiff {
  file: string;
  changes: string[];
  preview: string;
}

// ============================================================================
// Upgrade Applier Class
// ============================================================================

export class UpgradeApplier {
  private options: ApplyOptions;
  private backups: string[] = [];
  // Maps each backup path to the absolute file it was taken from, so rollback
  // restores to the exact original location (not a basename-derived guess).
  private backupOrigins = new Map<string, string>();

  constructor(options: ApplyOptions) {
    this.options = {
      dryRun: false,
      createBackup: true,
      backupDir: '.dependency-backups',
      maxRetries: 3,
      validateAfterApply: true,
      rollbackOnError: true,
      preserveFormatting: true,
      updateLockFiles: true,
      ...options,
    };
  }

  /**
   * Apply upgrades based on optimization plan
   */
  async apply(plan: OptimizationPlan[]): Promise<ApplyResult> {
    const result: ApplyResult = {
      projectPath: this.options.projectPath,
      appliedAt: new Date(),
      dryRun: this.options.dryRun ?? false,
      summary: {
        totalChanges: 0,
        filesModified: 0,
        packagesUpgraded: 0,
        packagesDowngraded: 0,
        packagesRemoved: 0,
        packagesKept: 0,
        errors: 0,
        warnings: 0,
      },
      changes: [],
      backups: [],
      errors: [],
      warnings: [],
      diffs: [],
    };

    // Group changes by file
    const changesByFile = this.groupChangesByFile(plan);

    // Process each file
    for (const [filePath, fileChanges] of Object.entries(changesByFile)) {
      try {
        const fileResult = await this.applyFileChanges(filePath, fileChanges);
        result.changes.push(...fileResult.changes);
        result.diffs.push(fileResult.diff);
        result.summary.filesModified++;
        result.summary.totalChanges += fileResult.changes.length;
      } catch (error) {
        const errorMsg = `Failed to apply changes to ${filePath}: ${error}`;
        result.errors.push(errorMsg);
        result.summary.errors++;

        if (this.options.rollbackOnError && !this.options.dryRun) {
          await this.rollback();
        }
      }
    }

    // Update summary
    for (const change of result.changes) {
      if (change.newVersion === 'removed' || change.newVersion === '') {
        result.summary.packagesRemoved++;
      } else if (change.oldVersion && change.newVersion !== change.oldVersion) {
        // Check if it's a downgrade by looking at the plan
        const planItem = plan.find(p => p.package === change.package);
        if (planItem && planItem.action === 'downgrade') {
          result.summary.packagesDowngraded++;
        } else {
          result.summary.packagesUpgraded++;
        }
      }
    }

    // `keep` actions are intentionally excluded from `changes`; count them
    // directly from the plan so the summary reflects them.
    result.summary.packagesKept = plan.filter((p) => p.action === 'keep').length;

    result.backups = [...this.backups];

    return result;
  }

  /**
   * Group changes by file
   */
  private groupChangesByFile(plan: OptimizationPlan[]): Record<string, OptimizationPlan[]> {
    const grouped: Record<string, OptimizationPlan[]> = {};

    for (const item of plan) {
      if (item.action === 'keep') {
        continue;
      }

      for (const file of item.affectedFiles) {
        if (!grouped[file]) {
          grouped[file] = [];
        }
        grouped[file].push(item);
      }
    }

    return grouped;
  }

  /**
   * Apply changes to a single file
   */
  private async applyFileChanges(
    filePath: string,
    changes: OptimizationPlan[]
  ): Promise<{ changes: UpgradeChange[]; diff: FileDiff }> {
    const fullPath = join(this.options.projectPath, filePath);

    if (!existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Read original content
    const originalContent = readFileSync(fullPath, 'utf-8');

    // Create backup if needed
    if (this.options.createBackup && !this.options.dryRun) {
      await this.createBackup(fullPath);
    }

    // Apply changes based on file type
    const fileExt = this.getFileExtension(filePath);
    let newContent: string;

    switch (fileExt) {
      case 'json':
        newContent = this.applyJsonChanges(originalContent, changes);
        break;
      case 'txt':
        newContent = this.applyTxtChanges(originalContent, changes);
        break;
      case 'toml':
        newContent = this.applyTomlChanges(originalContent, changes);
        break;
      case 'mod':
        newContent = this.applyGoModChanges(originalContent, changes);
        break;
      case 'xml':
        newContent = this.applyXmlChanges(originalContent, changes);
        break;
      default:
        // Try to detect file type by content
        newContent = this.detectAndApplyChanges(originalContent, changes, filePath);
    }

    // Validate new content
    if (this.options.validateAfterApply) {
      this.validateFileContent(originalContent, newContent, filePath);
    }

    // Write new content
    if (!this.options.dryRun) {
      writeFileSync(fullPath, newContent, 'utf-8');
    }

    // Generate diff
    const diff = this.generateDiff(originalContent, newContent, filePath);

    // Convert to UpgradeChange format
    const upgradeChanges: UpgradeChange[] = changes.map((c) => ({
      file: filePath,
      package: c.package,
      oldVersion: c.currentVersion,
      newVersion: c.suggestedVersion,
      oldConstraint: c.currentConstraint,
      newConstraint: c.suggestedConstraint,
      type: 'production', // Default, could be enhanced
      registry: c.registry,
    }));

    return { changes: upgradeChanges, diff };
  }

  /**
   * Apply changes to JSON files (package.json)
   */
  private applyJsonChanges(content: string, changes: OptimizationPlan[]): string {
    const pkg = JSON.parse(content);
    const modified = new Set<string>();

    for (const change of changes) {
      const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

      for (const section of sections) {
        if (pkg[section] && pkg[section][change.package]) {
          const newVersion = change.suggestedConstraint || change.suggestedVersion;

          if (change.action === 'remove') {
            delete pkg[section][change.package];
          } else {
            pkg[section][change.package] = newVersion;
          }

          modified.add(`${section}.${change.package}`);
        }
      }
    }

    return JSON.stringify(pkg, null, 2) + '\n';
  }

  /**
   * Apply changes to text files (requirements.txt)
   */
  private applyTxtChanges(content: string, changes: OptimizationPlan[]): string {
    const lines = content.split('\n');
    const changeMap = new Map<string, OptimizationPlan>();

    for (const change of changes) {
      changeMap.set(change.package.toLowerCase(), change);
    }

    const newLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        newLines.push(line);
        continue;
      }

      // Parse package name
      const match = trimmed.match(/^([a-zA-Z0-9_-]+)/);
      if (!match) {
        newLines.push(line);
        continue;
      }

      const packageName = match[1].toLowerCase();
      const change = changeMap.get(packageName);

      if (change) {
        if (change.action === 'remove') {
          // Skip this line
          continue;
        }

        // Update version
        const newVersion = change.suggestedConstraint || change.suggestedVersion;
        newLines.push(`${change.package}${newVersion ? '==' + newVersion : ''}`);
        changeMap.delete(packageName);
      } else {
        newLines.push(line);
      }
    }

    // Add new packages
    for (const change of changeMap.values()) {
      if (change.action !== 'remove') {
        const newVersion = change.suggestedConstraint || change.suggestedVersion;
        newLines.push(`${change.package}${newVersion ? '==' + newVersion : ''}`);
      }
    }

    return newLines.join('\n') + '\n';
  }

  /**
   * Apply changes to TOML files (pyproject.toml, Cargo.toml)
   */
  private applyTomlChanges(content: string, changes: OptimizationPlan[]): string {
    const lines = content.split('\n');
    const changeMap = new Map<string, OptimizationPlan>();

    for (const change of changes) {
      changeMap.set(change.package.toLowerCase(), change);
    }

    const newLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Preserve section header lines unchanged
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        newLines.push(line);
        continue;
      }

      // Parse dependency line (key = "value" format)
      const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/);
      if (match) {
        const packageName = match[1].toLowerCase();
        const change = changeMap.get(packageName);

        if (change) {
          if (change.action === 'remove') {
            continue;
          }

          const newVersion = change.suggestedConstraint || change.suggestedVersion;
          newLines.push(`${match[1]} = "${newVersion}"`);
          changeMap.delete(packageName);
          continue;
        }
      }

      // Parse array-style dependencies (e.g., "django==3.2.0",)
      const arrayMatch = trimmed.match(/^"([a-zA-Z0-9_-]+)(?:==|>=|<=|~=|>|<|!=)([^"]+)"/);
      if (arrayMatch) {
        const packageName = arrayMatch[1].toLowerCase();
        const change = changeMap.get(packageName);

        if (change) {
          if (change.action === 'remove') {
            continue;
          }

          const newVersion = change.suggestedConstraint || change.suggestedVersion;
          newLines.push(`"${change.package}${newVersion ? '==' + newVersion : ''}",`);
          changeMap.delete(packageName);
          continue;
        }
      }

      newLines.push(line);
    }

    return newLines.join('\n') + '\n';
  }

  /**
   * Apply changes to go.mod files
   */
  private applyGoModChanges(content: string, changes: OptimizationPlan[]): string {
    const lines = content.split('\n');
    const changeMap = new Map<string, OptimizationPlan>();

    for (const change of changes) {
      changeMap.set(change.package.toLowerCase(), change);
    }

    const newLines: string[] = [];
    let inRequire = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === 'require (') {
        inRequire = true;
        newLines.push(line);
        continue;
      }

      if (inRequire && trimmed === ')') {
        inRequire = false;
        newLines.push(line);
        continue;
      }

      if (inRequire) {
        // Parse require line: "package version"
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          const packageName = parts[0].toLowerCase();
          const change = changeMap.get(packageName);

          if (change) {
            if (change.action === 'remove') {
              continue;
            }

            const newVersion = change.suggestedVersion;
            newLines.push(`\t${change.package} ${newVersion}`);
            changeMap.delete(packageName);
            continue;
          }
        }
      }

      newLines.push(line);
    }

    return newLines.join('\n') + '\n';
  }

  /**
   * Apply changes to XML files (pom.xml)
   */
  private applyXmlChanges(content: string, changes: OptimizationPlan[]): string {
    const changeMap = new Map<string, OptimizationPlan>();

    for (const change of changes) {
      changeMap.set(change.package.toLowerCase(), change);
    }

    let newContent = content;

    for (const change of changes) {
      if (change.action === 'remove') {
        // Remove dependency element
        const regex = new RegExp(
          `<dependency>[\\s\\S]*?<artifactId>${change.package}</artifactId>[\\s\\S]*?</dependency>`,
          'g'
        );
        newContent = newContent.replace(regex, '');
      } else {
        // Update version
        const newVersion = change.suggestedVersion;
        const regex = new RegExp(
          `(<dependency>[\\s\\S]*?<artifactId>${change.package}</artifactId>[\\s\\S]*?<version>)([^<]+)(</version>[\\s\\S]*?</dependency>)`,
          'g'
        );
        newContent = newContent.replace(regex, `$1${newVersion}$3`);
      }
    }

    return newContent;
  }

  /**
   * Detect file type and apply changes
   */
  private detectAndApplyChanges(
    content: string,
    changes: OptimizationPlan[],
    _filePath: string
  ): string {
    // Try JSON first
    if (content.trim().startsWith('{')) {
      try {
        JSON.parse(content);
        return this.applyJsonChanges(content, changes);
      } catch {
        // Not JSON
      }
    }

    // Try TOML
    if (content.includes('[') && content.includes(']')) {
      return this.applyTomlChanges(content, changes);
    }

    // Default to text
    return this.applyTxtChanges(content, changes);
  }

  /**
   * Validate changes don't break file structure
   */
  private validateFileContent(_original: string, modified: string, filePath: string): void {
    const fileExt = this.getFileExtension(filePath);

    switch (fileExt) {
      case 'json':
        try {
          JSON.parse(modified);
        } catch (error) {
          throw new Error(`Invalid JSON after applying changes: ${error}`);
        }
        break;

      case 'xml':
        if (!modified.includes('<?xml') && !modified.includes('<project')) {
          throw new Error('Invalid XML after applying changes');
        }
        break;

      default:
        // Basic validation
        if (modified.length === 0) {
          throw new Error('File is empty after applying changes');
        }
    }
  }

  /**
   * Generate diff between original and modified content
   */
  private generateDiff(original: string, modified: string, filePath: string): FileDiff {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');
    const changes: string[] = [];

    const maxLines = Math.max(originalLines.length, modifiedLines.length);

    for (let i = 0; i < maxLines; i++) {
      const origLine = originalLines[i] || '';
      const modLine = modifiedLines[i] || '';

      if (origLine !== modLine) {
        if (origLine) {
          changes.push(`- ${origLine}`);
        }
        if (modLine) {
          changes.push(`+ ${modLine}`);
        }
      }
    }

    // Generate preview (first 20 lines of diff)
    const preview = changes.slice(0, 20).join('\n');
    const previewText =
      changes.length > 20 ? `${preview}\n... (${changes.length - 20} more lines)` : preview;

    return {
      file: filePath,
      changes,
      preview: previewText,
    };
  }

  /**
   * Create backup of a file
   */
  private async createBackup(filePath: string): Promise<void> {
    const backupDir = join(this.options.projectPath, this.options.backupDir!);

    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    // Encode the project-relative path (sanitized) so files that share a
    // basename across directories don't collide in the backup folder.
    const rel = relative(this.options.projectPath, filePath) || basename(filePath);
    const safeName = rel.replace(/[\\/]/g, '__');
    const backupPath = join(backupDir, `${safeName}.${timestamp}.backup`);

    copyFileSync(filePath, backupPath);
    this.backups.push(backupPath);
    this.backupOrigins.set(backupPath, filePath);
  }

  /**
   * Rollback all changes
   */
  private async rollback(): Promise<void> {
    for (const backupPath of this.backups) {
      try {
        const originalPath = this.backupOrigins.get(backupPath);
        if (originalPath && existsSync(backupPath)) {
          copyFileSync(backupPath, originalPath);
          unlinkSync(backupPath);
        }
      } catch (error) {
        console.error(`Failed to rollback ${backupPath}:`, error);
      }
    }

    this.backups = [];
    this.backupOrigins.clear();
  }

  /**
   * Get file extension
   */
  private getFileExtension(filePath: string): string {
    const parts = filePath.split('.');
    return parts.length > 1 ? parts[parts.length - 1] : '';
  }

  /**
   * Apply a single upgrade
   */
  async applyUpgrade(
    file: string,
    packageName: string,
    newVersion: string,
    options?: { constraint?: string; type?: 'production' | 'development' | 'peer' | 'optional' }
  ): Promise<ApplyResult> {
    const plan: OptimizationPlan[] = [
      {
        package: packageName,
        registry: 'npm', // Default, could be detected
        currentVersion: '',
        suggestedVersion: newVersion,
        suggestedConstraint: options?.constraint,
        action: 'upgrade',
        reason: 'Manual upgrade',
        risk: 'medium',
        affectedFiles: [file],
      },
    ];

    return this.apply(plan);
  }

  /**
   * Validate changes before applying
   */
  async validateChanges(file: string, changes: UpgradeChange[]): Promise<boolean> {
    const fullPath = join(this.options.projectPath, file);

    if (!existsSync(fullPath)) {
      throw new Error(`File not found: ${file}`);
    }

    const originalContent = readFileSync(fullPath, 'utf-8');

    // Create a temporary plan
    const plan: OptimizationPlan[] = changes.map((c) => ({
      package: c.package,
      registry: c.registry,
      currentVersion: c.oldVersion,
      suggestedVersion: c.newVersion,
      suggestedConstraint: c.newConstraint,
      action: c.newVersion === 'removed' ? 'remove' : 'upgrade',
      reason: 'Validation',
      risk: 'medium',
      affectedFiles: [file],
    }));

    try {
      const fileExt = this.getFileExtension(file);
      let newContent: string;

      switch (fileExt) {
        case 'json':
          newContent = this.applyJsonChanges(originalContent, plan);
          break;
        case 'txt':
          newContent = this.applyTxtChanges(originalContent, plan);
          break;
        case 'toml':
          newContent = this.applyTomlChanges(originalContent, plan);
          break;
        case 'mod':
          newContent = this.applyGoModChanges(originalContent, plan);
          break;
        case 'xml':
          newContent = this.applyXmlChanges(originalContent, plan);
          break;
        default:
          newContent = this.detectAndApplyChanges(originalContent, plan, file);
      }

      this.validateFileContent(originalContent, newContent, file);
      return true;
    } catch (error) {
      return false;
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Apply upgrades to a project
 */
export async function applyUpgrades(
  projectPath: string,
  plan: OptimizationPlan[],
  options?: Partial<ApplyOptions>
): Promise<ApplyResult> {
  const applier = new UpgradeApplier({ projectPath, ...options });
  return applier.apply(plan);
}

/**
 * Apply a single upgrade
 */
export async function applySingleUpgrade(
  projectPath: string,
  file: string,
  packageName: string,
  newVersion: string,
  options?: Partial<ApplyOptions>
): Promise<ApplyResult> {
  const applier = new UpgradeApplier({ projectPath, ...options });
  // Return the real result of the apply (accurate summary, diffs, errors,
  // backups) instead of a fabricated success.
  return applier.applyUpgrade(file, packageName, newVersion);
}

/**
 * Preview changes without applying
 */
export async function previewUpgrades(
  projectPath: string,
  plan: OptimizationPlan[]
): Promise<ApplyResult> {
  return applyUpgrades(projectPath, plan, { dryRun: true });
}
