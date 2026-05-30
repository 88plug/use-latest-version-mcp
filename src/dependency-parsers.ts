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
        if (trimmed.startsWith('[') && !trimmed.includes('dependencies')) {
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

export const PARSERS: DependencyParser[] = [
  new NpmParser(),
  new PythonParser(),
  new PyProjectParser(),
  new GoModParser(),
  new CargoParser(),
  new GemfileParser(),
  new PomParser(),
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
