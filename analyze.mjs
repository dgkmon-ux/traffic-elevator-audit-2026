import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
export function parseCSV(s){
  let rows=[],row=[],v='',quoted=false;
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(c==='"'){if(quoted&&s[i+1]==='"'){v+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&(c===','||c==='\n')){row.push(v.replace(/\r$/,''));v='';if(c==='\n'){rows.push(row);row=[];}}
    else v+=c;
  }
  assert(!quoted,'Unclosed CSV quote');
  if(v||row.length){row.push(v.replace(/\r$/,''));rows.push(row);}
  return rows.filter(r=>r.some(Boolean));
}
assert.deepEqual(parseCSV('a,b\r\n"x,y","z""q"\r\n'),[['a','b'],['x,y','z"q']]);
assert.deepEqual(parseCSV('a,b\n"x\ny",0'),[['a','b'],['x\ny','0']]);
assert.throws(()=>parseCSV('a\n"x'));
const raw=fs.readFileSync(path.join(root,'source.csv'));
const all=parseCSV(new TextDecoder('euc-kr',{fatal:true}).decode(raw));
const headers=all.shift().map(v=>v.trim());
assert.equal(new Set(headers).size,headers.length);
assert(all.every(r=>r.length===headers.length),'CSV column-count mismatch');
const rows=all.map(r=>Object.fromEntries(headers.map((k,i)=>[k,r[i].trim()])));
const H={line:'호선',station:'역  명',name:'관리번호(호기)',start:'시작층(지상_지하)',end:'종료층(지상_지하)',serial:'승강기 일련번호',date:'데이터 기준일자'};
for(const key of Object.values(H))assert(headers.includes(key),'Missing header: '+key);
const groups=new Map(),serials=new Map();
const audit=rows.map((r,index)=>{
  const A=r[H.name].includes('외부');
  const B=[r[H.start],r[H.end]].includes('지상');
  const key=r[H.line]+'|'+r[H.station];
  if(!groups.has(key))groups.set(key,{line:r[H.line],station:r[H.station],rows:0,A:0,B:0});
  const g=groups.get(key);g.rows++;g.A+=+A;g.B+=+B;
  const serial=r[H.serial];if(serial){if(!serials.has(serial))serials.set(serial,[]);serials.get(serial).push(index+1);}
  return {sourceRow:index+1,...r,A,B};
});
const gs=[...groups.values()];
const lineSummary=[...new Set(rows.map(r=>r[H.line]))].sort().map(line=>{
  const subset=audit.filter(r=>r[H.line]===line);
  return {line,rows:subset.length,A:subset.filter(r=>r.A).length,B:subset.filter(r=>r.B).length};
});
const duplicates=[...serials].filter(([,v])=>v.length>1).map(([serial,sourceRows])=>({serial,sourceRows,records:sourceRows.map(i=>rows[i-1])}));
const result={source:'https://www.data.go.kr/data/15044261/fileData.do',retrieved:'2026-10-01',asOf:[...new Set(rows.map(r=>r[H.date]))],sha256:crypto.createHash('sha256').update(raw).digest('hex'),
 rowCount:rows.length,columnCount:headers.length,stationLinePairs:gs.length,A:audit.filter(r=>r.A).length,B:audit.filter(r=>r.B).length,
 crossTab:{both:audit.filter(r=>r.A&&r.B).length,Aonly:audit.filter(r=>r.A&&!r.B).length,Bonly:audit.filter(r=>!r.A&&r.B).length,neither:audit.filter(r=>!r.A&&!r.B).length},
 disagreementGroups:gs.filter(r=>r.A!==r.B).length,zeroApositiveBGroups:gs.filter(r=>r.A===0&&r.B>0).length,missingSerial:rows.filter(r=>!r[H.serial]).length,uniqueSerial:serials.size,duplicateSerialKinds:duplicates.length,duplicateAffectedRows:duplicates.reduce((s,d)=>s+d.sourceRows.length,0),lineSummary,
 limitations:[
 '집계 단위는 기록행과 역명×호선이다. 전체 역사 수나 독립 경로 수가 아니다.',
 'A는 문자 표기, B는 운행층 조건이다. B는 접근 가능성의 정답지가 아니다.',
 '가동·고장·도로부터 승강장까지의 연속 경로·이용자 현장 측정은 포함하지 않는다.'
]};
const out=path.join(root,'results');fs.mkdirSync(out,{recursive:true});
for(const [name,data]of Object.entries({'summary.json':result,'row_audit.json':audit,'duplicate_review.json':duplicates,'station_line.json':gs}))fs.writeFileSync(path.join(out,name),JSON.stringify(data,null,2));
const csvEscape=v=>'"'+String(v).replaceAll('"','""')+'"';
fs.writeFileSync(path.join(out,'station_line.csv'),'\ufeff호선,역명,기록행,A_외부문자,B_지상층\n'+gs.map(g=>[g.line,g.station,g.rows,g.A,g.B].map(csvEscape).join(',')).join('\n'));
console.log(JSON.stringify(result,null,2));
