
window.addEventListener('error',e=>{
  console.error(e.error||e.message);
  let box=document.getElementById('runtimeError');
  if(!box){
    box=document.createElement('div');
    box.id='runtimeError';
    box.style.cssText='position:fixed;left:16px;bottom:16px;z-index:9999;background:#7c2139;color:#fff;padding:10px 14px;border-radius:10px;font:12px Segoe UI,Arial;max-width:520px;box-shadow:0 4px 18px rgba(0,0,0,.25)';
    document.body.appendChild(box);
  }
  box.textContent='Ошибка интерфейса: '+(e.message||'неизвестная ошибка');
});
const $=id=>document.getElementById(id);
const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Math.round(Number(n)||0));
const fmt1=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(Number(n)||0);
const colors={storage:'#d8bdf0',process:'#f4c2dc',staff:'#c7d5ef',service:'#d5ddcf',equipment:'#e6d3a9',custom:'#d8d8e8'};
const names={accept:'Приёмка',putaway:'Раскладка',pick:'Сборка',ship:'Отгрузка'};

const defaults={
  roomL:20,roomW:10,roomH:3,avgSkuL:4.5,targetFlow:100000,simFlow:100000,layoutMode:'balanced',
  centralAisle:1.6,rackL:1.2,rackD:0.5,rackH:2.5,shelves:5,aisle:1.2,fillPct:95,
  normAccept:2750,normPutaway:2750,normPick:1500,normShip:3500,
  opsPerShift:3,shiftsPerDay:2,paidHours:11,opRate:400,seniors:2,seniorSalary:90000,managers:1,managerSalary:130000,
  cameraRange:3.4,coverageStep:0.8,zones:[],columns:[],objects:[],avgFlow:100000,maxFlow:120000,fixedPC:2,fixedTsd:3,fixedTablet:2,rent:300000,capex:2921881
};

let state=JSON.parse(localStorage.getItem('mfcPlannerV61')||'null');
if(!state){
  state=JSON.parse(localStorage.getItem('mfcPlannerV5')||'null')||structuredClone(defaults);
}
for(const k in defaults){if(state[k]===undefined) state[k]=structuredClone(defaults[k]);}
let selected={kind:null,index:null,name:null};
let mode='move', drag=null;

function save(){localStorage.setItem('mfcPlannerV61',JSON.stringify(state));}
function rectsOverlap(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function pointInRect(p,r){return p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function getZone(n){return state.zones.find(z=>z.name===n)}
function area(r){return Math.max(0,r.w*r.h)}
function colAreaIn(r){return state.columns.reduce((s,c)=>{if(!rectsOverlap(r,c))return s;const x1=Math.max(r.x,c.x),x2=Math.min(r.x+r.w,c.x+c.w),y1=Math.max(r.y,c.y),y2=Math.min(r.y+r.h,c.y+c.h);return s+Math.max(0,x2-x1)*Math.max(0,y2-y1)},0)}
function netArea(r){return Math.max(0,area(r)-colAreaIn(r))}
function selectedArray(){
  if(selected.kind==='zone') return state.zones;
  if(selected.kind==='column') return state.columns;
  if(selected.kind==='object') return state.objects;
  return [];
}
function objectColor(o){
  return o.color || colors[o.type] || colors.custom || '#d8d8e8';
}

function initZones(){
  const L=state.roomL,W=state.roomW;
  state.zones=[
    {name:'Коридор персонала',type:'service',x:0,y:0,w:2.2,h:W,locked:false},
    {name:'Раздевалка',type:'staff',x:.2,y:1,w:1.8,h:2,locked:false},
    {name:'Офис',type:'staff',x:.2,y:3.3,w:1.8,h:2.4,locked:false},
    {name:'WC',type:'service',x:.2,y:6,w:1.8,h:1.3,locked:false},
    {name:'Хранение',type:'storage',x:2.4,y:.2,w:L-2.8,h:W-3.2,locked:false},
    {name:'Центральный проход',type:'service',x:2.4,y:(W-3.2)/2-state.centralAisle/2+.2,w:L-2.8,h:state.centralAisle,locked:false},
    {name:'Приёмка',type:'process',x:2.4,y:W-2.6,w:5,h:2.2,locked:false},
    {name:'Сборка',type:'process',x:7.7,y:W-2.6,w:5,h:2.2,locked:false},
    {name:'Отгрузка',type:'process',x:13,y:W-2.6,w:4.2,h:2.2,locked:false},
    {name:'Вход поставщиков',type:'service',x:L/2-1.5,y:W-.6,w:3,h:.6,locked:false},
    {name:'Вход/выход персонала',type:'service',x:0,y:W/2-.8,w:.4,h:1.6,locked:false},
    {name:'Эвакуационный выход',type:'service',x:L-.4,y:W/2-.8,w:.4,h:1.6,locked:false},
  ];
}
if(!state.zones.length)initZones();

function optimize(){
  const L=state.roomL,W=state.roomW;
  let procDepth=state.layoutMode==='capacity'?2.0:state.layoutMode==='flow'?2.8:2.4;
  procDepth=Math.min(procDepth,W*.32);
  const left=2.2, main=L-left-.2, py=W-procDepth-.2;
  const ar=state.layoutMode==='flow'?.34:.32, pr=state.layoutMode==='flow'?.40:.36;
  const aw=main*ar,pw=main*pr,sw=main-aw-pw;
  const storage={name:'Хранение',type:'storage',x:left+.2,y:.2,w:main,h:py-.4,locked:false};
  const cy=storage.y+storage.h/2-state.centralAisle/2;
  state.zones=[
    {name:'Коридор персонала',type:'service',x:0,y:0,w:left,h:W,locked:false},
    {name:'Раздевалка',type:'staff',x:.2,y:1,w:left-.4,h:2,locked:false},
    {name:'Офис',type:'staff',x:.2,y:3.3,w:left-.4,h:2.4,locked:false},
    {name:'WC',type:'service',x:.2,y:6,w:left-.4,h:1.3,locked:false},
    storage,
    {name:'Центральный проход',type:'service',x:storage.x,y:cy,w:storage.w,h:state.centralAisle,locked:false},
    {name:'Приёмка',type:'process',x:storage.x,y:py,w:aw,h:procDepth,locked:false},
    {name:'Сборка',type:'process',x:storage.x+aw,y:py,w:pw,h:procDepth,locked:false},
    {name:'Отгрузка',type:'process',x:storage.x+aw+pw,y:py,w:sw,h:procDepth,locked:false},
    {name:'Вход поставщиков',type:'service',x:L/2-1.5,y:W-.6,w:3,h:.6,locked:false},
    {name:'Вход/выход персонала',type:'service',x:0,y:W/2-.8,w:.4,h:1.6,locked:false},
    {name:'Эвакуационный выход',type:'service',x:L-.4,y:W/2-.8,w:.4,h:1.6,locked:false},
  ];
  render();
}

function splitStorageBlocks(){
  const s=getZone('Хранение'), c=getZone('Центральный проход');
  if(!s)return [];
  if(!c||!rectsOverlap(s,c))return [s];
  const topH=Math.max(0,c.y-s.y);
  const bottomY=c.y+c.h;
  const bottomH=Math.max(0,s.y+s.h-bottomY);
  const blocks=[];
  if(topH>.2)blocks.push({x:s.x,y:s.y,w:s.w,h:topH});
  if(bottomH>.2)blocks.push({x:s.x,y:bottomY,w:s.w,h:bottomH});
  return blocks;
}

function rackLayoutForBlock(b,orientation){
  if(orientation==='horizontal'){
    const rows=[];for(let y=b.y;y+state.rackD<=b.y+b.h+1e-9;y+=state.rackD+state.aisle)rows.push(y);
    const sec=Math.floor(b.w/Math.max(.1,state.rackL));return {orientation,rows,sec,total:rows.length*sec}
  }else{
    const cols=[];for(let x=b.x;x+state.rackD<=b.x+b.w+1e-9;x+=state.rackD+state.aisle)cols.push(x);
    const sec=Math.floor(b.h/Math.max(.1,state.rackL));return {orientation,cols,sec,total:cols.length*sec}
  }
}
function rackPlan(){
  const blocks=splitStorageBlocks();
  let best=null;
  for(const orientation of ['horizontal','vertical']){
    let total=0,parts=[];
    blocks.forEach(b=>{const p=rackLayoutForBlock(b,orientation);total+=p.total;parts.push({b,p})});
    if(!best||total>best.total)best={orientation,total,parts};
  }
  return best||{orientation:'horizontal',total:0,parts:[]};
}

function processModel(flow){
  const daily=flow/30,norms={accept:state.normAccept,putaway:state.normPutaway,pick:state.normPick,ship:state.normShip};
  let total=0,req={};for(const k in norms){req[k]=daily/Math.max(1,norms[k]);total+=req[k]}
  const team=state.opsPerShift*state.shiftsPerDay, labor=Object.values(norms).reduce((s,n)=>s+1/Math.max(1,n),0);
  return {daily,norms,req,total,util:team?total/team:Infinity,maxMonthly:team/labor*30,min:Math.ceil(total/state.shiftsPerDay),rec:Math.ceil((total/.85)/state.shiftsPerDay),bottleneck:Object.keys(req).sort((a,b)=>req[b]-req[a])[0]}
}

function lineHitsRect(a,b,r){
  if(pointInRect(a,r)||pointInRect(b,r))return true;
  const seg=(p1,p2,p3,p4)=>{const d=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);const o1=d(p1,p2,p3),o2=d(p1,p2,p4),o3=d(p3,p4,p1),o4=d(p3,p4,p2);return ((o1>0)!=(o2>0))&&((o3>0)!=(o4>0))}
  const q=[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}];
  return seg(a,b,q[0],q[1])||seg(a,b,q[1],q[2])||seg(a,b,q[2],q[3])||seg(a,b,q[3],q[0])
}
function storageCameras(){
  const blocks=splitStorageBlocks(),step=Math.max(.5,state.coverageStep),range=Math.max(1,state.cameraRange),samples=[];
  blocks.forEach(b=>{for(let x=b.x+step/2;x<b.x+b.w;x+=step)for(let y=b.y+step/2;y<b.y+b.h;y+=step){const p={x,y};if(!state.columns.some(c=>pointInRect(p,c)))samples.push(p)}})
  const candidates=[];blocks.forEach(b=>{for(let x=b.x+.3;x<b.x+b.w;x+=Math.max(1,range*.9))for(let y=b.y+.3;y<b.y+b.h;y+=Math.max(1,range*.9)){const p={x,y};if(!state.columns.some(c=>pointInRect(p,c)))candidates.push(p)}})
  const visible=(cam,p)=>Math.hypot(cam.x-p.x,cam.y-p.y)<=range&&!state.columns.some(c=>lineHitsRect(cam,p,c));
  let uncovered=samples.slice(),cams=[];
  while(uncovered.length&&cams.length<80){
    let best=null,cover=[];
    for(const cand of candidates){const cc=uncovered.filter(p=>visible(cand,p));if(cc.length>cover.length){best=cand;cover=cc}}
    if(!best||!cover.length)break;
    cams.push(best);const set=new Set(cover.map(p=>p.x+'|'+p.y));uncovered=uncovered.filter(p=>!set.has(p.x+'|'+p.y))
  }
  return {cams,uncovered,total:samples.length,covered:samples.length-uncovered.length}
}

function analytics(){
  const rp=rackPlan(),vol=rp.total*state.rackL*state.rackD*state.rackH,cap100=vol*1000/state.avgSkuL,cap=cap100*state.fillPct/100;
  const pm=processModel(state.targetFlow),cams=storageCameras();
  const userCams=state.objects.filter(o=>o.objectKind==='camera').length;
  const other=7+userCams;
  const currentFOT=state.opsPerShift*state.shiftsPerDay*state.paidHours*30*state.opRate + state.seniors*state.seniorSalary + state.managers*state.managerSalary;
  const autoFOT=pm.rec*state.shiftsPerDay*state.paidHours*30*state.opRate + state.seniors*state.seniorSalary + state.managers*state.managerSalary;
  const storage=getZone('Хранение');
  const processArea=state.zones.filter(z=>z.type==='process').reduce((s,z)=>s+netArea(z),0)+state.objects.filter(o=>o.type==='process').reduce((s,o)=>s+area(o),0);
  const supportArea=state.zones.filter(z=>z.type!=='process'&&z.type!=='storage').reduce((s,z)=>s+netArea(z),0)+state.objects.filter(o=>o.type!=='process'&&o.type!=='storage').reduce((s,o)=>s+area(o),0);
  return {rp,vol,cap100,cap,pm,cams,totalCams:cams.cams.length+other,area:state.roomL*state.roomW,storageArea:storage?netArea(storage):0,processArea,supportArea,currentFOT,autoFOT,currentOpex:currentFOT+state.rent,autoOpex:autoFOT+state.rent,userCams};
}

function draw(){
  const svg=$('plan');svg.innerHTML='';const ns='http://www.w3.org/2000/svg',W=940,H=520,sc=Math.min(W/state.roomL,H/state.roomW),ox=(1000-state.roomL*sc)/2,oy=(590-state.roomW*sc)/2;
  const add=(tag,attrs,parent=svg)=>{const e=document.createElementNS(ns,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);parent.appendChild(e);return e};
  add('rect',{x:ox,y:oy,width:state.roomL*sc,height:state.roomW*sc,class:'room'});
  for(let i=1;i<state.roomL;i++)add('line',{x1:ox+i*sc,y1:oy,x2:ox+i*sc,y2:oy+state.roomW*sc,class:'grid'});
  for(let i=1;i<state.roomW;i++)add('line',{x1:ox,y1:oy+i*sc,x2:ox+state.roomL*sc,y2:oy+i*sc,class:'grid'});

  state.zones.forEach((z,idx)=>{
    const g=add('g',{'data-kind':'zone','data-index':idx,class:'obj'});
    add('rect',{x:ox+z.x*sc,y:oy+z.y*sc,width:z.w*sc,height:z.h*sc,rx:7,fill:colors[z.type],class:'zone'+(selected.kind==='zone'&&selected.index===idx?' selected':'')},g);
    add('text',{x:ox+z.x*sc+7,y:oy+z.y*sc+18,class:'label'},g).textContent=z.name;
    add('text',{x:ox+z.x*sc+7,y:oy+z.y*sc+33,class:'sub'},g).textContent=fmt1(netArea(z))+' м²';
    if(mode==='resize'&&selected.kind==='zone'&&selected.index===idx)add('rect',{x:ox+(z.x+z.w)*sc-8,y:oy+(z.y+z.h)*sc-8,width:16,height:16,class:'handle'},g)
  });

  state.objects.forEach((o,idx)=>{
    const g=add('g',{'data-kind':'object','data-index':idx,class:'obj'});
    add('rect',{x:ox+o.x*sc,y:oy+o.y*sc,width:o.w*sc,height:o.h*sc,rx:6,fill:objectColor(o),class:'zone'+(selected.kind==='object'&&selected.index===idx?' selected':'')},g);
    add('text',{x:ox+o.x*sc+7,y:oy+o.y*sc+18,class:'label'},g).textContent=o.name;
    add('text',{x:ox+o.x*sc+7,y:oy+o.y*sc+33,class:'sub'},g).textContent=fmt1(area(o))+' м²';
    if(mode==='resize'&&selected.kind==='object'&&selected.index===idx)add('rect',{x:ox+(o.x+o.w)*sc-8,y:oy+(o.y+o.h)*sc-8,width:16,height:16,class:'handle'},g)
  });

  state.columns.forEach((c,idx)=>{
    const g=add('g',{'data-kind':'column','data-index':idx,class:'obj'});
    add('rect',{x:ox+c.x*sc,y:oy+c.y*sc,width:c.w*sc,height:c.h*sc,rx:4,class:'column'+(selected.kind==='column'&&selected.index===idx?' selected':'')},g);
    if(mode==='resize'&&selected.kind==='column'&&selected.index===idx)add('rect',{x:ox+(c.x+c.w)*sc-8,y:oy+(c.y+c.h)*sc-8,width:16,height:16,class:'handle'},g)
  });

  const a=analytics();
  a.rp.parts.forEach(({b,p})=>{
    if(a.rp.orientation==='horizontal')p.rows.forEach(y=>{for(let s=0;s<p.sec;s++){const r={x:b.x+s*state.rackL,y,w:state.rackL,h:state.rackD};if(state.columns.some(c=>rectsOverlap(r,c)))continue;if(state.objects.some(o=>o.affectsCapacity&&rectsOverlap(r,o)))continue;add('rect',{x:ox+r.x*sc+1,y:oy+r.y*sc+1,width:r.w*sc-2,height:Math.max(2,r.h*sc-2),class:'rack'})}})
    else p.cols.forEach(x=>{for(let s=0;s<p.sec;s++){const r={x,y:b.y+s*state.rackL,w:state.rackD,h:state.rackL};if(state.columns.some(c=>rectsOverlap(r,c)))continue;if(state.objects.some(o=>o.affectsCapacity&&rectsOverlap(r,o)))continue;add('rect',{x:ox+r.x*sc+1,y:oy+r.y*sc+1,width:Math.max(2,r.w*sc-2),height:r.h*sc-2,class:'rack'})}})
  });

  a.cams.cams.forEach(p=>{add('circle',{cx:ox+p.x*sc,cy:oy+p.y*sc,r:4,class:'cam'});add('path',{d:`M ${ox+p.x*sc-10} ${oy+p.y*sc+8} Q ${ox+p.x*sc} ${oy+p.y*sc-6} ${ox+p.x*sc+10} ${oy+p.y*sc+8}`,class:'camarc'})});
  a.cams.uncovered.slice(0,150).forEach(p=>add('circle',{cx:ox+p.x*sc,cy:oy+p.y*sc,r:2,class:'dead'}));

  svg.onmousedown=e=>{
    const obj=e.target.closest('.obj');if(!obj)return;
    const kind=obj.dataset.kind,index=+obj.dataset.index;selected={kind,index};
    const target=kind==='zone'?state.zones[index]:kind==='column'?state.columns[index]:state.objects[index];
    const pt=clientToModel(e,svg,ox,oy,sc);
    const nearHandle=mode==='resize'&&Math.abs(pt.x-(target.x+target.w))<.35&&Math.abs(pt.y-(target.y+target.h))<.35;
    drag={kind,index,startX:pt.x,startY:pt.y,orig:{...target},action:nearHandle?'resize':'move',ox,oy,sc};
    renderSelected();draw();
  };
  window.onmousemove=e=>{
    if(!drag)return;
    const svg=$('plan'),pt=clientToModel(e,svg,drag.ox,drag.oy,drag.sc),target=drag.kind==='zone'?state.zones[drag.index]:drag.kind==='column'?state.columns[drag.index]:state.objects[drag.index];
    if(drag.action==='move'){
      target.x=clamp(drag.orig.x+(pt.x-drag.startX),0,state.roomL-target.w);
      target.y=clamp(drag.orig.y+(pt.y-drag.startY),0,state.roomW-target.h);
    }else{
      target.w=clamp(drag.orig.w+(pt.x-drag.startX),.3,state.roomL-target.x);
      target.h=clamp(drag.orig.h+(pt.y-drag.startY),.3,state.roomW-target.y);
      if(target.name==='Центральный проход')state.centralAisle=target.h;
    }
    draw();renderAll(false);renderSelected();
  };
  window.onmouseup=()=>{if(drag){drag=null;save();renderAll()}}
  $('layoutSummary').textContent=`ЦП делит хранение на ${splitStorageBlocks().length} блока · секций ${a.rp.total} · камер на склад ${a.cams.cams.length}`;
}
function clientToModel(e,svg,ox,oy,sc){
  const r=svg.getBoundingClientRect(),sx=1000/r.width,sy=590/r.height;
  return {x:((e.clientX-r.left)*sx-ox)/sc,y:((e.clientY-r.top)*sy-oy)/sc}
}

function renderSelected(){
  const box=$('selectedEditor');
  if(!selected.kind){box.innerHTML='<div class="hint">Кликни по зоне, проходу, колонне или добавленному объекту.</div>';return}
  const arr=selectedArray(),obj=arr[selected.index];
  if(!obj){selected={kind:null,index:null};return renderSelected()}
  box.innerHTML=`<div class="selname">${selected.kind==='column'?'Колонна '+(selected.index+1):obj.name}</div>
  ${selected.kind!=='column'?`<label>Название<input id="selName" value="${obj.name}"></label>`:''}
  <div class="grid2">
    <label>X<input id="sx" type="number" step="0.1" value="${obj.x.toFixed(1)}"></label>
    <label>Y<input id="sy" type="number" step="0.1" value="${obj.y.toFixed(1)}"></label>
    <label>Ширина<input id="sw" type="number" step="0.1" value="${obj.w.toFixed(1)}"></label>
    <label>Высота<input id="sh" type="number" step="0.1" value="${obj.h.toFixed(1)}"></label>
  </div>
  ${selected.kind!=='column'?`<label>Тип<select id="selType"><option value="storage">Хранение</option><option value="process">Операционная зона</option><option value="staff">Персонал</option><option value="service">Проход / сервис</option><option value="equipment">Оборудование</option><option value="custom">Кастомный</option></select></label>
  <div class="toggles">
    <label><input id="capToggle" type="checkbox" ${obj.affectsCapacity?'checked':''}> влияет на вместимость</label>
    <label><input id="flowToggle" type="checkbox" ${obj.affectsFlow?'checked':''}> влияет на поток</label>
    <label><input id="camToggle" type="checkbox" ${obj.needsCamera?'checked':''}> нужен контроль камерой</label>
  </div><div class="hint">Поворот: ${obj.rotation||0}°</div>`:''}`;
  if($('selName'))$('selName').oninput=()=>{obj.name=$('selName').value;renderAll()};
  ['sx','sy','sw','sh'].forEach(id=>$(id).oninput=()=>{
    obj[{sx:'x',sy:'y',sw:'w',sh:'h'}[id]]=parseFloat($(id).value)||0;
    if(obj.name==='Центральный проход')state.centralAisle=obj.h;renderAll();
  });
  if($('selType')){$('selType').value=obj.type;$('selType').onchange=()=>{obj.type=$('selType').value;renderAll()}}
  if($('capToggle'))$('capToggle').onchange=()=>{obj.affectsCapacity=$('capToggle').checked;renderAll()};
  if($('flowToggle'))$('flowToggle').onchange=()=>{obj.affectsFlow=$('flowToggle').checked;renderAll()};
  if($('camToggle'))$('camToggle').onchange=()=>{obj.needsCamera=$('camToggle').checked;renderAll()};
}

function renderColumns(){
  const w=$('columnsList');w.innerHTML='';
  state.columns.forEach((c,i)=>{
    const d=document.createElement('div');d.className='colitem';d.innerHTML=`<div class="headrow"><b>Колонна ${i+1}</b><button class="delbtn">×</button></div><div class="hint">${fmt1(c.x)} × ${fmt1(c.y)} · ${fmt1(c.w)}×${fmt1(c.h)} м</div>`;
    d.querySelector('.delbtn').onclick=()=>{state.columns.splice(i,1);if(selected.kind==='column'&&selected.index===i)selected={kind:null};renderAll()};
    d.onclick=e=>{if(e.target.tagName!=='BUTTON'){selected={kind:'column',index:i};renderSelected();draw()}};
    w.appendChild(d)
  })
}

function renderEmu(){
  const m=processModel(state.simFlow),ok=m.util<=1,total=m.total||1;
  $('emulatorBody').innerHTML=`<div class="emugrid">
  <div class="emukpi ${ok?'goodbg':'badbg'}"><span>Статус</span><b>${ok?'Поток проходит':'Выше мощности'}</b><small>${fmt(state.simFlow)} SKU/мес</small></div>
  <div class="emukpi"><span>Загрузка</span><b>${fmt1(m.util*100)}%</b></div>
  <div class="emukpi"><span>Минимум</span><b>${m.min} оп./смену</b></div>
  <div class="emukpi"><span>Рекомендуемо</span><b>${m.rec} оп./смену</b></div></div>
  <div class="lineflow"><span>Приёмка</span><i>→</i><span>Раскладка</span><i>→</i><span>Сборка</span><i>→</i><span>Отгрузка</span></div>`
}

function tr(a,b,c,d){return `<tr><td>${a}</td><td>${b}</td>${c!==undefined?`<td>${c}</td>`:''}${d!==undefined?`<td>${d}</td>`:''}</tr>`}
function metric(name,val,sub=''){return `<div class="metricrow"><span>${name}</span><b>${val}</b>${sub?`<small>${sub}</small>`:''}</div>`}
function renderTabs(){
  const a=analytics(),pm=a.pm;
  $('mArea').textContent=fmt1(a.area)+' м²';$('mCapacity').textContent=fmt(a.cap)+' SKU';$('mThroughput').textContent=fmt(pm.maxMonthly)+' SKU/мес';$('mCams').textContent=fmt(a.totalCams)+' шт.';$('mStaff').textContent=pm.rec+' оп./смену';

  $('tab-capacity').innerHTML=`<div class="cards3">${metric('Площадь хранения',fmt1(a.storageArea)+' м²')}${metric('Секции',fmt(a.rp.total))}${metric('Рабочая вместимость',fmt(a.cap)+' SKU',state.fillPct+'% заполнения')}</div>
  <table class="tbl"><tr><th>Показатель</th><th>Значение</th></tr>${tr('Полезный объём',fmt1(a.vol)+' м³')}${tr('Вместимость 100%',fmt(a.cap100)+' SKU')}${tr('Рабочая вместимость',fmt(a.cap)+' SKU')}${tr('Центральный проход',fmt1(getZone('Центральный проход')?.h||0)+' м')}</table>`;

  const oneTurn=processModel(a.cap),avg=processModel(state.avgFlow||100000),mx=processModel(state.maxFlow||120000);
  $('tab-throughput').innerHTML=`<div class="cards3">${metric('1 оборот рабочего стока',fmt(a.cap)+' SKU/мес',fmt(a.cap/30)+' SKU/сутки')}${metric('Средний рабочий',fmt(state.avgFlow||100000)+' SKU/мес',fmt1(avg.util*100)+'% загрузки')}${metric('Максимальный',fmt(state.maxFlow||120000)+' SKU/мес',fmt1(mx.util*100)+'% загрузки')}</div>
  <table class="tbl"><tr><th>Сценарий</th><th>Оборотов стока</th><th>Загрузка</th><th>Статус</th></tr>${tr('1 оборот',1,fmt1(oneTurn.util*100)+'%',oneTurn.util<=1?'проходит':'выше мощности')}${tr('Средний',((state.avgFlow||100000)/Math.max(1,a.cap)).toFixed(2),fmt1(avg.util*100)+'%',avg.util<=1?'проходит':'выше мощности')}${tr('Максимальный',((state.maxFlow||120000)/Math.max(1,a.cap)).toFixed(2),fmt1(mx.util*100)+'%',mx.util<=1?'проходит':'выше мощности')}${tr('Целевой',(state.targetFlow/Math.max(1,a.cap)).toFixed(2),fmt1(pm.util*100)+'%',pm.util<=1?'проходит':'выше мощности')}</table>`;

  $('tab-staff').innerHTML=`<div class="cards3">${metric('Минимум',pm.min+' оп./смену')}${metric('Рекомендуемо',pm.rec+' оп./смену','нагрузка до 85%')}${metric('Текущий состав',state.opsPerShift+' оп./смену',fmt1(pm.util*100)+'% загрузки')}</div>
  <table class="tbl"><tr><th>Операция</th><th>Норма</th><th>Чел.-смен/сутки</th><th>Доля труда</th></tr>${Object.keys(pm.req).map(k=>tr(names[k],fmt(pm.norms[k]),fmt1(pm.req[k]),fmt1(pm.req[k]/pm.total*100)+'%')).join('')}</table>`;

  $('tab-video').innerHTML=`<div class="cards3">${metric('Автокамеры склада',a.cams.cams.length)}${metric('Мёртвые точки',a.cams.uncovered.length,a.cams.uncovered.length?'нужно корректировать':'не обнаружены')}${metric('Итого камер',a.totalCams)}</div>
  <table class="tbl"><tr><th>Блок</th><th>Количество</th><th>Комментарий</th></tr>${tr('Склад',a.cams.cams.length,'автопокрытие')}${tr('Пользовательские камеры',a.userCams,'добавлены вручную')}${tr('Прочие точки',7,'входы, коридор, офис, отгрузка')}</table>`;

  $('tab-equip').innerHTML=`<div class="cards3">${metric('Пользовательские объекты',state.objects.length)}${metric('Колонны',state.columns.length)}${metric('Оборудование',state.objects.filter(o=>o.type==='equipment').length)}</div>
  <table class="tbl"><tr><th>Объект</th><th>Количество</th><th>Комментарий</th></tr>${tr('Стационарные ПК',state.fixedPC||2,'базовая модель')}${tr('ТСД',state.fixedTsd||3,'базовая модель')}${tr('Планшеты',state.fixedTablet||2,'базовая модель')}${tr('Столы, двери, кастомные зоны',state.objects.length,'созданы через библиотеку')}</table>`;

  const s=getZone('Хранение'),cp=getZone('Центральный проход'),pick=getZone('Сборка');let route='—';
  if(s&&cp&&pick){const p1={x:s.x+s.w/2,y:cp.y+cp.h/2},p2={x:pick.x+pick.w/2,y:pick.y+pick.h/2};route=fmt1(Math.hypot(p1.x-p2.x,p1.y-p2.y))+' м'}
  $('tab-analytics').innerHTML=`<div class="cards3">${metric('ФОТ текущий',money(a.currentFOT))}${metric('ФОТ с автоштатом',money(a.autoFOT))}${metric('OPEX с арендой',money(a.currentOpex))}</div>
  <table class="tbl"><tr><th>Аналитика</th><th>Значение</th></tr>${tr('Доля хранения',fmt1(a.storageArea/a.area*100)+'%')}${tr('Доля процессных зон',fmt1(a.processArea/a.area*100)+'%')}${tr('Доля staff/service',fmt1(a.supportArea/a.area*100)+'%')}${tr('Секций на 1 м²',fmt1(a.rp.total/a.area))}${tr('SKU на 1 м²',fmt1(a.cap/a.area))}${tr('Путь центра хранения до сборки',route)}${tr('Макс. сквозной поток',fmt(pm.maxMonthly)+' SKU/мес')}${tr('Запас мощности до таргета',fmt(pm.maxMonthly-state.targetFlow)+' SKU/мес')}${tr('CAPEX',money(state.capex||2921881))}${tr('Аренда',money(state.rent||300000))}</table>`;

  const warns=[],storage=getZone('Хранение'),central=getZone('Центральный проход');
  if(central&&central.h<1.2)warns.push(['bad','Центральный проход меньше 1,2 м.']);
  if(state.aisle<1)warns.push(['bad','Проход между стеллажными рядами меньше 1 м.']);
  if(a.cams.uncovered.length)warns.push(['bad',`Есть ${a.cams.uncovered.length} контрольных точек без покрытия камер.`]);else warns.push(['good','Мёртвых зон по модели камер нет.']);
  if(pm.util>1)warns.push(['bad',`Целевой поток ${fmt(state.targetFlow)} SKU/мес выше мощности текущей команды.`]);
  if(storage&&central&&!rectsOverlap(storage,central))warns.push(['bad','Центральный проход находится вне зоны хранения.']);
  if(storage&&central&&Math.abs((central.y+central.h/2)-(storage.y+storage.h/2))>storage.h*.18)warns.push(['info','Центральный проход смещён от центра. Проверь путь сборщика.']);
  state.objects.filter(o=>o.affectsCapacity&&storage&&rectsOverlap(storage,o)).forEach(o=>warns.push(['info',`${o.name} занимает часть зоны хранения.`]));
  warns.push(['info','Добавленные объекты можно двигать, менять по размеру, поворачивать, копировать и удалять.']);
  $('tab-checks').innerHTML=warns.map(([c,t])=>`<div class="warnbox ${c}">${t}</div>`).join('');
}

function renderAll(full=true){save();if(full){renderColumns();renderSelected()}draw();renderEmu();renderTabs()}

const inputIds=['roomL','roomW','roomH','avgSkuL','targetFlow','simFlow','centralAisle','rackL','rackD','rackH','shelves','aisle','fillPct','normAccept','normPutaway','normPick','normShip','opsPerShift','shiftsPerDay','paidHours','opRate','seniors','seniorSalary','managers','managerSalary','cameraRange','coverageStep'];
inputIds.forEach(id=>{const el=$(id);el.value=state[id];el.oninput=()=>{state[id]=parseFloat(el.value)||0;if(id==='centralAisle'){const c=getZone('Центральный проход');if(c)c.h=state.centralAisle}renderAll()}});
$('layoutMode').value=state.layoutMode;$('layoutMode').onchange=()=>{state.layoutMode=$('layoutMode').value;renderAll()};
$('optBtn').onclick=optimize;$('optSideBtn').onclick=optimize;
$('addColumnBtn').onclick=()=>{state.columns.push({x:6,y:3,w:.6,h:.6,rotation:0});selected={kind:'column',index:state.columns.length-1};renderAll()};
document.querySelectorAll('.objbtn').forEach(b=>b.onclick=()=>addTemplate(b.dataset.template));
$('rotateBtn').onclick=rotateSelected;$('cloneBtn').onclick=cloneSelected;$('deleteBtn').onclick=deleteSelected;
$('saveBtn').onclick=()=>save();
$('resetBtn').onclick=()=>{if(confirm('Сбросить проект?')){state=structuredClone(defaults);initZones();selected={kind:null};inputIds.forEach(id=>$(id).value=state[id]);renderAll()}};
$('exportBtn').onclick=()=>{const b=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='mfc-planner-v6.json';a.click();URL.revokeObjectURL(a.href)};
$('importInput').onchange=async e=>{try{state=Object.assign(structuredClone(defaults),JSON.parse(await e.target.files[0].text()));selected={kind:null};inputIds.forEach(id=>$(id).value=state[id]);$('layoutMode').value=state.layoutMode;renderAll()}catch{alert('Не удалось загрузить проект')}}; 
document.querySelectorAll('.tool[data-mode]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tool[data-mode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');mode=b.dataset.mode;draw()});
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tabcontent').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('tab-'+b.dataset.tab).classList.add('active')});

renderAll();
