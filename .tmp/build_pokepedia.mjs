import fs from 'node:fs/promises';
import path from 'node:path';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const root = process.cwd();
const source = JSON.parse(await fs.readFile(path.join(root, '.tmp', 'creatures.json'), 'utf8'));
const tmList = JSON.parse(await fs.readFile(path.join(root, '.tmp', 'tm_overrides.json'), 'utf8'));
const tmByType = Object.fromEntries(tmList.map(x => [x.tm, x]));
const creatures = source.creatures.filter(x => x.pokeId < 10000).sort((a, b) => a.pokeId - b.pokeId);
const byId = new Map(creatures.map(x => [x.pokeId, x]));

const typeOrder = ['NORMAL','FIRE','WATER','ELECTRIC','GRASS','ICE','FIGHTING','POISON','GROUND','FLYING','PSYCHIC','BUG','ROCK','GHOST','DRAGON','DARK','STEEL','FAIRY'];
const typePt = {NORMAL:'Normal',FIRE:'Fogo',WATER:'Água',ELECTRIC:'Elétrico',GRASS:'Planta',ICE:'Gelo',FIGHTING:'Lutador',POISON:'Venenoso',GROUND:'Terrestre',FLYING:'Voador',PSYCHIC:'Psíquico',BUG:'Inseto',ROCK:'Pedra',GHOST:'Fantasma',DRAGON:'Dragão',DARK:'Sombrio',STEEL:'Aço',FAIRY:'Fada'};
const rarityPt = {COMMON:'Comum',UNCOMMON:'Incomum',RARE:'Raro',EPIC:'Épico',LEGENDARY:'Lendário',MYTHIC:'Mítico'};
const classPt = {PHYSICAL:'Física',SPECIAL:'Especial',STATUS:'Status'};
// Matriz de efetividade usada pelo jogo, também visível nas fichas da Poképedia.
const chart = {
  NORMAL:{ROCK:.5,GHOST:0,STEEL:.5},
  FIRE:{FIRE:.5,WATER:.5,GRASS:2,ICE:2,BUG:2,ROCK:.5,DRAGON:.5,STEEL:2},
  WATER:{FIRE:2,WATER:.5,GRASS:.5,GROUND:2,ROCK:2,DRAGON:.5},
  ELECTRIC:{WATER:2,ELECTRIC:.5,GRASS:.5,GROUND:0,FLYING:2,DRAGON:.5},
  GRASS:{FIRE:.5,WATER:2,GRASS:.5,POISON:.5,GROUND:2,FLYING:.5,BUG:.5,ROCK:2,DRAGON:.5,STEEL:.5},
  ICE:{FIRE:.5,WATER:.5,GRASS:2,ICE:.5,GROUND:2,FLYING:2,DRAGON:2,STEEL:.5},
  FIGHTING:{NORMAL:2,ICE:2,POISON:.5,FLYING:.5,PSYCHIC:.5,BUG:.5,ROCK:2,GHOST:0,DARK:2,STEEL:2,FAIRY:.5},
  POISON:{GRASS:2,POISON:.5,GROUND:.5,ROCK:.5,GHOST:.5,STEEL:0,FAIRY:2},
  GROUND:{FIRE:2,ELECTRIC:2,GRASS:.5,POISON:2,FLYING:0,BUG:.5,ROCK:2,STEEL:2},
  FLYING:{ELECTRIC:.5,GRASS:2,FIGHTING:2,BUG:2,ROCK:.5,STEEL:.5},
  PSYCHIC:{FIGHTING:2,POISON:2,PSYCHIC:.5,DARK:0,STEEL:.5},
  BUG:{FIRE:.5,GRASS:2,FIGHTING:.5,POISON:.5,FLYING:.5,PSYCHIC:2,GHOST:.5,DARK:2,STEEL:.5,FAIRY:.5},
  ROCK:{FIRE:2,ICE:2,FIGHTING:.5,GROUND:.5,FLYING:2,BUG:2,STEEL:.5},
  GHOST:{NORMAL:0,PSYCHIC:2,GHOST:2,DARK:.5},
  DRAGON:{DRAGON:2,STEEL:.5,FAIRY:0},
  DARK:{FIGHTING:.5,PSYCHIC:2,GHOST:2,DARK:.5,FAIRY:.5},
  STEEL:{FIRE:.5,WATER:.5,ELECTRIC:.5,ICE:2,ROCK:2,STEEL:.5,FAIRY:2},
  FAIRY:{FIRE:.5,FIGHTING:2,POISON:.5,DRAGON:2,DARK:2,STEEL:.5}
};
const attackFactor = (atk, defs) => defs.reduce((v, def) => v * (chart[atk]?.[def] ?? 1), 1);
const fmtFactor = v => Number.isInteger(v) ? `${v}×` : `${String(v).replace('.', ',')}×`;
const urlFor = c => `https://poke.idleworld.online/pokepedia/pokemon/${c.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
const actualAttack = (a, order, c) => {
  const tm = tmByType[String(a.tm || '').toUpperCase()];
  const category = tm?.category ?? a.category ?? 'PHYSICAL';
  const power = tm?.power ?? a.power ?? 0;
  const used = category === 'PHYSICAL' ? c.baseAtk : category === 'SPECIAL' ? c.baseSpAtk : null;
  return {name:a.name, type:String(a.type || 'NORMAL').toUpperCase(), category, power, used,
    score:used === null || power <= 0 ? null : power + used,
    learnLevel:a.learnLevel ?? 1, cooldownMs:a.cooldownMs ?? null, tm:Boolean(a.tm), order};
};

const attacksById = new Map();
const offense = [];
for (const c of creatures) {
  const moves = (c.attacks || []).map((a, i) => actualAttack(a, i + 1, c));
  moves.sort((a,b) => a.learnLevel-b.learnLevel || a.order-b.order);
  moves.forEach((m,i) => { m.displayOrder=i+1; });
  moves.sort((a,b) => (b.score ?? -1) - (a.score ?? -1) || b.power - a.power || a.learnLevel - b.learnLevel || a.order - b.order);
  attacksById.set(c.pokeId, moves);
  offense.push({c, moves, best:moves.find(m => m.score !== null)?.score ?? null});
}
offense.sort((a,b) => (b.best ?? -1) - (a.best ?? -1) || Math.max(b.c.baseAtk,b.c.baseSpAtk) - Math.max(a.c.baseAtk,a.c.baseSpAtk) || a.c.pokeId - b.c.pokeId);

const wb = Workbook.create();
const ranking = wb.worksheets.add('Ranking');
const pokemon = wb.worksheets.add('Pokémon');
const movesSheet = wb.worksheets.add('Habilidades');
const effectiveness = wb.worksheets.add('Efetividade');
const drops = wb.worksheets.add('Drops');
for (const sh of [ranking,pokemon,movesSheet,effectiveness,drops]) sh.showGridLines = false;

function setup(sh, title, subtitle, headers, nRows, tableName) {
  const endCol = colName(headers.length);
  sh.getRange('A1').values = [[title]];
  sh.getRange('A2').values = [[subtitle]];
  sh.getRange(`A4:${endCol}4`).values = [headers];
  sh.getRange(`A1:${endCol}4`).format.font = {name:'Arial',size:10,color:'#17212B'};
  sh.getRange('A1').format.font = {name:'Arial',size:16,bold:true,color:'#17212B'};
  sh.getRange('A2').format.font = {name:'Arial',size:9,italic:true,color:'#52616B'};
  sh.getRange(`A4:${endCol}4`).format = {fill:'#263B53',font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},rowHeight:30,verticalAlignment:'center',wrapText:true};
  sh.getRange(`A4:${endCol}4`).format.borders = {bottom:{style:'thin',color:'#A9B8C7'}};
  sh.getRange(`A5:${endCol}${4+nRows}`).format.font = {name:'Arial',size:10,color:'#17212B'};
  sh.getRange(`A5:${endCol}${4+nRows}`).format.rowHeight = 22;
  sh.freezePanes.freezeRows(4);
  sh.freezePanes.freezeColumns(2);
  const tbl = sh.tables.add(`A4:${endCol}${4+nRows}`,true,tableName);
  tbl.style = 'TableStyleMedium2';
  return endCol;
}
function colName(n) { let s=''; while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s; }

// Dados centrais: um Pokémon por linha, incluindo os seis atributos, tipos e efetividade.
const pokemonHeaders = ['Nº','Pokémon','Tipo 1','Tipo 2','Raridade','PS base','Ataque','Defesa','Ataque especial','Defesa especial','Velocidade','Total base','Principal ofensivo','Nível de caça','XP por abate','Preço NPC','Valor de venda','Evolui para','Nível da evolução','Fonte'];
setup(pokemon,'Pokémon da Poképedia',`${creatures.length} Pokémon da lista principal • atributos e tipos atuais • efetividade calculada a partir dos tipos`,pokemonHeaders,creatures.length,'PokemonDados');
const pokemonRows = creatures.map(c => {
  const types = [c.type1,c.type2].filter(Boolean);
  const incoming = typeOrder.map(t => [t,attackFactor(t,types)]);
  const group = pred => incoming.filter(([,v])=>pred(v)).map(([t,v])=>`${typePt[t]} ${fmtFactor(v)}`).join('; ');
  const advantage = typeOrder.filter(def => types.some(atk => attackFactor(atk,[def])>1)).map(t=>typePt[t]).join('; ');
  const ev = byId.get(c.evolvesToId)?.name || '';
  return [c.pokeId,c.name,typePt[c.type1]||c.type1,typePt[c.type2]||'',rarityPt[c.rarity]||c.rarity,c.baseHp,c.baseAtk,c.baseDef,c.baseSpAtk,c.baseSpDef,c.baseSpeed,null,null,c.huntLevel,c.experience,c.priceNpc,c.sellValue,ev,c.evolveLevel || null,group(v=>v>1),group(v=>v>0&&v<1),group(v=>v===0),advantage,urlFor(c)];
});
pokemon.getRange(`A5:T${4+creatures.length}`).values = pokemonRows.map(row=>[...row.slice(0,19),row[23]]);
pokemon.getRange(`L5:M${4+creatures.length}`).formulas = creatures.map((c,i)=>{const r=i+5;return [`=SUM(F${r}:K${r})`,`=IF(G${r}=I${r},"Empate",IF(G${r}>I${r},"Física","Especial"))`];});
pokemon.getRange('A:A').format.columnWidth = 9;
pokemon.getRange('B:B').format.columnWidth = 22;
pokemon.getRange('C:E').format.columnWidth = 14;
pokemon.getRange('F:L').format.columnWidth = 14;
pokemon.getRange('M:M').format.columnWidth = 19;
pokemon.getRange('N:S').format.columnWidth = 16;
pokemon.getRange('R:R').format.columnWidth = 22;
pokemon.getRange('T:T').format.columnWidth = 68;
pokemon.getRange(`T5:T${4+creatures.length}`).format.borders={left:{style:'thin',color:'#D0D7DE'}};
pokemon.getRange(`F5:L${4+creatures.length}`).setNumberFormat('#,##0');
pokemon.getRange(`N5:Q${4+creatures.length}`).setNumberFormat('#,##0');

const effectHeaders=['Nº','Pokémon','Tipo 1','Tipo 2','Fraquezas','Resistências','Imunidades','Vantagens ofensivas de tipo','Fonte'];
setup(effectiveness,'Efetividade de tipos','Multiplicadores de dano recebido; vantagens ofensivas consideram os tipos próprios contra um tipo defensor isolado',effectHeaders,creatures.length,'PokemonEfetividade');
effectiveness.getRange(`A5:I${4+creatures.length}`).values=pokemonRows.map(row=>[...row.slice(0,4),...row.slice(19,23),row[23]]);
effectiveness.getRange('A:A').format.columnWidth=9;
effectiveness.getRange('B:B').format.columnWidth=22;
effectiveness.getRange('C:D').format.columnWidth=14;
effectiveness.getRange('E:E').format.columnWidth=55;
effectiveness.getRange('F:F').format.columnWidth=75;
effectiveness.getRange('G:G').format.columnWidth=24;
effectiveness.getRange('H:H').format.columnWidth=55;
effectiveness.getRange('I:I').format.columnWidth=68;
effectiveness.getRange(`E5:H${4+creatures.length}`).format.wrapText=true;
pokemonRows.forEach((row,i)=>{
  const longest=Math.max(...row.slice(19,23).map(v=>String(v||'').length));
  const lines=Math.max(1,Math.ceil(longest/60));
  effectiveness.getRange(`A${i+5}:I${i+5}`).format.rowHeight=Math.max(28,lines*16+10);
});
effectiveness.getRange(`I5:I${4+creatures.length}`).format.borders={left:{style:'thin',color:'#D0D7DE'}};

// Todos os golpes da ficha atual; pontuação em fórmula para reproduzir o cálculo do modelo.
const moveHeaders = ['Nº','Pokémon','Ordem na ficha','Habilidade','Tipo do golpe','Classe','Poder','Atributo base usado','Força estimada','Aprende no nível','Recarga (s)','MT','Fonte'];
const moveRecords = [];
const moveRowByObject = new Map();
for (const c of creatures) for (const m of attacksById.get(c.pokeId)) moveRecords.push({c,m});
setup(movesSheet,'Habilidades',`${moveRecords.length} golpes • força estimada = poder + Ataque (Física) ou Ataque especial (Especial); Status sem pontuação`,moveHeaders,moveRecords.length,'PokemonHabilidades');
const moveValues = moveRecords.map(({c,m})=>[c.pokeId,c.name,m.displayOrder,m.name,typePt[m.type]||m.type,classPt[m.category]||m.category,m.power,null,null,m.learnLevel,m.cooldownMs===null?null:m.cooldownMs/1000,m.tm?'Sim':'',urlFor(c)]);
movesSheet.getRange(`A5:M${4+moveRecords.length}`).values = moveValues;
const pokemonRowById = new Map(creatures.map((c,i)=>[c.pokeId,i+5]));
const moveFormulas = moveRecords.map(({c,m},i)=>{
  const r=i+5, pr=pokemonRowById.get(c.pokeId);
  moveRowByObject.set(m,r);
  return [`=IF(F${r}="Física",'Pokémon'!G${pr},IF(F${r}="Especial",'Pokémon'!I${pr},""))`,`=IF(OR(F${r}="Status",G${r}=0),"",G${r}+H${r})`];
});
movesSheet.getRange(`H5:I${4+moveRecords.length}`).formulas = moveFormulas;
movesSheet.getRange('A:A').format.columnWidth=9;
movesSheet.getRange('B:B').format.columnWidth=22;
movesSheet.getRange('C:C').format.columnWidth=16;
movesSheet.getRange('D:D').format.columnWidth=27;
movesSheet.getRange('E:F').format.columnWidth=17;
movesSheet.getRange('G:K').format.columnWidth=17;
movesSheet.getRange('L:L').format.columnWidth=9;
movesSheet.getRange('M:M').format.columnWidth=68;
movesSheet.getRange(`M5:M${4+moveRecords.length}`).format.borders={left:{style:'thin',color:'#D0D7DE'}};
movesSheet.getRange(`G5:J${4+moveRecords.length}`).setNumberFormat('#,##0');
movesSheet.getRange(`K5:K${4+moveRecords.length}`).setNumberFormat('0.0');

// Ranking e cinco habilidades mais fortes, no formato de leitura do arquivo de referência.
const rankHeaders = ['Posição','Nº','Pokémon','Tipo 1','Tipo 2','Ataque','Ataque especial','Maior ofensiva','Atributo principal','Melhor habilidade','Tipo do golpe','Classe','Poder','Força estimada','2ª habilidade','3ª habilidade','4ª habilidade','5ª habilidade','Fonte'];
setup(ranking,'Ranking ofensivo',`${creatures.length} Pokémon; ${offense.filter(x=>x.best!==null).length} com golpes ofensivos • força estimada = poder + atributo base da classe`,rankHeaders,creatures.length,'PokemonRanking');
let lastScore=null, rank=0;
const rankRows = offense.map(({c,moves,best},i)=>{
  if(best!==null&&best!==lastScore)rank=i+1;
  if(best!==null)lastScore=best;
  return [best===null?null:rank,c.pokeId,c.name,typePt[c.type1]||c.type1,typePt[c.type2]||'',c.baseAtk,c.baseSpAtk,null,null,null,null,null,null,null,null,null,null,null,urlFor(c)];
});
ranking.getRange(`A5:S${4+creatures.length}`).values=rankRows;
const rankFormulaRows = offense.map(({c,moves},i)=>{
  const r=i+5, pr=pokemonRowById.get(c.pokeId);
  const top=moves.filter(m=>m.score!==null).slice(0,5);
  const mr=top[0]?moveRowByObject.get(top[0]):null;
  const base=[`=MAX(F${r}:G${r})`,`='Pokémon'!M${pr}`];
  if(mr){base.push(`='Habilidades'!D${mr}`,`='Habilidades'!E${mr}`,`='Habilidades'!F${mr}`,`='Habilidades'!G${mr}`,`='Habilidades'!I${mr}`);}
  else base.push('=""','=""','=""','=""','=""');
  for(let j=1;j<5;j++){
    const row=top[j]?moveRowByObject.get(top[j]):null;
    base.push(row?`='Habilidades'!D${row}&" ("&'Habilidades'!I${row}&")"`:'=""');
  }
  return base;
});
ranking.getRange(`H5:R${4+creatures.length}`).formulas=rankFormulaRows;
ranking.getRange('A:B').format.columnWidth=11;
ranking.getRange('C:C').format.columnWidth=22;
ranking.getRange('D:E').format.columnWidth=14;
ranking.getRange('F:H').format.columnWidth=17;
ranking.getRange('I:I').format.columnWidth=20;
ranking.getRange('J:J').format.columnWidth=27;
ranking.getRange('K:L').format.columnWidth=16;
ranking.getRange('M:N').format.columnWidth=18;
ranking.getRange('O:R').format.columnWidth=32;
ranking.getRange('S:S').format.columnWidth=68;
ranking.getRange(`S5:S${4+creatures.length}`).format.borders={left:{style:'thin',color:'#D0D7DE'}};
ranking.getRange(`F5:H${4+creatures.length}`).setNumberFormat('#,##0');
ranking.getRange(`M5:N${4+creatures.length}`).setNumberFormat('#,##0');

// Itens soltos, com a probabilidade em porcentagem já exibida na ficha da Poképedia.
const dropRecords=[];
for(const c of creatures) for(const item of c.loot||[]) dropRecords.push({c,item});
const dropHeaders=['Nº','Pokémon','Item','Quantidade mínima','Quantidade máxima','Chance','Fonte'];
setup(drops,'Drops',`${dropRecords.length} itens • chance conforme a Poképedia (valor da fonte ÷ 1000, em %)`,dropHeaders,dropRecords.length,'PokemonDrops');
drops.getRange(`A5:G${4+dropRecords.length}`).values=dropRecords.map(({c,item})=>[c.pokeId,c.name,item.name,item.minCount,item.maxCount,(item.chance||0)/100000,urlFor(c)]);
drops.getRange('A:A').format.columnWidth=9;
drops.getRange('B:B').format.columnWidth=22;
drops.getRange('C:C').format.columnWidth=30;
drops.getRange('D:E').format.columnWidth=20;
drops.getRange('F:F').format.columnWidth=15;
drops.getRange('G:G').format.columnWidth=68;
drops.getRange(`G5:G${4+dropRecords.length}`).format.borders={left:{style:'thin',color:'#D0D7DE'}};
drops.getRange(`F5:F${4+dropRecords.length}`).setNumberFormat('0.00%');

const outDir=path.join(root,'outputs','01a0b23b-b076-7253-8fb3-c8a9f4ac4aa3');
await fs.mkdir(outDir,{recursive:true});
for(const [sh,range] of [[ranking,'A1:N12'],[pokemon,'A1:T12'],[movesSheet,'A1:M12'],[effectiveness,'A1:I12'],[drops,'A1:G12']]){
  const blob=await wb.render({sheetName:sh.name,range,scale:1.5,format:'png'});
  await fs.writeFile(path.join(root,'.tmp',`preview_${sh.name}.png`),new Uint8Array(await blob.arrayBuffer()));
}
for(const [sh,range] of [[ranking,'A1:S7'],[pokemon,'A1:T7'],[movesSheet,'A1:M7'],[effectiveness,'A1:I7'],[drops,'A1:G7']]){
  const result=await wb.inspect({kind:'table',range:`${sh.name}!${range}`,include:'values,formulas',tableMaxRows:7,tableMaxCols:24,maxChars:3800});
  console.log(sh.name,result.ndjson);
}
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:20},summary:'final formula error scan',maxChars:2000});
console.log('FORMULA_ERRORS',errors.ndjson);
const output=await SpreadsheetFile.exportXlsx(wb);
const out=path.join(outDir,'pokemon_pokepedia_atual.xlsx');
await output.save(out);
console.log(JSON.stringify({file:out,pokemon:creatures.length,moves:moveRecords.length,drops:dropRecords.length,ranked:offense.filter(x=>x.best!==null).length}));
