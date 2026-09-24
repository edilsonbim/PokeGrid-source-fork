'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { spawn } = require('child_process');

const RELEASE_REPO = 'edilsonbim/PokeGrid-custom';
const RELEASE_API = 'https://api.github.com/repos/' + RELEASE_REPO + '/releases/latest';
const RELEASE_HOSTS = new Set([
  'api.github.com', 'github.com', 'objects.githubusercontent.com',
  'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com'
]);
const MAX_DOWNLOAD = 350 * 1024 * 1024;

function parseVersion(value) {
  const m = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersions(a, b) {
  const A = parseVersion(a) || [0, 0, 0], B = parseVersion(b) || [0, 0, 0];
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] > B[i] ? 1 : -1;
  return 0;
}

function validUrl(value, allowApi = false) {
  try {
    const u = new URL(String(value));
    if (u.protocol !== 'https:' || !RELEASE_HOSTS.has(u.hostname)) return null;
    if (!allowApi && u.hostname === 'api.github.com') return null;
    return u;
  } catch { return null; }
}

function requestJson(url, redirects = 0) {
  return new Promise((resolve) => {
    const u = validUrl(url, true);
    if (!u || redirects > 3) { resolve({ ok:false, error:'URL de atualização inválida.' }); return; }
    const req = https.get(u, {
      headers: {
        'User-Agent': 'PokeGrid/' + (process.env.npm_package_version || 'app'),
        Accept: 'application/vnd.github+json'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, u).toString();
        requestJson(next, redirects + 1).then(resolve);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (body.length < 2 * 1024 * 1024) body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) { resolve({ ok:false, error:'GitHub respondeu HTTP ' + res.statusCode }); return; }
        try { resolve({ ok:true, value:JSON.parse(body) }); }
        catch { resolve({ ok:false, error:'Resposta inválida do GitHub.' }); }
      });
      res.on('error', () => resolve({ ok:false, error:'Falha ao ler a versão disponível.' }));
    });
    req.setTimeout(12000, () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ ok:false, error:'Não foi possível consultar o GitHub.' }));
  });
}

function chooseAsset(release, portable) {
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  const executables = assets.filter((a) => a && typeof a.name === 'string' && /\.exe$/i.test(a.name) && validUrl(a.browser_download_url));
  const wanted = portable
    ? executables.find((a) => /portable/i.test(a.name))
    : executables.find((a) => /setup|installer/i.test(a.name));
  return wanted || executables.find((a) => /x64|win/i.test(a.name)) || executables[0] || null;
}

async function checkLatestRelease({ currentVersion, packaged, portable = false } = {}) {
  if (!packaged) return { ok:true, updateAvailable:false, kind:'development', repo:RELEASE_REPO };
  const current = parseVersion(currentVersion);
  if (!current) return { ok:false, kind:'version', message:'A versão instalada é inválida.' };
  const response = await requestJson(RELEASE_API);
  if (!response.ok) return { ok:false, kind:'network', message:response.error };
  const release = response.value || {};
  const version = parseVersion(release.tag_name);
  if (release.draft || release.prerelease || !version) return { ok:true, updateAvailable:false, repo:RELEASE_REPO };
  if (compareVersions(release.tag_name, currentVersion) <= 0) {
    return { ok:true, updateAvailable:false, repo:RELEASE_REPO, version:release.tag_name };
  }
  const asset = chooseAsset(release, portable);
  if (!asset) return { ok:false, kind:'asset-missing', message:'A nova versão foi publicada sem instalador compatível.' };
  return {
    ok:true, updateAvailable:true, repo:RELEASE_REPO, version:release.tag_name,
    name:String(release.name || release.tag_name).slice(0, 120),
    notes:String(release.body || '').slice(0, 4000),
    publishedAt:release.published_at || '',
    asset:{ name:asset.name, url:asset.browser_download_url, size:+asset.size || 0 }
  };
}

function download(url, destination, redirects = 0, received = 0) {
  return new Promise((resolve) => {
    const u = validUrl(url);
    if (!u || redirects > 4) { resolve({ ok:false, error:'Download fora dos domínios permitidos.' }); return; }
    const out = fs.createWriteStream(destination);
    let total = received;
    let finished = false;
    const fail = (error) => {
      if (finished) return;
      finished = true;
      try { out.close(); fs.unlinkSync(destination); } catch {}
      resolve({ ok:false, error });
    };
    const req = https.get(u, { headers:{ 'User-Agent':'PokeGrid updater', Accept:'application/octet-stream' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); out.close();
        const next = new URL(res.headers.location, u).toString();
        download(next, destination, redirects + 1, total).then(resolve);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); fail('GitHub respondeu HTTP ' + res.statusCode); return; }
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_DOWNLOAD) { req.destroy(); fail('O instalador excede o limite permitido.'); }
      });
      res.on('error', () => fail('Falha durante o download.'));
      out.on('error', () => fail('Não foi possível salvar o instalador.'));
      res.pipe(out);
      out.on('finish', () => { if (!finished) { finished = true; out.close(); resolve({ ok:true, size:total }); } });
    });
    req.setTimeout(180000, () => req.destroy(new Error('timeout')));
    req.on('error', () => fail('Download interrompido.'));
  });
}

function writeInstallScript({ packageFile, targetPath, portable, pid, tempDir }) {
  const script = path.join(tempDir, 'aplicar-atualizacao.ps1');
  const q = (value) => "'" + String(value).replace(/'/g, "''") + "'";
  const lines = [
    '$ErrorActionPreference = "Stop"',
    '$pidAlvo = ' + Math.trunc(pid),
    '$pacote = ' + q(packageFile),
    '$alvo = ' + q(targetPath),
    'while (Get-Process -Id $pidAlvo -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 250 }'
  ];
  if (portable) {
    lines.push(
      '$backup = $alvo + ".old"',
      'Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue',
      'Move-Item -LiteralPath $alvo -Destination $backup -Force',
      'Copy-Item -LiteralPath $pacote -Destination $alvo -Force',
      'Start-Process -FilePath $alvo'
    );
  } else {
    lines.push(
      '$inst = Start-Process -FilePath $pacote -ArgumentList @("/S", ("/D=" + (Split-Path -Parent $alvo))) -PassThru -Wait',
      'if ($inst.ExitCode -ne 0) { exit $inst.ExitCode }',
      'Start-Process -FilePath $alvo'
    );
  }
  fs.writeFileSync(script, lines.join('\r\n') + '\r\n', 'utf8');
  return script;
}

async function downloadAndInstall({ release, appPid, targetPath, portable, tempRoot }) {
  if (!release || !release.updateAvailable || !release.asset || !validUrl(release.asset.url)) {
    return { ok:false, kind:'invalid-release', message:'Atualização inválida ou desatualizada.' };
  }
  const tempDir = fs.mkdtempSync(path.join(tempRoot, 'pokegrid-update-'));
  const packageFile = path.join(tempDir, release.asset.name.replace(/[^\w.-]+/g, '_'));
  const got = await download(release.asset.url, packageFile);
  if (!got.ok) { try { fs.rmSync(tempDir, { recursive:true, force:true }); } catch {} return { ok:false, kind:'network', message:got.error }; }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(packageFile)).digest('hex');
  const script = writeInstallScript({ packageFile, targetPath, portable, pid:appPid, tempDir });
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { detached:true, windowsHide:true, stdio:'ignore' });
  child.unref();
  return { ok:true, restarting:true, version:release.version, asset:release.asset.name, sha256:hash };
}

module.exports = { RELEASE_REPO, RELEASE_API, checkLatestRelease, downloadAndInstall, _test:{ parseVersion, compareVersions, chooseAsset } };
