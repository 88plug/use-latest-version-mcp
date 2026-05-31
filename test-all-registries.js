import('./build/registries.js').then(async (m) => {
  const clients = [
    { name: 'NpmRegistryClient', client: new m.NpmRegistryClient(), test: 'express' },
    { name: 'PyPIRegistryClient', client: new m.PyPIRegistryClient(), test: 'requests' },
    { name: 'MavenRegistryClient', client: new m.MavenRegistryClient(), test: 'org.springframework.boot:spring-boot-starter' },
    { name: 'CratesIORegistryClient', client: new m.CratesIORegistryClient(), test: 'serde' },
    { name: 'RubyGemsRegistryClient', client: new m.RubyGemsRegistryClient(), test: 'rails' },
    { name: 'GoModulesRegistryClient', client: new m.GoModulesRegistryClient(), test: 'github.com/gorilla/mux' },
    { name: 'GitHubRegistryClient', client: new m.GitHubRegistryClient(), test: 'vercel/next.js' },
    { name: 'DockerHubRegistryClient', client: new m.DockerHubRegistryClient(), test: 'library/nginx' },
    { name: 'GitLabRegistryClient', client: new m.GitLabRegistryClient(), test: 'gitlab-org/gitlab' },
    { name: 'AURRegistryClient', client: new m.AURRegistryClient(), test: 'neovim-git' },
    { name: 'SnapStoreRegistryClient', client: new m.SnapStoreRegistryClient(), test: 'core' },
    { name: 'FlatpakRegistryClient', client: new m.FlatpakRegistryClient(), test: 'org.gimp.GIMP' },
    { name: 'GradlePluginRegistryClient', client: new m.GradlePluginRegistryClient(), test: 'com.android.application' },
    { name: 'TerraformRegistryClient', client: new m.TerraformRegistryClient(), test: 'hashicorp/aws' },
    { name: 'AnsibleGalaxyRegistryClient', client: new m.AnsibleGalaxyRegistryClient(), test: 'geerlingguy.docker' },
    { name: 'CRANRegistryClient', client: new m.CRANRegistryClient(), test: 'ggplot2' },
    { name: 'ChocolateyRegistryClient', client: new m.ChocolateyRegistryClient(), test: 'nodejs' },
    { name: 'CPANRegistryClient', client: new m.CPANRegistryClient(), test: 'Mojolicious' },
    { name: 'ClojarsRegistryClient', client: new m.ClojarsRegistryClient(), test: 'clj-time' },
    { name: 'NuGetRegistryClient', client: new m.NuGetRegistryClient(), test: 'Newtonsoft.Json' },
    { name: 'PackagistRegistryClient', client: new m.PackagistRegistryClient(), test: 'laravel/framework' },
    { name: 'HomebrewRegistryClient', client: new m.HomebrewRegistryClient(), test: 'node' },
    { name: 'PubDevRegistryClient', client: new m.PubDevRegistryClient(), test: 'http' },
    { name: 'CocoaPodsRegistryClient', client: new m.CocoaPodsRegistryClient(), test: 'Alamofire' },
    { name: 'GitHubContainerRegistryClient', client: new m.GitHubContainerRegistryClient(), test: 'library/nginx' },
    { name: 'QuayIORegistryClient', client: new m.QuayIORegistryClient(), test: 'coreos/etcd' },
    { name: 'GCRRegistryClient', client: new m.GCRRegistryClient(), test: 'distroless/base' },
    { name: 'SwiftPackageRegistryClient', client: new m.SwiftPackageRegistryClient(), test: 'swift' },
    { name: 'HackageRegistryClient', client: new m.HackageRegistryClient(), test: 'base' },
    { name: 'DubRegistryClient', client: new m.DubRegistryClient(), test: 'vibe-d' },
    { name: 'LuaRocksRegistryClient', client: new m.LuaRocksRegistryClient(), test: 'luasocket' },
    { name: 'ElmPackagesRegistryClient', client: new m.ElmPackagesRegistryClient(), test: 'elm/core' },
    { name: 'JSRRegistryClient', client: new m.JSRRegistryClient(), test: '@std/http' },
    { name: 'CondaRegistryClient', client: new m.CondaRegistryClient(), test: 'numpy' },
    { name: 'BioconductorRegistryClient', client: new m.BioconductorRegistryClient(), test: 'BiocGenerics' },
    { name: 'VSCodeExtensionsRegistryClient', client: new m.VSCodeExtensionsRegistryClient(), test: 'ms-python.python' },
    { name: 'WordPressPluginRegistryClient', client: new m.WordPressPluginRegistryClient(), test: 'akismet' },
    { name: 'JenkinsPluginsRegistryClient', client: new m.JenkinsPluginsRegistryClient(), test: 'git' },
    { name: 'HexRegistryClient', client: new m.HexRegistryClient(), test: 'phoenix' }
  ];

  console.log(`Testing all ${clients.length} registry clients...\n`);
  
  let passed = 0;
  let failed = 0;
  
  for (const { name, client, test } of clients) {
    try {
      const version = await client.getLatestVersion(test);
      console.log(`✅ [${name.padEnd(35)}] ${test.padEnd(35)} -> ${version}`);
      passed++;
    } catch (error) {
      console.log(`❌ [${name.padEnd(35)}] ${test.padEnd(35)} -> ERROR: ${error.message.substring(0, 60)}`);
      failed++;
    }
  }
  
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
