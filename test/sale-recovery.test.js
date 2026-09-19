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
function makeSeller(webview, errors, button, confirms = [], confirmResult = true) {
  const build = new Function('webviews', 'off', 'protectedItemIds', 'PREVIEW_SAFE_ITEMS', 'SELL_SAFE_ITEMS_SELECTED', 'window', 'tabNames', 'stName', 'READ_STATE', 'GO_TOWN_FOR_SALE', 'GOTO_HUNT_CURRENT', 'refreshCards', 'document', 'stBody', 'statsIdx', 'nf', sellBody + '\nreturn sellSafeItems;');
  return build([webview], [false], new Set(['59195']), ids => 'preview', (ids, items) => 'sale',
    { alert: () => { throw new Error('alert não permitido'); }, confirm: msg => { confirms.push(msg); return confirmResult; }, pokeAPI: { logError: (...args) => errors.push(args) } },
    ['Treinador 1'], () => 'Conta 1', 'state', 'town', slug => 'tp:' + slug, () => {},
    { querySelectorAll: () => [button] }, { querySelector: () => null }, 0, value => String(value));
}

async function testRetryOnlyAfterCity() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…' };
  const confirms = [];
  let sales = 0;
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'preview') return { ok:true, items:[{ itemId:59195, qty:2, name:'Hyper Potion' }] };
    if (script === 'sale') return ++sales === 1
      ? { ok:false, reason:'Você precisa estar na cidade para vender no Mark — saia da hunt primeiro.' }
      : { ok:true, sold:3, gold:120 };
    if (script === 'state') return { huntSlug:'bulbasaur', hunt:'Bulbasaur' };
    if (script === 'town') return { ok:true, moved:true };
    if (script === 'tp:bulbasaur') return true;
    throw new Error('script inesperado: ' + script);
  } };
  const result = await makeSeller(webview, errors, button, confirms)(0);
  assert.deepEqual(calls, ['preview', 'sale', 'state', 'town', 'sale', 'tp:bulbasaur']);
  assert.match(confirms[0], /Hyper Potion/);
  assert.match(confirms[0], /2 unidades/);
  assert.equal(result.ok, true);
  assert.equal(errors.length, 0);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Vender todos os itens permitidos');
}

async function testNoRetryWithoutArrival() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…' };
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'preview') return { ok:true, items:[{ itemId:59195, qty:2, name:'Hyper Potion' }] };
    if (script === 'sale') return { ok:false, reason:'Você precisa estar na cidade para vender no Mark' };
    if (script === 'state') return { huntSlug:'bulbasaur' };
    if (script === 'town') return { ok:false, moved:true, reason:'cidade não confirmada' };
    if (script === 'tp:bulbasaur') return true;
    throw new Error('script inesperado');
  } };
  const result = await makeSeller(webview, errors, button)(0);
  assert.deepEqual(calls, ['preview', 'sale', 'state', 'town', 'tp:bulbasaur']);
  assert.equal(result.ok, false);
  assert.match(errors[0][1], /cidade não confirmada/);
  assert.equal(button.disabled, false);
}

async function testFailedSaleStillReturns() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…' };
  let sales = 0;
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'preview') return { ok:true, items:[{ itemId:59195, qty:2, name:'Hyper Potion' }] };
    if (script === 'sale') {
      if (++sales === 1) return { ok:false, reason:'Você precisa estar na cidade para vender no Mark' };
      throw new Error('falha na venda da cidade');
    }
    if (script === 'state') return { huntSlug:'bulbasaur' };
    if (script === 'town') return { ok:true, moved:true };
    if (script === 'tp:bulbasaur') return false;
    throw new Error('script inesperado');
  } };
  const result = await makeSeller(webview, errors, button)(0);
  assert.deepEqual(calls, ['preview', 'sale', 'state', 'town', 'sale', 'tp:bulbasaur']);
  assert.equal(result.ok, false);
  assert.match(errors[0][1], /falha na venda da cidade/);
  assert.match(errors[0][1], /retorno à hunt não confirmado/);
  assert.equal(button.disabled, false);
}

async function testUnknownHuntDoesNotMove() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…' };
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'preview') return { ok:true, items:[{ itemId:59195, qty:2, name:'Hyper Potion' }] };
    if (script === 'sale') return { ok:false, reason:'Você precisa estar na cidade para vender no Mark' };
    if (script === 'state') return { huntSlug:'' };
    throw new Error('personagem não deve sair da hunt sem destino de volta');
  } };
  const result = await makeSeller(webview, errors, button)(0);
  assert.deepEqual(calls, ['preview', 'sale', 'state']);
  assert.equal(result.ok, false);
  assert.match(errors[0][1], /Não foi possível identificar a hunt atual/);
  assert.equal(button.disabled, false);
}

async function testTownScriptFailureAttemptsReturn() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…' };
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'preview') return { ok:true, items:[{ itemId:59195, qty:2, name:'Hyper Potion' }] };
    if (script === 'sale') return { ok:false, reason:'Você precisa estar na cidade para vender no Mark' };
    if (script === 'state') return { huntSlug:'bulbasaur' };
    if (script === 'town') throw new Error('falha após clicar Casa');
    if (script === 'tp:bulbasaur') return true;
    throw new Error('script inesperado');
  } };
  const result = await makeSeller(webview, errors, button)(0);
  assert.deepEqual(calls, ['preview', 'sale', 'state', 'town', 'tp:bulbasaur']);
  assert.equal(result.ok, false);
  assert.match(errors[0][1], /falha após clicar Casa/);
  assert.equal(button.disabled, false);
}

const pokeSellBody = extract('const sellPokesBusy =', 'async function sellSelectedStones');
function makePokeSeller(webview, errors, button, confirms = [], confirmResult = true) {
  const build = new Function('webviews', 'off', 'PREVIEW_SAFE_POKES', 'SELL_SAFE_POKES_SELECTED', 'READ_STATE', 'GO_TOWN_FOR_SALE', 'GOTO_HUNT_CURRENT', 'tabNames', 'stName', 'window', 'refreshCards', 'document', 'stBody', 'statsIdx', 'nf', pokeSellBody + '\nreturn sellSafePokes;');
  return build([webview], [false], () => 'poke-preview', ids => 'poke-sale', 'state', 'town', slug => 'tp:' + slug,
    ['Treinador 1'], () => 'Conta 1',
    { alert: () => { throw new Error('alert não permitido'); }, confirm: msg => { confirms.push(msg); return confirmResult; }, pokeAPI: { logError: (...args) => errors.push(args) } },
    () => {}, { querySelectorAll: () => [button] }, { querySelector: () => null }, 0, value => String(value));
}

async function testCancelledItemSaleDoesNotCallApi() {
  const calls = [], errors = [], confirms = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…' };
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'preview') return { ok:true, items:[{ itemId:59195, qty:2, name:'Hyper Potion' }] };
    throw new Error('venda cancelada não deve chamar a API');
  } };
  const result = await makeSeller(webview, errors, button, confirms, false)(0);
  assert.deepEqual(calls, ['preview']);
  assert.equal(result.cancelled, true);
  assert.match(confirms[0], /Clique em OK para vender/);
  assert.equal(errors.length, 0);
  assert.equal(button.disabled, false);
}

async function testPokeSaleDirectDoesNotMove() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…', title:'' };
  const confirms = [];
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'poke-preview') return { ok:true, pokeIds:['p1','p2'], count:2 };
    if (script === 'poke-sale') return { ok:true, sold:2, gold:200 };
    throw new Error('venda na cidade não deve mover o personagem');
  } };
  const result = await makePokeSeller(webview, errors, button, confirms)(0);
  assert.deepEqual(calls, ['poke-preview', 'poke-sale']);
  assert.match(confirms[0], /2 Pokémon/);
  assert.equal(result.ok, true);
  assert.equal(errors.length, 0);
  assert.equal(button.disabled, false);
}

const stoneSellBody = extract('async function sellSelectedStones', 'function openCharacterMarket');
function makeStoneSeller(webview, errors, button, confirms = [], confirmResult = true) {
  const build = new Function('webviews', 'off', 'markActionBusy', 'stoneSelected', 'PREVIEW_SELECTED_STONES', 'SELL_SELECTED_STONES_SELECTED', 'runMarkAction', 'tabNames', 'stName', 'nf', 'window', 'localStorage', 'refreshCards', 'document', 'stoneBody', stoneSellBody + '\nreturn sellSelectedStones;');
  const recover = async (i, script) => {
    let r = await webview.executeJavaScript(script);
    if (!r?.ok && /precisa estar na cidade|saia da hunt/i.test(String(r?.reason || ''))) {
      const state = await webview.executeJavaScript('state');
      const town = await webview.executeJavaScript('town');
      if (town?.ok) r = await webview.executeJavaScript(script);
      await webview.executeJavaScript('tp:' + state.huntSlug);
    }
    return { r, returnFailed:false };
  };
  return build([webview], [false], new Set(), { bag1:{ stone1:true } }, ids => 'stone-preview', (ids, selected) => 'stone-sale', recover,
    ['Treinador 1'], () => 'Conta 1', value => String(value),
    { confirm: msg => { confirms.push(msg); return confirmResult; }, pokeAPI: { logError: (...args) => errors.push(args) } },
    { setItem() {} }, () => {}, { querySelectorAll: () => [button] }, stoneSellBody);
}

async function testStoneSaleShowsListAndRecoversCity() {
  const calls = [], errors = [], confirms = [], button = { dataset:{ i:'0', cid:'bag1' }, disabled:true, textContent:'Vendendo…', title:'' };
  let sales = 0;
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'stone-preview') return { ok:true, stones:[{ id:1, qty:3, name:'Fire Stone' }], totalQty:3 };
    if (script === 'stone-sale') return ++sales === 1
      ? { ok:false, reason:'Você precisa estar na cidade para vender com o Flint — saia da hunt primeiro.' }
      : { ok:true, sold:3, gold:90 };
    if (script === 'state') return { huntSlug:'bulbasaur', hunt:'Bulbasaur' };
    if (script === 'town') return { ok:true, moved:true };
    if (script === 'tp:bulbasaur') return true;
    throw new Error('script inesperado: ' + script);
  } };
  const result = await makeStoneSeller(webview, errors, button, confirms)(0, 'bag1');
  assert.deepEqual(calls, ['stone-preview', 'stone-sale', 'state', 'town', 'stone-sale', 'tp:bulbasaur']);
  assert.equal(result.ok, true);
  assert.match(confirms[0], /Fire Stone/);
  assert.match(confirms[0], /3 unidades/);
  assert.equal(errors.length, 0);
  assert.equal(button.disabled, false);
}

async function testPokeSaleOtherFailureDoesNotMove() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…', title:'' };
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'poke-preview') return { ok:false, reason:'Nenhum Pokémon permitido para vender' };
    throw new Error('erro não relacionado à cidade não deve mover o personagem');
  } };
  const result = await makePokeSeller(webview, errors, button)(0);
  assert.deepEqual(calls, ['poke-preview']);
  assert.equal(result.ok, false);
  assert.match(errors[0][1], /Nenhum Pokémon permitido/);
  assert.equal(button.disabled, false);
}

async function testPokeSaleGoesToTownWithoutDialog() {
  const calls = [], errors = [], button = { dataset:{ i:'0' }, disabled:true, textContent:'Vendendo…', title:'' };
  let sales = 0;
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script === 'poke-preview') return { ok:true, pokeIds:['p1','p2'], count:2 };
    if (script === 'poke-sale') return ++sales === 1
      ? { ok:false, reason:'Você precisa estar na cidade para vender Pokémon no Mark — saia da hunt primeiro.' }
      : { ok:true, sold:4, gold:500 };
    if (script === 'state') return { huntSlug:'bulbasaur', hunt:'Bulbasaur' };
    if (script === 'town') return { ok:true, moved:true };
    if (script === 'tp:bulbasaur') return true;
    throw new Error('script inesperado: ' + script);
  } };
  const result = await makePokeSeller(webview, errors, button)(0);
  assert.deepEqual(calls, ['poke-preview', 'poke-sale', 'state', 'town', 'poke-sale', 'tp:bulbasaur']);
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
    if (script === 'poke-preview') return { ok:true, pokeIds:['p1','p2'], count:2 };
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
  assert.deepEqual(calls, ['poke-preview', 'poke-sale', 'state', 'town', 'poke-sale', 'tp:bulbasaur']);
  assert.equal(result.ok, false);
  assert.match(errors[0][1], /falha na venda de Pokémon/);
  assert.match(errors[0][1], /retorno à hunt não confirmado/);
  assert.equal(button.disabled, false);
}

(async () => {
  await testCityArrival();
  await testRetryOnlyAfterCity();
  await testCancelledItemSaleDoesNotCallApi();
  await testNoRetryWithoutArrival();
  await testFailedSaleStillReturns();
  await testUnknownHuntDoesNotMove();
  await testTownScriptFailureAttemptsReturn();
  await testPokeSaleDirectDoesNotMove();
  await testPokeSaleOtherFailureDoesNotMove();
  await testPokeSaleGoesToTownWithoutDialog();
  await testPokeSaleFailureStillReturnsSilently();
  await testStoneSaleShowsListAndRecoversCity();
  console.log('Vendas: itens, Pokémon e Stones com prévia, OK, retry único e retorno à hunt OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
