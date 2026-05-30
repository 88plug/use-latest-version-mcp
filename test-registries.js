import('./build/registries.js').then(async (m) => {
  const { 
    NpmRegistryClient, 
    PyPIRegistryClient, 
    CratesIORegistryClient,
    RubyGemsRegistryClient,
    GoModulesRegistryClient,
    GitHubRegistryClient,
    DockerHubRegistryClient,
    HomebrewRegistryClient,
    NuGetRegistryClient,
    PackagistRegistryClient
  } = m;
  
  const tests = [
    { client: new NpmRegistryClient(), package: 'express', name: 'npm' },
    { client: new PyPIRegistryClient(), package: 'requests', name: 'pypi' },
    { client: new CratesIORegistryClient(), package: 'serde', name: 'crates' },
    { client: new RubyGemsRegistryClient(), package: 'rails', name: 'rubygems' },
    { client: new GoModulesRegistryClient(), package: 'github.com/gorilla/mux', name: 'go' },
    { client: new GitHubRegistryClient(), package: 'vercel/next.js', name: 'github' },
    { client: new DockerHubRegistryClient(), package: 'library/nginx', name: 'dockerhub' },
    { client: new HomebrewRegistryClient(), package: 'node', name: 'homebrew' },
    { client: new NuGetRegistryClient(), package: 'Newtonsoft.Json', name: 'nuget' },
    { client: new PackagistRegistryClient(), package: 'laravel/framework', name: 'packagist' }
  ];
  
  console.log('Testing registry clients...\n');
  
  for (const test of tests) {
    try {
      const version = await test.client.getLatestVersion(test.package);
      console.log(`✅ [${test.name.padEnd(12)}] ${test.package.padEnd(30)} -> ${version}`);
    } catch (error) {
      console.log(`❌ [${test.name.padEnd(12)}] ${test.package.padEnd(30)} -> ERROR: ${error.message}`);
    }
  }
  
  console.log('\nTest complete!');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
