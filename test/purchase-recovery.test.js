'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(start, end) {
  const a = index.indexOf(start), b = index.indexOf(end, a);
  assert(a >= 0 && b > a, start + ' encontrado');
  return index.slice(a, b);
}

const runnerBody = extract('const markActionBusy =', 'async function buyUbAllCharacters');
function makeRunner(webview) {
  const build = new Function('webviews', 'off', 'READ_STATE', 'GO_TOWN_FOR_SALE', 'GOTO_HUNT_CURRENT', runnerBody + '\nreturn runMarkAction;');
  return build([webview], [false], 'state', 'town', slug => 'tp:' + slug);
}

async function testDirectPurchaseDoesNotMove() {
  const calls = [];
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'buy') return { ok:true, bought:1000 };
    throw new Error('compra direta não deve mover o personagem');
  } };
  const out = await makeRunner(webview)(0, 'buy');
  assert.deepEqual(calls, ['buy']);
  assert.equal(out.r.ok, true);
  assert.equal(out.returnFailed, false);
}

async function testPurchaseGoesToTownAndReturns() {
  const calls = [];
  let buys = 0;
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'buy') return ++buys === 1
      ? { ok:false, reason:'Você precisa estar na cidade para comprar no Mark — saia da hunt primeiro.' }
      : { ok:true, bought:1000 };
    if (script === 'state') return { huntSlug:'bulbasaur', hunt:'Bulbasaur' };
    if (script === 'town') return { ok:true, moved:true };
    if (script === 'tp:bulbasaur') return true;
    throw new Error('script inesperado: ' + script);
  } };
  const out = await makeRunner(webview)(0, 'buy');
  assert.deepEqual(calls, ['buy', 'state', 'town', 'buy', 'tp:bulbasaur']);
  assert.equal(out.r.ok, true);
  assert.equal(out.returnFailed, false);
}

async function testOtherFailureDoesNotMove() {
  const calls = [];
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    return { ok:false, reason:'Gold insuficiente' };
  } };
  const out = await makeRunner(webview)(0, 'buy');
  assert.deepEqual(calls, ['buy']);
  assert.equal(out.r.ok, false);
}

async function testPartialBatchIsNotBoughtTwice() {
  const calls = [];
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    return { ok:false, bought:1000, reason:'Você precisa estar na cidade para comprar no Mark' };
  } };
  const out = await makeRunner(webview)(0, 'buy-5000');
  assert.deepEqual(calls, ['buy-5000']);
  assert.equal(out.r.ok, false);
  assert.equal(out.r.bought, 1000);
}

async function testFailedArrivalStillReturns() {
  const calls = [];
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'buy') return { ok:false, reason:'Você precisa estar na cidade para comprar no Mark' };
    if (script === 'state') return { huntSlug:'bulbasaur' };
    if (script === 'town') return { ok:false, moved:true, reason:'cidade não confirmada' };
    if (script === 'tp:bulbasaur') return true;
    throw new Error('script inesperado');
  } };
  const out = await makeRunner(webview)(0, 'buy');
  assert.deepEqual(calls, ['buy', 'state', 'town', 'tp:bulbasaur']);
  assert.equal(out.r.ok, false);
  assert.match(out.r.reason, /cidade não confirmada/);
}

async function testFailedRetryStillReturns() {
  const calls = [];
  let buys = 0;
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'buy') {
      if (++buys === 1) return { ok:false, reason:'Você precisa estar na cidade para comprar no Mark' };
      throw new Error('falha ao comprar na cidade');
    }
    if (script === 'state') return { huntSlug:'bulbasaur' };
    if (script === 'town') return { ok:true, moved:true };
    if (script === 'tp:bulbasaur') return true;
    throw new Error('script inesperado');
  } };
  const out = await makeRunner(webview)(0, 'buy');
  assert.deepEqual(calls, ['buy', 'state', 'town', 'buy', 'tp:bulbasaur']);
  assert.equal(out.r.ok, false);
  assert.match(out.r.reason, /falha ao comprar na cidade/);
  assert.equal(out.returnFailed, false);
}

const buyOneBody = extract('async function buy1000Ball', 'const sellItemsBusy =');
async function testIndividualPurchaseHasNoDialogs() {
  const errors = [], calls = [], button = { dataset:{ i:'0', kind:'ball', id:'7' }, disabled:true, textContent:'…', title:'' };
  const build = new Function('tabNames', 'stName', 'runMarkAction', 'BUY_1000_SUPPLY', 'window', 'document', 'refreshCards', buyOneBody + '\nreturn buy1000Ball;');
  const buy = build(['Treinador 1'], () => 'Conta 1', async (i, script) => {
    calls.push([i, script]); return { r:{ ok:false, reason:'Gold insuficiente' }, returnFailed:false };
  }, (kind, id) => 'buy:' + kind + ':' + id,
  { alert: () => { throw new Error('alert não permitido'); }, confirm: () => { throw new Error('confirm não permitido'); }, pokeAPI:{ logError:(...x) => errors.push(x) } },
  { querySelectorAll: () => [button] }, () => {});
  const result = await buy(0, 'ball', '7', 'Ultra Ball');
  assert.deepEqual(calls, [[0, 'buy:ball:7']]);
  assert.equal(result.ok, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0][1], /Gold insuficiente/);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '+1000');
  assert.match(button.title, /Gold insuficiente/);
}

const buyAllBody = extract('async function buyUbAllCharacters', 'async function buy1000Ball');
async function testBulkPurchaseHasNoDialogs() {
  const calls = [], errors = [], buttons = [1000, 5000, 10000].map(q => ({ dataset:{ qty:String(q) }, disabled:true, textContent:'…', title:'' }));
  const build = new Function('ubAllBusy', 'count', 'off', 'webviews', 'tabNames', 'stName', 'runMarkAction', 'BUY_UB_BATCH', 'nf', 'window', 'refreshStats', 'cardsOn', 'refreshCards', 'ubAllLastStatus', 'stBody', buyAllBody + '\nreturn buyUbAllCharacters;');
  const buyAll = build(false, 2, [false, false], [{}, {}], ['A', 'B'], i => 'Conta ' + i,
    async (i, script) => { calls.push([i, script]); return { r:{ ok:true, bought:1000 }, returnFailed:false }; },
    qty => 'ub:' + qty, String,
    { alert: () => { throw new Error('alert não permitido'); }, confirm: () => { throw new Error('confirm não permitido'); }, pokeAPI:{ logError:(...x) => errors.push(x) } },
    () => {}, false, () => {}, '', { querySelectorAll:() => buttons });
  await buyAll(1000);
  assert.deepEqual(calls, [[0, 'ub:1000'], [1, 'ub:1000']]);
  assert.equal(errors.length, 0);
  assert.deepEqual(buttons.map(b => [b.disabled, b.textContent]), [[false, '1k'], [false, '5k'], [false, '10k']]);
}

(async () => {
  await testDirectPurchaseDoesNotMove();
  await testPurchaseGoesToTownAndReturns();
  await testOtherFailureDoesNotMove();
  await testPartialBatchIsNotBoughtTwice();
  await testFailedArrivalStillReturns();
  await testFailedRetryStillReturns();
  await testIndividualPurchaseHasNoDialogs();
  await testBulkPurchaseHasNoDialogs();
  console.log('Compras: individuais e em massa sem janelas, com cidade e retorno à hunt OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
