'use strict';

// Atualizador da versao source. Ele nunca envia nada ao GitHub: apenas baixa o historico
// oficial e faz uma mesclagem de tres versoes pelo Git (base oficial + local + oficial nova).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const OFFICIAL_URL = 'https://github.com/leodantas70/idle.git';
const OFFICIAL_REMOTE = 'origin';
// Ultima versao oficial que foi mesclada manualmente neste projeto: PokeGrid 1.5.15.
const OFFICIAL_BASE = '5803119d131193f4987ec0fa1be3fc074d498734';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const normalizeUrl = (s) => String(s || '').trim().replace(/\/$/, '').replace(/\.git$/, '').toLowerCase();
const fileHash = (f) => {
  try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch { return ''; }
};

function runGit(cwd, args, timeout = 120000) {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd,
      windowsHide: true,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' }
    }, (error, stdout, stderr) => resolve({
      ok: !error,
      code: error && typeof error.code === 'number' ? error.code : (error ? 1 : 0),
      stdout: String(stdout || '').trim(),
      stderr: String(stderr || '').trim(),
      error: error ? String(error.message || error) : ''
    }));
  });
}

function runProgram(cwd, command, args, timeout = 120000) {
  return new Promise((resolve) => {
    execFile(command, args, {
      cwd,
      windowsHide:true,
      timeout,
      maxBuffer:16 * 1024 * 1024,
      env:{ ...process.env, ELECTRON_RUN_AS_NODE:'1' }
    }, (error, stdout, stderr) => resolve({ ok:!error, stdout:String(stdout || ''), stderr:String(stderr || ''), error:error ? String(error.message || error) : '' }));
  });
}

// Mantém tudo que o Git já conseguiu mesclar fora dos marcadores. Dentro de cada conflito,
// "union" tenta conservar o local e acrescentar linhas novas do oficial; "ours" conserva só
// o bloco local, usado como reserva quando a união não passa na validação.
function resolveConflictMarkers(text, mode) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/), output = [];
  let conflicts = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^<<<<<<< /.test(lines[i])) { output.push(lines[i]); continue; }
    conflicts++;
    const ours = [], theirs = [];
    i++;
    while (i < lines.length && lines[i] !== '=======') {
      if (/^\|\|\|\|\|\|\| /.test(lines[i])) throw new Error('Marcador diff3 inesperado');
      ours.push(lines[i++]);
    }
    if (i >= lines.length) throw new Error('Conflito sem separador');
    i++;
    while (i < lines.length && !/^>>>>>>> /.test(lines[i])) theirs.push(lines[i++]);
    if (i >= lines.length) throw new Error('Conflito sem final');
    if (mode === 'union') {
      const have = new Set(ours);
      output.push(...ours);
      for (const line of theirs) if (!have.has(line)) { output.push(line); have.add(line); }
    } else output.push(...ours);
  }
  return { text:output.join(eol), conflicts };
}

async function resolveTextConflicts(projectRoot, files, mode) {
  let blocks = 0;
  for (const relative of files) {
    const full = path.resolve(projectRoot, relative);
    if (!full.startsWith(projectRoot + path.sep)) throw new Error('Caminho de conflito inválido: ' + relative);
    let source;
    try { source = fs.readFileSync(full, 'utf8'); } catch {
      const ours = await runGit(projectRoot, ['checkout', '--ours', '--', relative], 30000);
      if (!ours.ok) throw new Error('Não foi possível preservar o arquivo binário ' + relative);
      continue;
    }
    const resolved = resolveConflictMarkers(source, mode);
    if (!resolved.conflicts) throw new Error('Marcadores não encontrados em ' + relative);
    blocks += resolved.conflicts;
    fs.writeFileSync(full, resolved.text, 'utf8');
  }
  const add = await runGit(projectRoot, ['add', '--', ...files], 30000);
  if (!add.ok) throw new Error('Não foi possível preparar os trechos combinados: ' + (add.stderr || add.error));
  return blocks;
}

async function validateMergedProject(projectRoot) {
  const checks = [];
  for (const file of ['main.js', 'preload.js', 'src/updater.js']) {
    if (fs.existsSync(path.join(projectRoot, file))) checks.push(['node', ['--check', file]]);
  }
  if (fs.existsSync(path.join(projectRoot, 'test', 'boot.test.js'))) checks.push(['node', ['test/boot.test.js']]);
  let hasFullSuite = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    hasFullSuite = !!(pkg.scripts && typeof pkg.scripts.test === 'string' && pkg.scripts.test.trim());
  } catch {}
  if (hasFullSuite) checks.push([process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test']]);
  for (const [command, args] of checks) {
    const result = await runProgram(projectRoot, command, args, 120000);
    if (!result.ok) return { ok:false, detail:(result.stderr || result.stdout || result.error).slice(0, 3000) };
  }
  return { ok:true, detail:'' };
}

function copyBackupTree(source, destination) {
  const ignoredDirs = new Set(['.git', 'node_modules', 'dist', '.teste-tmp', '.tmp', 'outputs']);
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    if (entry.isFile() && (/\.(?:zip|log)$/i.test(entry.name) || entry.name === '.update-needs-install')) continue;
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyBackupTree(from, to);
    else if (entry.isFile()) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
  }
}

function makeBackup(projectRoot, backupRoot) {
  const destination = path.join(backupRoot, 'antes-da-atualizacao-' + stamp());
  copyBackupTree(projectRoot, destination);
  const backups = fs.readdirSync(backupRoot, { withFileTypes:true })
    .filter(x => x.isDirectory() && x.name.startsWith('antes-da-atualizacao-'))
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const old of backups.slice(5)) {
    try { fs.rmSync(path.join(backupRoot, old.name), { recursive:true, force:true }); } catch {}
  }
  return destination;
}

async function ensureLocalHistory(projectRoot, remoteUrl, baseCommit) {
  let probe = await runGit(projectRoot, ['rev-parse', '--is-inside-work-tree'], 15000);
  const inside = probe.ok && probe.stdout === 'true';
  if (!inside) {
    const init = await runGit(projectRoot, ['init'], 30000);
    if (!init.ok) throw new Error('Não foi possível iniciar o histórico local: ' + (init.stderr || init.error));
  }
  // Um download interrompido pode deixar a pasta .git criada, mas ainda sem commit/base.
  // Nesse caso o próximo clique precisa concluir a preparação, não tratar o repositório vazio como pronto.
  const head = await runGit(projectRoot, ['rev-parse', '--verify', 'HEAD'], 15000);
  const fresh = !head.ok;
  await runGit(projectRoot, ['config', 'user.name', 'PokeGrid Atualizador Local'], 15000);
  await runGit(projectRoot, ['config', 'user.email', 'atualizador@pokegrid.local'], 15000);

  const remotes = await runGit(projectRoot, ['remote'], 15000);
  const names = remotes.ok ? remotes.stdout.split(/\r?\n/).filter(Boolean) : [];
  if (!names.includes(OFFICIAL_REMOTE)) {
    const add = await runGit(projectRoot, ['remote', 'add', OFFICIAL_REMOTE, remoteUrl], 15000);
    if (!add.ok) throw new Error('Não foi possível registrar o repositório oficial: ' + (add.stderr || add.error));
  } else {
    const got = await runGit(projectRoot, ['remote', 'get-url', OFFICIAL_REMOTE], 15000);
    if (!got.ok || normalizeUrl(got.stdout) !== normalizeUrl(remoteUrl)) {
      throw new Error('O endereço salvo para o repositório oficial é diferente do esperado. Nenhum arquivo foi alterado.');
    }
  }

  if (fresh) {
    const fetchBase = await runGit(projectRoot, ['fetch', '--no-tags', OFFICIAL_REMOTE, baseCommit], 180000);
    if (!fetchBase.ok) throw new Error('Não foi possível baixar a versão oficial de base: ' + (fetchBase.stderr || fetchBase.error));
    const reset = await runGit(projectRoot, ['reset', '--mixed', 'FETCH_HEAD'], 30000);
    if (!reset.ok) throw new Error('Não foi possível preparar a base da mesclagem: ' + (reset.stderr || reset.error));
  }
}

async function commitLocalChanges(projectRoot) {
  // Só registra alterações em arquivos já versionados. Arquivos locais novos
  // (downloads, segredos e artefatos) nunca entram automaticamente no histórico.
  const add = await runGit(projectRoot, ['add', '-u', '--', '.', ':!.tmp/**', ':!outputs/**'], 30000);
  if (!add.ok) throw new Error('Não foi possível preparar as personalizações locais: ' + (add.stderr || add.error));
  const pending = await runGit(projectRoot, ['diff', '--cached', '--quiet'], 15000);
  if (pending.ok) return false;
  const commit = await runGit(projectRoot, ['commit', '-m', 'Personalizações locais antes da atualização oficial'], 60000);
  if (!commit.ok) throw new Error('Não foi possível salvar as personalizações no histórico local: ' + (commit.stderr || commit.error));
  return true;
}

async function applyOfficialUpdate(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const backupRoot = path.resolve(options.backupRoot);
  const remoteUrl = options.remoteUrl || OFFICIAL_URL;
  const baseCommit = options.baseCommit || OFFICIAL_BASE;
  if (!fs.existsSync(path.join(projectRoot, 'package.json')) || !fs.existsSync(path.join(projectRoot, 'index.html'))) {
    return { ok:false, kind:'invalid-project', message:'A pasta do PokeGrid não foi reconhecida.' };
  }

  let backup = '';
  try {
    backup = makeBackup(projectRoot, backupRoot);
    const gitVersion = await runGit(projectRoot, ['--version'], 15000);
    if (!gitVersion.ok) return { ok:false, kind:'git-missing', backup, message:'Git não foi encontrado neste computador.' };

    await ensureLocalHistory(projectRoot, remoteUrl, baseCommit);
    await commitLocalChanges(projectRoot);

    const beforeLock = fileHash(path.join(projectRoot, 'package-lock.json'));
    const beforePackage = fileHash(path.join(projectRoot, 'package.json'));
    const fetchNew = await runGit(projectRoot, ['fetch', '--no-tags', OFFICIAL_REMOTE, 'main'], 180000);
    if (!fetchNew.ok) return { ok:false, kind:'network', backup, message:'Não foi possível baixar a atualização: ' + (fetchNew.stderr || fetchNew.error) };
    const sha = await runGit(projectRoot, ['rev-parse', 'FETCH_HEAD'], 15000);
    const already = await runGit(projectRoot, ['merge-base', '--is-ancestor', 'FETCH_HEAD', 'HEAD'], 15000);
    if (already.ok) return { ok:true, updated:false, backup, commit:sha.stdout, files:[], message:'Você já está com a versão oficial mais recente.' };

    const mergeArgs = ['-c', 'merge.conflictStyle=merge', 'merge', '--no-edit', '--no-ff', '--no-commit', 'FETCH_HEAD'];
    let merge = await runGit(projectRoot, mergeArgs, 180000);
    let conflictFiles = [], conflictBlocks = 0;
    let autoCombined = false, keptLocalSections = false;

    if (!merge.ok) {
      const unresolved = await runGit(projectRoot, ['diff', '--name-only', '--diff-filter=U'], 15000);
      conflictFiles = unresolved.stdout.split(/\r?\n/).filter(Boolean);
      if (!conflictFiles.length) {
        await runGit(projectRoot, ['merge', '--abort'], 30000);
        return { ok:false, kind:'merge', backup, commit:sha.stdout, files:[], message:'A atualização não pôde ser combinada: ' + (merge.stderr || merge.error) };
      }

      conflictBlocks = await resolveTextConflicts(projectRoot, conflictFiles, 'union');
      let validation = await validateMergedProject(projectRoot);
      if (validation.ok) {
        autoCombined = true;
      } else {
        await runGit(projectRoot, ['merge', '--abort'], 30000);
        merge = await runGit(projectRoot, mergeArgs, 180000);
        const retryUnresolved = await runGit(projectRoot, ['diff', '--name-only', '--diff-filter=U'], 15000);
        conflictFiles = retryUnresolved.stdout.split(/\r?\n/).filter(Boolean);
        if (merge.ok || !conflictFiles.length) {
          await runGit(projectRoot, ['merge', '--abort'], 30000);
          return { ok:false, kind:'merge', backup, commit:sha.stdout, files:conflictFiles, message:'Não foi possível repetir a mesclagem com segurança. A versão anterior foi restaurada.' };
        }
        conflictBlocks = await resolveTextConflicts(projectRoot, conflictFiles, 'ours');
        validation = await validateMergedProject(projectRoot);
        if (!validation.ok) {
          await runGit(projectRoot, ['merge', '--abort'], 30000);
          return {
            ok:false,
            kind:'validation',
            backup,
            commit:sha.stdout,
            files:conflictFiles,
            message:'Nem a combinação seletiva passou na verificação. A sua versão foi restaurada sem alterações.'
          };
        }
        keptLocalSections = true;
      }
    } else {
      const validation = await validateMergedProject(projectRoot);
      if (!validation.ok) {
        await runGit(projectRoot, ['merge', '--abort'], 30000);
        return { ok:false, kind:'validation', backup, commit:sha.stdout, files:[], message:'A versão oficial baixada não passou na verificação. A sua versão foi restaurada sem alterações.' };
      }
    }

    const commitMerge = await runGit(projectRoot, ['commit', '--no-edit'], 60000);
    if (!commitMerge.ok) {
      await runGit(projectRoot, ['merge', '--abort'], 30000);
      return { ok:false, kind:'commit', backup, commit:sha.stdout, files:conflictFiles, message:'A combinação foi cancelada porque não pôde ser salva com segurança.' };
    }

    const changed = await runGit(projectRoot, ['diff', '--name-only', 'HEAD^1', 'HEAD'], 15000);
    const files = changed.stdout.split(/\r?\n/).filter(Boolean);
    const afterLock = fileHash(path.join(projectRoot, 'package-lock.json'));
    const afterPackage = fileHash(path.join(projectRoot, 'package.json'));
    const needsInstall = beforeLock !== afterLock || beforePackage !== afterPackage;
    if (needsInstall) fs.writeFileSync(path.join(projectRoot, '.update-needs-install'), '1\n');
    const message = autoCombined
      ? 'Atualização oficial combinada com as personalizações, inclusive nos trechos sobrepostos.'
      : keptLocalSections
        ? 'Atualização aplicada. As novidades seguras foram adicionadas; somente os pequenos trechos incompatíveis mantiveram a versão local.'
        : 'Atualização oficial mesclada sem apagar as personalizações.';
    return { ok:true, updated:true, backup, commit:sha.stdout, files, needsInstall, autoCombined, keptLocalSections, conflictFiles, conflictBlocks, message };
  } catch (e) {
    await runGit(projectRoot, ['merge', '--abort'], 30000);
    return { ok:false, kind:'error', backup, message:String((e && e.message) || e) };
  }
}

module.exports = { applyOfficialUpdate, OFFICIAL_URL, OFFICIAL_BASE, _test:{ runGit, makeBackup } };
