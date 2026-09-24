'use strict';

const assert = require('assert');
const { RELEASE_REPO, RELEASE_API, _test } = require('../src/release-updater');

assert.equal(RELEASE_REPO, 'edilsonbim/PokeGrid-custom');
assert.equal(RELEASE_API, 'https://api.github.com/repos/edilsonbim/PokeGrid-custom/releases/latest');
assert.deepEqual(_test.parseVersion('v1.5.27'), [1, 5, 27]);
assert.equal(_test.compareVersions('1.5.27', '1.5.26'), 1);
assert.equal(_test.compareVersions('1.5.26', '1.5.26'), 0);
assert.equal(_test.compareVersions('1.5.25', '1.5.26'), -1);

const release = { assets: [
  { name:'PokeGrid-1.5.27-setup-x64.exe', browser_download_url:'https://github.com/edilsonbim/PokeGrid-custom/releases/download/v1.5.27/PokeGrid-1.5.27-setup-x64.exe' },
  { name:'PokeGrid-1.5.27-portable-x64.exe', browser_download_url:'https://github.com/edilsonbim/PokeGrid-custom/releases/download/v1.5.27/PokeGrid-1.5.27-portable-x64.exe' }
] };
assert.equal(_test.chooseAsset(release, false).name, 'PokeGrid-1.5.27-setup-x64.exe');
assert.equal(_test.chooseAsset(release, true).name, 'PokeGrid-1.5.27-portable-x64.exe');
console.log('Atualizador de releases: tudo certo');
