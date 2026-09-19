'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const a = index.indexOf('const unstuckBtn =');
const b = index.indexOf('// ----- Proteção de venda', a);
assert(a >= 0 && b > a, 'rotina de recuperacao encontrada');
const body = index.slice(a, b);

function makeHarness() {
  const calls = [], timers = new Map();
  let nextTimer = 1, resolveTown;
  const townPromise = new Promise(resolve => { resolveTown = resolve; });
  const button = { textContent:'', title:'', classList:{ toggle() {} }, onclick:null };
  const document = { getElementById: id => id === 'unstuck' ? button : null };
  const webview = { executeJavaScript(script) {
    calls.push(script);
    return script === 'hunt:bulbasaur' ? Promise.resolve(true) : townPromise;
  } };
  const fakeSetTimeout = (cb, ms) => { const id = nextTimer++; timers.set(id, { cb, ms }); return id; };
  const fakeClearTimeout = id => { timers.delete(id); };
  const build = new Function('document', 'lsGet', 'lsSet', 't', 'webviews', 'off', 'recentHunts', 'GOTO_HUNT_CURRENT', 'setTimeout', 'clearTimeout', body + '\nreturn { checkUnstuck, unstuckState, applyUnstuck };');
  const api = build(document, key => key === 'unstuckFarm' ? '1' : null, () => {}, key => key,
    [webview], [false], { c1:[{ slug:'bulbasaur', name:'Bulbasaur' }] }, slug => 'hunt:' + slug, fakeSetTimeout, fakeClearTimeout);
  return { api, calls, timers, resolveTown };
}

async function flush() { await new Promise(resolve => setImmediate(resolve)); }

async function testWaitsForCityBeforeStartingTownTimer() {
  const h = makeHarness();
  const sample = { live:true, cid:'c1', slug:'bulbasaur', xp:10 };
  h.api.checkUnstuck(0, sample);
  const state = h.api.unstuckState[0];
  state.lastXpAt = Date.now() - state.limit - 1;
  h.api.checkUnstuck(0, sample);
  await flush();
  assert.equal(h.calls.length, 1, 'manda o personagem para a cidade uma vez');
  assert.equal(h.timers.size, 0, 'não inicia espera antes da confirmação da cidade');
  h.resolveTown({ ok:true, moved:true });
  await flush();
  assert.equal(h.timers.size, 1, 'inicia a espera somente após chegar à cidade');
  const timer = [...h.timers.values()][0];
  assert(timer.ms >= 10000 && timer.ms <= 30000, 'espera na cidade fica entre 10 e 30 segundos');
  timer.cb();
  await flush();
  assert.deepEqual(h.calls.slice(-1), ['hunt:bulbasaur'], 'retorna à última hunt depois da espera');
  await flush();
  assert.equal(h.api.unstuckState[0].busy, false, 'libera o estado após o retorno');
}

testWaitsForCityBeforeStartingTownTimer()
  .then(() => console.log('Recuperacao de farm: cidade confirmada, espera reduzida e retorno OK'))
  .catch(error => { console.error(error); process.exitCode = 1; });
