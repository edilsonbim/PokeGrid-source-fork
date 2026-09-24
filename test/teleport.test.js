'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = index.indexOf('const GOTO_HUNT_CURRENT =');
const end = index.indexOf('const BUY_1000_BALL =', start);
assert(start >= 0 && end > start, 'função de teleporte encontrada');
const makeTeleport = new Function(index.slice(start, end) + '\nreturn GOTO_HUNT_CURRENT;')();

function injectedScript(variable, next) {
  const begin = index.indexOf('const ' + variable + ' = `');
  const finish = index.indexOf(next, begin);
  assert(begin >= 0 && finish > begin, variable + ' encontrado');
  return new Function(index.slice(begin, finish) + '\nreturn ' + variable + ';')();
}

function classes(...names) {
  const values = new Set(names);
  return { contains: name => values.has(name), add: name => values.add(name), delete: name => values.delete(name) };
}

async function simulate({ destination, locked = false, ignored = false, guide = 'hunt-' + destination.toLowerCase(), label = destination }) {
  let opened = false, active = 'Kanto', traveled = false;
  const poke = { lastSlug: 'bulbasaur', ws: { 'field-init': { slug: 'bulbasaur' } } };
  const marker = {
    dataset: { guide }, classList: classes(), disabled: false, isConnected: true,
    querySelector: selector => selector === '.hunt-name' ? { textContent: label } : null,
    click() { traveled = true; if (!ignored) { poke.lastSlug = destination.toLowerCase(); poke.ws['field-init'] = { slug: poke.lastSlug }; this.classList.add('here'); } }
  };
  const areas = ['Kanto', 'Outland', 'Orre', 'Nightmare'].map(name => ({
    name, disabled: false, classList: classes(...(name === 'Kanto' ? ['on'] : []), ...(name === 'Nightmare' && locked ? ['locked'] : [])),
    querySelector: selector => selector === 'img[alt]' ? { alt: name } : null,
    click() { areas.forEach(area => area.classList.delete('on')); this.classList.add('on'); active = name; }
  }));
  const document = {
    querySelector(selector) {
      if (selector === '.map-window') return opened ? {} : null;
      if (selector === '[data-guide="dock-map"]') return { click() { opened = true; } };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.map-window button.hunt-marker') return opened && active === (locked ? 'Nightmare' : 'Outland') ? [marker] : [];
      if (selector === '.map-areas button.map-plate,.map-areas button.map-area') return opened ? areas : [];
      return [];
    }
  };
  const context = { document, window: { __poke: poke }, setTimeout: callback => setTimeout(callback, 0), Promise };
  const success = await vm.runInNewContext(makeTeleport(destination.toLowerCase(), label), context);
  return { success, active, traveled, opened };
}

(async () => {
  const outland = await simulate({ destination: 'Brave Blastoise' });
  assert.equal(outland.success, true);
  assert.equal(outland.active, 'Outland');
  assert.equal(outland.traveled, true);

  const renamed = await simulate({ destination: 'Lavender', guide: 'hunt-pewter' });
  assert.equal(renamed.success, true, 'nome visível encontra hunt mesmo com guide antigo');

  const stale = await simulate({ destination: 'Bulbasaur' });
  assert.equal(stale.success, true);
  assert.equal(stale.traveled, true, 'slug guardado não impede retorno da cidade à mesma hunt');

  const blocked = await simulate({ destination: 'Nightmare', locked: true });
  assert.equal(blocked.success, false, 'região bloqueada não é acionada');
  assert.equal(blocked.traveled, false);

  const ignored = await simulate({ destination: 'Brave Blastoise', ignored: true });
  assert.equal(ignored.success, false, 'clique ignorado pelo jogo não vira sucesso falso');

  for (const [variable, next, text] of [
    ['openMarketHere', 'return w.executeJavaScript(openMarketHere)', 'Abrir Market'],
    ['openDepot', 'w.executeJavaScript(openDepot)', 'Abrir Depot']
  ]) {
    let clicked = false, depotVisible = false;
    const button = { tagName: 'BUTTON', textContent: text, className: '', disabled: false, getClientRects: () => [1], getAttribute: () => '', hasAttribute: () => false, click() { clicked = true; if (text === 'Abrir Depot') depotVisible = true; } };
    const document = {
      querySelector: selector => selector.includes('dep-window') && depotVisible ? { className: 'npc-dialog', innerText: 'Depot Abrir Depósito', getBoundingClientRect: () => ({ width: 300, height: 200 }) } : null,
      querySelectorAll: selector => selector.includes('dep-window') && depotVisible ? [{ className: 'npc-dialog', innerText: 'Depot Abrir Depósito', getBoundingClientRect: () => ({ width: 300, height: 200 }) }] : (selector.includes('button') ? [button] : [])
    };
    const script = injectedScript(variable, next);
    const result = await vm.runInNewContext(script, { document, location: { href: 'https://poke.idleworld.online/play' }, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), setTimeout: callback => setTimeout(callback, 0), Promise });
    assert.equal(result.ok, true, text + ' direto funciona sem hook interno do jogo');
    assert.equal(clicked, true);
  }

  console.log('Teleporte e ícones: placas novas, região bloqueada, Market e Depot OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
