/**
 * Dependency File Parsers
 * Parses various dependency file formats (package.json, requirements.txt, etc.)
 */

import { readFileSync } from 'fs';
import { basename } from 'path';

// Parsed dependency information
export interface ParsedDependency {
  name: string;
  version?: string;
  constraint?: string;
  registry: string;
  type: 'production' | 'development' | 'peer' | 'optional';
  source: string; // File path where this dependency was found
}

// Parser result
export interface ParserResult {
  dependencies: ParsedDependency[];
  errors: string[];
  warnings: string[];
}

// Parser interface
export interface DependencyParser {
  name: string;
  filePatterns: string[];
  registry: string;
  parse(content: string, filePath: string): ParserResult;
}

// ============================================================================
// npm / Node.js (package.json)
// ============================================================================

export class NpmParser implements DependencyParser {
  name = 'npm';
  filePatterns = ['package.json'];
  registry = 'npm';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const pkg = JSON.parse(content);

      // Parse dependencies (production)
      if (pkg.dependencies) {
        for (const [name, version] of Object.entries(pkg.dependencies)) {
          result.dependencies.push({
            name,
            version: this.extractVersion(version as string),
            constraint: version as string,
            registry: this.registry,
            type: 'production',
            source: filePath,
          });
        }
      }

      // Parse devDependencies
      if (pkg.devDependencies) {
        for (const [name, version] of Object.entries(pkg.devDependencies)) {
          result.dependencies.push({
            name,
            version: this.extractVersion(version as string),
            constraint: version as string,
            registry: this.registry,
            type: 'development',
            source: filePath,
          });
        }
      }

      // Parse peerDependencies
      if (pkg.peerDependencies) {
        for (const [name, version] of Object.entries(pkg.peerDependencies)) {
          result.dependencies.push({
            name,
            version: this.extractVersion(version as string),
            constraint: version as string,
            registry: this.registry,
            type: 'peer',
            source: filePath,
          });
        }
      }

      // Parse optionalDependencies
      if (pkg.optionalDependencies) {
        for (const [name, version] of Object.entries(pkg.optionalDependencies)) {
          result.dependencies.push({
            name,
            version: this.extractVersion(version as string),
            constraint: version as string,
            registry: this.registry,
            type: 'optional',
            source: filePath,
          });
        }
      }
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  private extractVersion(constraint: string): string | undefined {
    // Extract a single pinned version from a constraint, including prerelease
    // and build metadata. e.g. "^1.2.3" -> "1.2.3", "~1.2.3-beta.1" -> "1.2.3-beta.1".
    // Ranges like ">=1.2.3" have no single version and return undefined.
    const match = constraint.match(
      /^[\^~]?(\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/
    );
    return match ? match[1] : undefined;
  }
}

// ============================================================================
// Python (requirements.txt)
// ============================================================================

export class PythonParser implements DependencyParser {
  name = 'pypi';
  filePatterns = ['requirements.txt', 'requirements/*.txt'];
  registry = 'pypi';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };

    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Skip -r, --requirement, -e, --editable (includes)
      if (trimmed.startsWith('-r') || trimmed.startsWith('--requirement') ||
          trimmed.startsWith('-e') || trimmed.startsWith('--editable')) {
        continue;
      }

      try {
        const dep = this.parseRequirement(trimmed);
        if (dep) {
          result.dependencies.push({
            ...dep,
            registry: this.registry,
            type: 'production',
            source: filePath,
          });
        }
      } catch (error) {
        result.warnings.push(`Failed to parse requirement "${trimmed}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return result;
  }

  private parseRequirement(line: string): { name: string; version?: string; constraint?: string } | null {
    // Parse requirement specifiers
    // Examples: requests==2.28.0, django>=3.2,<4.0, flask~=2.0
    const patterns = [
      // name==version
      /^([a-zA-Z0-9_-]+)==([\d.]+)$/,
      // name>=version
      /^([a-zA-Z0-9_-]+)>=([\d.]+)$/,
      // name<=version
      /^([a-zA-Z0-9_-]+)<=([\d.]+)$/,
      // name>version
      /^([a-zA-Z0-9_-]+)>([\d.]+)$/,
      // name<version
      /^([a-zA-Z0-9_-]+)<([\d.]+)$/,
      // name~=version
      /^([a-zA-Z0-9_-]+)~=([\d.]+)$/,
      // name (no version)
      /^([a-zA-Z0-9_-]+)$/,
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        // Extract just the constraint part (operator + version)
        const constraint = match[2] ? line.substring(match[1].length) : undefined;
        return {
          name: match[1],
          version: match[2],
          constraint,
        };
      }
    }

    // Try to parse complex constraints (e.g., django>=3.2,<4.0)
    const complexMatch = line.match(/^([a-zA-Z0-9_-]+)(.*)$/);
    if (complexMatch) {
      return {
        name: complexMatch[1],
        constraint: complexMatch[2].trim() || undefined,
      };
    }

    return null;
  }
}

// ============================================================================
// Python (pyproject.toml)
// ============================================================================

export class PyProjectParser implements DependencyParser {
  name = 'pypi';
  filePatterns = ['pyproject.toml'];
  registry = 'pypi';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      // Line-based parser (not a full TOML spec) covering the two dominant
      // pyproject layouts:
      //   PEP 621: [project] dependencies = [...] and [project.optional-dependencies]
      //   Poetry:  [tool.poetry.dependencies] / .dev-dependencies / .group.<n>.dependencies
      const lines = content.split('\n');
      let mode: 'none' | 'project' | 'pep621-optional' | 'poetry-prod' | 'poetry-dev' = 'none';
      let inArray = false;
      let arrayType: ParsedDependency['type'] = 'production';

      const pushSpec = (spec: string, type: ParsedDependency['type']) => {
        const dep = this.parsePep508(spec);
        if (dep) {
          result.dependencies.push({ ...dep, registry: this.registry, type, source: filePath });
        }
      };

      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Collecting items of a multi-line PEP 621 array.
        if (inArray) {
          if (trimmed.startsWith(']')) {
            inArray = false;
            continue;
          }
          const item = trimmed.match(/^["']([^"']+)["']\s*,?\s*$/);
          if (item) pushSpec(item[1], arrayType);
          continue;
        }

        // Section header.
        const section = trimmed.match(/^\[([^\]]+)\]$/);
        if (section) {
          const name = section[1].trim();
          if (name === 'project') mode = 'project';
          else if (name === 'project.optional-dependencies') mode = 'pep621-optional';
          else if (name === 'tool.poetry.dependencies') mode = 'poetry-prod';
          else if (
            name === 'tool.poetry.dev-dependencies' ||
            /^tool\.poetry\.group\..+\.dependencies$/.test(name)
          ) {
            mode = 'poetry-dev';
          } else {
            mode = 'none';
          }
          continue;
        }

        // PEP 621 main dependency array.
        if (mode === 'project' && /^dependencies\s*=\s*\[/.test(trimmed)) {
          arrayType = 'production';
          const rest = trimmed.slice(trimmed.indexOf('[') + 1);
          if (rest.includes(']')) {
            this.parseInlineArray(rest, (item) => pushSpec(item, 'production'));
          } else {
            inArray = true;
          }
          continue;
        }

        // PEP 621 optional-dependencies: each key is a group whose value is an array.
        if (mode === 'pep621-optional') {
          const m = trimmed.match(/^[A-Za-z0-9._-]+\s*=\s*\[(.*)$/);
          if (m) {
            arrayType = 'optional';
            if (m[1].includes(']')) {
              this.parseInlineArray(m[1], (item) => pushSpec(item, 'optional'));
            } else {
              inArray = true;
            }
          }
          continue;
        }

        // Poetry sections: name = "spec" | name = { version = "spec", ... }
        if (mode === 'poetry-prod' || mode === 'poetry-dev') {
          const dep = this.parsePoetryDependency(trimmed);
          // `python` here is the interpreter constraint, not a package.
          if (dep && dep.name.toLowerCase() !== 'python') {
            result.dependencies.push({
              ...dep,
              registry: this.registry,
              type: mode === 'poetry-dev' ? 'development' : 'production',
              source: filePath,
            });
          }
          continue;
        }
      }
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  // Parse a comma-separated inline array body (text after the leading `[`).
  private parseInlineArray(body: string, cb: (item: string) => void): void {
    const end = body.indexOf(']');
    const inner = end >= 0 ? body.slice(0, end) : body;
    for (const part of inner.split(',')) {
      const m = part.trim().match(/^["']([^"']+)["']$/);
      if (m) cb(m[1]);
    }
  }

  // Parse a PEP 508 requirement string: name[extras] <versionspec> ; <markers>
  private parsePep508(spec: string): { name: string; version?: string; constraint?: string } | null {
    const noMarker = spec.split(';')[0].trim();
    if (!noMarker) return null;
    const m = noMarker.match(/^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(.*)$/);
    if (!m) return null;
    const constraint = m[2].trim() || undefined;
    return {
      name: m[1],
      version: constraint ? this.extractPyVersion(constraint) : undefined,
      constraint,
    };
  }

  private parsePoetryDependency(line: string): { name: string; version?: string; constraint?: string } | null {
    const match = line.match(/^([A-Za-z0-9._-]+)\s*=\s*(.+)$/);
    if (!match) return null;
    const name = match[1];
    const value = match[2].trim();
    // Inline-table form: { version = "^1.0", optional = true }
    if (value.startsWith('{')) {
      const v = value.match(/version\s*=\s*["']([^"']+)["']/);
      const constraint = v ? v[1] : undefined;
      return { name, version: constraint ? this.extractPyVersion(constraint) : undefined, constraint };
    }
    const constraint = value.replace(/['"]/g, '').trim();
    return { name, version: this.extractPyVersion(constraint), constraint };
  }

  // Python pins use ==; Poetry also uses ^/~/bare. Ranges (>=, <, ~=) have no
  // single version and yield undefined.
  private extractPyVersion(constraint: string): string | undefined {
    const exact = constraint.match(/^==\s*([0-9][0-9A-Za-z.\-+]*)$/);
    if (exact) return exact[1];
    return this.extractVersion(constraint);
  }

  private extractVersion(constraint: string): string | undefined {
    const match = constraint.match(
      /^[\^~]?(\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/
    );
    return match ? match[1] : undefined;
  }
}

// ============================================================================
// Go (go.mod)
// ============================================================================

export class GoModParser implements DependencyParser {
  name = 'go';
  filePatterns = ['go.mod'];
  registry = 'go';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };

    const lines = content.split('\n');
    let inRequire = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Check for require section
      if (trimmed === 'require (') {
        inRequire = true;
        continue;
      }
      if (trimmed === ')' && inRequire) {
        inRequire = false;
        continue;
      }

      // Parse require lines
      if (inRequire || trimmed.startsWith('require ')) {
        const requireLine = inRequire ? trimmed : trimmed.slice(8).trim();
        const dep = this.parseRequire(requireLine);
        if (dep) {
          result.dependencies.push({
            ...dep,
            registry: this.registry,
            type: 'production',
            source: filePath,
          });
        }
      }
    }

    return result;
  }

  private parseRequire(line: string): { name: string; version?: string; constraint?: string } | null {
    // Parse go.mod require format
    // Examples: github.com/gin-gonic/gin v1.9.1, github.com/stretchr/testify v1.8.4 // indirect
    const parts = line.split(/\s+/);
    if (parts.length >= 2) {
      return {
        name: parts[0],
        version: parts[1].replace(/^v/, ''),
        constraint: parts[1],
      };
    }
    return null;
  }
}

// ============================================================================
// Rust (Cargo.toml)
// ============================================================================

export class CargoParser implements DependencyParser {
  name = 'crates';
  filePatterns = ['Cargo.toml'];
  registry = 'crates';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const lines = content.split('\n');
      let inDependencies = false;
      let inDevDependencies = false;

      for (const line of lines) {
        const trimmed = line.trim();

        // Check for section headers
        if (trimmed.startsWith('[dependencies]')) {
          inDependencies = true;
          inDevDependencies = false;
          continue;
        }
        if (trimmed.startsWith('[dev-dependencies]')) {
          inDevDependencies = true;
          inDependencies = false;
          continue;
        }
        // Any other section header (incl. target-specific tables like
        // [target.'cfg(windows)'.dependencies.windows-sys] or [dependencies.foo],
        // and [features]/[package]) ends the simple [dependencies] block — otherwise
        // bare keys like `version =`/`features =` get parsed as fake packages.
        if (trimmed.startsWith('[')) {
          inDependencies = false;
          inDevDependencies = false;
          continue;
        }

        // Parse dependency lines
        if (inDependencies || inDevDependencies) {
          const dep = this.parseCargoDependency(trimmed);
          if (dep) {
            result.dependencies.push({
              ...dep,
              registry: this.registry,
              type: inDevDependencies ? 'development' : 'production',
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

  private parseCargoDependency(line: string): { name: string; version?: string; constraint?: string } | null {
    // Parse Cargo.toml dependency format
    // Examples: serde = "1.0", tokio = { version = "1.0", features = ["full"] }
    const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
    if (match) {
      const value = match[2].trim();
      let version: string | undefined;
      let constraint: string | undefined;

      if (value.startsWith('"') && value.endsWith('"')) {
        // Simple version: serde = "1.0"
        version = value.slice(1, -1);
        constraint = version;
      } else if (value.startsWith('{')) {
        // Object with version: serde = { version = "1.0", ... }
        const versionMatch = value.match(/version\s*=\s*"([^"]+)"/);
        if (versionMatch) {
          version = versionMatch[1];
          constraint = version;
        }
      }

      return {
        name: match[1],
        version,
        constraint,
      };
    }

    return null;
  }
}

// ============================================================================
// Ruby (Gemfile)
// ============================================================================

export class GemfileParser implements DependencyParser {
  name = 'rubygems';
  filePatterns = ['Gemfile'];
  registry = 'rubygems';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };

    const lines = content.split('\n');
    let inGroup = false;
    let groupDepth = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Track group blocks
      if (trimmed.startsWith('group ')) {
        inGroup = true;
        groupDepth++;
        continue;
      }
      if (trimmed === 'end' && inGroup) {
        groupDepth--;
        if (groupDepth === 0) {
          inGroup = false;
        }
        continue;
      }

      // Skip source, git, path directives
      if (/^(source|git|path)\s/.test(trimmed)) {
        continue;
      }

      // Skip gems inside groups
      if (inGroup) {
        continue;
      }

      try {
        const dep = this.parseGem(trimmed);
        if (dep) {
          result.dependencies.push({
            ...dep,
            registry: this.registry,
            type: 'production',
            source: filePath,
          });
        }
      } catch (error) {
        result.warnings.push(`Failed to parse gem "${trimmed}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return result;
  }

  private parseGem(line: string): { name: string; version?: string; constraint?: string } | null {
    // Parse Gemfile format
    // Examples: gem "rails", "~> 7.0", gem "pg", ">= 1.0"
    const match = line.match(/^gem\s+["']([^"']+)["'](?:,\s*["']([^"']+)["'])?/);
    if (match) {
      return {
        name: match[1],
        version: this.extractVersion(match[2]),
        constraint: match[2],
      };
    }

    // Simple gem without version
    const simpleMatch = line.match(/^gem\s+["']([^"']+)["']$/);
    if (simpleMatch) {
      return { name: simpleMatch[1] };
    }

    return null;
  }

  private extractVersion(constraint?: string): string | undefined {
    if (!constraint) return undefined;
    const match = constraint.match(/^[\^~]?\s*(\d+(?:\.\d+)*(?:\.\d+)?)$/);
    return match ? match[1] : undefined;
  }
}

// ============================================================================
// Java/Maven (pom.xml)
// ============================================================================

export class PomParser implements DependencyParser {
  name = 'maven';
  filePatterns = ['pom.xml'];
  registry = 'maven';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      // Simple XML parsing for dependencies
      // This is a basic implementation - for production, use a proper XML parser
      const depRegex = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*(?:<version>([^<]*)<\/version>)?\s*(?:<scope>[^<]*<\/scope>)?\s*<\/dependency>/g;

      let match;
      while ((match = depRegex.exec(content)) !== null) {
        const groupId = match[1].trim();
        const artifactId = match[2].trim();
        const version = match[3]?.trim();

        result.dependencies.push({
          name: `${groupId}:${artifactId}`,
          version: version || undefined,
          constraint: version || undefined,
          registry: this.registry,
          type: 'production',
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
// Parser Registry
// ============================================================================

// ============================================================================
// .NET (*.csproj / Directory.Packages.props)
// ============================================================================

export class CsprojParser implements DependencyParser {
  name = 'nuget';
  filePatterns = ['*.csproj', '*.fsproj', '*.vbproj', 'Directory.Packages.props'];
  registry = 'nuget';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      // Match <PackageReference .../> and <PackageReference ...>...</PackageReference>.
      // Covers both `Version="x"` attribute and `<Version>x</Version>` child forms,
      // and Include= (normal) / Update= (central package management).
      const refRegex = /<PackageReference\b([^>]*?)(?:\/>|>([\s\S]*?)<\/PackageReference>)/gi;
      let match;
      while ((match = refRegex.exec(content)) !== null) {
        const attrs = match[1] || '';
        const inner = match[2] || '';

        const nameMatch = attrs.match(/\b(?:Include|Update)\s*=\s*"([^"]+)"/i);
        if (!nameMatch) continue;
        const name = nameMatch[1].trim();

        const versionAttr = attrs.match(/\bVersion\s*=\s*"([^"]*)"/i);
        const versionChild = inner.match(/<Version>\s*([^<]*?)\s*<\/Version>/i);
        const rawVersion = (versionAttr?.[1] ?? versionChild?.[1])?.trim();

        // MSBuild property versions (e.g. "$(JsonVersion)") can't be resolved
        // here, so keep them as the constraint but leave the concrete version unset.
        const version = rawVersion && !rawVersion.includes('$(') ? rawVersion : undefined;

        result.dependencies.push({
          name,
          version,
          constraint: rawVersion || undefined,
          registry: this.registry,
          type: 'production',
          source: filePath,
        });
      }
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }
}

// Shared: extract a single pinned version from a constraint string (handles
// ^/~/=/v prefixes); returns undefined for ranges, unions, and tags.
function extractPinnedVersion(constraint: string): string | undefined {
  const m = constraint.trim().match(/^[\^~=v]*\s*(\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?)$/);
  return m ? m[1] : undefined;
}

// ============================================================================
// PHP (composer.json)
// ============================================================================

export class ComposerParser implements DependencyParser {
  name = 'packagist';
  filePatterns = ['composer.json'];
  registry = 'packagist';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const pkg = JSON.parse(content);
      const sections: Array<[string, ParsedDependency['type']]> = [
        ['require', 'production'],
        ['require-dev', 'development'],
      ];
      for (const [section, type] of sections) {
        const deps = pkg[section];
        if (!deps || typeof deps !== 'object') continue;
        for (const [name, raw] of Object.entries(deps)) {
          // Skip platform requirements (php, ext-*, lib-*, composer-*) — not Packagist packages.
          if (name === 'php' || /^(ext|lib|composer)-/.test(name) || name === 'composer-runtime-api') {
            continue;
          }
          const constraint = String(raw);
          result.dependencies.push({
            name,
            version: extractPinnedVersion(constraint),
            constraint,
            registry: this.registry,
            type,
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
// Dart / Flutter (pubspec.yaml)
// ============================================================================

export class PubspecParser implements DependencyParser {
  name = 'pub.dev';
  filePatterns = ['pubspec.yaml', 'pubspec.yml'];
  registry = 'pub.dev';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const lines = content.split('\n');
      let type: ParsedDependency['type'] | null = null;

      for (const raw of lines) {
        const line = raw.replace(/#.*$/, '');
        if (!line.trim()) continue;

        // Top-level key resets the section.
        if (/^[A-Za-z_]/.test(line)) {
          const key = line.split(':')[0].trim();
          type = key === 'dependencies' ? 'production' : key === 'dev_dependencies' ? 'development' : null;
          continue;
        }
        if (!type) continue;

        // A scalar dependency at 2-space indent: `  name: constraint`.
        const m = line.match(/^  ([A-Za-z0-9_.]+):\s*(.*)$/);
        if (!m) continue;
        const name = m[1];
        const value = m[2].trim().replace(/^["']|["']$/g, '');
        // Empty value => a nested map (sdk/git/path dep), e.g. `flutter:` — skip.
        if (!value || name === 'flutter' || name === 'sdk' || name === 'dart') continue;

        result.dependencies.push({
          name,
          version: extractPinnedVersion(value),
          constraint: value,
          registry: this.registry,
          type,
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
// Conda (environment.yml)
// ============================================================================

export class CondaParser implements DependencyParser {
  name = 'conda';
  filePatterns = ['environment.yml', 'environment.yaml'];
  registry = 'conda';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const lines = content.split('\n');
      let inDeps = false;
      let pipIndent = -1; // indent of a `- pip:` block; deeper items are PyPI deps

      for (const raw of lines) {
        const line = raw.replace(/#.*$/, '');
        if (!line.trim()) continue;

        if (/^[A-Za-z_]/.test(line)) {
          inDeps = line.split(':')[0].trim() === 'dependencies';
          pipIndent = -1;
          continue;
        }
        if (!inDeps) continue;

        const indent = line.length - line.trimStart().length;
        const trimmed = line.trim();

        // Enter / exit the nested `- pip:` block by indentation.
        if (/^-\s*pip\s*:\s*$/.test(trimmed)) {
          pipIndent = indent;
          continue;
        }
        if (pipIndent >= 0 && indent <= pipIndent) pipIndent = -1;

        const item = trimmed.match(/^-\s*(.+)$/);
        if (!item) continue;
        const spec = item[1].trim();
        if (!spec || spec.endsWith(':')) continue; // nested map header

        // conda specs: `numpy=1.20`, `python>=3.8`, `pytest`; pip specs: `pkg==1.0`.
        const sm = spec.match(/^([A-Za-z0-9_.\-]+)\s*([=<>!~].*)?$/);
        if (!sm) continue;
        const constraint = sm[2] ? sm[2].trim() : undefined;
        const isPip = pipIndent >= 0 && indent > pipIndent;

        result.dependencies.push({
          name: sm[1],
          version: constraint ? extractPinnedVersion(constraint) : undefined,
          constraint,
          registry: isPip ? 'pypi' : this.registry,
          type: 'production',
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
// Gradle Version Catalog (gradle/libs.versions.toml)
// ============================================================================

export class GradleVersionCatalogParser implements DependencyParser {
  name = 'gradle';
  filePatterns = ['libs.versions.toml'];
  registry = 'maven';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const lines = content.split('\n');
      const versions: Record<string, string> = {};
      let section = '';

      for (const raw of lines) {
        const line = raw.replace(/#.*$/, '');
        const sec = line.match(/^\s*\[([^\]]+)\]\s*$/);
        if (sec) { section = sec[1].trim(); continue; }

        const kv = line.match(/^\s*([A-Za-z0-9_.\-]+)\s*=\s*(.+?)\s*$/);
        if (!kv) continue;
        const key = kv[1];
        const val = kv[2];

        if (section === 'versions') {
          const m = val.match(/^["']([^"']+)["']$/);
          if (m) versions[key] = m[1];
          continue;
        }
        if (section !== 'libraries' && section !== 'plugins') continue;

        let name: string | undefined;
        let version: string | undefined;
        if (val.startsWith('"') || val.startsWith("'")) {
          // String form: libraries "group:artifact:version".
          const parts = val.replace(/^["']|["']$/g, '').split(':');
          if (section === 'libraries' && parts.length >= 2) {
            name = `${parts[0]}:${parts[1]}`;
            version = parts[2];
          }
        } else if (val.startsWith('{')) {
          const module = val.match(/\bmodule\s*=\s*["']([^"']+)["']/);
          const group = val.match(/\bgroup\s*=\s*["']([^"']+)["']/);
          const nm = val.match(/\bname\s*=\s*["']([^"']+)["']/);
          const id = val.match(/\bid\s*=\s*["']([^"']+)["']/);
          const verLit = val.match(/\bversion\s*=\s*["']([^"']+)["']/);
          const verRef = val.match(/\bversion\.ref\s*=\s*["']([^"']+)["']/);
          if (section === 'plugins') {
            name = id?.[1];
          } else if (module) {
            name = module[1];
          } else if (group && nm) {
            name = `${group[1]}:${nm[1]}`;
          }
          version = verLit?.[1] ?? (verRef ? versions[verRef[1]] : undefined);
        }

        if (name) {
          result.dependencies.push({
            name,
            version,
            constraint: version,
            // [plugins] resolve via the Gradle plugin portal; [libraries] are Maven coords.
            registry: section === 'plugins' ? 'gradle' : 'maven',
            type: 'production',
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
// R (DESCRIPTION — Debian Control Format)
// ============================================================================

export class RDescriptionParser implements DependencyParser {
  name = 'cran';
  filePatterns = ['DESCRIPTION'];
  registry = 'cran';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      // DCF: `Field:` at column 0, continuation lines indented. Collect the
      // dependency fields (which may span many lines), then split on commas.
      const lines = content.split('\n');
      const fields: Record<string, string[]> = {};
      let current = '';
      for (const raw of lines) {
        const start = raw.match(/^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/);
        if (start && !/^\s/.test(raw)) {
          current = start[1];
          fields[current] = fields[current] || [];
          if (start[2].trim()) fields[current].push(start[2]);
        } else if (/^\s+\S/.test(raw) && current) {
          fields[current].push(raw.trim());
        }
      }

      const sections: Array<[string, ParsedDependency['type']]> = [
        ['Depends', 'production'],
        ['Imports', 'production'],
        ['LinkingTo', 'production'],
        ['Suggests', 'development'],
        ['Enhances', 'development'],
      ];
      for (const [field, type] of sections) {
        const text = (fields[field] || []).join(' ');
        if (!text) continue;
        for (const entry of text.split(',')) {
          const m = entry.trim().match(/^([A-Za-z][A-Za-z0-9._]*)\s*(?:\(([^)]+)\))?/);
          if (!m || !m[1]) continue;
          if (m[1] === 'R') continue; // the R runtime itself, not a CRAN package
          const constraint = m[2] ? m[2].trim() : undefined;
          result.dependencies.push({
            name: m[1],
            version: constraint ? extractPinnedVersion(constraint) : undefined,
            constraint,
            registry: this.registry,
            type,
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
// Python (Pipfile — pipenv)
// ============================================================================

export class PipfileParser implements DependencyParser {
  name = 'pypi';
  filePatterns = ['Pipfile'];
  registry = 'pypi';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      const lines = content.split('\n');
      let type: ParsedDependency['type'] | null = null;

      for (const raw of lines) {
        const line = raw.replace(/#.*$/, '');
        const sec = line.match(/^\s*\[([^\]]+)\]\s*$/);
        if (sec) {
          const s = sec[1].trim();
          type = s === 'packages' ? 'production' : s === 'dev-packages' ? 'development' : null;
          continue;
        }
        if (!type) continue;

        const kv = line.match(/^\s*([A-Za-z0-9_.\-]+)\s*=\s*(.+?)\s*$/);
        if (!kv) continue;
        const name = kv[1];
        if (name === 'python_version' || name === 'python_full_version') continue;

        const val = kv[2];
        let constraint: string | undefined;
        if (val.startsWith('{')) {
          // Inline table: {version = "x", extras = [...], ...}
          constraint = val.match(/\bversion\s*=\s*["']([^"']*)["']/)?.[1];
        } else {
          constraint = val.replace(/^["']|["']$/g, '');
        }
        if (constraint === '*' || constraint === '') constraint = undefined;

        result.dependencies.push({
          name,
          version: constraint ? extractPinnedVersion(constraint) : undefined,
          constraint,
          registry: this.registry,
          type,
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
// Deno (deno.json / deno.jsonc)
// ============================================================================

export class DenoJsonParser implements DependencyParser {
  name = 'jsr';
  filePatterns = ['deno.json', 'deno.jsonc', 'import_map.json'];
  registry = 'jsr';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };

    try {
      let data: any;
      try {
        data = JSON.parse(content);
      } catch {
        // deno.jsonc may carry comments — strip them and retry.
        const cleaned = content
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:"'])\/\/.*$/gm, '$1');
        data = JSON.parse(cleaned);
      }
      const imports = (data && data.imports) || {};
      for (const raw of Object.values(imports)) {
        const spec = String(raw);
        let registry: string;
        let body: string;
        if (spec.startsWith('jsr:')) { registry = 'jsr'; body = spec.slice(4); }
        else if (spec.startsWith('npm:')) { registry = 'npm'; body = spec.slice(4); }
        else continue; // http(s):// or relative path imports have no registry version
        // body is name@version with the name possibly scoped (@scope/name@ver).
        const at = body.lastIndexOf('@');
        if (at <= 0) continue;
        const name = body.slice(0, at);
        const constraint = body.slice(at + 1);
        result.dependencies.push({
          name,
          version: extractPinnedVersion(constraint),
          constraint,
          registry,
          type: 'production',
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
// Haskell (*.cabal)
// ============================================================================

export class CabalParser implements DependencyParser {
  name = 'hackage';
  filePatterns = ['*.cabal'];
  registry = 'hackage';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };
    const seen = new Set<string>();

    try {
      const lines = content.split('\n');
      let collecting = false;
      let buf: string[] = [];

      const flush = () => {
        for (let entry of buf.join(' ').split(',')) {
          entry = entry.trim();
          if (!entry) continue;
          const m = entry.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*(.*)$/);
          if (!m) continue;
          const key = m[1].toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const constraint = m[2].trim() || undefined;
          result.dependencies.push({
            name: m[1],
            version: undefined, // cabal uses version RANGES, not pins
            constraint,
            registry: this.registry,
            type: 'production',
            source: filePath,
          });
        }
        buf = [];
        collecting = false;
      };

      for (const raw of lines) {
        const line = raw.replace(/--.*$/, ''); // cabal line comments
        const bd = line.match(/^\s*build-depends\s*:\s*(.*)$/i);
        if (bd) {
          if (collecting) flush();
          collecting = true;
          buf = bd[1].trim() ? [bd[1]] : [];
          continue;
        }
        if (collecting) {
          // Continuation = an indented line that is NOT a new field (deps contain
          // no ':'); anything else ends the build-depends block.
          if (/^\s+\S/.test(line) && !/^\s*[A-Za-z][A-Za-z0-9-]*\s*:/.test(line)) {
            buf.push(line.trim());
          } else {
            flush();
          }
        }
      }
      flush();
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }
}

// ============================================================================
// Elixir (mix.exs)
// ============================================================================

export class MixExsParser implements DependencyParser {
  name = 'hex';
  filePatterns = ['mix.exs'];
  registry = 'hex';

  parse(content: string, filePath: string): ParserResult {
    const result: ParserResult = { dependencies: [], errors: [], warnings: [] };
    const seen = new Set<string>();

    try {
      // Dependency tuples in mix.exs look like `{:phoenix, "~> 1.7.0"}` —
      // optionally followed by keyword options. Match each tuple's atom name
      // and the remainder up to the closing brace.
      const tupleRe = /\{\s*:([a-zA-Z_][a-zA-Z0-9_]*)\s*,([^}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = tupleRe.exec(content)) !== null) {
        const name = m[1];
        const rest = m[2];
        if (seen.has(name)) continue;

        // Skip git/path/in-umbrella deps — they don't resolve against Hex.
        if (/\b(git|github|path|in_umbrella)\s*:/.test(rest)) continue;

        // The version requirement is the first string literal in the tuple.
        const verMatch = rest.match(/"([^"]+)"/);
        const constraint = verMatch ? verMatch[1].trim() : undefined;

        seen.add(name);
        result.dependencies.push({
          name,
          version: constraint ? extractPinnedVersion(constraint) : undefined,
          constraint,
          registry: this.registry,
          type: 'production',
          source: filePath,
        });
      }
    } catch (error) {
      result.errors.push(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }
}

export const PARSERS: DependencyParser[] = [
  new NpmParser(),
  new PythonParser(),
  new PyProjectParser(),
  new GoModParser(),
  new CargoParser(),
  new GemfileParser(),
  new PomParser(),
  new CsprojParser(),
  new ComposerParser(),
  new PubspecParser(),
  new CondaParser(),
  new GradleVersionCatalogParser(),
  new RDescriptionParser(),
  new PipfileParser(),
  new DenoJsonParser(),
  new CabalParser(),
  new MixExsParser(),
];

/**
 * Get parser for a file based on its name
 */
export function getParserForFile(fileName: string): DependencyParser | null {
  for (const parser of PARSERS) {
    for (const pattern of parser.filePatterns) {
      // Handle patterns with wildcards
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        if (regex.test(fileName)) {
          return parser;
        }
      } else if (fileName === pattern) {
        return parser;
      }
    }
  }
  return null;
}

/**
 * Parse a dependency file
 */
export function parseDependencyFile(filePath: string): ParserResult {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const fileName = basename(filePath);
    const parser = getParserForFile(fileName);

    if (!parser) {
      return {
        dependencies: [],
        errors: [`No parser found for file: ${fileName}`],
        warnings: [],
      };
    }

    return parser.parse(content, filePath);
  } catch (error) {
    return {
      dependencies: [],
      errors: [`Failed to read file ${filePath}: ${error instanceof Error ? error.message : String(error)}`],
      warnings: [],
    };
  }
}
