const $=id=>document.getElementById(id);
const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Math.round(Number(n)||0));
const fmt1=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(Number(n)||0);
const money=n=>fmt(n)+' ₽';
const colors={storage:'#d9c0f0',process:'#f4c7dd',staff:'#c9d7f1',service:'#d8dfd2'};
const processNames={accept:'Приёмка',putaway:'Раскладка',pick:'Сборка',ship:'Отгрузка'};

const defaults={
  roomL:20,roomW:10,roomH:3,avgSkuL:4.5,targetFlow:100000,avgFlow:100000,maxFlow:120000,simFlow:100000,
  centralAisle:1.6,evacCount:1,layoutMode:'balanced',
  rackL:1.2,rackD:0.5,rackH:2.5,shelves:5,aisle:1.2,fillPct:95,
  normAccept:2750,normPutaway:2750,normPick:1500,normShip:3500,
  opsPerShift:3,shiftsPerDay:2,paidHours:11,opRate:400,seniors:2,seniorSalary:90000,managers:1,managerSalary:130000,
  cameraRange:3.4,coverageStep:0.8,
  fixedPC:2,fixedTsd:3,fixedTablet:2,rent:300000,capex:2921881,
  zones:[],columns:[]
};

let state=JSON.parse(localStorage.getItem('mfcPlannerV4')||'null')||structuredClone(defaults);
for(const k in defaults){ if(state[k]===undefined) state[k]=structuredClone(defaults[k]); }

function saveState(){ localStorage.setItem('mfcPlannerV4', JSON.stringify(state)); }
function rectArea(r){ return Math.max(0,r.w)*Math.max(0,r.h); }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function distance(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.sqrt(dx*dx+dy*dy); }
function pointInRect(p,r){ return p.x>=r.x && p.x<=r.x+r.w && p.y>=r.y && p.y<=r.y+r.h; }
function rectsOverlap(a,b){ return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y; }
function lineIntersectsRect(p1,p2,r){
  if(pointInRect(p1,r)||pointInRect(p2,r)) return true;
  const lines=[
    [{x:r.x,y:r.y},{x:r.x+r.w,y:r.y}],
    [{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h}],
    [{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}],
    [{x:r.x,y:r.y+r.h},{x:r.x,y:r.y}],
  ];
  return lines.some(([a,b])=>segmentsIntersect(p1,p2,a,b));
}
function segmentsIntersect(p1,p2,p3,p4){
  function orient(a,b,c){ return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
  function onSeg(a,b,c){ return Math.min(a.x,b.x)<=c.x+1e-9 && c.x<=Math.max(a.x,b.x)+1e-9 && Math.min(a.y,b.y)<=c.y+1e-9 && c.y<=Math.max(a.y,b.y)+1e-9; }
  const o1=orient(p1,p2,p3), o2=orient(p1,p2,p4), o3=orient(p3,p4,p1), o4=orient(p3,p4,p2);
  if((o1>0)!=(o2>0) && (o3>0)!=(o4>0)) return true;
  if(Math.abs(o1)<1e-9 && onSeg(p1,p2,p3)) return true;
  if(Math.abs(o2)<1e-9 && onSeg(p1,p2,p4)) return true;
  if(Math.abs(o3)<1e-9 && onSeg(p3,p4,p1)) return true;
  if(Math.abs(o4)<1e-9 && onSeg(p3,p4,p2)) return true;
  return false;
}
function getZone(name){ return state.zones.find(z=>z.name===name); }
function effectiveColumnsInRect(r){ return state.columns.filter(c=>rectsOverlap(r,c)); }
function usedColumnArea(rect){
  return effectiveColumnsInRect(rect).reduce((s,c)=>{
    const x1=Math.max(rect.x,c.x), y1=Math.max(rect.y,c.y);
    const x2=Math.min(rect.x+rect.w,c.x+c.w), y2=Math.min(rect.y+rect.h,c.y+c.h);
    return s + Math.max(0,x2-x1)*Math.max(0,y2-y1);
  },0);
}
function zoneNetArea(z){ return Math.max(0, rectArea(z)-usedColumnArea(z)); }

function loadDefaultZones(){
  const L=state.roomL,W=state.roomW;
  state.zones=[
    {name:'Коридор персонала',type:'service',x:0,y:0,w:2.2,h:W},
    {name:'Раздевалка',type:'staff',x:0.2,y:1.0,w:1.8,h:2.0},
    {name:'Офис',type:'staff',x:0.2,y:3.3,w:1.8,h:2.4},
    {name:'WC',type:'service',x:0.2,y:6.0,w:1.8,h:1.3},
    {name:'Хранение',type:'storage',x:2.4,y:0.2,w:L-2.8,h:W-3.2},
    {name:'Центральный проход',type:'service',x:2.4,y:W/2-state.centralAisle/2,w:L-2.8,h:state.centralAisle},
    {name:'Приёмка',type:'process',x:2.4,y:W-2.6,w:5,h:2.2},
    {name:'Сборка',type:'process',x:7.7,y:W-2.6,w:5,h:2.2},
    {name:'Отгрузка',type:'process',x:13.0,y:W-2.6,w:4.2,h:2.2},
    {name:'Вход поставщиков',type:'service',x:L/2-1.5,y:W-0.6,w:3,h:0.6},
    {name:'Вход/выход персонала',type:'service',x:0,y:W/2-0.8,w:0.4,h:1.6},
    {name:'Эвакуационный выход',type:'service',x:L-0.4,y:W/2-0.8,w:0.4,h:1.6},
  ];
}
if(!state.zones.length) loadDefaultZones();

function bindInputs(){
  const inputs=['roomL','roomW','roomH','avgSkuL','targetFlow','avgFlow','maxFlow','simFlow','centralAisle','evacCount',
    'rackL','rackD','rackH','shelves','aisle','fillPct','normAccept','normPutaway','normPick','normShip',
    'opsPerShift','shiftsPerDay','paidHours','opRate','seniors','seniorSalary','managers','managerSalary',
    'cameraRange','coverageStep','fixedPC','fixedTsd','fixedTablet','rent','capex'];
  inputs.forEach(id=>{
    const el=$(id); if(!el) return;
    el.value=state[id];
    el.oninput=()=>{ state[id]=parseFloat(el.value)||0; render(); };
  });
  $('layoutMode').value=state.layoutMode;
  $('layoutMode').onchange=()=>{ state.layoutMode=$('layoutMode').value; render(); };
}

function renderColumnsList(){
  const wrap=$('columnsList');
  wrap.innerHTML='';
  state.columns.forEach((c,idx)=>{
    const row=document.createElement('div');
    row.className='colitem';
    row.innerHTML=`
      <div class="headrow smallrow"><b>Колонна ${idx+1}</b><button data-idx="${idx}" class="delbtn">×</button></div>
      <div class="grid4">
        <label>X<input data-k="x" data-idx="${idx}" type="number" min="0" step="0.1" value="${c.x}"></label>
        <label>Y<input data-k="y" data-idx="${idx}" type="number" min="0" step="0.1" value="${c.y}"></label>
        <label>Шир.<input data-k="w" data-idx="${idx}" type="number" min="0.1" step="0.1" value="${c.w}"></label>
        <label>Дл.<input data-k="h" data-idx="${idx}" type="number" min="0.1" step="0.1" value="${c.h}"></label>
      </div>`;
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('input').forEach(inp=>{
    inp.oninput=()=>{
      const idx=+inp.dataset.idx, k=inp.dataset.k;
      state.columns[idx][k]=parseFloat(inp.value)||0;
      state.columns[idx].x=clamp(state.columns[idx].x,0,Math.max(0,state.roomL-state.columns[idx].w));
      state.columns[idx].y=clamp(state.columns[idx].y,0,Math.max(0,state.roomW-state.columns[idx].h));
      render();
    };
  });
  wrap.querySelectorAll('.delbtn').forEach(btn=>btn.onclick=()=>{
    state.columns.splice(+btn.dataset.idx,1);
    render();
  });
}

function optimizePlan(){
  const L=state.roomL,W=state.roomW;
  const mode=state.layoutMode;
  let corridorW=2.2;
  let procDepth = mode==='capacity' ? 2.0 : mode==='flow' ? 2.8 : 2.4;
  procDepth += Math.min(0.9,(state.targetFlow/30)/10000);
  procDepth = Math.min(procDepth, W*0.33);
  const leftW=corridorW, mainW=L-leftW-0.2;
  const procY=W-procDepth-0.2;
  let acceptRatio=.32,pickRatio=.36,shipRatio=.32;
  if(mode==='capacity'){acceptRatio=.30;pickRatio=.34;shipRatio=.36;}
  if(mode==='flow'){acceptRatio=.34;pickRatio=.40;shipRatio=.26;}
  const acceptW=mainW*acceptRatio, pickW=mainW*pickRatio, shipW=mainW-acceptW-pickW;
  const storageX=leftW+0.2, storageY=0.2, storageW=mainW, storageH=Math.max(2.2,procY-storageY-0.2);
  const centralY=storageY+storageH/2-state.centralAisle/2;

  state.zones=[
    {name:'Коридор персонала',type:'service',x:0,y:0,w:leftW,h:W},
    {name:'Раздевалка',type:'staff',x:0.2,y:1.0,w:leftW-0.4,h:2.0},
    {name:'Офис',type:'staff',x:0.2,y:3.3,w:leftW-0.4,h:2.4},
    {name:'WC',type:'service',x:0.2,y:6.0,w:leftW-0.4,h:1.3},
    {name:'Хранение',type:'storage',x:storageX,y:storageY,w:storageW,h:storageH},
    {name:'Центральный проход',type:'service',x:storageX,y:centralY,w:storageW,h:state.centralAisle},
    {name:'Приёмка',type:'process',x:storageX,y:procY,w:acceptW,h:procDepth},
    {name:'Сборка',type:'process',x:storageX+acceptW,y:procY,w:pickW,h:procDepth},
    {name:'Отгрузка',type:'process',x:storageX+acceptW+pickW,y:procY,w:shipW,h:procDepth},
    {name:'Вход поставщиков',type:'service',x:L/2-1.5,y:W-0.6,w:3,h:0.6},
    {name:'Вход/выход персонала',type:'service',x:0,y:W/2-0.8,w:0.4,h:1.6},
    {name:'Эвакуационный выход',type:'service',x:L-0.4,y:W/2-0.8,w:0.4,h:1.6},
  ];
  // Небольшой дефолт по колоннам для демонстрации, если их нет
  state.columns=state.columns.filter(c=>c.x+c.w<=L && c.y+c.h<=W);
  saveState(); render();
}

function rackLayoutFor(z,orientation){
  // Из зоны хранения вычитаем центральный проход, если он внутри неё
  const central=getZone('Центральный проход');
  const blockedBand=central && rectsOverlap(z,central) ? central : null;
  if(orientation==='horizontal'){
    const rowsPositions=[];
    let y=z.y;
    while(y+state.rackD<=z.y+z.h+1e-9){
      if(!(blockedBand && y < blockedBand.y+blockedBand.h && y+state.rackD > blockedBand.y)) rowsPositions.push(y);
      y += state.rackD + state.aisle;
    }
    const sectionsPerRow=Math.max(0,Math.floor(z.w / Math.max(0.1,state.rackL)));
    return {orientation, rows:rowsPositions.length, sectionsPerRow, total:rowsPositions.length*sectionsPerRow, rowsPositions};
  } else {
    const colsPositions=[];
    let x=z.x;
    while(x+state.rackD<=z.x+z.w+1e-9){
      if(!(blockedBand && x < blockedBand.x+blockedBand.w && x+state.rackD > blockedBand.x)) colsPositions.push(x);
      x += state.rackD + state.aisle;
    }
    const sectionsPerCol=Math.max(0,Math.floor(z.h / Math.max(0.1,state.rackL)));
    return {orientation, rows:colsPositions.length, sectionsPerRow:sectionsPerCol, total:colsPositions.length*sectionsPerCol, colsPositions};
  }
}
function bestRackLayout(z){
  const a=rackLayoutFor(z,'horizontal'), b=rackLayoutFor(z,'vertical');
  return b.total>a.total?b:a;
}

function calcTables(){
  const acc=getZone('Приёмка'), build=getZone('Сборка'), office=getZone('Офис');
  const acceptanceTables = acc ? Math.max(1, Math.round(zoneNetArea(acc)/6)) : 0;
  const assemblyTables = build ? Math.max(1, Math.round(zoneNetArea(build)/8)) : 0;
  const officeDesks = office ? Math.max(1, Math.round(zoneNetArea(office)/4)) : 0;
  return {acceptanceTables,assemblyTables,officeDesks,total:acceptanceTables+assemblyTables+officeDesks};
}

function processModel(flow,opsPerShift=state.opsPerShift){
  const daily=(Number(flow)||0)/30;
  const norms={accept:Math.max(1,state.normAccept),putaway:Math.max(1,state.normPutaway),pick:Math.max(1,state.normPick),ship:Math.max(1,state.normShip)};
  const req={}; let total=0;
  Object.keys(norms).forEach(k=>{ req[k]=daily/norms[k]; total+=req[k]; });
  const teamWorkerShifts=Math.max(0,opsPerShift)*Math.max(1,state.shiftsPerDay);
  const laborPerSku=Object.values(norms).reduce((s,n)=>s+1/n,0);
  const maxDaily=teamWorkerShifts/laborPerSku, maxMonthly=maxDaily*30;
  const minOpsPerShift=Math.ceil(total/Math.max(1,state.shiftsPerDay)-1e-9);
  const recOpsPerShift=Math.ceil((total/0.85)/Math.max(1,state.shiftsPerDay)-1e-9);
  const utilization=teamWorkerShifts?total/teamWorkerShifts:Infinity;
  const bottleneck=Object.keys(req).sort((a,b)=>req[b]-req[a])[0];
  return {daily,norms,req,total,teamWorkerShifts,maxDaily,maxMonthly,minOpsPerShift,recOpsPerShift,utilization,bottleneck};
}

function samplePointsForCoverage(rect, step){
  const pts=[];
  for(let x=rect.x+step/2; x<rect.x+rect.w; x+=step){
    for(let y=rect.y+step/2; y<rect.y+rect.h; y+=step){
      const p={x,y};
      if(state.columns.some(c=>pointInRect(p,c))) continue;
      pts.push(p);
    }
  }
  return pts;
}
function candidateCameraPoints(rect, spacing){
  const pts=[];
  for(let x=rect.x+0.4; x<rect.x+rect.w-0.2; x+=spacing){
    for(let y=rect.y+0.4; y<rect.y+rect.h-0.2; y+=spacing){
      const p={x,y};
      if(state.columns.some(c=>pointInRect(p,c))) continue;
      pts.push(p);
    }
  }
  // дополнительные кандидаты возле колонн
  state.columns.forEach(c=>{
    const around=[
      {x:c.x-0.3,y:c.y-0.3},{x:c.x+c.w+0.3,y:c.y-0.3},
      {x:c.x-0.3,y:c.y+c.h+0.3},{x:c.x+c.w+0.3,y:c.y+c.h+0.3}
    ];
    around.forEach(p=>{
      if(p.x>rect.x && p.x<rect.x+rect.w && p.y>rect.y && p.y<rect.y+rect.h) pts.push(p);
    });
  });
  return pts;
}
function covers(pCam,pPoint,range){
  if(distance(pCam,pPoint)>range) return false;
  for(const c of state.columns){ if(lineIntersectsRect(pCam,pPoint,c)) return false; }
  return true;
}
function autoStorageCameras(storage){
  if(!storage) return {cams:[], covered:0, total:0, uncovered:[]};
  const step=Math.max(0.4,state.coverageStep);
  const range=Math.max(1,state.cameraRange);
  const samples=samplePointsForCoverage(storage,step);
  const candidates=candidateCameraPoints(storage,Math.max(1.0,range*0.9));
  let uncovered=samples.slice();
  const cams=[];
  const maxCams=80;
  while(uncovered.length && cams.length<maxCams){
    let best=null, bestCover=[];
    for(const cand of candidates){
      if(cams.some(c=>distance(c,cand)<0.4)) continue;
      const cover=uncovered.filter(p=>covers(cand,p,range));
      if(cover.length > bestCover.length){
        best=cand; bestCover=cover;
      }
    }
    if(!best || bestCover.length===0) break;
    cams.push(best);
    const coveredSet=new Set(bestCover.map(p=>p.x+'|'+p.y));
    uncovered=uncovered.filter(p=>!coveredSet.has(p.x+'|'+p.y));
  }
  return {cams, covered:samples.length-uncovered.length, total:samples.length, uncovered};
}
function fixedOtherCameras(){
  const cams=[];
  const tables=calcTables();
  const acc=getZone('Приёмка'), ship=getZone('Отгрузка'), corridor=getZone('Коридор персонала'), office=getZone('Офис');
  if(acc){
    const cols=Math.max(1,Math.floor(acc.w/1.2));
    for(let i=0;i<tables.acceptanceTables;i++){
      const tx=acc.x+0.5+(i%cols)*1.0, ty=acc.y+0.25+Math.floor(i/cols)*0.7;
      if(tx<acc.x+acc.w && ty<acc.y+acc.h) cams.push({x:tx,y:ty,group:'Приёмка'});
    }
  }
  if(ship) cams.push({x:ship.x+ship.w/2,y:ship.y+0.25,group:'Отгрузка'});
  if(corridor){
    cams.push({x:corridor.x+corridor.w/2,y:1.2,group:'Коридор'});
    cams.push({x:corridor.x+corridor.w/2,y:corridor.h/2,group:'Коридор'});
    cams.push({x:corridor.x+corridor.w/2,y:corridor.h-1.2,group:'Коридор'});
  }
  if(office) cams.push({x:office.x+office.w-0.25,y:office.y+0.25,group:'Офис'});
  const supplier=getZone('Вход поставщиков'); if(supplier) cams.push({x:supplier.x+supplier.w/2,y:supplier.y+0.15,group:'Входы'});
  const staff=getZone('Вход/выход персонала'); if(staff) cams.push({x:staff.x+0.15,y:staff.y+staff.h/2,group:'Входы'});
  const evac=getZone('Эвакуационный выход'); if(evac) cams.push({x:evac.x+0.12,y:evac.y+evac.h/2,group:'Входы'});
  return cams;
}
function analytics(){
  const storage=getZone('Хранение');
  const layout=storage?bestRackLayout(storage):{rows:0,sectionsPerRow:0,total:0,orientation:'horizontal'};
  const sections=layout.total;
  const grossCubic=sections*state.rackL*state.rackD*state.rackH;
  const storageNet=storage?zoneNetArea(storage):0;
  const columnAreaTotal=state.columns.reduce((s,c)=>s+rectArea(c),0);
  const grossLiters=grossCubic*1000;
  const cap100=grossLiters/Math.max(0.1,state.avgSkuL);
  const workCap=cap100*state.fillPct/100;
  const stockTurn=workCap;
  const dayTurn=stockTurn/30;
  const target=processModel(state.targetFlow,state.opsPerShift);
  const avg=processModel(state.avgFlow,state.opsPerShift);
  const max=processModel(state.maxFlow,state.opsPerShift);
  const oneTurn=processModel(stockTurn,state.opsPerShift);
  const tables=calcTables();

  const autoCams=autoStorageCameras(storage);
  const otherCams=fixedOtherCameras();
  const currentFOT=state.opsPerShift*state.shiftsPerDay*state.paidHours*30*state.opRate + state.seniors*state.seniorSalary + state.managers*state.managerSalary;
  const autoFOT=target.recOpsPerShift*state.shiftsPerDay*state.paidHours*30*state.opRate + state.seniors*state.seniorSalary + state.managers*state.managerSalary;
  return {
    area:state.roomL*state.roomW,
    storageNet,columnAreaTotal,processArea:state.zones.filter(z=>z.type==='process').reduce((s,z)=>s+zoneNetArea(z),0),
    supportArea:state.zones.filter(z=>z.type!=='process'&&z.type!=='storage').reduce((s,z)=>s+zoneNetArea(z),0),
    layout,sections,grossCubic,cap100,workCap,stockTurn,dayTurn,target,avg,max,oneTurn,tables,
    autoStorageCams:autoCams, otherCams, totalCams:autoCams.cams.length+otherCams.length,
    currentFOT,autoFOT,totalCurrentOpex:currentFOT+state.rent,totalAutoOpex:autoFOT+state.rent
  };
}

function drawPlan(){
  const svg=$('plan'); svg.innerHTML='';
  const c=analytics();
  const ns='http://www.w3.org/2000/svg';
  const w=940,h=520,scale=Math.min(w/state.roomL,h/state.roomW),ox=(1000-state.roomL*scale)/2,oy=(580-state.roomW*scale)/2;
  function add(tag,attrs,parent=svg){
    const el=document.createElementNS(ns,tag);
    for(const k in attrs) el.setAttribute(k,attrs[k]);
    parent.appendChild(el);
    return el;
  }
  add('rect',{x:ox,y:oy,width:state.roomL*scale,height:state.roomW*scale,class:'room'});
  for(let i=1;i<state.roomL;i++) add('line',{x1:ox+i*scale,y1:oy,x2:ox+i*scale,y2:oy+state.roomW*scale,class:'grid'});
  for(let i=1;i<state.roomW;i++) add('line',{x1:ox,y1:oy+i*scale,x2:ox+state.roomL*scale,y2:oy+i*scale,class:'grid'});

  state.zones.forEach(z=>{
    const g=add('g',{});
    add('rect',{x:ox+z.x*scale,y:oy+z.y*scale,width:z.w*scale,height:z.h*scale,rx:6,fill:colors[z.type],class:'zone'},g);
    add('text',{x:ox+z.x*scale+7,y:oy+z.y*scale+18,class:'label'},g).textContent=z.name;
    add('text',{x:ox+z.x*scale+7,y:oy+z.y*scale+33,class:'sub'},g).textContent=fmt1(zoneNetArea(z))+' м²';
  });

  state.columns.forEach(col=>{
    add('rect',{x:ox+col.x*scale,y:oy+col.y*scale,width:col.w*scale,height:col.h*scale,rx:4,class:'column'});
  });

  const storage=getZone('Хранение');
  if(storage){
    const layout=c.layout;
    const central=getZone('Центральный проход');
    if(layout.orientation==='horizontal'){
      const rowsPos=layout.rowsPositions||[];
      rowsPos.forEach(y=>{
        for(let s=0;s<layout.sectionsPerRow;s++){
          const x=storage.x + s*state.rackL;
          const rect={x,y,w:state.rackL,h:state.rackD};
          if(state.columns.some(col=>rectsOverlap(rect,col))) continue;
          if(central && rectsOverlap(rect,central)) continue;
          if(x+state.rackL>storage.x+storage.w || y+state.rackD>storage.y+storage.h) continue;
          add('rect',{x:ox+x*scale+1,y:oy+y*scale+1,width:Math.max(2,state.rackL*scale-2),height:Math.max(2,state.rackD*scale-2),class:'rack'});
        }
      });
    } else {
      const colsPos=layout.colsPositions||[];
      colsPos.forEach(x=>{
        for(let s=0;s<layout.sectionsPerRow;s++){
          const y=storage.y + s*state.rackL;
          const rect={x,y,w:state.rackD,h:state.rackL};
          if(state.columns.some(col=>rectsOverlap(rect,col))) continue;
          if(central && rectsOverlap(rect,central)) continue;
          if(x+state.rackD>storage.x+storage.w || y+state.rackL>storage.y+storage.h) continue;
          add('rect',{x:ox+x*scale+1,y:oy+y*scale+1,width:Math.max(2,state.rackD*scale-2),height:Math.max(2,state.rackL*scale-2),class:'rack'});
        }
      });
    }
  }

  // draw tables
  const tables=c.tables;
  drawTables(getZone('Приёмка'), tables.acceptanceTables, 'table1', ox, oy, scale, add);
  drawTables(getZone('Сборка'), tables.assemblyTables, 'table2', ox, oy, scale, add);
  drawTables(getZone('Офис'), tables.officeDesks, 'table3', ox, oy, scale, add);

  // draw cameras
  const cams=[...c.autoStorageCams.cams.map(p=>({...p,group:'Склад'})), ...c.otherCams];
  cams.forEach(p=>{
    add('circle',{cx:ox+p.x*scale,cy:oy+p.y*scale,r:4,class:'cam'});
    add('path',{d:`M ${ox+p.x*scale-10} ${oy+p.y*scale+8} Q ${ox+p.x*scale} ${oy+p.y*scale-6} ${ox+p.x*scale+10} ${oy+p.y*scale+8}`,class:'camarc'});
  });

  // uncovered sample points
  c.autoStorageCams.uncovered.slice(0,200).forEach(p=>{
    add('circle',{cx:ox+p.x*scale,cy:oy+p.y*scale,r:1.8,class:'deadpoint'});
  });

  $('layoutSummary').textContent=`Хранение ${fmt1(c.storageNet)} м² · ${fmt(c.sections)} секций · колонны ${fmt1(c.columnAreaTotal)} м² · автокамер на склад ${c.autoStorageCams.cams.length} · общий итог ${c.totalCams}`;
}
function drawTables(z,count,cls,ox,oy,scale,add){
  if(!z||count<=0) return;
  const cols=Math.max(1,Math.floor(z.w/1.1));
  let drawn=0;
  for(let r=0; drawn<count; r++){
    for(let col=0; col<cols && drawn<count; col++){
      const tx=z.x+0.2+col*1.0, ty=z.y+0.25+r*0.7;
      const rect={x:tx,y:ty,w:0.75,h:0.42};
      if(tx+0.75>z.x+z.w || ty+0.42>z.y+z.h) break;
      if(state.columns.some(c=>rectsOverlap(rect,c))) continue;
      add('rect',{x:ox+tx*scale,y:oy+ty*scale,width:0.75*scale,height:0.42*scale,class:cls});
      drawn++;
    }
  }
}

function renderEmulator(){
  const m=processModel(state.simFlow,state.opsPerShift), ok=m.utilization<=1, total=m.total||1;
  $('emulatorBody').innerHTML=`
    <div class="emugrid">
      <div class="emukpi ${ok?'goodbg':'badbg'}"><span>Статус</span><b>${ok?'Поток проходит':'Поток выше мощности'}</b><small>${fmt(state.simFlow)} SKU/мес · ${fmt(m.daily)} SKU/сутки</small></div>
      <div class="emukpi"><span>Загрузка команды</span><b>${fmt1(m.utilization*100)}%</b><small>${state.opsPerShift} операторов × ${state.shiftsPerDay} смены</small></div>
      <div class="emukpi"><span>Минимум</span><b>${m.minOpsPerShift} оп./смену</b><small>без запаса</small></div>
      <div class="emukpi"><span>Рекомендуемо</span><b>${m.recOpsPerShift} оп./смену</b><small>загрузка до 85%</small></div>
    </div>
    <div class="lineflow"><span>Приёмка</span><i>→</i><span>Раскладка</span><i>→</i><span>Сборка</span><i>→</i><span>Отгрузка</span></div>
    <div class="stages">
      ${Object.keys(m.req).map(k=>`
        <div class="stage">
          <div class="sthead"><b>${processNames[k]}</b><span>${fmt1(m.req[k])} чел.-смен/сутки</span></div>
          <div class="bar"><i style="width:${Math.min(100,m.req[k]/total*100)}%"></i></div>
          <small>Доля трудозатрат ${fmt1(m.req[k]/total*100)}% · норма ${fmt(m.norms[k])}/смену</small>
        </div>`).join('')}
    </div>
    <div class="note ${ok?'goodbg':'badbg'}">Максимальный сквозной поток текущей команды: <b>${fmt(m.maxMonthly)} SKU/мес</b>. Узкое место: <b>${processNames[m.bottleneck]}</b>.</div>`;
}
function metricRow(name,val,sub=''){ return `<div class="metricrow"><span>${name}</span><b>${val}</b>${sub?`<small>${sub}</small>`:''}</div>`; }
function tr(a,b,c,d){ return `<tr><td>${a}</td><td>${b}</td>${c!==undefined?`<td>${c}</td>`:''}${d!==undefined?`<td>${d}</td>`:''}</tr>`; }

function renderTabs(){
  const c=analytics();
  $('mArea').textContent=fmt1(c.area)+' м²';
  $('mCapacity').textContent=fmt(c.workCap)+' SKU';
  $('mThroughput').textContent=fmt(c.target.maxMonthly)+' SKU/мес';
  $('mCams').textContent=fmt(c.totalCams)+' шт.';
  $('mStaff').textContent=c.target.recOpsPerShift+' оп./смену';

  $('tab-capacity').innerHTML=`
    <div class="cards3">
      ${metricRow('Чистая площадь хранения',fmt1(c.storageNet)+' м²',`колонны занимают ${fmt1(c.columnAreaTotal)} м²`)}
      ${metricRow('Стеллажные секции',fmt(c.sections),`${c.layout.orientation==='vertical'?'вертикальная':'горизонтальная'} ориентация`)}
      ${metricRow('Рабочая вместимость',fmt(c.workCap)+' SKU',`${state.fillPct}% заполнения`)}
    </div>
    <table class="tbl"><tr><th>Показатель</th><th>Значение</th></tr>
      ${tr('Полезный объём стеллажей',fmt1(c.grossCubic)+' м³')}
      ${tr('Вместимость 100%',fmt(c.cap100)+' SKU')}
      ${tr('Рабочая вместимость',fmt(c.workCap)+' SKU')}
      ${tr('Один оборот рабочего стока',fmt(c.stockTurn)+' SKU/мес',fmt(c.dayTurn)+' SKU/сутки')}
    </table>`;

  $('tab-throughput').innerHTML=`
    <div class="cards3">
      ${metricRow('1 оборот стока',fmt(c.stockTurn)+' SKU/мес',fmt1(c.oneTurn.utilization*100)+'% загрузки')}
      ${metricRow('Средний сценарий',fmt(state.avgFlow)+' SKU/мес',fmt1(c.avg.utilization*100)+'% загрузки')}
      ${metricRow('Максимальный сценарий',fmt(state.maxFlow)+' SKU/мес',fmt1(c.max.utilization*100)+'% загрузки')}
    </div>
    <table class="tbl"><tr><th>Сценарий</th><th>Оборотов стока</th><th>Загрузка команды</th><th>Статус</th></tr>
      ${tr('1 оборот рабочего стока',(c.stockTurn/Math.max(1,c.workCap)).toFixed(2),fmt1(c.oneTurn.utilization*100)+'%',c.oneTurn.utilization<=1?'проходит':'выше мощности')}
      ${tr('Средний рабочий',(state.avgFlow/Math.max(1,c.workCap)).toFixed(2),fmt1(c.avg.utilization*100)+'%',c.avg.utilization<=1?'проходит':'выше мощности')}
      ${tr('Максимальный заданный',(state.maxFlow/Math.max(1,c.workCap)).toFixed(2),fmt1(c.max.utilization*100)+'%',c.max.utilization<=1?'проходит':'выше мощности')}
      ${tr('Текущий целевой поток',(state.targetFlow/Math.max(1,c.workCap)).toFixed(2),fmt1(c.target.utilization*100)+'%',c.target.utilization<=1?'проходит':'выше мощности')}
    </table>`;

  $('tab-staff').innerHTML=`
    <div class="cards3">
      ${metricRow('Минимум на поток',c.target.minOpsPerShift+' оп./смену')}
      ${metricRow('Рекомендуемый состав',c.target.recOpsPerShift+' оп./смену','нагрузка до 85%')}
      ${metricRow('Текущий состав',state.opsPerShift+' оп./смену',fmt1(c.target.utilization*100)+'% загрузки')}
    </div>
    <table class="tbl"><tr><th>Операция</th><th>Норма / смену</th><th>Нужно чел.-смен / сутки</th><th>Доля труда</th></tr>
      ${Object.keys(c.target.req).map(k=>tr(processNames[k],fmt(c.target.norms[k]),fmt1(c.target.req[k]),fmt1(c.target.req[k]/c.target.total*100)+'%')).join('')}
    </table>
    <div class="note">Автоштат считается из сквозного объёма. Сотрудники считаются взаимозаменяемыми между операциями.</div>`;

  $('tab-video').innerHTML=`
    <div class="cards3">
      ${metricRow('Автокамеры на склад',fmt(c.autoStorageCams.cams.length),`${c.autoStorageCams.covered}/${c.autoStorageCams.total} контрольных точек`)}
      ${metricRow('Прочие камеры',fmt(c.otherCams.length),'приёмка, входы, коридор, офис, отгрузка')}
      ${metricRow('Мёртвые зоны',fmt(c.autoStorageCams.uncovered.length),c.autoStorageCams.uncovered.length===0?'не обнаружены':'точки на складе без покрытия')}
    </div>
    <table class="tbl"><tr><th>Блок</th><th>Логика</th><th>Количество</th></tr>
      ${tr('Склад',`авторасстановка по покрытию, дальность ${fmt1(state.cameraRange)} м`,fmt(c.autoStorageCams.cams.length))}
      ${tr('Приёмка',`1 камера на стол, столов ${fmt(c.tables.acceptanceTables)}`,fmt(c.otherCams.filter(x=>x.group==='Приёмка').length))}
      ${tr('Коридор персонала','фиксированные точки контроля',fmt(c.otherCams.filter(x=>x.group==='Коридор').length))}
      ${tr('Отгрузка','фиксированно',fmt(c.otherCams.filter(x=>x.group==='Отгрузка').length))}
      ${tr('Входы и эвакуация','вход поставщиков, вход персонала, эвакуация',fmt(c.otherCams.filter(x=>x.group==='Входы').length))}
      ${tr('Офис','фиксированно',fmt(c.otherCams.filter(x=>x.group==='Офис').length))}
      ${tr('Итого', 'авто + фиксированные точки', fmt(c.totalCams))}
    </table>
    <div class="note">Красные точки на плане показывают не закрытые камерой контрольные точки в зоне хранения. Колонны учитываются как препятствия для обзора.</div>`;

  $('tab-equip').innerHTML=`
    <div class="cards3">
      ${metricRow('Столы приемки',fmt(c.tables.acceptanceTables))}
      ${metricRow('Столы сборки',fmt(c.tables.assemblyTables))}
      ${metricRow('Офисные столы',fmt(c.tables.officeDesks))}
    </div>
    <table class="tbl"><tr><th>Оборудование</th><th>Количество</th><th>Комментарий</th></tr>
      ${tr('Столы',fmt(c.tables.total),'рассчитаны по площади зон')}
      ${tr('Стационарные ПК',fmt(state.fixedPC),'задано пользователем')}
      ${tr('ТСД',fmt(state.fixedTsd),'задано пользователем')}
      ${tr('Планшеты',fmt(state.fixedTablet),'задано пользователем')}
      ${tr('Камеры',fmt(c.totalCams),'автоподбор покрытия + фиксированные точки')}
    </table>`;

  $('tab-analytics').innerHTML=`
    <div class="cards3">
      ${metricRow('ФОТ текущий',money(c.currentFOT))}
      ${metricRow('ФОТ с автоштатом',money(c.autoFOT),`${c.target.recOpsPerShift} операторов / смену`)}
      ${metricRow('OPEX с арендой',money(c.totalCurrentOpex))}
    </div>
    <table class="tbl"><tr><th>Аналитика</th><th>Значение</th></tr>
      ${tr('Доля хранения в площади',fmt1(c.storageNet/c.area*100)+'%')}
      ${tr('Доля процессных зон',fmt1(c.processArea/c.area*100)+'%')}
      ${tr('Доля сервисных и staff зон',fmt1(c.supportArea/c.area*100)+'%')}
      ${tr('Секций на 1 м² помещения',fmt1(c.sections/c.area))}
      ${tr('SKU на 1 м² помещения',fmt1(c.workCap/c.area))}
      ${tr('Макс. сквозной поток команды',fmt(c.target.maxMonthly)+' SKU/мес')}
      ${tr('Запас мощности до таргета',fmt(c.target.maxMonthly-state.targetFlow)+' SKU/мес')}
      ${tr('CAPEX',money(state.capex))}
      ${tr('Аренда',money(state.rent))}
    </table>
    <div class="note">Следующим шагом можно добавить тарифы, выручку, прибыль и точку безубыточности.</div>`;

  const warnings=[];
  if(state.centralAisle<1.2) warnings.push(['bad','Центральный проход меньше 1,2 м.']);
  if(state.aisle<1.0) warnings.push(['bad','Проход между рядами меньше 1 м.']);
  if(c.autoStorageCams.uncovered.length>0) warnings.push(['bad',`В зоне хранения есть мёртвые зоны: ${c.autoStorageCams.uncovered.length} контрольных точек не закрыты.`]);
  else warnings.push(['good','В зоне хранения мёртвые зоны не обнаружены.']);
  if(!getZone('Эвакуационный выход')) warnings.push(['bad','Не отмечен эвакуационный выход.']);
  if(!getZone('Вход/выход персонала')) warnings.push(['bad','Не отмечен отдельный вход персонала.']);
  if(!getZone('Вход поставщиков')) warnings.push(['bad','Не отмечен вход поставщиков.']);
  if(getZone('Вход/выход персонала') && getZone('Вход поставщиков')) warnings.push(['good','Потоки персонала и поставщиков разделены.']);
  if(c.target.utilization>1) warnings.push(['bad',`Целевой поток ${fmt(state.targetFlow)} SKU/мес превышает мощность текущей команды ${fmt(c.target.maxMonthly)} SKU/мес.`]);
  if(c.sections===0) warnings.push(['bad','В зоне хранения не помещаются секции с заданными параметрами.']);
  warnings.push(['info','Модель камер использует условную дальность и простую проверку видимости. Для реального проекта нужно уточнять модель камеры и углы обзора.']);
  warnings.push(['info','Колонны и препятствия вычитаются из полезной площади и учитываются как блокирующие обзор камеры объекты.']);
  $('tab-checks').innerHTML=warnings.map(([cl,txt])=>`<div class="warnbox ${cl}">${txt}</div>`).join('');
}

function render(){
  saveState();
  renderColumnsList();
  drawPlan();
  renderEmulator();
  renderTabs();
}

function downloadJSON(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='mfc-planner-v4.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
$('saveBtn').onclick=()=>{ saveState(); toast('Проект сохранён'); };
$('exportBtn').onclick=downloadJSON;
$('resetBtn').onclick=()=>{ if(confirm('Сбросить проект?')){ state=structuredClone(defaults); loadDefaultZones(); bindInputs(); render(); } };
$('optBtn').onclick=optimizePlan;
$('optSideBtn').onclick=optimizePlan;
$('addColumnBtn').onclick=()=>{
  state.columns.push({x:6,y:3,w:0.6,h:0.6});
  render();
};
$('importInput').addEventListener('change', async (e)=>{
  try{
    const text=await e.target.files[0].text();
    state=Object.assign(structuredClone(defaults), JSON.parse(text));
    if(!state.zones || !state.zones.length) loadDefaultZones();
    if(!state.columns) state.columns=[];
    bindInputs(); render(); toast('Проект загружен');
  }catch(err){ alert('Не удалось прочитать проект'); }
});
document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.tabcontent').forEach(x=>x.classList.remove('active'));
  btn.classList.add('active');
  $('tab-'+btn.dataset.tab).classList.add('active');
});
function toast(text){
  let t=document.querySelector('.toast');
  if(!t){ t=document.createElement('div'); t.className='toast'; document.body.appendChild(t); }
  t.textContent=text; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1600);
}

bindInputs();
render();
