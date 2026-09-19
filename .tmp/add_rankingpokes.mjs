import fs from 'node:fs/promises';
import path from 'node:path';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';

const root=process.cwd();
const inputPath=path.join(root,'outputs','01a0b23b-b076-7253-8fb3-c8a9f4ac4aa3','pokemon_pokepedia_atual.xlsx');
const outputPath=path.join(root,'.tmp','pokemon_pokepedia_atual_edit.xlsx');
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const ranking=wb.worksheets.getItem('Ranking');
const moves=wb.worksheets.getItem('Habilidades');
const rankRows=ranking.getRange('A5:S413').values;
const moveRows=moves.getRange('A5:M3795').values;
const byPokemon=new Map();
for(let i=0;i<moveRows.length;i++){
  const row=moveRows[i],id=row[0],score=row[8];
  if(!byPokemon.has(id))byPokemon.set(id,[]);
  byPokemon.get(id).push({row:i+5,score:Number.isFinite(score)?score:null,power:row[6],sourceOrder:row[2]});
}
const groups=rankRows.map((r,i)=>{
  const id=r[1],name=r[2],rankRow=i+5;
  const selected=(byPokemon.get(id)||[]).sort((a,b)=>b.power-a.power||a.sourceOrder-b.sourceOrder).slice(0,5);
  selected.sort((a,b)=>(b.score??-1)-(a.score??-1)||b.power-a.power||a.sourceOrder-b.sourceOrder);
  return {id,name,rankRow,selected,peak:selected.find(m=>m.score!==null)?.score??null};
});
groups.sort((a,b)=>(b.peak??-1)-(a.peak??-1)||a.name.localeCompare(b.name,'en'));

const sheet=wb.worksheets.add('RankingPokes');
sheet.showGridLines=false;
sheet.getRange('A1:G1').values=[['Rank','Nome','Skill','Tipo','Power','Status Base','Somatório']];
sheet.getRange('A1:G1').format={fill:'#263B53',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},rowHeight:32,verticalAlignment:'center'};
sheet.getRange('A2:G2').format.rowHeight=12;
sheet.getRange('A:A').format.columnWidth=10;
sheet.getRange('B:B').format.columnWidth=22;
sheet.getRange('C:C').format.columnWidth=30;
sheet.getRange('D:D').format.columnWidth=16;
sheet.getRange('E:G').format.columnWidth=16;

const formulas=[];
const endOfGroup=[];
const rankFormula=row=>row===3?'=IF(B3="","",1)':`=IF(B${row}="","",IF(B${row}=B${row-1},A${row-1},A${row-1}+1))`;
for(const group of groups){
  const {rankRow,selected}=group;
  if(selected.length===0){
    formulas.push([rankFormula(formulas.length+3),`='Ranking'!C${rankRow}`,'=""','=""','=""','=""','=""']);
  }else{
    for(const move of selected){
      const mr=move.row;
      formulas.push([rankFormula(formulas.length+3),`='Ranking'!C${rankRow}`,`='Habilidades'!D${mr}`,`='Habilidades'!F${mr}`,`='Habilidades'!G${mr}`,`='Habilidades'!H${mr}`,`='Habilidades'!I${mr}`]);
    }
  }
  endOfGroup.push(formulas.length+2);
}
const lastRow=formulas.length+2;
sheet.getRange(`A3:G${lastRow}`).formulas=formulas;
sheet.getRange(`A3:G${lastRow}`).format.font={name:'Arial',size:10,color:'#17212B'};
sheet.getRange(`A3:G${lastRow}`).format.rowHeight=22;
sheet.getRange(`A3:A${lastRow}`).setNumberFormat('#,##0');
sheet.getRange(`E3:G${lastRow}`).setNumberFormat('#,##0');
sheet.getRange(`A3:A${lastRow}`).format.horizontalAlignment='center';
sheet.getRange(`E3:G${lastRow}`).format.horizontalAlignment='right';
for(const row of endOfGroup) sheet.getRange(`A${row}:G${row}`).format.borders={bottom:{style:'thin',color:'#D9E2EA'}};
sheet.freezePanes.freezeRows(1);
sheet.freezePanes.freezeColumns(2);

const sample=await wb.inspect({kind:'table',range:'RankingPokes!A1:G10',include:'values,formulas',tableMaxRows:10,tableMaxCols:7,maxChars:3000});
console.log(sample.ndjson);
const errors=await wb.inspect({kind:'match',sheetId:'RankingPokes',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:20},maxChars:1000});
console.log('ERRORS',errors.ndjson);
const preview=await wb.render({sheetName:'RankingPokes',range:'A1:G22',scale:1.5,format:'png'});
await fs.writeFile(path.join(root,'.tmp','preview_RankingPokes.png'),new Uint8Array(await preview.arrayBuffer()));
const output=await SpreadsheetFile.exportXlsx(wb);
await output.save(outputPath);
console.log(JSON.stringify({outputPath,lastRow,dataRows:formulas.length,pokemon:groups.length}));
