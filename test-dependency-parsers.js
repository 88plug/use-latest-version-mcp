#!/usr/bin/env node

/**
 * Test script for dependency file parsers
 */

import { parseDependencyFile, getParserForFile, PARSERS, PyProjectParser, CargoParser, CsprojParser, ComposerParser, PubspecParser, CondaParser, GradleVersionCatalogParser, RDescriptionParser, PipfileParser, DenoJsonParser, CabalParser } from './build/dependency-parsers.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

console.log('=== Dependency File Parser Tests ===\n');

// Test counters
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// Create test directory
const testDir = './test-dependency-files';
if (!existsSync(testDir)) {
  mkdirSync(testDir, { recursive: true });
}

// ============================================================================
// Test 1: Parser Registry
// ============================================================================
console.log('\n--- Parser Registry ---');

test('PARSERS has all expected parsers', () => {
  assert(PARSERS.length === 16, 'should have 16 parsers (incl. Deno/Cabal)');
});

test('getParserForFile finds npm parser', () => {
  const parser = getParserForFile('package.json');
  assert(parser !== null, 'should find parser for package.json');
  assert(parser?.name === 'npm', 'should be npm parser');
});

test('getParserForFile finds python parser', () => {
  const parser = getParserForFile('requirements.txt');
  assert(parser !== null, 'should find parser for requirements.txt');
  assert(parser?.name === 'pypi', 'should be pypi parser');
});

test('getParserForFile finds go parser', () => {
  const parser = getParserForFile('go.mod');
  assert(parser !== null, 'should find parser for go.mod');
  assert(parser?.name === 'go', 'should be go parser');
});

test('getParserForFile returns null for unknown file', () => {
  const parser = getParserForFile('unknown.xyz');
  assert(parser === null, 'should return null for unknown file');
});

// ============================================================================
// Test 2: npm Parser (package.json)
// ============================================================================
console.log('\n--- npm Parser ---');

const packageJson = {
  name: 'test-project',
  version: '1.0.0',
  dependencies: {
    express: '^4.18.0',
    lodash: '~4.17.0',
  },
  devDependencies: {
    jest: '^29.0.0',
    typescript: '^5.0.0',
  },
  peerDependencies: {
    react: '>=18.0.0',
  },
  optionalDependencies: {
    fsevents: '^2.3.0',
  },
};

writeFileSync(join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));

test('npm parser parses dependencies', () => {
  const result = parseDependencyFile(join(testDir, 'package.json'));
  assert(result.errors.length === 0, 'should have no errors');
  assert(result.dependencies.length === 6, 'should have 6 dependencies (2 prod + 2 dev + 1 peer + 1 optional)');
});

test('npm parser identifies production dependencies', () => {
  const result = parseDependencyFile(join(testDir, 'package.json'));
  const prodDeps = result.dependencies.filter(d => d.type === 'production');
  assert(prodDeps.length === 2, 'should have 2 production dependencies');
  assert(prodDeps.some(d => d.name === 'express'), 'should include express');
  assert(prodDeps.some(d => d.name === 'lodash'), 'should include lodash');
});

test('npm parser identifies dev dependencies', () => {
  const result = parseDependencyFile(join(testDir, 'package.json'));
  const devDeps = result.dependencies.filter(d => d.type === 'development');
  assert(devDeps.length === 2, 'should have 2 dev dependencies');
  assert(devDeps.some(d => d.name === 'jest'), 'should include jest');
  assert(devDeps.some(d => d.name === 'typescript'), 'should include typescript');
});

test('npm parser identifies peer dependencies', () => {
  const result = parseDependencyFile(join(testDir, 'package.json'));
  const peerDeps = result.dependencies.filter(d => d.type === 'peer');
  assert(peerDeps.length === 1, 'should have 1 peer dependency');
  assert(peerDeps[0].name === 'react', 'should be react');
});

test('npm parser identifies optional dependencies', () => {
  const result = parseDependencyFile(join(testDir, 'package.json'));
  const optDeps = result.dependencies.filter(d => d.type === 'optional');
  assert(optDeps.length === 1, 'should have 1 optional dependency');
  assert(optDeps[0].name === 'fsevents', 'should be fsevents');
});

test('npm parser extracts versions from constraints', () => {
  const result = parseDependencyFile(join(testDir, 'package.json'));
  const express = result.dependencies.find(d => d.name === 'express');
  assert(express?.version === '4.18.0', 'should extract version from ^4.18.0');
  assert(express?.constraint === '^4.18.0', 'should preserve constraint');
});

// ============================================================================
// Test 3: Python Parser (requirements.txt)
// ============================================================================
console.log('\n--- Python Parser ---');

const requirementsTxt = `# This is a comment
requests==2.28.0
django>=3.2,<4.0
flask~=2.0
numpy
# Another comment
pandas>=1.5.0
`;

writeFileSync(join(testDir, 'requirements.txt'), requirementsTxt);

test('python parser parses requirements', () => {
  const result = parseDependencyFile(join(testDir, 'requirements.txt'));
  assert(result.errors.length === 0, 'should have no errors');
  assert(result.dependencies.length === 5, 'should have 5 dependencies (skipping comments)');
});

test('python parser handles == operator', () => {
  const result = parseDependencyFile(join(testDir, 'requirements.txt'));
  const requests = result.dependencies.find(d => d.name === 'requests');
  assert(requests?.version === '2.28.0', 'should parse == operator');
});

test('python parser handles >= operator', () => {
  const result = parseDependencyFile(join(testDir, 'requirements.txt'));
  const pandas = result.dependencies.find(d => d.name === 'pandas');
  assert(pandas?.constraint === '>=1.5.0', 'should parse >= operator');
});

test('python parser handles ~= operator', () => {
  const result = parseDependencyFile(join(testDir, 'requirements.txt'));
  const flask = result.dependencies.find(d => d.name === 'flask');
  assert(flask?.version === '2.0', 'should parse ~= operator');
});

test('python parser handles packages without version', () => {
  const result = parseDependencyFile(join(testDir, 'requirements.txt'));
  const numpy = result.dependencies.find(d => d.name === 'numpy');
  assert(numpy !== undefined, 'should parse package without version');
  assert(numpy?.version === undefined, 'should have no version');
});

test('python parser skips comments', () => {
  const result = parseDependencyFile(join(testDir, 'requirements.txt'));
  assert(!result.dependencies.some(d => d.name.startsWith('#')), 'should skip comments');
});

// ============================================================================
// Test 4: Go Parser (go.mod)
// ============================================================================
console.log('\n--- Go Parser ---');

const goMod = `module example.com/myproject

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/stretchr/testify v1.8.4
	github.com/golang/mock v1.6.0
)
`;

writeFileSync(join(testDir, 'go.mod'), goMod);

test('go parser parses go.mod', () => {
  const result = parseDependencyFile(join(testDir, 'go.mod'));
  assert(result.errors.length === 0, 'should have no errors');
  assert(result.dependencies.length === 3, 'should have 3 dependencies');
});

test('go parser extracts module paths', () => {
  const result = parseDependencyFile(join(testDir, 'go.mod'));
  const gin = result.dependencies.find(d => d.name === 'github.com/gin-gonic/gin');
  assert(gin !== undefined, 'should parse github.com/gin-gonic/gin');
});

test('go parser extracts versions', () => {
  const result = parseDependencyFile(join(testDir, 'go.mod'));
  const gin = result.dependencies.find(d => d.name === 'github.com/gin-gonic/gin');
  assert(gin?.version === '1.9.1', 'should extract version 1.9.1');
});

// ============================================================================
// Test 5: Cargo Parser (Cargo.toml)
// ============================================================================
console.log('\n--- Cargo Parser ---');

const cargoToml = `[package]
name = "myproject"
version = "0.1.0"

[dependencies]
serde = "1.0"
tokio = { version = "1.0", features = ["full"] }
clap = "4.0"

[dev-dependencies]
criterion = "0.5"
`;

writeFileSync(join(testDir, 'Cargo.toml'), cargoToml);

test('cargo parser parses Cargo.toml', () => {
  const result = parseDependencyFile(join(testDir, 'Cargo.toml'));
  assert(result.errors.length === 0, 'should have no errors');
  assert(result.dependencies.length === 4, 'should have 4 dependencies');
});

test('cargo parser identifies production dependencies', () => {
  const result = parseDependencyFile(join(testDir, 'Cargo.toml'));
  const prodDeps = result.dependencies.filter(d => d.type === 'production');
  assert(prodDeps.length === 3, 'should have 3 production dependencies');
});

test('cargo parser identifies dev dependencies', () => {
  const result = parseDependencyFile(join(testDir, 'Cargo.toml'));
  const devDeps = result.dependencies.filter(d => d.type === 'development');
  assert(devDeps.length === 1, 'should have 1 dev dependency');
  assert(devDeps[0].name === 'criterion', 'should be criterion');
});

test('cargo parser handles simple version format', () => {
  const result = parseDependencyFile(join(testDir, 'Cargo.toml'));
  const serde = result.dependencies.find(d => d.name === 'serde');
  assert(serde?.version === '1.0', 'should parse simple version');
});

test('cargo parser handles object version format', () => {
  const result = parseDependencyFile(join(testDir, 'Cargo.toml'));
  const tokio = result.dependencies.find(d => d.name === 'tokio');
  assert(tokio?.version === '1.0', 'should parse object version format');
});

// ============================================================================
// Test 6: Gemfile Parser
// ============================================================================
console.log('\n--- Gemfile Parser ---');

const gemfile = `source "https://rubygems.org"

gem "rails", "~> 7.0"
gem "pg", ">= 1.0"
gem "puma"

group :development do
  gem "rubocop"
end
`;

writeFileSync(join(testDir, 'Gemfile'), gemfile);

test('gemfile parser parses Gemfile', () => {
  const result = parseDependencyFile(join(testDir, 'Gemfile'));
  assert(result.errors.length === 0, 'should have no errors');
  assert(result.dependencies.length === 3, 'should have 3 dependencies (skipping group)');
});

test('gemfile parser handles ~> operator', () => {
  const result = parseDependencyFile(join(testDir, 'Gemfile'));
  const rails = result.dependencies.find(d => d.name === 'rails');
  assert(rails?.constraint === '~> 7.0', 'should parse ~> operator');
});

test('gemfile parser handles >= operator', () => {
  const result = parseDependencyFile(join(testDir, 'Gemfile'));
  const pg = result.dependencies.find(d => d.name === 'pg');
  assert(pg?.constraint === '>= 1.0', 'should parse >= operator');
});

test('gemfile parser handles gems without version', () => {
  const result = parseDependencyFile(join(testDir, 'Gemfile'));
  const puma = result.dependencies.find(d => d.name === 'puma');
  assert(puma !== undefined, 'should parse gem without version');
  assert(puma?.version === undefined, 'should have no version');
});

test('gemfile parser skips source directive', () => {
  const result = parseDependencyFile(join(testDir, 'Gemfile'));
  assert(!result.dependencies.some(d => d.name === 'source'), 'should skip source directive');
});

// ============================================================================
// Test 7: pom.xml Parser
// ============================================================================
console.log('\n--- pom.xml Parser ---');

const pomXml = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>myproject</artifactId>
  <version>1.0.0</version>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>3.0.0</version>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.9.0</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>
`;

writeFileSync(join(testDir, 'pom.xml'), pomXml);

test('pom parser parses pom.xml', () => {
  const result = parseDependencyFile(join(testDir, 'pom.xml'));
  assert(result.errors.length === 0, 'should have no errors');
  assert(result.dependencies.length === 2, 'should have 2 dependencies');
});

test('pom parser combines groupId and artifactId', () => {
  const result = parseDependencyFile(join(testDir, 'pom.xml'));
  const spring = result.dependencies.find(d => d.name === 'org.springframework.boot:spring-boot-starter-web');
  assert(spring !== undefined, 'should combine groupId:artifactId');
});

test('pom parser extracts versions', () => {
  const result = parseDependencyFile(join(testDir, 'pom.xml'));
  const spring = result.dependencies.find(d => d.name === 'org.springframework.boot:spring-boot-starter-web');
  assert(spring?.version === '3.0.0', 'should extract version');
});

// ============================================================================
// Test 8: Error Handling
// ============================================================================
console.log('\n--- Error Handling ---');

test('parser handles invalid JSON', () => {
  writeFileSync(join(testDir, 'invalid.json'), '{ invalid json }');
  const result = parseDependencyFile(join(testDir, 'invalid.json'));
  assert(result.errors.length > 0, 'should have errors for invalid JSON');
  assert(result.dependencies.length === 0, 'should have no dependencies');
});

test('parser handles non-existent file', () => {
  const result = parseDependencyFile(join(testDir, 'nonexistent.txt'));
  assert(result.errors.length > 0, 'should have errors for non-existent file');
});

test('parser handles unknown file type', () => {
  writeFileSync(join(testDir, 'unknown.xyz'), 'some content');
  const result = parseDependencyFile(join(testDir, 'unknown.xyz'));
  assert(result.errors.length > 0, 'should have errors for unknown file type');
});

test('NpmParser extracts prerelease versions', () => {
  writeFileSync(join(testDir, 'package.json'), JSON.stringify({
    name: 'demo',
    dependencies: { alpha: '^1.2.3-beta.1', stable: '~2.0.0' },
  }, null, 2));
  const r = parseDependencyFile(join(testDir, 'package.json'));
  const alpha = r.dependencies.find((d) => d.name === 'alpha');
  assert(alpha.version === '1.2.3-beta.1', `prerelease should be extracted, got ${alpha.version}`);
  const stable = r.dependencies.find((d) => d.name === 'stable');
  assert(stable.version === '2.0.0', `tilde version should extract 2.0.0, got ${stable.version}`);
});

// ============================================================================
// pyproject.toml: PEP 621 and Poetry
// ============================================================================

test('PyProjectParser parses PEP 621 multi-line dependencies', () => {
  const content = `[project]
name = "demo"
dependencies = [
  "requests>=2.28.0",
  "flask==2.3.0",
  "click",
]

[project.optional-dependencies]
dev = ["pytest==7.4.0", "mypy>=1.0"]
`;
  const r = new PyProjectParser().parse(content, 'pyproject.toml');
  const names = r.dependencies.map((d) => d.name);
  assert(names.includes('requests'), 'should find requests');
  assert(names.includes('flask'), 'should find flask');
  assert(names.includes('click'), 'should find bare click');
  const flask = r.dependencies.find((d) => d.name === 'flask');
  assert(flask.version === '2.3.0', `flask == pin should extract 2.3.0, got ${flask.version}`);
  const pytest = r.dependencies.find((d) => d.name === 'pytest');
  assert(pytest && pytest.type === 'optional', 'optional-dependencies entries should be type optional');
});

test('PyProjectParser parses Poetry sections and skips python', () => {
  const content = `[tool.poetry]
name = "demo"

[tool.poetry.dependencies]
python = "^3.9"
requests = "^2.28.0"
django = { version = ">=3.2,<4.0", optional = false }

[tool.poetry.dev-dependencies]
pytest = "^7.4.0"
`;
  const r = new PyProjectParser().parse(content, 'pyproject.toml');
  const names = r.dependencies.map((d) => d.name);
  assert(!names.includes('python'), 'python interpreter constraint must be skipped');
  assert(names.includes('requests'), 'should find requests');
  assert(names.includes('django'), 'should find django from inline table');
  const requests = r.dependencies.find((d) => d.name === 'requests');
  assert(requests.version === '2.28.0', `caret pin should extract 2.28.0, got ${requests.version}`);
  const pytest = r.dependencies.find((d) => d.name === 'pytest');
  assert(pytest && pytest.type === 'development', 'dev-dependencies entries should be type development');
});

test('CargoParser ignores target-specific dependency tables (no fake packages)', () => {
  const toml = `[dependencies]
serde = "1.0"
tokio = { version = "1", features = ["full"] }

[target.'cfg(windows)'.dependencies.windows-sys]
version = "0.61"
features = ["Win32_Foundation"]

[features]
default = []
`;
  const r = new CargoParser().parse(toml, 'Cargo.toml');
  const names = r.dependencies.map((d) => d.name);
  assert(names.includes('serde') && names.includes('tokio'), 'real deps present');
  assert(!names.some((n) => ['version', 'features', 'optional', 'default'].includes(n)),
    `no bare-key fake packages, got ${JSON.stringify(names)}`);
});

test('CsprojParser parses PackageReference (attribute, child, and $(prop) forms)', () => {
  const csproj = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Serilog"><Version>3.1.1</Version></PackageReference>
    <PackageReference Include="Foo.Bar" Version="$(FooVersion)" />
  </ItemGroup>
</Project>`;
  const r = new CsprojParser().parse(csproj, 'app.csproj');
  const json = r.dependencies.find((d) => d.name === 'Newtonsoft.Json');
  const serilog = r.dependencies.find((d) => d.name === 'Serilog');
  const foo = r.dependencies.find((d) => d.name === 'Foo.Bar');
  assert(json && json.version === '13.0.3' && json.registry === 'nuget', 'attribute-form version + nuget registry');
  assert(serilog && serilog.version === '3.1.1', 'child-element <Version> form');
  assert(foo && foo.version === undefined && foo.constraint === '$(FooVersion)',
    'MSBuild property version -> constraint kept, concrete version unset');
  assert(getParserForFile('MyApp.csproj')?.name === 'nuget', '*.csproj routes to the nuget parser');
});

test('ComposerParser parses require/require-dev and skips platform packages', () => {
  const composer = JSON.stringify({
    require: { php: '>=7.2', 'guzzlehttp/guzzle': '^7.0', 'ext-json': '*', 'psr/log': '1.1.4' },
    'require-dev': { 'phpunit/phpunit': '9.5.0' },
  });
  const r = new ComposerParser().parse(composer, 'composer.json');
  const names = r.dependencies.map((d) => d.name);
  assert(!names.includes('php') && !names.includes('ext-json'), 'platform packages skipped');
  assert(names.includes('guzzlehttp/guzzle'), 'vendor/package found');
  const log = r.dependencies.find((d) => d.name === 'psr/log');
  assert(log.version === '1.1.4' && log.registry === 'packagist', 'pinned version extracted + packagist registry');
  const phpunit = r.dependencies.find((d) => d.name === 'phpunit/phpunit');
  assert(phpunit.type === 'development', 'require-dev -> development');
  assert(getParserForFile('composer.json')?.name === 'packagist', 'composer.json routes to packagist');
});

test('PubspecParser parses dependencies and skips sdk/flutter pseudo-deps', () => {
  const pubspec = `name: app
dependencies:
  http: ^1.1.0
  flutter:
    sdk: flutter
dev_dependencies:
  test: ^1.24.0
`;
  const r = new PubspecParser().parse(pubspec, 'pubspec.yaml');
  const names = r.dependencies.map((d) => d.name);
  assert(names.includes('http') && !names.includes('flutter') && !names.includes('sdk'),
    `http found, flutter/sdk skipped, got ${JSON.stringify(names)}`);
  const http = r.dependencies.find((d) => d.name === 'http');
  assert(http.version === '1.1.0' && http.registry === 'pub.dev', 'caret version + pub.dev registry');
  assert(r.dependencies.find((d) => d.name === 'test').type === 'development', 'dev_dependencies -> development');
});

test('CondaParser parses conda deps and attributes nested pip block to pypi', () => {
  const env = `name: e
dependencies:
  - python>=3.8
  - numpy=1.20
  - pytest
  - pip:
    - requests==2.0
`;
  const r = new CondaParser().parse(env, 'environment.yml');
  const numpy = r.dependencies.find((d) => d.name === 'numpy');
  const requests = r.dependencies.find((d) => d.name === 'requests');
  assert(numpy.version === '1.20' && numpy.registry === 'conda', 'conda = pin extracted');
  assert(requests && requests.registry === 'pypi', 'nested pip dep attributed to pypi registry');
  assert(getParserForFile('environment.yml')?.name === 'conda', 'environment.yml routes to conda');
});

test('GradleVersionCatalogParser resolves version.ref and tags libraries=maven, plugins=gradle', () => {
  const toml = `[versions]
retrofit = "2.11.0"
hilt = "2.59"
[libraries]
retrofit-core = { group = "com.squareup.retrofit2", name = "retrofit", version.ref = "retrofit" }
javax-inject = { module = "javax.inject:javax.inject", version = "1" }
[plugins]
hilt = { id = "com.google.dagger.hilt.android", version.ref = "hilt" }
`;
  const r = new GradleVersionCatalogParser().parse(toml, 'libs.versions.toml');
  const retro = r.dependencies.find((d) => d.name === 'com.squareup.retrofit2:retrofit');
  const inject = r.dependencies.find((d) => d.name === 'javax.inject:javax.inject');
  const hilt = r.dependencies.find((d) => d.name === 'com.google.dagger.hilt.android');
  assert(retro.version === '2.11.0' && retro.registry === 'maven', 'version.ref resolved + maven registry');
  assert(inject.version === '1', 'inline literal version');
  assert(hilt.version === '2.59' && hilt.registry === 'gradle', 'plugin -> gradle registry');
  assert(getParserForFile('libs.versions.toml')?.name === 'gradle', 'routes to gradle catalog parser');
});

test('RDescriptionParser parses Imports/Suggests, keeps version ranges, skips R', () => {
  const desc = `Package: ggplot2
Depends:
    R (>= 4.1)
Imports:
    cli,
    gtable (>= 0.3.6),
    rlang (>= 1.1.0)
Suggests:
    knitr,
    covr
`;
  const r = new RDescriptionParser().parse(desc, 'DESCRIPTION');
  const names = r.dependencies.map((d) => d.name);
  assert(!names.includes('R'), 'R runtime itself skipped');
  assert(names.includes('cli') && names.includes('gtable'), 'Imports found');
  const gtable = r.dependencies.find((d) => d.name === 'gtable');
  assert(gtable.constraint === '>= 0.3.6' && gtable.version === undefined, 'range kept as constraint, no false pin');
  assert(r.dependencies.find((d) => d.name === 'knitr').type === 'development', 'Suggests -> development');
});

test('PipfileParser parses [packages]/[dev-packages] incl. inline tables, skips python_version', () => {
  const pipfile = `[packages]
requests = ">=2.32.0"
click = "==8.0.3"
pytz = "*"
myst-parser = {extras = ["linkify"], version = "==1.0"}
[dev-packages]
sphinx = "*"
[requires]
python_version = "3.11"
`;
  const r = new PipfileParser().parse(pipfile, 'Pipfile');
  const click = r.dependencies.find((d) => d.name === 'click');
  const myst = r.dependencies.find((d) => d.name === 'myst-parser');
  assert(click.version === '8.0.3', '== pin extracted');
  assert(myst && myst.version === '1.0', 'inline-table version extracted');
  assert(!r.dependencies.some((d) => d.name === 'python_version'), 'python_version skipped');
  assert(r.dependencies.find((d) => d.name === 'sphinx').type === 'development', 'dev-packages -> development');
});

test('DenoJsonParser parses jsr:/npm: imports and skips URL imports', () => {
  const deno = JSON.stringify({
    imports: { '@std/assert': 'jsr:@std/assert@^1.0.19', ts: 'npm:typescript@5.8.2', url: 'https://deno.land/x/foo.ts' },
  });
  const r = new DenoJsonParser().parse(deno, 'deno.json');
  const assert1 = r.dependencies.find((d) => d.name === '@std/assert');
  const ts = r.dependencies.find((d) => d.name === 'typescript');
  assert(assert1 && assert1.registry === 'jsr' && assert1.version === '1.0.19', 'scoped jsr import w/ version');
  assert(ts && ts.registry === 'npm' && ts.version === '5.8.2', 'npm import mapped to npm registry');
  assert(r.dependencies.length === 2, 'http(s) URL import skipped');
  assert(getParserForFile('deno.json')?.name === 'jsr', 'deno.json routes to jsr parser');
});

test('CabalParser parses build-depends across continuation lines, keeps ranges', () => {
  const cabal = `name: aeson
library
  build-depends:
    , base >=4.12 && <5
    , aeson
    , text >= 1.0 || >= 2.0
  default-language: Haskell2010
`;
  const r = new CabalParser().parse(cabal, 'aeson.cabal');
  const names = r.dependencies.map((d) => d.name);
  assert(names.includes('base') && names.includes('aeson') && names.includes('text'), 'deps found across leading-comma lines');
  assert(!names.includes('default') && !names.includes('default-language'), 'new field ends the block');
  const base = r.dependencies.find((d) => d.name === 'base');
  assert(base.constraint === '>=4.12 && <5' && base.version === undefined, 'range kept as constraint, no false pin');
  assert(getParserForFile('foo.cabal')?.name === 'hackage', '*.cabal routes to hackage parser');
});

// ============================================================================
// Summary
// ============================================================================
console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed === 0) {
  console.log('\n✅ All tests passed!');
  process.exit(0);
} else {
  console.log(`\n❌ ${failed} test(s) failed`);
  process.exit(1);
}
