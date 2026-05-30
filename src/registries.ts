import nodeFetch from 'node-fetch';
import { packageCache, getCacheKey } from './utils.js';

// Registry HTTP calls must never hang forever in production, so every request is
// wrapped with an AbortController timeout. Configurable via REGISTRY_TIMEOUT_MS.
const REGISTRY_TIMEOUT_MS = parseInt(process.env.REGISTRY_TIMEOUT_MS || '15000', 10);

// Local timeout-aware fetch. Declared as `fetch` so it transparently replaces the
// previous bare node-fetch import at every call site without further changes.
async function fetch(
  url: Parameters<typeof nodeFetch>[0],
  options: Parameters<typeof nodeFetch>[1] = {}
): Promise<Awaited<ReturnType<typeof nodeFetch>>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
  try {
    return await nodeFetch(url, { ...options, signal: controller.signal } as Parameters<typeof nodeFetch>[1]);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Registry request timed out after ${REGISTRY_TIMEOUT_MS}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class EnhancedRegistryError extends Error {
  constructor(
    message: string,
    public registry: string,
    public packageName: string,
    public url: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'EnhancedRegistryError';
  }

  toString(): string {
    return `[${this.registry}] ${this.message}
Package: ${this.packageName}
URL: ${this.url}
${this.statusCode ? `Status: ${this.statusCode}` : ''}`;
  }
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on 404 or client errors
      if (error instanceof Error && error.message.includes('not found')) {
        throw error;
      }

      // Don't retry on last attempt
      if (i === maxRetries - 1) {
        throw error;
      }

      // Exponential backoff
      const delay = baseDelay * Math.pow(2, i);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

export interface PackageInfo {
  name: string;
  latestVersion: string;
  description?: string;
  homepage?: string;
  publishedAt?: string;
  registry: string;
}

export interface RegistryClient {
  getLatestVersion(packageName: string): Promise<string>;
  getPackageInfo(packageName: string): Promise<PackageInfo>;
}

// Cache TTL for registry lookups; set REGISTRY_CACHE_TTL_MS=0 to disable caching.
const REGISTRY_CACHE_TTL_MS = parseInt(process.env.REGISTRY_CACHE_TTL_MS || '300000', 10);

/**
 * Wraps a RegistryClient with response caching so repeated lookups (batch checks,
 * project scans, multiple tools touching the same package) don't hammer the
 * registry. Only successful results are cached; errors propagate uncached so a
 * transient failure or a not-found is never memoized.
 */
export class CachingRegistryClient implements RegistryClient {
  constructor(
    private readonly inner: RegistryClient,
    private readonly registry: string
  ) {}

  async getLatestVersion(packageName: string): Promise<string> {
    const key = getCacheKey(this.registry, packageName, 'version');
    if (REGISTRY_CACHE_TTL_MS > 0) {
      const cached = packageCache.get(key);
      if (cached !== null) return cached as string;
    }
    const value = await this.inner.getLatestVersion(packageName);
    if (REGISTRY_CACHE_TTL_MS > 0) packageCache.set(key, value, REGISTRY_CACHE_TTL_MS);
    return value;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const key = getCacheKey(this.registry, packageName, 'info');
    if (REGISTRY_CACHE_TTL_MS > 0) {
      const cached = packageCache.get(key);
      if (cached !== null) return cached as PackageInfo;
    }
    const value = await this.inner.getPackageInfo(packageName);
    if (REGISTRY_CACHE_TTL_MS > 0) packageCache.set(key, value, REGISTRY_CACHE_TTL_MS);
    return value;
  }
}

export class NpmRegistryClient implements RegistryClient {
  private baseUrl = 'https://registry.npmjs.org';

  async getLatestVersion(packageName: string): Promise<string> {
    const url = `${this.baseUrl}/${packageName}/latest`;
    const response = await retryWithBackoff(() => fetch(url));
    if (!response.ok) {
      throw new EnhancedRegistryError(
        `Package not found. Verify the package name exists on npm registry.`,
        'npm',
        packageName,
        url,
        response.status
      );
    }
    const data = await response.json() as any;
    return data.version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const url = `${this.baseUrl}/${packageName}/latest`;
    const response = await retryWithBackoff(() => fetch(url));
    if (!response.ok) {
      throw new EnhancedRegistryError(
        `Package not found. Verify the package name exists on npm registry.`,
        'npm',
        packageName,
        url,
        response.status
      );
    }
    const data = await response.json() as any;

    return {
      name: data.name,
      latestVersion: data.version,
      description: data.description,
      homepage: data.homepage,
      publishedAt: data.time?.[data.version],
      registry: 'npm'
    };
  }
}

export class PyPIRegistryClient implements RegistryClient {
  private baseUrl = 'https://pypi.org/pypi';

  async getLatestVersion(packageName: string): Promise<string> {
    const url = `${this.baseUrl}/${packageName}/json`;
    const response = await retryWithBackoff(() => fetch(url));
    if (!response.ok) {
      throw new EnhancedRegistryError(
        `Package not found. Check if the package name is correct and available on PyPI.`,
        'pypi',
        packageName,
        url,
        response.status
      );
    }
    const data = await response.json() as any;
    return data.info.version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const url = `${this.baseUrl}/${packageName}/json`;
    const response = await retryWithBackoff(() => fetch(url));
    if (!response.ok) {
      throw new EnhancedRegistryError(
        `Package not found. Check if the package name is correct and available on PyPI.`,
        'pypi',
        packageName,
        url,
        response.status
      );
    }
    const data = await response.json() as any;

    return {
      name: data.info.name,
      latestVersion: data.info.version,
      description: data.info.summary,
      homepage: data.info.home_page || data.info.project_url,
      registry: 'pypi'
    };
  }
}

export class MavenRegistryClient implements RegistryClient {
  private baseUrl = 'https://search.maven.org/solrsearch/select';

  async getLatestVersion(packageName: string): Promise<string> {
    const [groupId, artifactId] = this.parseCoordinates(packageName);
    const url = `${this.baseUrl}?q=g:"${groupId}"+AND+a:"${artifactId}"&rows=1&wt=json`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new EnhancedRegistryError(
        `Failed to query Maven Central. Check network connection or try again later.`,
        'maven',
        packageName,
        url,
        response.status
      );
    }
    const data = await response.json() as any;
    if (data.response.numFound === 0) {
      throw new EnhancedRegistryError(
        `Artifact not found. Verify groupId:artifactId format is correct and exists on Maven Central.`,
        'maven',
        packageName,
        url
      );
    }
    return data.response.docs[0].latestVersion;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const [groupId, artifactId] = this.parseCoordinates(packageName);
    const url = `${this.baseUrl}?q=g:"${groupId}"+AND+a:"${artifactId}"&rows=1&wt=json`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new EnhancedRegistryError(
        `Failed to query Maven Central. Check network connection or try again later.`,
        'maven',
        packageName,
        url,
        response.status
      );
    }
    const data = await response.json() as any;
    if (data.response.numFound === 0) {
      throw new EnhancedRegistryError(
        `Artifact not found. Verify groupId:artifactId format is correct and exists on Maven Central.`,
        'maven',
        packageName,
        url
      );
    }

    const doc = data.response.docs[0];
    return {
      name: `${doc.g}:${doc.a}`,
      latestVersion: doc.latestVersion,
      registry: 'maven'
    };
  }

  private parseCoordinates(packageName: string): [string, string] {
    const parts = packageName.split(':');
    if (parts.length !== 2) {
      throw new Error('Maven package must be in format groupId:artifactId');
    }
    return [parts[0], parts[1]];
  }
}

export class CratesIORegistryClient implements RegistryClient {
  private baseUrl = 'https://crates.io/api/v1';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/crates/${packageName}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    return data.crate.newest_version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(`${this.baseUrl}/crates/${packageName}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;

    return {
      name: data.crate.name,
      latestVersion: data.crate.newest_version,
      description: data.crate.description,
      homepage: data.crate.homepage,
      registry: 'crates.io'
    };
  }
}

export class RubyGemsRegistryClient implements RegistryClient {
  private baseUrl = 'https://rubygems.org/api/v1';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/gems/${packageName}.json`);
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    return data.version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(`${this.baseUrl}/gems/${packageName}.json`);
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;

    return {
      name: data.name,
      latestVersion: data.version,
      description: data.info,
      homepage: data.homepage_uri,
      registry: 'rubygems'
    };
  }
}

export class GoModulesRegistryClient implements RegistryClient {
  private baseUrl = 'https://proxy.golang.org';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/${packageName}/@latest`);
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    return data.Version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(`${this.baseUrl}/${packageName}/@latest`);
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;

    return {
      name: packageName,
      latestVersion: data.Version,
      publishedAt: data.Time,
      registry: 'go'
    };
  }
}

export class GitHubRegistryClient implements RegistryClient {
  private baseUrl = 'https://api.github.com';

  async getLatestVersion(packageName: string): Promise<string> {
    const [owner, repo] = this.parseRepoName(packageName);
    const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/releases/latest`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Repository or release not found: ${packageName}`);
    }
    const data = await response.json() as any;
    return data.tag_name;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const [owner, repo] = this.parseRepoName(packageName);
    const [repoResponse, releaseResponse] = await Promise.all([
      fetch(`${this.baseUrl}/repos/${owner}/${repo}`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'use-latest-version-mcp-server'
        }
      }),
      fetch(`${this.baseUrl}/repos/${owner}/${repo}/releases/latest`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'use-latest-version-mcp-server'
        }
      })
    ]);

    if (!repoResponse.ok) {
      throw new Error(`Repository not found: ${packageName}`);
    }

    const repoData = await repoResponse.json() as any;
    let latestVersion = 'No releases found';
    let publishedAt = undefined;

    if (releaseResponse.ok) {
      const releaseData = await releaseResponse.json() as any;
      latestVersion = releaseData.tag_name;
      publishedAt = releaseData.published_at;
    }

    return {
      name: repoData.full_name,
      latestVersion,
      description: repoData.description,
      homepage: repoData.html_url,
      publishedAt,
      registry: 'github'
    };
  }

  private parseRepoName(packageName: string): [string, string] {
    const parts = packageName.split('/');
    if (parts.length !== 2) {
      throw new Error('GitHub repository must be in format owner/repo');
    }
    return [parts[0], parts[1]];
  }
}

export class DockerHubRegistryClient implements RegistryClient {
  private baseUrl = 'https://hub.docker.com/v2';

  async getLatestVersion(packageName: string): Promise<string> {
    const [namespace, repository] = this.parseImageName(packageName);
    const response = await fetch(
      `${this.baseUrl}/repositories/${namespace}/${repository}/tags?page_size=100`
    );
    if (!response.ok) {
      throw new Error(`Image not found: ${packageName}`);
    }
    const data = await response.json() as any;

    const latestTag = data.results.find((tag: any) => tag.name === 'latest');
    if (latestTag) {
      return 'latest';
    }

    const tags = data.results
      .filter((tag: any) => /^\d+\.\d+(\.\d+)?$/.test(tag.name))
      .sort((a: any, b: any) => {
        const aDate = new Date(a.last_updated);
        const bDate = new Date(b.last_updated);
        return bDate.getTime() - aDate.getTime();
      });

    return tags[0]?.name || data.results[0]?.name || 'unknown';
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const [namespace, repository] = this.parseImageName(packageName);
    const [repoResponse, tagsResponse] = await Promise.all([
      fetch(`${this.baseUrl}/repositories/${namespace}/${repository}`),
      fetch(`${this.baseUrl}/repositories/${namespace}/${repository}/tags?page_size=100`)
    ]);

    if (!repoResponse.ok) {
      throw new Error(`Image not found: ${packageName}`);
    }

    const repoData = await repoResponse.json() as any;
    const tagsData = tagsResponse.ok ? await tagsResponse.json() as any : null;

    let latestVersion = 'unknown';
    let publishedAt = undefined;

    if (tagsData) {
      const latestTag = tagsData.results.find((tag: any) => tag.name === 'latest');
      if (latestTag) {
        latestVersion = 'latest';
        publishedAt = latestTag.last_updated;
      } else {
        const tags = tagsData.results
          .filter((tag: any) => /^\d+\.\d+(\.\d+)?$/.test(tag.name))
          .sort((a: any, b: any) => {
            const aDate = new Date(a.last_updated);
            const bDate = new Date(b.last_updated);
            return bDate.getTime() - aDate.getTime();
          });

        if (tags[0]) {
          latestVersion = tags[0].name;
          publishedAt = tags[0].last_updated;
        }
      }
    }

    return {
      name: `${namespace}/${repository}`,
      latestVersion,
      description: repoData.description,
      registry: 'dockerhub',
      publishedAt
    };
  }

  private parseImageName(packageName: string): [string, string] {
    const parts = packageName.split('/');
    if (parts.length === 1) {
      return ['library', parts[0]];
    } else if (parts.length === 2) {
      return [parts[0], parts[1]];
    }
    throw new Error('Docker image must be in format [namespace/]repository');
  }
}

export class GitLabRegistryClient implements RegistryClient {
  private baseUrl = 'https://gitlab.com/api/v4';

  async getLatestVersion(packageName: string): Promise<string> {
    const encodedPath = encodeURIComponent(packageName);
    const response = await fetch(`${this.baseUrl}/projects/${encodedPath}/releases`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Project or release not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (data.length === 0) {
      throw new Error(`No releases found for: ${packageName}`);
    }
    return data[0].tag_name;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const encodedPath = encodeURIComponent(packageName);
    const [projectResponse, releasesResponse] = await Promise.all([
      fetch(`${this.baseUrl}/projects/${encodedPath}`, {
        headers: {
          'User-Agent': 'use-latest-version-mcp-server'
        }
      }),
      fetch(`${this.baseUrl}/projects/${encodedPath}/releases`, {
        headers: {
          'User-Agent': 'use-latest-version-mcp-server'
        }
      })
    ]);

    if (!projectResponse.ok) {
      throw new Error(`Project not found: ${packageName}`);
    }

    const projectData = await projectResponse.json() as any;
    let latestVersion = 'No releases found';
    let publishedAt = undefined;

    if (releasesResponse.ok) {
      const releasesData = await releasesResponse.json() as any;
      if (releasesData.length > 0) {
        latestVersion = releasesData[0].tag_name;
        publishedAt = releasesData[0].released_at;
      }
    }

    return {
      name: projectData.path_with_namespace,
      latestVersion,
      description: projectData.description,
      homepage: projectData.web_url,
      publishedAt,
      registry: 'gitlab'
    };
  }
}

export class AURRegistryClient implements RegistryClient {
  private baseUrl = 'https://aur.archlinux.org/rpc';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}?v=5&type=info&arg=${encodeURIComponent(packageName)}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (data.resultcount === 0) {
      throw new Error(`Package not found: ${packageName}`);
    }
    return data.results[0].Version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(`${this.baseUrl}?v=5&type=info&arg=${encodeURIComponent(packageName)}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (data.resultcount === 0) {
      throw new Error(`Package not found: ${packageName}`);
    }

    const pkg = data.results[0];
    return {
      name: pkg.Name,
      latestVersion: pkg.Version,
      description: pkg.Description,
      homepage: pkg.URL,
      publishedAt: pkg.LastModified ? new Date(pkg.LastModified * 1000).toISOString() : undefined,
      registry: 'aur'
    };
  }
}

export class SnapStoreRegistryClient implements RegistryClient {
  private baseUrl = 'https://api.snapcraft.io/v2/snaps/info';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/${encodeURIComponent(packageName)}`, {
      headers: {
        'Snap-Device-Series': '16',
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;

    const stableChannel = data['channel-map'].find((ch: any) =>
      ch.channel.name === 'stable' || ch.channel.risk === 'stable'
    );

    if (!stableChannel) {
      throw new Error(`No stable channel found for: ${packageName}`);
    }

    return stableChannel.version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(`${this.baseUrl}/${encodeURIComponent(packageName)}`, {
      headers: {
        'Snap-Device-Series': '16',
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;

    const stableChannel = data['channel-map'].find((ch: any) =>
      ch.channel.name === 'stable' || ch.channel.risk === 'stable'
    );

    if (!stableChannel) {
      throw new Error(`No stable channel found for: ${packageName}`);
    }

    return {
      name: data.snap.name,
      latestVersion: stableChannel.version,
      description: data.snap.summary,
      homepage: data.snap.website,
      publishedAt: stableChannel['released-at'],
      registry: 'snap'
    };
  }
}

export class FlatpakRegistryClient implements RegistryClient {
  private baseUrl = 'https://flathub.org/api/v2/appstream';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/${encodeURIComponent(packageName)}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Application not found: ${packageName}`);
    }
    const data = await response.json() as any;

    if (!data.releases || data.releases.length === 0 || !data.releases[0].version) {
      throw new Error(`No version information available for: ${packageName}`);
    }

    return data.releases[0].version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(`${this.baseUrl}/${encodeURIComponent(packageName)}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Application not found: ${packageName}`);
    }
    const data = await response.json() as any;

    if (!data.releases || data.releases.length === 0 || !data.releases[0].version) {
      throw new Error(`No version information available for: ${packageName}`);
    }

    return {
      name: data.id || packageName,
      latestVersion: data.releases[0].version,
      description: data.summary,
      homepage: data.urls?.homepage,
      publishedAt: data.releases[0]?.timestamp,
      registry: 'flatpak'
    };
  }
}

export class GradlePluginRegistryClient implements RegistryClient {
  private baseUrl = 'https://plugins.gradle.org';

  async getLatestVersion(packageName: string): Promise<string> {
    const url = `${this.baseUrl}/plugin/${encodeURIComponent(packageName)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Plugin not found: ${packageName}`);
    }
    const text = await response.text();
    // Extract version from HTML: <h3>Version 0.53.0  (latest) </h3> or <h3>Version 2.3.20-Beta2  (latest) </h3>
    const versionMatch = text.match(/<h3>Version\s+([\d.]+(?:-[\w.]+)?)\s+\(latest\)/);
    if (!versionMatch) {
      throw new Error(`Could not extract version from response for: ${packageName}`);
    }
    return versionMatch[1];
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const url = `${this.baseUrl}/plugin/${encodeURIComponent(packageName)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Plugin not found: ${packageName}`);
    }
    const text = await response.text();
    
    // Extract version (handles versions like 0.53.0 or 2.3.20-Beta2)
    const versionMatch = text.match(/<h3>Version\s+([\d.]+(?:-[\w.]+)?)\s+\(latest\)/);
    if (!versionMatch) {
      throw new Error(`Could not extract version from response for: ${packageName}`);
    }
    
    // Extract description
    const descMatch = text.match(/<span id="plugin-version-description"[^>]*>([^<]+)<\/span>/);
    
    // Extract website
    const websiteMatch = text.match(/<a id="website" href="([^"]+)">/);

    return {
      name: packageName,
      latestVersion: versionMatch[1],
      description: descMatch ? descMatch[1].trim() : undefined,
      homepage: websiteMatch ? websiteMatch[1] : url,
      registry: 'gradle'
    };
  }
}

export class TerraformRegistryClient implements RegistryClient {
  private baseUrl = 'https://registry.terraform.io/v1';

  async getLatestVersion(packageName: string): Promise<string> {
    const [namespace, name, provider] = this.parseModuleName(packageName);
    const response = await fetch(`${this.baseUrl}/modules/${namespace}/${name}/${provider}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Module not found: ${packageName}`);
    }
    const data = await response.json() as any;
    return data.version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const [namespace, name, provider] = this.parseModuleName(packageName);
    const response = await fetch(`${this.baseUrl}/modules/${namespace}/${name}/${provider}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Module not found: ${packageName}`);
    }
    const data = await response.json() as any;

    return {
      name: `${namespace}/${name}/${provider}`,
      latestVersion: data.version,
      description: data.description,
      publishedAt: data.published_at,
      registry: 'terraform'
    };
  }

  private parseModuleName(packageName: string): [string, string, string] {
    const parts = packageName.split('/');
    if (parts.length !== 3) {
      throw new Error(`Terraform module must be in format namespace/name/provider (e.g., terraform-aws-modules/vpc/aws). Got: ${packageName}`);
    }
    return [parts[0], parts[1], parts[2]];
  }
}

export class AnsibleGalaxyRegistryClient implements RegistryClient {
  private baseUrl = 'https://galaxy.ansible.com/api';

  async getLatestVersion(packageName: string): Promise<string> {
    const [namespace, name] = this.parseCollectionName(packageName);
    const response = await fetch(`${this.baseUrl}/v3/plugin/ansible/content/published/collections/index/${namespace}/${name}/`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Collection not found: ${packageName}`);
    }
    const data = await response.json() as any;
    return data.highest_version.version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const [namespace, name] = this.parseCollectionName(packageName);
    const response = await fetch(`${this.baseUrl}/v3/plugin/ansible/content/published/collections/index/${namespace}/${name}/`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Collection not found: ${packageName}`);
    }
    const data = await response.json() as any;

    return {
      name: `${data.namespace}.${data.name}`,
      latestVersion: data.highest_version.version,
      description: data.description || '',
      homepage: `https://galaxy.ansible.com/${data.namespace}/${data.name}`,
      registry: 'ansible'
    };
  }

  private parseCollectionName(packageName: string): [string, string] {
    const parts = packageName.split('.');
    if (parts.length !== 2) {
      throw new Error(`Ansible collection must be in format namespace.name (e.g., community.general). Got: ${packageName}`);
    }
    return [parts[0], parts[1]];
  }
}

export class CRANRegistryClient implements RegistryClient {
  private baseUrl = 'https://crandb.r-pkg.org';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/${packageName}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    return data.Version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(`${this.baseUrl}/${packageName}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;

    return {
      name: data.Package,
      latestVersion: data.Version,
      description: data.Title,
      homepage: data.URL,
      registry: 'cran'
    };
  }
}

export class ChocolateyRegistryClient implements RegistryClient {
  private baseUrl = 'https://community.chocolatey.org/api/v2';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(
      `${this.baseUrl}/Packages()?$filter=Id eq '${packageName}' and IsLatestVersion`,
      {
        headers: {
          'User-Agent': 'use-latest-version-mcp-server'
        }
      }
    );
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const text = await response.text();
    const versionMatch = text.match(/<d:Version>([^<]+)<\/d:Version>/);
    if (!versionMatch) {
      throw new Error(`Could not extract version from response for: ${packageName}`);
    }
    return versionMatch[1];
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(
      `${this.baseUrl}/Packages()?$filter=Id eq '${packageName}' and IsLatestVersion`,
      {
        headers: {
          'User-Agent': 'use-latest-version-mcp-server'
        }
      }
    );
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const text = await response.text();
    const versionMatch = text.match(/<d:Version>([^<]+)<\/d:Version>/);
    const descMatch = text.match(/<d:Description>([^<]+)<\/d:Description>/);
    const urlMatch = text.match(/<d:ProjectUrl>([^<]+)<\/d:ProjectUrl>/);
    
    if (!versionMatch) {
      throw new Error(`Could not extract version from response for: ${packageName}`);
    }

    return {
      name: packageName,
      latestVersion: versionMatch[1],
      description: descMatch ? descMatch[1] : '',
      homepage: urlMatch ? urlMatch[1] : '',
      publishedAt: '',
      registry: 'chocolatey'
    };
  }
}

export class CPANRegistryClient implements RegistryClient {
  private baseUrl = 'https://fastapi.metacpan.org/v1';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/release/${packageName}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    return data.version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(`${this.baseUrl}/release/${packageName}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;

    return {
      name: data.distribution,
      latestVersion: data.version,
      description: data.abstract,
      homepage: data.resources?.homepage,
      publishedAt: data.date,
      registry: 'cpan'
    };
  }
}

export class ClojarsRegistryClient implements RegistryClient {
  private baseUrl = 'https://clojars.org/api';

  async getLatestVersion(packageName: string): Promise<string> {
    const [group, artifact] = this.parseCoordinates(packageName);
    const response = await fetch(`${this.baseUrl}/artifacts/${group}/${artifact}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    return data.latest_version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const [group, artifact] = this.parseCoordinates(packageName);
    const response = await fetch(`${this.baseUrl}/artifacts/${group}/${artifact}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;

    return {
      name: `${group}/${artifact}`,
      latestVersion: data.latest_version,
      description: data.description,
      homepage: data.homepage,
      registry: 'clojars'
    };
  }

  private parseCoordinates(packageName: string): [string, string] {
    const parts = packageName.split('/');
    if (parts.length === 1) {
      return [parts[0], parts[0]];
    } else if (parts.length === 2) {
      return [parts[0], parts[1]];
    }
    throw new Error('Clojars package must be in format group/artifact or artifact');
  }
}


export class NuGetRegistryClient implements RegistryClient {
  private baseUrl = 'https://api.nuget.org';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await retryWithBackoff(() => fetch(`${this.baseUrl}/v3-flatcontainer/${packageName.toLowerCase()}/index.json`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    }));
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (!data.versions || data.versions.length === 0) {
      throw new Error(`No versions found for: ${packageName}`);
    }
    return data.versions[data.versions.length - 1];
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const [versionsResponse, packageResponse] = await Promise.all([
      retryWithBackoff(() => fetch(`${this.baseUrl}/v3-flatcontainer/${packageName.toLowerCase()}/index.json`, {
        headers: {
          'User-Agent': 'use-latest-version-mcp-server'
        }
      })),
      retryWithBackoff(() => fetch(`${this.baseUrl}/v3/registration5-gz-semver2/${packageName.toLowerCase()}/index.json`, {
        headers: {
          'User-Agent': 'use-latest-version-mcp-server'
        }
      }))
    ]);

    if (!versionsResponse.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }

    const versionsData = await versionsResponse.json() as any;
    if (!versionsData.versions || versionsData.versions.length === 0) {
      throw new Error(`No versions found for: ${packageName}`);
    }

    const latestVersion = versionsData.versions[versionsData.versions.length - 1];
    let description = undefined;
    let homepage = undefined;

    if (packageResponse.ok) {
      const packageData = await packageResponse.json() as any;
      if (packageData.items && packageData.items.length > 0) {
        const latestItem = packageData.items[packageData.items.length - 1];
        if (latestItem.items && latestItem.items.length > 0) {
          const catalogEntry = latestItem.items[latestItem.items.length - 1].catalogEntry;
          description = catalogEntry?.description;
          homepage = catalogEntry?.projectUrl;
        }
      }
    }

    return {
      name: packageName,
      latestVersion,
      description,
      homepage,
      registry: 'nuget'
    };
  }
}

export class PackagistRegistryClient implements RegistryClient {
  private baseUrl = 'https://repo.packagist.org';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/p2/${packageName}.json`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (!data.packages || !data.packages[packageName] || data.packages[packageName].length === 0) {
      throw new Error(`No versions found for: ${packageName}`);
    }
    return data.packages[packageName][0].version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(`${this.baseUrl}/p2/${packageName}.json`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (!data.packages || !data.packages[packageName] || data.packages[packageName].length === 0) {
      throw new Error(`No versions found for: ${packageName}`);
    }

    const latestPackage = data.packages[packageName][0];
    return {
      name: latestPackage.name,
      latestVersion: latestPackage.version,
      description: latestPackage.description,
      homepage: latestPackage.homepage,
      publishedAt: latestPackage.time,
      registry: 'packagist'
    };
  }
}

export class HomebrewRegistryClient implements RegistryClient {
  private baseUrl = 'https://formulae.brew.sh/api';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/formula/${packageName}.json`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Formula not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (!data.versions || !data.versions.stable) {
      throw new Error(`No stable version found for: ${packageName}`);
    }
    return data.versions.stable;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(`${this.baseUrl}/formula/${packageName}.json`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Formula not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (!data.versions || !data.versions.stable) {
      throw new Error(`No stable version found for: ${packageName}`);
    }

    return {
      name: data.name,
      latestVersion: data.versions.stable,
      description: data.desc,
      homepage: data.homepage,
      registry: 'homebrew'
    };
  }
}

export class PubDevRegistryClient implements RegistryClient {
  private baseUrl = 'https://pub.dev/api';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/packages/${packageName}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (!data.latest || !data.latest.version) {
      throw new Error(`No version found for: ${packageName}`);
    }
    return data.latest.version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(`${this.baseUrl}/packages/${packageName}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (!data.latest || !data.latest.version) {
      throw new Error(`No version found for: ${packageName}`);
    }

    const latest = data.latest;
    return {
      name: data.name,
      latestVersion: latest.version,
      description: latest.pubspec?.description,
      homepage: latest.pubspec?.homepage,
      publishedAt: latest.published,
      registry: 'pub.dev'
    };
  }
}

export class CocoaPodsRegistryClient implements RegistryClient {
  private baseUrl = 'https://trunk.cocoapods.org/api/v1';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/pods/${packageName}/specs/latest`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Pod not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (!data.version) {
      throw new Error(`No version found for: ${packageName}`);
    }
    return data.version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(`${this.baseUrl}/pods/${packageName}/specs/latest`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Pod not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (!data.version) {
      throw new Error(`No version found for: ${packageName}`);
    }

    return {
      name: data.name,
      latestVersion: data.version,
      description: data.summary,
      homepage: data.homepage,
      registry: 'cocoapods'
    };
  }
}

export class GitHubContainerRegistryClient implements RegistryClient {
  private baseUrl = 'https://api.github.com';

  async getLatestVersion(packageName: string): Promise<string> {
    const [owner, packageNameOnly] = this.parsePackageName(packageName);
    const response = await fetch(
      `${this.baseUrl}/users/${owner}/packages/container/${packageNameOnly}/versions`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'use-latest-version-mcp-server'
        }
      }
    );
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(`GitHub Container Registry requires authentication. Please set GITHUB_TOKEN environment variable. Package: ${packageName}`);
      }
      throw new Error(`Container package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (data.length === 0) {
      throw new Error(`No versions found for: ${packageName}`);
    }

    const latestVersion = data[0];
    const tags = latestVersion.metadata?.container?.tags || [];

    if (tags.includes('latest')) {
      return 'latest';
    }

    const semverTags = tags.filter((tag: string) => /^\d+\.\d+(\.\d+)?$/.test(tag));
    return semverTags[0] || tags[0] || 'unknown';
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const [owner, packageNameOnly] = this.parsePackageName(packageName);
    const response = await fetch(
      `${this.baseUrl}/users/${owner}/packages/container/${packageNameOnly}/versions`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'use-latest-version-mcp-server'
        }
      }
    );
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(`GitHub Container Registry requires authentication. Please set GITHUB_TOKEN environment variable. Package: ${packageName}`);
      }
      throw new Error(`Container package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (data.length === 0) {
      throw new Error(`No versions found for: ${packageName}`);
    }

    const latestVersion = data[0];
    const tags = latestVersion.metadata?.container?.tags || [];

    let version = 'unknown';
    if (tags.includes('latest')) {
      version = 'latest';
    } else {
      const semverTags = tags.filter((tag: string) => /^\d+\.\d+(\.\d+)?$/.test(tag));
      version = semverTags[0] || tags[0] || 'unknown';
    }

    return {
      name: `${owner}/${packageNameOnly}`,
      latestVersion: version,
      publishedAt: latestVersion.created_at,
      registry: 'ghcr.io'
    };
  }

  private parsePackageName(packageName: string): [string, string] {
    const parts = packageName.split('/');
    if (parts.length === 1) {
      throw new Error('GitHub Container Registry package must be in format owner/package');
    } else if (parts.length === 2) {
      return [parts[0], parts[1]];
    }
    throw new Error('GitHub Container Registry package must be in format owner/package');
  }
}

export class QuayIORegistryClient implements RegistryClient {
  private baseUrl = 'https://quay.io/api/v1';

  async getLatestVersion(packageName: string): Promise<string> {
    const [namespace, repository] = this.parseImageName(packageName);
    const response = await fetch(
      `${this.baseUrl}/repository/${namespace}/${repository}/tag/?limit=100`,
      {
        headers: {
          'User-Agent': 'use-latest-version-mcp-server'
        }
      }
    );
    if (!response.ok) {
      throw new Error(`Image not found: ${packageName}`);
    }
    const data = await response.json() as any;

    if (!data.tags || data.tags.length === 0) {
      throw new Error(`No tags found for: ${packageName}`);
    }

    const latestTag = data.tags.find((tag: any) => tag.name === 'latest');
    if (latestTag) {
      return 'latest';
    }

    const tags = data.tags
      .filter((tag: any) => /^\d+\.\d+(\.\d+)?$/.test(tag.name))
      .sort((a: any, b: any) => {
        const aDate = new Date(a.last_modified);
        const bDate = new Date(b.last_modified);
        return bDate.getTime() - aDate.getTime();
      });

    return tags[0]?.name || data.tags[0]?.name || 'unknown';
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const [namespace, repository] = this.parseImageName(packageName);
    const [repoResponse, tagsResponse] = await Promise.all([
      fetch(`${this.baseUrl}/repository/${namespace}/${repository}`, {
        headers: {
          'User-Agent': 'use-latest-version-mcp-server'
        }
      }),
      fetch(`${this.baseUrl}/repository/${namespace}/${repository}/tag/?limit=100`, {
        headers: {
          'User-Agent': 'use-latest-version-mcp-server'
        }
      })
    ]);

    if (!repoResponse.ok) {
      throw new Error(`Image not found: ${packageName}`);
    }

    const repoData = await repoResponse.json() as any;
    const tagsData = tagsResponse.ok ? await tagsResponse.json() as any : null;

    let latestVersion = 'unknown';
    let publishedAt = undefined;

    if (tagsData && tagsData.tags && tagsData.tags.length > 0) {
      const latestTag = tagsData.tags.find((tag: any) => tag.name === 'latest');
      if (latestTag) {
        latestVersion = 'latest';
        publishedAt = latestTag.last_modified;
      } else {
        const tags = tagsData.tags
          .filter((tag: any) => /^\d+\.\d+(\.\d+)?$/.test(tag.name))
          .sort((a: any, b: any) => {
            const aDate = new Date(a.last_modified);
            const bDate = new Date(b.last_modified);
            return bDate.getTime() - aDate.getTime();
          });

        if (tags[0]) {
          latestVersion = tags[0].name;
          publishedAt = tags[0].last_modified;
        }
      }
    }

    return {
      name: `${namespace}/${repository}`,
      latestVersion,
      description: repoData.description,
      registry: 'quay.io',
      publishedAt
    };
  }

  private parseImageName(packageName: string): [string, string] {
    const parts = packageName.split('/');
    if (parts.length !== 2) {
      throw new Error('Quay.io image must be in format namespace/repository');
    }
    return [parts[0], parts[1]];
  }
}

export class GCRRegistryClient implements RegistryClient {
  private baseUrl = 'https://gcr.io/v2';

  async getLatestVersion(packageName: string): Promise<string> {
    const [project, image] = this.parseImageName(packageName);
    const response = await fetch(`${this.baseUrl}/${project}/${image}/tags/list`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Image not found: ${packageName}`);
    }
    const data = await response.json() as any;

    if (!data.tags || data.tags.length === 0) {
      throw new Error(`No tags found for: ${packageName}`);
    }

    if (data.tags.includes('latest')) {
      return 'latest';
    }

    const semverTags = data.tags
      .filter((tag: string) => /^\d+\.\d+(\.\d+)?$/.test(tag))
      .sort((a: string, b: string) => {
        const parseVersion = (v: string) => v.split('.').map(n => parseInt(n, 10));
        const aParts = parseVersion(a);
        const bParts = parseVersion(b);

        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const aVal = aParts[i] || 0;
          const bVal = bParts[i] || 0;
          if (bVal !== aVal) return bVal - aVal;
        }
        return 0;
      });

    return semverTags[0] || data.tags[0] || 'unknown';
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const [project, image] = this.parseImageName(packageName);
    const response = await fetch(`${this.baseUrl}/${project}/${image}/tags/list`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Image not found: ${packageName}`);
    }
    const data = await response.json() as any;

    let latestVersion = 'unknown';

    if (data.tags && data.tags.length > 0) {
      if (data.tags.includes('latest')) {
        latestVersion = 'latest';
      } else {
        const semverTags = data.tags
          .filter((tag: string) => /^\d+\.\d+(\.\d+)?$/.test(tag))
          .sort((a: string, b: string) => {
            const parseVersion = (v: string) => v.split('.').map(n => parseInt(n, 10));
            const aParts = parseVersion(a);
            const bParts = parseVersion(b);

            for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
              const aVal = aParts[i] || 0;
              const bVal = bParts[i] || 0;
              if (bVal !== aVal) return bVal - aVal;
            }
            return 0;
          });

        latestVersion = semverTags[0] || data.tags[0] || 'unknown';
      }
    }

    return {
      name: `${project}/${image}`,
      latestVersion,
      registry: 'gcr.io'
    };
  }

  private parseImageName(packageName: string): [string, string] {
    const parts = packageName.split('/');
    if (parts.length !== 2) {
      throw new Error('GCR image must be in format project/image');
    }
    return [parts[0], parts[1]];
  }
}


export class SwiftPackageRegistryClient implements RegistryClient {
  private baseUrl = 'https://api.github.com';

  async getLatestVersion(packageName: string): Promise<string> {
    const [owner, repo] = this.parsePackageName(packageName);
    const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/releases/latest`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Swift package or release not found: ${packageName}`);
    }
    const data = await response.json() as any;
    return data.tag_name;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const [owner, repo] = this.parsePackageName(packageName);
    const [repoResponse, releaseResponse] = await Promise.all([
      fetch(`${this.baseUrl}/repos/${owner}/${repo}`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'use-latest-version-mcp-server'
        }
      }),
      fetch(`${this.baseUrl}/repos/${owner}/${repo}/releases/latest`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'use-latest-version-mcp-server'
        }
      })
    ]);

    if (!repoResponse.ok) {
      throw new Error(`Swift package not found: ${packageName}`);
    }

    const repoData = await repoResponse.json() as any;
    let latestVersion = 'No releases found';
    let publishedAt = undefined;

    if (releaseResponse.ok) {
      const releaseData = await releaseResponse.json() as any;
      latestVersion = releaseData.tag_name;
      publishedAt = releaseData.published_at;
    }

    return {
      name: repoData.full_name,
      latestVersion,
      description: repoData.description,
      homepage: repoData.html_url,
      publishedAt,
      registry: 'swift'
    };
  }

  private parsePackageName(packageName: string): [string, string] {
    let cleanedName = packageName.trim();
    cleanedName = cleanedName.replace(/^https?:\/\//, '');
    cleanedName = cleanedName.replace(/^github\.com\//, '');
    cleanedName = cleanedName.replace(/\.git$/, '');

    const parts = cleanedName.split('/');
    if (parts.length !== 2) {
      throw new Error('Swift package must be in format github.com/owner/repo or owner/repo');
    }
    return [parts[0], parts[1]];
  }
}

export class HackageRegistryClient implements RegistryClient {
  private baseUrl = 'https://hackage.haskell.org';

  async getLatestVersion(packageName: string): Promise<string> {
    const url = `${this.baseUrl}/package/${packageName}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new EnhancedRegistryError(
        `Package not found. Verify the package name exists on Hackage.`,
        'hackage',
        packageName,
        url,
        response.status
      );
    }
    const text = await response.text();
    // Extract version from package page HTML: aeson-2.2.3.0
    const versionMatch = text.match(new RegExp(`${packageName}-(\\d+\\.\\d+\\.\\d+\\.\\d+)`));
    if (!versionMatch) {
      throw new EnhancedRegistryError(
        `Could not parse version from package page. The package may have an unexpected format.`,
        'hackage',
        packageName,
        url
      );
    }
    return versionMatch[1];
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const versionUrl = `${this.baseUrl}/package/${packageName}/preferred`;
    const versionResponse = await fetch(versionUrl, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!versionResponse.ok) {
      throw new EnhancedRegistryError(
        `Package not found. Verify the package name exists on Hackage.`,
        'hackage',
        packageName,
        versionUrl,
        versionResponse.status
      );
    }
    const versionText = await versionResponse.text();
    const versionMatch = versionText.match(/"(.+?)"/);
    if (!versionMatch) {
      throw new EnhancedRegistryError(
        `Could not parse version information. The package may have an unexpected format.`,
        'hackage',
        packageName,
        versionUrl
      );
    }
    const latestVersion = versionMatch[1];

    const infoResponse = await fetch(`${this.baseUrl}/package/${packageName}-${latestVersion}/${packageName}.cabal`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });

    let description = undefined;
    let homepage = undefined;

    if (infoResponse.ok) {
      const cabalText = await infoResponse.text();
      const descMatch = cabalText.match(/^description:\s*(.+?)$/im);
      const homeMatch = cabalText.match(/^homepage:\s*(.+?)$/im);

      if (descMatch) {
        description = descMatch[1].trim();
      }
      if (homeMatch) {
        homepage = homeMatch[1].trim();
      }
    }

    return {
      name: packageName,
      latestVersion,
      description,
      homepage: homepage || `${this.baseUrl}/package/${packageName}`,
      registry: 'hackage'
    };
  }
}

export class DubRegistryClient implements RegistryClient {
  private baseUrl = 'https://code.dlang.org/api';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/packages/${packageName}/latest`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    return data.version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const [latestResponse, infoResponse] = await Promise.all([
      fetch(`${this.baseUrl}/packages/${packageName}/latest`, {
        headers: {
          'User-Agent': 'use-latest-version-mcp-server'
        }
      }),
      fetch(`${this.baseUrl}/packages/${packageName}/info`, {
        headers: {
          'User-Agent': 'use-latest-version-mcp-server'
        }
      })
    ]);

    if (!latestResponse.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }

    const latestData = await latestResponse.json() as any;
    let description = undefined;
    let homepage = undefined;

    if (infoResponse.ok) {
      const infoData = await infoResponse.json() as any;
      description = infoData.info?.description;
      homepage = infoData.info?.homepage;
    }

    return {
      name: packageName,
      latestVersion: latestData.version,
      description,
      homepage: homepage || `https://code.dlang.org/packages/${packageName}`,
      registry: 'dub'
    };
  }
}

export class LuaRocksRegistryClient implements RegistryClient {
  private baseUrl = 'https://luarocks.org';

  private parsePackageName(packageName: string): { manifest: string; name: string } {
    const parts = packageName.split('/');
    if (parts.length !== 2) {
      throw new EnhancedRegistryError(
        `Invalid package name format. Expected 'manifest/package' (e.g., 'luasocket/luasocket').`,
        'luarocks',
        packageName,
        `${this.baseUrl}/modules/${packageName}`
      );
    }
    return { manifest: parts[0], name: parts[1] };
  }

  private extractVersionFromHtml(html: string): string | null {
    // Look for version rows in the HTML
    // Pattern: <div class="version_row"><a href="/modules/manifest/package/version">version</a>
    // We need to skip versions with <span class="development_flag">dev</span>
    const versionRowRegex = /<div class="version_row">(.*?)<\/div>/gs;
    const matches = [...html.matchAll(versionRowRegex)];

    for (const match of matches) {
      const rowHtml = match[1];
      // Skip if this row has a development flag
      if (rowHtml.includes('class="development_flag"')) {
        continue;
      }
      // Extract version from the link
      const versionMatch = rowHtml.match(/<a[^>]*href="\/modules\/[^\/]+\/[^\/]+\/([^"]+)">([^<]+)<\/a>/);
      if (versionMatch) {
        return versionMatch[2];
      }
    }

    return null;
  }

  private extractDescriptionFromHtml(html: string): string | null {
    // Look for description in the HTML
    const descRegex = /<div class="module_description">\s*<p>([^<]+)<\/p>/s;
    const match = html.match(descRegex);
    return match ? match[1].trim() : null;
  }

  async getLatestVersion(packageName: string): Promise<string> {
    const { manifest, name } = this.parsePackageName(packageName);
    const url = `${this.baseUrl}/modules/${manifest}/${name}`;

    const response = await retryWithBackoff(() => fetch(url, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    }));

    if (!response.ok) {
      throw new EnhancedRegistryError(
        `Package not found. Verify the package name exists on LuaRocks.`,
        'luarocks',
        packageName,
        url,
        response.status
      );
    }

    const html = await response.text();
    const version = this.extractVersionFromHtml(html);

    if (!version) {
      throw new EnhancedRegistryError(
        `No versions found for package. The package page may have changed.`,
        'luarocks',
        packageName,
        url
      );
    }

    return version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const { manifest, name } = this.parsePackageName(packageName);
    const url = `${this.baseUrl}/modules/${manifest}/${name}`;

    const response = await retryWithBackoff(() => fetch(url, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    }));

    if (!response.ok) {
      throw new EnhancedRegistryError(
        `Package not found. Verify the package name exists on LuaRocks.`,
        'luarocks',
        packageName,
        url,
        response.status
      );
    }

    const html = await response.text();
    const latestVersion = this.extractVersionFromHtml(html);
    const description = this.extractDescriptionFromHtml(html);

    if (!latestVersion) {
      throw new EnhancedRegistryError(
        `No versions found for package. The package page may have changed.`,
        'luarocks',
        packageName,
        url
      );
    }

    return {
      name: packageName,
      latestVersion,
      description: description || undefined,
      homepage: url,
      registry: 'luarocks'
    };
  }
}

export class ElmPackagesRegistryClient implements RegistryClient {
  private baseUrl = 'https://package.elm-lang.org';

  private parsePackageName(packageName: string): [string, string] {
    const parts = packageName.split('/');
    if (parts.length !== 2) {
      throw new EnhancedRegistryError(
        `Invalid package name format. Expected 'author/package' (e.g., 'elm/browser').`,
        'elm',
        packageName,
        `${this.baseUrl}/packages/${packageName}`
      );
    }
    return [parts[0], parts[1]];
  }

  private getLatestVersionFromReleases(releases: Record<string, number>): string {
    // The releases.json returns an object with version numbers as keys
    // and timestamps as values. We need to find the latest version.
    const versions = Object.keys(releases);
    if (versions.length === 0) {
      throw new Error('No versions found');
    }
    // Sort versions semantically to find the latest
    return versions.sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aNum = aParts[i] || 0;
        const bNum = bParts[i] || 0;
        if (aNum !== bNum) {
          return bNum - aNum;
        }
      }
      return 0;
    })[0];
  }

  async getLatestVersion(packageName: string): Promise<string> {
    const [author, pkg] = this.parsePackageName(packageName);
    const url = `${this.baseUrl}/packages/${author}/${pkg}/releases.json`;
    const response = await retryWithBackoff(() => fetch(url, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    }));

    if (!response.ok) {
      throw new EnhancedRegistryError(
        `Package not found. Verify the package name exists on Elm package registry.`,
        'elm',
        packageName,
        url,
        response.status
      );
    }

    const data = await response.json() as Record<string, number>;

    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      throw new EnhancedRegistryError(
        `No versions found for package.`,
        'elm',
        packageName,
        url
      );
    }

    return this.getLatestVersionFromReleases(data);
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const [author, pkg] = this.parsePackageName(packageName);
    const releasesUrl = `${this.baseUrl}/packages/${author}/${pkg}/releases.json`;
    const docsUrl = `${this.baseUrl}/packages/${author}/${pkg}/latest/elm.json`;

    const [releasesResponse, docsResponse] = await Promise.all([
      retryWithBackoff(() => fetch(releasesUrl, {
        headers: {
          'User-Agent': 'use-latest-version-mcp-server'
        }
      })),
      retryWithBackoff(() => fetch(docsUrl, {
        headers: {
          'User-Agent': 'use-latest-version-mcp-server'
        }
      }))
    ]);

    if (!releasesResponse.ok) {
      throw new EnhancedRegistryError(
        `Package not found. Verify the package name exists on Elm package registry.`,
        'elm',
        packageName,
        releasesUrl,
        releasesResponse.status
      );
    }

    const releasesData = await releasesResponse.json() as Record<string, number>;

    if (!releasesData || typeof releasesData !== 'object' || Object.keys(releasesData).length === 0) {
      throw new EnhancedRegistryError(
        `No versions found for package.`,
        'elm',
        packageName,
        releasesUrl
      );
    }

    const latestVersion = this.getLatestVersionFromReleases(releasesData);
    let description = undefined;

    if (docsResponse.ok) {
      const docsData = await docsResponse.json() as any;
      description = docsData.summary;
    }

    return {
      name: `${author}/${pkg}`,
      latestVersion,
      description,
      homepage: `${this.baseUrl}/packages/${author}/${pkg}/latest`,
      registry: 'elm'
    };
  }
}

export class JSRRegistryClient implements RegistryClient {
  private baseUrl = 'https://jsr.io';

  async getLatestVersion(packageName: string): Promise<string> {
    const [scope, pkg] = this.parseScopedPackage(packageName);
    const response = await fetch(`${this.baseUrl}/@${scope}/${pkg}/meta.json`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (!data.latest) {
      throw new Error(`No version found for: ${packageName}`);
    }
    return data.latest;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const [scope, pkg] = this.parseScopedPackage(packageName);
    const response = await fetch(`${this.baseUrl}/@${scope}/${pkg}/meta.json`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const data = await response.json() as any;
    if (!data.latest) {
      throw new Error(`No version found for: ${packageName}`);
    }

    return {
      name: `@${scope}/${pkg}`,
      latestVersion: data.latest,
      description: data.description,
      homepage: data.github?.url || `${this.baseUrl}/@${scope}/${pkg}`,
      registry: 'jsr'
    };
  }

  private parseScopedPackage(packageName: string): [string, string] {
    let cleanName = packageName.trim();
    if (cleanName.startsWith('@')) {
      cleanName = cleanName.substring(1);
    }
    const parts = cleanName.split('/');
    if (parts.length !== 2) {
      throw new Error('JSR package must be in format @scope/package');
    }
    return [parts[0], parts[1]];
  }
}

export class CondaRegistryClient implements RegistryClient {
  private baseUrl = 'https://api.anaconda.org';
  private channels = ['conda-forge', 'anaconda'];

  async getLatestVersion(packageName: string): Promise<string> {
    for (const channel of this.channels) {
      try {
        const response = await fetch(`${this.baseUrl}/package/${channel}/${packageName}`, {
          headers: {
            'User-Agent': 'use-latest-version-mcp-server'
          }
        });
        if (response.ok) {
          const data = await response.json() as any;
          if (data.latest_version) {
            return data.latest_version;
          }
        }
      } catch (error) {
        continue;
      }
    }
    throw new Error(`Package not found in any conda channel: ${packageName}`);
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    for (const channel of this.channels) {
      try {
        const response = await fetch(`${this.baseUrl}/package/${channel}/${packageName}`, {
          headers: {
            'User-Agent': 'use-latest-version-mcp-server'
          }
        });
        if (response.ok) {
          const data = await response.json() as any;
          if (data.latest_version) {
            return {
              name: data.name || packageName,
              latestVersion: data.latest_version,
              description: data.summary || data.description,
              homepage: data.home || data.doc_url || `https://anaconda.org/${channel}/${packageName}`,
              registry: 'conda'
            };
          }
        }
      } catch (error) {
        continue;
      }
    }
    throw new Error(`Package not found in any conda channel: ${packageName}`);
  }
}

export class BioconductorRegistryClient implements RegistryClient {
  private baseUrl = 'https://bioconductor.org';
  private version = '3.18';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/packages/json/${this.version}/bioc/packages.json`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch Bioconductor packages list`);
    }
    const data = await response.json() as any;

    const packageInfo = data[packageName];
    if (!packageInfo || !packageInfo.Version) {
      throw new Error(`Package not found: ${packageName}`);
    }

    return packageInfo.Version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(`${this.baseUrl}/packages/json/${this.version}/bioc/packages.json`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch Bioconductor packages list`);
    }
    const data = await response.json() as any;

    const packageInfo = data[packageName];
    if (!packageInfo || !packageInfo.Version) {
      throw new Error(`Package not found: ${packageName}`);
    }

    return {
      name: packageName,
      latestVersion: packageInfo.Version,
      description: packageInfo.Title,
      homepage: `${this.baseUrl}/packages/release/bioc/html/${packageName}.html`,
      registry: 'bioconductor'
    };
  }
}

export class VSCodeExtensionsRegistryClient implements RegistryClient {
  private baseUrl = 'https://marketplace.visualstudio.com/_apis/public/gallery';

  async getLatestVersion(packageName: string): Promise<string> {
    const [publisher, extension] = this.parseExtensionName(packageName);
    const response = await fetch(`${this.baseUrl}/extensionquery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json;api-version=3.0-preview.1',
        'User-Agent': 'use-latest-version-mcp-server'
      },
      body: JSON.stringify({
        filters: [{
          criteria: [
            { filterType: 7, value: `${publisher}.${extension}` }
          ]
        }],
        flags: 914
      })
    });

    if (!response.ok) {
      throw new Error(`Extension not found: ${packageName}`);
    }

    const data = await response.json() as any;
    if (!data.results || data.results.length === 0 || !data.results[0].extensions || data.results[0].extensions.length === 0) {
      throw new Error(`Extension not found: ${packageName}`);
    }

    const ext = data.results[0].extensions[0];
    const latestVersion = ext.versions?.[0]?.version;

    if (!latestVersion) {
      throw new Error(`No version found for: ${packageName}`);
    }

    return latestVersion;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const [publisher, extension] = this.parseExtensionName(packageName);
    const response = await fetch(`${this.baseUrl}/extensionquery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json;api-version=3.0-preview.1',
        'User-Agent': 'use-latest-version-mcp-server'
      },
      body: JSON.stringify({
        filters: [{
          criteria: [
            { filterType: 7, value: `${publisher}.${extension}` }
          ]
        }],
        flags: 914
      })
    });

    if (!response.ok) {
      throw new Error(`Extension not found: ${packageName}`);
    }

    const data = await response.json() as any;
    if (!data.results || data.results.length === 0 || !data.results[0].extensions || data.results[0].extensions.length === 0) {
      throw new Error(`Extension not found: ${packageName}`);
    }

    const ext = data.results[0].extensions[0];
    const latestVersion = ext.versions?.[0]?.version;

    if (!latestVersion) {
      throw new Error(`No version found for: ${packageName}`);
    }

    const publishedDate = ext.versions?.[0]?.lastUpdated;

    return {
      name: `${ext.publisher.publisherName}.${ext.extensionName}`,
      latestVersion,
      description: ext.shortDescription,
      homepage: `https://marketplace.visualstudio.com/items?itemName=${ext.publisher.publisherName}.${ext.extensionName}`,
      publishedAt: publishedDate,
      registry: 'vscode'
    };
  }

  private parseExtensionName(packageName: string): [string, string] {
    const parts = packageName.split('.');
    if (parts.length !== 2) {
      throw new Error('VS Code extension must be in format publisher.extension');
    }
    return [parts[0], parts[1]];
  }
}

export class WordPressPluginRegistryClient implements RegistryClient {
  private baseUrl = 'https://api.wordpress.org/plugins/info/1.2';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/?action=plugin_information&slug=${encodeURIComponent(packageName)}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });

    if (!response.ok) {
      throw new Error(`Plugin not found: ${packageName}`);
    }

    const data = await response.json() as any;
    if (!data.version) {
      throw new Error(`No version found for: ${packageName}`);
    }

    return data.version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(`${this.baseUrl}/?action=plugin_information&slug=${encodeURIComponent(packageName)}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });

    if (!response.ok) {
      throw new Error(`Plugin not found: ${packageName}`);
    }

    const data = await response.json() as any;
    if (!data.version) {
      throw new Error(`No version found for: ${packageName}`);
    }

    return {
      name: data.name,
      latestVersion: data.version,
      description: data.short_description,
      homepage: data.homepage,
      publishedAt: data.last_updated,
      registry: 'wordpress'
    };
  }
}

export class JenkinsPluginsRegistryClient implements RegistryClient {
  private baseUrl = 'https://plugins.jenkins.io/api/plugin';

  async getLatestVersion(packageName: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/${encodeURIComponent(packageName)}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });

    if (!response.ok) {
      throw new Error(`Plugin not found: ${packageName}`);
    }

    const data = await response.json() as any;
    if (!data.version) {
      throw new Error(`No version found for: ${packageName}`);
    }

    return data.version;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await fetch(`${this.baseUrl}/${encodeURIComponent(packageName)}`, {
      headers: {
        'User-Agent': 'use-latest-version-mcp-server'
      }
    });

    if (!response.ok) {
      throw new Error(`Plugin not found: ${packageName}`);
    }

    const data = await response.json() as any;
    if (!data.version) {
      throw new Error(`No version found for: ${packageName}`);
    }

    return {
      name: data.name,
      latestVersion: data.version,
      description: data.excerpt,
      homepage: data.wiki?.url || `https://plugins.jenkins.io/${packageName}`,
      publishedAt: data.releaseTimestamp,
      registry: 'jenkins'
    };
  }
}

function createRegistryClient(registry: string): RegistryClient {
  switch (registry.toLowerCase()) {
    case 'npm':
      return new NpmRegistryClient();
    case 'pypi':
    case 'python':
      return new PyPIRegistryClient();
    case 'maven':
      return new MavenRegistryClient();
    case 'crates':
    case 'crates.io':
    case 'rust':
      return new CratesIORegistryClient();
    case 'rubygems':
    case 'gem':
    case 'ruby':
      return new RubyGemsRegistryClient();
    case 'go':
    case 'golang':
      return new GoModulesRegistryClient();
    case 'github':
      return new GitHubRegistryClient();
    case 'dockerhub':
    case 'docker':
      return new DockerHubRegistryClient();
    case 'gitlab':
      return new GitLabRegistryClient();
    case 'nuget':
    case '.net':
    case 'dotnet':
      return new NuGetRegistryClient();
    case 'packagist':
    case 'php':
    case 'composer':
      return new PackagistRegistryClient();
    case 'homebrew':
    case 'brew':
      return new HomebrewRegistryClient();
    case 'pub.dev':
    case 'pub':
    case 'dart':
    case 'flutter':
      return new PubDevRegistryClient();
    case 'cocoapods':
    case 'pods':
      return new CocoaPodsRegistryClient();
    case 'cran':
    case 'r':
      return new CRANRegistryClient();
    case 'chocolatey':
    case 'choco':
      return new ChocolateyRegistryClient();
    case 'cpan':
    case 'perl':
      return new CPANRegistryClient();
    case 'clojars':
    case 'clojure':
      return new ClojarsRegistryClient();
    case 'ghcr':
    case 'ghcr.io':
      return new GitHubContainerRegistryClient();
    case 'quay':
    case 'quay.io':
      return new QuayIORegistryClient();
    case 'gcr':
    case 'gcr.io':
      return new GCRRegistryClient();
    case 'swift':
    case 'spm':
      return new SwiftPackageRegistryClient();
    case 'hackage':
    case 'haskell':
      return new HackageRegistryClient();
    case 'dub':
    case 'dlang':
    case 'd':
      return new DubRegistryClient();
    case 'luarocks':
    case 'lua':
      return new LuaRocksRegistryClient();
    case 'elm':
      return new ElmPackagesRegistryClient();
    case 'aur':
    case 'arch':
      return new AURRegistryClient();
    case 'snap':
    case 'snapcraft':
      return new SnapStoreRegistryClient();
    case 'flatpak':
    case 'flathub':
      return new FlatpakRegistryClient();
    case 'gradle':
      return new GradlePluginRegistryClient();
    case 'terraform':
    case 'tf':
      return new TerraformRegistryClient();
    case 'ansible':
    case 'galaxy':
      return new AnsibleGalaxyRegistryClient();
    case 'vscode':
    case 'vscode-extensions':
      return new VSCodeExtensionsRegistryClient();
    case 'wordpress':
    case 'wp':
      return new WordPressPluginRegistryClient();
    case 'jenkins':
      return new JenkinsPluginsRegistryClient();
    case 'jsr':
    case 'deno':
      return new JSRRegistryClient();
    case 'conda':
    case 'anaconda':
      return new CondaRegistryClient();
    case 'bioconductor':
    case 'bioc':
      return new BioconductorRegistryClient();
    default:
      throw new Error(`Unsupported registry: ${registry}`);
  }
}

export function getRegistryClient(registry: string): RegistryClient {
  // Decorate every client with response caching + the timeout-aware fetch above.
  return new CachingRegistryClient(createRegistryClient(registry), registry.toLowerCase());
}
