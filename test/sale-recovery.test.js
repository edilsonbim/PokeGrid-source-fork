'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(start, end) {
  const a = index.indexOf(start), b = index.indexOf(end, a);
  assert(a >= 0 && b > a, start + ' encontrado');
  return index.slice(a, b);
}

const cityScript = new Function(extract('const GO_TOWN_FOR_SALE =', 'function checkUnstuck') + '\nreturn GO_TOWN_FOR_SALE;')();
async function testCityArrival() {
  let city = false, clicks = 0;
  const market = { textContent: 'Abrir Market', disabled: false, getClientRects: () => [1] };
  const document = {
    querySelectorAll: () => city ? [market] : [],
    querySelector: () => ({ click() { city = true; clicks++; } })
  };
  const result = await vm.runInNewContext(cityScript, { document, setTimeout: cb => setTimeout(cb, 0), Promise });
  assert.equal(result.ok, true);
  assert.equal(result.moved, true);
  assert.equal(clicks, 1);
}

const sellBody = extract('const sellItemsBusy =', 'const sellPokesBusy =');
function makeSeller(webview, errors, button) {
  const build = new Function('webviews', 'off', 'protectedItemIds', 'SELL_SAFE_ITEMS_V2', 'window', 'tabNames', 'stName', 'READ_STATE', 'GO_TOWN_FOR_SALE', 'GOTO_HUNT_CURRENT', 'refreshCards', 'document', 'stBody', 'statsIdx', sellBody + '\nreturn sellSafeItems;');
  return build([webview], [false], new Set(['59195']), ids => 'sale:' + ids.join(','),
    { alert: () => { throw new Error('alert não permitido'); }, confirm: () => { throw new Error('confirm não permitido'); }, pokeAPI: { logError: (...args) => errors.push(args) } },
    ['Treinador 1'], () => 'Conta 1', 'state', 'town', slug => 'tp:' + slug, () => {},
    { querySelectorAll: () => [button] }, { querySelector: () => null }, 0);
}

async function testRetryOnlyAfterCity() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…' };
  let sales = 0;
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script.startsWith('sale:')) return ++sales === 1
      ? { ok:false, reason:'Você precisa estar na cidade para vender no Mark — saia da hunt primeiro.' }
      : { ok:true, sold:3, gold:120 };
    if (script === 'state') return { huntSlug:'bulbasaur', hunt:'Bulbasaur' };
    if (script === 'town') return { ok:true, moved:true };
    if (script === 'tp:bulbasaur') return true;
    throw new Error('script inesperado: ' + script);
  } };
  const result = await makeSeller(webview, errors, button)(0);
  assert.deepEqual(calls, ['sale:59195', 'state', 'town', 'sale:59195', 'tp:bulbasaur']);
  assert.equal(result.ok, true);
  assert.equal(errors.length, 0);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Vender todos os itens permitidos');
}

async function testNoRetryWithoutArrival() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…' };
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script.startsWith('sale:')) return { ok:false, reason:'Você precisa estar na cidade para vender no Mark' };
    if (script === 'state') return { huntSlug:'bulbasaur' };
    if (script === 'town') return { ok:false, moved:true, reason:'cidade não confirmada' };
    if (script === 'tp:bulbasaur') return true;
    throw new Error('script inesperado');
  } };
  const result = await makeSeller(webview, errors, button)(0);
  assert.deepEqual(calls, ['sale:59195', 'state', 'town', 'tp:bulbasaur']);
  assert.equal(result.ok, false);
  assert.match(errors[0][1], /cidade não confirmada/);
  assert.equal(button.disabled, false);
}

async function testFailedSaleStillReturns() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…' };
  let sales = 0;
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script.startsWith('sale:')) {
      if (++sales === 1) return { ok:false, reason:'Você precisa estar na cidade para vender no Mark' };
      throw new Error('falha na venda da cidade');
    }
    if (script === 'state') return { huntSlug:'bulbasaur' };
    if (script === 'town') return { ok:true, moved:true };
    if (script === 'tp:bulbasaur') return false;
    throw new Error('script inesperado');
  } };
  const result = await makeSeller(webview, errors, button)(0);
  assert.deepEqual(calls, ['sale:59195', 'state', 'town', 'sale:59195', 'tp:bulbasaur']);
  assert.equal(result.ok, false);
  assert.match(errors[0][1], /falha na venda da cidade/);
  assert.match(errors[0][1], /retorno à hunt não confirmado/);
  assert.equal(button.disabled, false);
}

async function testUnknownHuntDoesNotMove() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…' };
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script.startsWith('sale:')) return { ok:false, reason:'Você precisa estar na cidade para vender no Mark' };
    if (script === 'state') return { huntSlug:'' };
    throw new Error('personagem não deve sair da hunt sem destino de volta');
  } };
  const result = await makeSeller(webview, errors, button)(0);
  assert.deepEqual(calls, ['sale:59195', 'state']);
  assert.equal(result.ok, false);
  assert.match(errors[0][1], /Não foi possível identificar a hunt atual/);
  assert.equal(button.disabled, false);
}

async function testTownScriptFailureAttemptsReturn() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…' };
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script.startsWith('sale:')) return { ok:false, reason:'Você precisa estar na cidade para vender no Mark' };
    if (script === 'state') return { huntSlug:'bulbasaur' };
    if (script === 'town') throw new Error('falha após clicar Casa');
    if (script === 'tp:bulbasaur') return true;
    throw new Error('script inesperado');
  } };
  const result = await makeSeller(webview, errors, button)(0);
  assert.deepEqual(calls, ['sale:59195', 'state', 'town', 'tp:bulbasaur']);
  assert.equal(result.ok, false);
  assert.match(errors[0][1], /falha após clicar Casa/);
  assert.equal(button.disabled, false);
}

const pokeSellBody = extract('const sellPokesBusy =', 'function sellSelectedStones');
function makePokeSeller(webview, errors, button) {
  const build = new Function('webviews', 'off', 'SELL_SAFE_POKES', 'READ_STATE', 'GO_TOWN_FOR_SALE', 'GOTO_HUNT_CURRENT', 'tabNames', 'stName', 'window', 'refreshCards', 'document', 'stBody', 'statsIdx', pokeSellBody + '\nreturn sellSafePokes;');
  return build([webview], [false], 'poke-sale', 'state', 'town', slug => 'tp:' + slug,
    ['Treinador 1'], () => 'Conta 1',
    { alert: () => { throw new Error('alert não permitido'); }, confirm: () => { throw new Error('confirm não permitido'); }, pokeAPI: { logError: (...args) => errors.push(args) } },
    () => {}, { querySelectorAll: () => [button] }, { querySelector: () => null }, 0);
}

async function testPokeSaleDirectDoesNotMove() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…', title:'' };
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'poke-sale') return { ok:true, sold:2, gold:200 };
    throw new Error('venda na cidade não deve mover o personagem');
  } };
  const result = await makePokeSeller(webview, errors, button)(0);
  assert.deepEqual(calls, ['poke-sale']);
  assert.equal(result.ok, true);
  assert.equal(errors.length, 0);
  assert.equal(button.disabled, false);
}

async function testPokeSaleOtherFailureDoesNotMove() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…', title:'' };
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'poke-sale') return { ok:false, reason:'Nenhum Pokémon permitido para vender' };
    throw new Error('erro não relacionado à cidade não deve mover o personagem');
  } };
  const result = await makePokeSeller(webview, errors, button)(0);
  assert.deepEqual(calls, ['poke-sale']);
  assert.equal(result.ok, false);
  assert.match(errors[0][1], /Nenhum Pokémon permitido/);
  assert.equal(button.disabled, false);
}

async function testPokeSaleGoesToTownWithoutDialog() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…', title:'' };
  let sales = 0;
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'poke-sale') return ++sales === 1
      ? { ok:false, reason:'Você precisa estar na cidade para vender Pokémon no Mark — saia da hunt primeiro.' }
      : { ok:true, sold:4, gold:500 };
    if (script === 'state') return { huntSlug:'bulbasaur', hunt:'Bulbasaur' };
    if (script === 'town') return { ok:true, moved:true };
    if (script === 'tp:bulbasaur') return true;
    throw new Error('script inesperado: ' + script);
  } };
  const result = await makePokeSeller(webview, errors, button)(0);
  assert.deepEqual(calls, ['poke-sale', 'state', 'town', 'poke-sale', 'tp:bulbasaur']);
  assert.equal(result.ok, true);
  assert.equal(errors.length, 0);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Vender Pokémon IV < 150');
  assert.equal(button.title, 'Venda concluída');
}

async function testPokeSaleFailureStillReturnsSilently() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…', title:'' };
  let sales = 0;
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'poke-sale') {
      if (++sales === 1) return { ok:false, reason:'Você precisa estar na cidade para vender Pokémon no Mark' };
      throw new Error('falha na venda de Pokémon');
    }
    if (script === 'state') return { huntSlug:'bulbasaur' };
    if (script === 'town') return { ok:true, moved:true };
    if (script === 'tp:bulbasaur') return false;
    throw new Error('script inesperado');
  } };
  const result = await makePokeSeller(webview, errors, button)(0);
  assert.deepEqual(calls, ['poke-sale', 'state', 'town', 'poke-sale', 'tp:bulbasaur']);
  assert.equal(result.ok, false);
  assert.match(errors[0][1], /falha na venda de Pokémon/);
  assert.match(errors[0][1], /retorno à hunt não confirmado/);
  assert.equal(button.disabled, false);
}

(async () => {
  await testCityArrival();
  await testRetryOnlyAfterCity();
  await testNoRetryWithoutArrival();
  await testFailedSaleStillReturns();
  await testUnknownHuntDoesNotMove();
  await testTownScriptFailureAttemptsReturn();
  await testPokeSaleDirectDoesNotMove();
  await testPokeSaleOtherFailureDoesNotMove();
  await testPokeSaleGoesToTownWithoutDialog();
  await testPokeSaleFailureStillReturnsSilently();
  console.log('Vendas: itens e Pokémon sem janelas, retry único e retorno à hunt OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
