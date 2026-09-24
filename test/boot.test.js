// Teste de inicializacao: o app tem que ABRIR sempre.
//
// Existe por causa de um incidente real (1.5.5 a 1.5.9): o canal 'webhook:send' ficou registrado
// duas vezes no main.js. O Electron recusa registro repetido e interrompe o carregamento do
// arquivo, entao o programa subia como processo e a janela nunca era criada. Ninguem percebeu por
// quatro versoes porque os testes olhavam outras coisas.
//
// Rode com: npm test    (ou: node test/boot.test.js)
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
let falhas = 0;
const ok = (cond, rotulo) => { console.log((cond ? 'ok   ' : 'FALHA ') + rotulo); if (!cond) falhas++; };

const main = fs.readFileSync(path.join(RAIZ, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(RAIZ, 'preload.js'), 'utf8');
const index = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

console.log('--- registros que o Electron recusa se vierem repetidos ---');
const canais = [...main.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1]);
const repetidos = canais.filter((c, i) => canais.indexOf(c) !== i);
ok(canais.length > 0, 'main.js registra canais de IPC (' + canais.length + ')');
ok(repetidos.length === 0, 'nenhum canal repetido' + (repetidos.length ? ' -> ' + [...new Set(repetidos)].join(', ') : ''));
const expostos = [...preload.matchAll(/exposeInMainWorld\(\s*'([^']+)'/g)].map((m) => m[1]);
ok(expostos.filter((c, i) => expostos.indexOf(c) !== i).length === 0, 'preload sem exposicao repetida');

console.log('--- o main.js carrega de verdade (Electron de mentira, que recusa repetidos) ---');
const registrados = new Set();
const eventos = () => { const o = { on: () => o, once: () => o, removeListener: () => o }; return o; };
const janela = Object.assign(eventos(), {
  loadFile: () => Promise.resolve(), loadURL: () => Promise.resolve(), show() {}, hide() {}, focus() {},
  maximize() {}, minimize() {}, restore() {}, destroy() {}, close() {}, center() {}, setMenu() {},
  setMenuBarVisibility() {}, setSkipTaskbar() {}, setAlwaysOnTop() {}, setBounds() {}, setSize() {}, setTitle() {},
  isMinimized: () => false, isVisible: () => false, isMaximized: () => false, isDestroyed: () => false,
  getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }), getSize: () => [1280, 800],
  webContents: Object.assign(eventos(), {
    send() {}, executeJavaScript: () => Promise.resolve(null), setWindowOpenHandler() {}, setAudioMuted() {},
    setZoomFactor() {}, openDevTools() {}, reload() {}, id: 1, getWebContentsId: () => 1,
    isDestroyed: () => false, hostWebContents: null
  })
});
function JanelaFalsa() { return janela; }
JanelaFalsa.getAllWindows = () => [janela];
JanelaFalsa.fromWebContents = () => janela;
const CAMINHOS = { appData: path.join(RAIZ, '.teste-tmp'), userData: path.join(RAIZ, '.teste-tmp'), temp: path.join(RAIZ, '.teste-tmp'), exe: process.execPath, home: RAIZ, desktop: RAIZ, documents: RAIZ, downloads: RAIZ, logs: RAIZ, crashDumps: RAIZ, sessionData: RAIZ, module: RAIZ };
const eletronFalso = {
  app: Object.assign(eventos(), {
    whenReady: () => Promise.resolve(),
    getPath: (n) => { if (!(n in CAMINHOS)) throw new Error("path desconhecido: " + n); return CAMINHOS[n]; },
    getVersion: () => '0.0.0-teste', getName: () => 'PokeGrid', getAppPath: () => RAIZ, isPackaged: false,
    quit() {}, focus() {}, setAppUserModelId() {}, setLoginItemSettings() {},
    getLoginItemSettings: () => ({ openAtLogin: false }), requestSingleInstanceLock: () => true,
    userAgentFallback: 'Mozilla/5.0 Chrome/150.0.0.0 Electron/43.1.1 Safari/537.36',
    commandLine: { appendSwitch() {} }
  }),
  BrowserWindow: JanelaFalsa,
  // igual ao Electron: canal repetido LANCA. E isto que o incidente exigiu.
  ipcMain: {
    handle(canal) {
      if (registrados.has(canal)) throw new Error("Attempted to register a second handler for '" + canal + "'");
      registrados.add(canal);
    },
    on() {}, removeHandler(c) { registrados.delete(c); }
  },
  shell: { openExternal: () => Promise.resolve(), writeShortcutLink: () => true, showItemInFolder() {}, openPath: () => Promise.resolve('') },
  session: { defaultSession: { setPermissionRequestHandler() {} }, fromPartition: () => ({ setPermissionRequestHandler() {} }) },
  Menu: { buildFromTemplate: (t) => ({ items: t || [] }), setApplicationMenu() {} },
  Tray: function () { return Object.assign(eventos(), { setToolTip() {}, setContextMenu() {}, destroy() {} }); },
  dialog: { showMessageBox: () => Promise.resolve({ response: 1 }), showErrorBox() {} },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => String(b) },
  powerSaveBlocker: { start: () => 1, stop() {}, isStarted: () => false },
  Notification: Object.assign(function () { return { show() {} }; }, { isSupported: () => true }),
  nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
  globalShortcut: { register: () => true, unregisterAll() {} },
  clipboard: { writeText() {} },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) }
};
const Modulo = require('module');
const resolverOriginal = Modulo._resolveFilename;
Modulo._resolveFilename = function (pedido, ...resto) {
  if (pedido === 'electron') return 'electron-de-teste';
  return resolverOriginal.call(this, pedido, ...resto);
};
require.cache['electron-de-teste'] = { id: 'electron-de-teste', filename: 'electron-de-teste', loaded: true, exports: eletronFalso };
try { fs.mkdirSync(path.join(RAIZ, '.teste-tmp'), { recursive: true }); } catch {}
let carregou = true, erroCarga = '';
try { require(path.join(RAIZ, 'main.js')); } catch (e) { carregou = false; erroCarga = e.message; }
ok(carregou, 'main.js carrega sem estourar' + (carregou ? '' : ' -> ' + erroCarga));
ok(registrados.size === canais.length, 'todos os canais foram registrados uma vez (' + registrados.size + ')');

console.log('--- scripts injetados nos paineis parseiam ---');
const pega = (marca) => { const i = index.indexOf(marca); if (i < 0) return null; const ini = index.indexOf('`', i) + 1; return index.slice(ini, index.indexOf('`;', ini)); };
[['READ_STATE', 'READ_STATE = `'], ['READ_ALERTS', 'READ_ALERTS = `('], ['HUNTS_JS', 'const HUNTS_JS = `'], ['SELLGUARD', 'const SELLGUARD = `'], ['READ_BAG_IV', 'const READ_BAG_IV = `'], ['SELL_SAFE_POKES', 'const SELL_SAFE_POKES = `'], ['BUY_UB_BATCH', 'const BUY_UB_BATCH = qty => `'], ['LAYOUTS_JS', 'const LAYOUTS_JS = cfg => `']].forEach(([nome, marca]) => {
  const cru = pega(marca);
  if (cru == null) { ok(false, nome + ' sumiu do index.html'); return; }
  // o template literal e desescapado antes de rodar no painel; aqui fazemos o mesmo
  try { new Function(eval('`' + cru.replace(/\$\{[^}]*\}/g, '0') + '`')); ok(true, nome + ' parseia'); }
  catch (e) { ok(false, nome + ' com erro: ' + e.message.slice(0, 70)); }
});

console.log('--- o <script> da interface parseia ---');
const re = /<script>([\s\S]*?)<\/script>/g; let m, maior = '';
while ((m = re.exec(index))) { if (m[1].length > maior.length) maior = m[1]; }
try { new Function(maior); ok(true, 'index.html parseia (' + maior.length + ' chars)'); }
catch (e) { ok(false, 'index.html nao parseia: ' + e.message.slice(0, 80)); }

console.log('--- estado exigido pelo modo Simples ---');
const declaraCdFC = index.search(/\blet\s+cdFC\s*=/);
const usaCdFC = index.indexOf('SB.catches =');
ok(declaraCdFC >= 0, 'filtros de capturas (cdFC) sao inicializados');
ok(usaCdFC >= 0 && declaraCdFC < usaCdFC, 'cdFC existe antes de o painel de capturas ser montado');
ok(index.includes('class="st-buy-ub-all"') && index.includes('[1000, 5000, 10000]'), 'Resumo Geral oferece compra de UB em 1k, 5k e 10k');
ok(index.includes('function focarJogo(i = ultimoPainelFoco)') && index.includes("wv.addEventListener('focus', () => { ultimoPainelFoco = i; })") && index.includes('else focarJogo();'), 'foco volta ao jogo ao fechar o modo Simples');
ok(index.includes('price:+it.priceGold||+it.npcPrice||+it.price||0'), 'preço de compra das potions usa priceGold');
ok(index.includes("'<span class=\"cd-item-price\">$' + nf(b.price) + '</span>'") && !index.includes('×1000: $'), 'valor unitário não repete o multiplicador de compra');
ok(index.includes('Math.min(1000,Math.floor(gold/unitPrice))') && index.includes("data-price=\"' + (+b.price || 0) + '\""), 'compra até 1000 respeita o gold disponível');
ok(index.includes('stCache[i] = null;') && index.includes('refreshStats();') && index.includes('if (cardsOn) refreshCards(true);'), 'saldos e estoque são atualizados após a compra');
ok(index.includes('id="reloadUi"') && index.includes("getElementById('reloadUi').onclick = () => location.reload()"), 'interface pode recarregar o index.html sem fechar o programa');
ok(index.includes("k.lastIndexOf('ctx', 0) === 0") && main.includes("ctrlPressed = true") && main.includes("if (!ctrlPressed || (params && params.isEditable)) return"), 'Ctrl + clique direito alterna o painel selecionado e clique direito comum fica livre');
ok(index.includes('orreXpMul') && index.includes('depColeta()') && index.includes('id="tierBtn"'), 'recursos oficiais 1.5.15 de Orre, depot e tierlist permanecem');
ok(index.includes('num(p&&p.ivTotal)') && index.includes('nL(p.ivTotal)'), 'formato novo de IV e qualidade funciona nos paineis e na venda personalizada');
ok(index.includes('pokemonGrid.querySelectorAll') && index.includes('ivRecebeSimples(el, true)') && index.includes('data-shared-name=') && index.includes('data-iv-source='), 'janela de Pokémons alimenta a calculadora de IV com os dois botões do mouse');
ok(index.includes('class="account-action depot"') && index.includes('class="account-action market"') && index.includes('openCharacterDepot(i)') && index.includes('openCharacterMarket(i)'), 'cada barra do Grid abre o Baú e o Market da conta correspondente');
ok(index.includes('function maximizaPainel(i)') && index.includes('if (!p.classList.contains(\'expanded\')) p.classList.add(\'expanded\')') && !index.includes('setTimeout(() => toggleExpand(i), 120)'), 'Baú e Market maximizam o painel sem alternar o estado');
ok(index.includes('const bagIvCache = []') && index.includes('BAG_IV_CACHE_MS = 30000') && index.includes('Date.now() - bc.t < BAG_IV_CACHE_MS'), 'modo Simples reutiliza o snapshot de IV por conta');
ok(index.includes("window.addEventListener('focus'") && index.includes('appTemCampoAtivo') && index.includes('focarJogo(); }, 30'), 'retorno do foco do aplicativo restaura o teclado sem roubar campos');
ok(index.includes('pgObsQueue') && index.includes('agendaChat') && index.includes('agendaDock') && index.includes('setTimeout(aplica, 120)'), 'observers dos webviews usam debounce para reduzir varreduras do DOM');
ok(index.includes('cd-team-poke') && index.includes('openHuntTool'), 'duplo clique do time abre a Hunt com os dados do Pokemon');
ok(preload.includes("openHuntTool: (data) => ipcRenderer.invoke('hunt:open', data)") && main.includes("url.searchParams.set('tab', 'route')") && main.includes('HUNT_TOOL_AUTOMATE') && main.includes('ATIVAR SIMULADOR DE BATALHA'), 'ponte segura abre modal com rota e ativa o simulador de batalha');
ok(index.includes("if (e.key === 'F6') { e.preventDefault(); focarJogo(); return; }") && index.includes('if (cardsOn || statsOpen) return') && index.includes('if (!e.ctrlKey && !e.altKey && !e.metaKey) return') && index.includes("else if (k === 'focus') focarJogo()"), 'atalhos da interface nao consomem teclas do jogo');
ok(main.includes("key === 'F6'") && main.includes("send('hotkey', 'focus')") && index.includes("else if (k === 'focus') focarJogo()") && index.includes('cardsEl.addEventListener(\'click\''), 'foco do jogo pode ser recuperado apos usar o dashboard');
ok(index.includes("id=\"pokemonBtn\"") && index.includes("id=\"pokemonOverlay\"") && index.includes("id=\"pokemonSearch\"") && index.includes('openPokemonDepot'), 'janela de Pokemon abre pela barra superior com filtros');
ok(index.includes('data-poke-lock') && index.includes('POKEMON_LOCK_ACTION') && index.includes("type:'poke-lock'") && index.includes('togglePokemonLock'), 'janela consolidada permite bloquear e desbloquear o Pokémon na conta correta');
ok(index.includes('CHAT_POKEMON_ACTION') && index.includes('e.shiftKey') && index.includes("'[poke:'+id+'] '") && index.includes("closest('.chat-box')") && index.includes('Campo público do chat') && index.includes('prepared:true') && !index.includes("new KeyboardEvent('keydown'"), 'Shift + clique apenas prepara a citação nativa no chat público sem enviar automaticamente');
ok(index.includes('id="pokemonType"') && index.includes('id="pokemonSort"') && index.includes("iv-asc") && index.includes("level-desc") && index.includes("level-asc") && index.includes('type1:String(p.type1||\'\')'), 'janela consolidada filtra por tipo e ordena por IV e level');
ok(index.includes("const CDSECTS = ['kpis', 'today', 'table', 'balls', 'bagIv', 'sellItems'") && !index.includes("CDSECTS = ['kpis', 'today', 'table', 'balls', 'bagIv', 'depotPokes'"), 'sessao de Pokemon foi removida do dashboard Simples');
ok(index.includes("depotPokes") && index.includes('cdDpIv') && index.includes('cdDpQ') && index.includes('cdDpShiny'), 'sessao consolidada de Pokemon do depot possui filtros');
ok(index.includes('raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/') && index.includes('data-shared-iv'), 'sessao do depot exibe sprite e dados de IV');
ok(index.includes('id="stFavoriteHunt"') && index.includes('id="stFavoriteTp"') && index.includes('class="st-fav-row"'), 'painel individual mostra favorito e Dar TP na mesma linha');
ok(index.includes("localStorage.setItem('favoritePokeHunts'") && index.includes('favoritePokeHunts[favoriteCid]') && index.includes('goToRecentHunt(statsIdx, chosenFavorite.slug'), 'favorito fica salvo por personagem e reutiliza o teleporte');
ok(index.includes('data-catch-alert=') && index.includes("lsSet('catchAlerts'") && index.includes('avisaCaptura(i, r, x)'), 'alerta de captura fica na Sessao, salvo e ligado apenas a capturas novas');
ok(index.includes("window.pokeAPI.notify('PokeGrid', acc + ' ' + t('msgCatch')") && index.includes('function beepCapture()'), 'alerta de captura toca som e envia notificacao com o Pokemon');
ok(index.includes('id="unstuck"') && index.includes("lsGet('unstuckFarm')") && index.includes('checkUnstuck(i, r)'), 'Opcoes permite ligar e desligar a recuperacao automatica do farm');
ok(index.includes('120000 + Math.floor(Math.random() * 120001)') && index.includes('10000 + Math.floor(Math.random() * 20001)'), 'recuperacao usa espera aleatoria de 2–4 min sem XP e 10–30 s na cidade');
ok(index.includes('executeJavaScript(GO_TOWN_FOR_SALE)).then') && index.includes('unstuckState[i] !== s'), 'recuperacao confirma chegada à cidade e cancela operacoes antigas com seguranca');
ok(index.includes('[data-guide="dock-home"]') && index.includes('GOTO_HUNT_CURRENT(hunt.slug'), 'recuperacao vai para a cidade e retorna para a ultima hunt');
ok(index.includes('id="protectItemsBtn"') && index.includes('id="protectOverlay"') && index.includes('id="protectFilter"'), 'topo abre painel grande de protecao com busca e filtros');
ok(index.includes("localStorage.setItem('protectedItemIds'") && index.includes('protectedItemIds.add(id)') && index.includes('protectedItemIds.delete(id)'), 'itens marcados e desmarcados ficam salvos');
ok(index.includes('!protectedIds.has(String(x.itemId))') && index.includes('const selectedProtection = [...protectedItemIds]') && index.includes('PREVIEW_SAFE_ITEMS(selectedProtection)') && index.includes('SELL_SAFE_ITEMS_SELECTED([...protectedItemIds], confirmedItems)'), 'venda de itens exclui toda protecao personalizada e pede confirmacao com snapshot');
ok(index.includes('PREVIEW_SELECTED_STONES(ids)') && index.includes('SELL_SELECTED_STONES_SELECTED(ids, confirmed)') && index.includes('Clique em OK para vender.'), 'venda de Stones mostra a lista e confirma antes de vender');
ok(index.includes('runMarkAction(j, BUY_CONFIG_BALL(ballId, qtd))'), 'compra pelas opcoes usa o mesmo retorno automatico para a cidade');
ok(index.includes("blocked=/boss|key|card|picture|strange\\\\s+pheromone/i") && index.includes("!['heal','revive','stone'].includes"), 'protecao personalizada preserva todas as regras antigas');
ok(index.includes('id="layoutsBtn"') && index.includes('data-layout="map"') && index.includes("gameLayouts = { map:true"), 'Layouts fica ao lado de Opcoes e inicia com mapa simplificado selecionado');
ok(index.includes("it.image || it.icon || it.sprite || it.img") && index.includes('protectFallbackIcon'), 'catalogo protegido usa todos os campos de imagem e fallback oficial');
ok(index.includes('id="refreshPediaItems"') && index.includes("fetch('/game/items.json',{cache:'no-store'})"), 'Opcoes atualiza itens e imagens da Pokepedia sem cache');
ok(index.includes('const activeMoves=') && index.includes("fetch('/game/creatures.json')") && index.includes("badge.textContent='⚡ '+x.ef+'x'"), 'mapa simplificado calcula vantagem pelos golpes do Pokemon ativo');
ok(index.includes('else if(v===2)v=2.5') && index.includes('else if(v>=4)v=5'), 'mapa aplica multiplicadores especiais 2.5x e 5x do layout Interface');
ok(index.includes('.pg-eff.adv') && index.includes('.pg-eff.max') && index.includes("x.ef>=5?'max':'adv'"), 'mapa diferencia visualmente efetividade 2.5x e 5x');

try { fs.rmSync(path.join(RAIZ, '.teste-tmp'), { recursive: true, force: true }); } catch {}
console.log(falhas ? '\n' + falhas + ' falha(s)' : '\nInicializacao: tudo certo');
process.exit(falhas ? 1 : 0);
