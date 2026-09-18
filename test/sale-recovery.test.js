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

const sellBody = extract('const sellItemsBusy =', 'function sellSafePokes');
function makeSeller(webview, alerts, confirms) {
  const build = new Function('webviews', 'off', 'protectedItemIds', 'SELL_SAFE_ITEMS_V2', 'window', 'tabNames', 'stName', 'READ_STATE', 'GO_TOWN_FOR_SALE', 'GOTO_HUNT_CURRENT', 'nf', 'refreshCards', sellBody + '\nreturn sellSafeItems;');
  return build([webview], [false], new Set(['59195']), ids => 'sale:' + ids.join(','),
    { alert: msg => alerts.push(msg), confirm: msg => { confirms.push(msg); return true; } },
    ['Treinador 1'], () => 'Conta 1', 'state', 'town', slug => 'tp:' + slug, String, () => {});
}

async function testRetryOnlyAfterCity() {
  const calls = [], alerts = [], confirms = [];
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
  await makeSeller(webview, alerts, confirms)(0);
  assert.deepEqual(calls, ['sale:59195', 'state', 'town', 'sale:59195', 'tp:bulbasaur']);
  assert.equal(confirms.length, 1);
  assert.match(alerts[0], /Venda concluída/);
}

async function testNoRetryWithoutArrival() {
  const calls = [], alerts = [], confirms = [];
  const webview = { async executeJavaScript(script) {
    calls.push(script);
    if (script.startsWith('sale:')) return { ok:false, reason:'Você precisa estar na cidade para vender no Mark' };
    if (script === 'state') return { huntSlug:'bulbasaur' };
    if (script === 'town') return { ok:false, reason:'cidade não confirmada' };
    throw new Error('script inesperado');
  } };
  await makeSeller(webview, alerts, confirms)(0);
  assert.deepEqual(calls, ['sale:59195', 'state', 'town']);
  assert.match(alerts[0], /cidade não confirmada/);
}

(async () => {
  await testCityArrival();
  await testRetryOnlyAfterCity();
  await testNoRetryWithoutArrival();
  console.log('Venda: chegada à cidade, retry único e proteções preservadas OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
