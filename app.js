
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
function money(n){return fmt(n)+' ₽';}
const colors={storage:'#d8bdf0',process:'#f4c2dc',staff:'#c7d5ef',service:'#d5ddcf',equipment:'#e6d3a9',custom:'#d8d8e8'};
const names={accept:'Приёмка',putaway:'Раскладка',pick:'Сборка',ship:'Отгрузка'};

const defaults={
  roomL:20,roomW:10,roomH:3,avgSkuL:4.5,targetFlow:100000,simFlow:100000,layoutMode:'balanced',
  centralAisle:1.6,rackL:1.2,rackD:0.5,rackH:2.5,shelves:5,aisle:1.2,fillPct:95,
  normAccept:2750,normPutaway:2750,normPick:1500,normShip:3500,
  opsPerShift:3,shiftsPerDay:2,paidHours:11,opRate:400,seniors:2,seniorSalary:90000,managers:1,managerSalary:130000,
  cameraRange:3.4,coverageStep:0.8,zones:[],columns:[],objects:[],avgFlow:100000,maxFlow:120000,fixedPC:2,fixedTsd:3,fixedTablet:2,rent:300000,capex:2921881
};

let state=JSON.parse(localStorage.getItem('mfcPlannerV743')||'null');
if(!state){
  const previousKeys=['mfcPlannerV69','mfcPlannerV68','mfcPlannerV67','mfcPlannerV66','mfcPlannerV65','mfcPlannerV64','mfcPlannerV63','mfcPlannerV62','mfcPlannerV61','mfcPlannerV5'];
  for(const key of previousKeys){
    try{
      const candidate=JSON.parse(localStorage.getItem(key)||'null');
      if(candidate){ state=candidate; break; }
    }catch(e){}
  }
}
if(!state) state=structuredClone(defaults);
for(const k in defaults){if(state[k]===undefined) state[k]=structuredClone(defaults[k]);}


function sanitizeState(){
  const numericKeys=[
    'roomL','roomW','roomH','avgSkuL','targetFlow','simFlow','centralAisle',
    'rackL','rackD','rackH','shelves','aisle','fillPct',
    'normAccept','normPutaway','normPick','normShip',
    'opsPerShift','shiftsPerDay','paidHours','opRate',
    'seniors','seniorSalary','managers','managerSalary',
    'cameraRange','coverageStep','avgFlow','maxFlow',
    'fixedPC','fixedTsd','fixedTablet','rent','capex'
  ];
  numericKeys.forEach(k=>{
    const v=Number(state[k]);
    if(state[k]===null || state[k]==='' || !Number.isFinite(v)){
      state[k]=defaults[k];
    }else{
      state[k]=v;
    }
  });
  if(!state.layoutMode) state.layoutMode=defaults.layoutMode;
  if(!Array.isArray(state.zones)) state.zones=[];
  if(!Array.isArray(state.columns)) state.columns=[];
  if(!Array.isArray(state.objects)) state.objects=[];
}
sanitizeState();

function inferZoneRole(o){
  if(!o) return 'optional';
  if(o.zoneRole) return o.zoneRole;
  if(['Приёмка','Отгрузка','Упаковка','Контроль качества','Возвраты','Буфер приемки','Буфер отгрузки'].includes(o.name)) return 'process';
  if(['Коридор персонала','WC','Раздевалка','Офис','Центральный проход'].includes(o.name)) return 'service';
  if(['Вход поставщиков','Вход/выход персонала','Эвакуационный выход','Дверь'].includes(o.name)) return 'hard';
  if(o.type==='process') return 'process';
  if(o.type==='staff'||o.type==='service') return 'service';
  return 'optional';
}

function migrateSmartZones(){
  [...(state.zones||[]),...(state.objects||[])].forEach(o=>{
    if(!o.zoneRole) o.zoneRole=inferZoneRole(o);
    // Для старых проектов сохраняем физическую геометрию: объект блокирует хранение,
    // пока пользователь явно не отключил это в редакторе.
    if(o.blocksStorage===undefined) o.blocksStorage=(o.affectsCapacity!==false);
  });
}
migrateSmartZones();

function migrateV69(){
  // Сборка в этом проекте находится на мезонине и не должна занимать площадь 1 этажа.
  state.zones = (state.zones||[]).filter(z=>z.name!=='Сборка');

  // Старая зона "Хранение" больше не является геометрическим источником для стеллажей.
  // Оставляем её только как системную сущность совместимости, но не рисуем и не блокируем.
}
migrateV69();

let selected={kind:null,index:null,name:null};
let mode='move', drag=null;

function save(){localStorage.setItem('mfcPlannerV743',JSON.stringify(state));}
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
    {name:'Отгрузка',type:'process',x:13,y:W-2.6,w:4.2,h:2.2,locked:false},
    {name:'Вход поставщиков',type:'service',x:L/2-1.5,y:W-.6,w:3,h:.6,locked:false},
    {name:'Вход/выход персонала',type:'service',x:0,y:W/2-.8,w:.4,h:1.6,locked:false},
    {name:'Эвакуационный выход',type:'service',x:L-.4,y:W/2-.8,w:.4,h:1.6,locked:false},
  ];
}
if(!state.zones.length)initZones();


function recommendedCentralAisle(){
  let w=1.6;
  const f=Number(state.targetFlow)||0;
  if(f<=60000) w=1.4;
  else if(f<=100000) w=1.6;
  else if(f<=120000) w=1.8;
  else w=2.0;

  if(state.layoutMode==='capacity') w=Math.max(1.2,w-0.2);
  if(state.layoutMode==='flow') w=Math.min(2.4,w+0.2);
  return Math.round(w*10)/10;
}

function centralIsVertical(){
  const c=getZone('Центральный проход');
  return !!c && ((c.rotation||0)%180===90);
}

function normalizeSystemZones(){
  const L=state.roomL,W=state.roomW;
  const central=getZone('Центральный проход');
  if(!central) return;

  const candidate=rackCandidateArea();
  const thickness=clamp(Number(state.centralAisle)||1.6,1.2,2.6);

  if(centralIsVertical()){
    central.rotation=90;
    central.y=candidate.y;
    central.h=candidate.h;
    central.w=thickness;
    central.x=clamp(central.x,candidate.x+.3,candidate.x+candidate.w-central.w-.3);
    state.centralAisle=central.w;
  }else{
    central.rotation=0;
    central.x=candidate.x;
    central.w=candidate.w;
    central.h=thickness;
    central.y=clamp(central.y,candidate.y+.3,candidate.y+candidate.h-central.h-.3);
    state.centralAisle=central.h;
  }
}

function centerCentralAisle(){
  const central=getZone('Центральный проход');
  if(!central)return;
  const candidate=rackCandidateArea();

  if(centralIsVertical()){
    central.y=candidate.y;
    central.h=candidate.h;
    central.w=clamp(state.centralAisle||1.6,1.2,2.6);
    central.x=candidate.x+candidate.w/2-central.w/2;
  }else{
    central.x=candidate.x;
    central.w=candidate.w;
    central.h=clamp(state.centralAisle||1.6,1.2,2.6);
    central.y=candidate.y+candidate.h/2-central.h/2;
  }
}

function optimize(){
  const L=state.roomL,W=state.roomW;

  // Автоподбор ЦП по целевому потоку и режиму.
  state.centralAisle=recommendedCentralAisle();

  const left = state.layoutMode==='capacity' ? 1.8 : 2.1;

  let procDepth=2.2;
  const daily=(Number(state.targetFlow)||0)/30;
  procDepth += Math.min(0.8,daily/5000);
  if(state.layoutMode==='capacity') procDepth-=0.2;
  if(state.layoutMode==='flow') procDepth+=0.35;
  procDepth=clamp(procDepth,2.0,Math.min(3.2,W*0.34));

  const mainW=Math.max(4,L-left-0.4);
  const processY=W-procDepth-0.2;
  const storage={
    name:'Хранение',type:'storage',
    x:left+0.2,y:0.2,w:mainW,h:Math.max(2.4,processY-0.4),
    rotation:0,affectsCapacity:true,affectsFlow:false,needsCamera:true
  };

  // Приёмка/сборка/отгрузка: сборке больше места, т.к. она самое медленное звено.
  let acceptRatio=0.30,pickRatio=0.42,shipRatio=0.28;
  if(state.layoutMode==='capacity'){acceptRatio=0.29;pickRatio=0.39;shipRatio=0.32;}
  if(state.layoutMode==='flow'){acceptRatio=0.31;pickRatio=0.45;shipRatio=0.24;}
  const aw=mainW*acceptRatio;
  const pw=mainW*pickRatio;
  const sw=mainW-aw-pw;

  state.zones=[
    {name:'Коридор персонала',type:'service',x:0,y:0,w:left,h:W,rotation:0,affectsCapacity:false,affectsFlow:false,needsCamera:true},
    {name:'Раздевалка',type:'staff',x:0.2,y:0.8,w:left-0.4,h:1.9,rotation:0,affectsCapacity:false,affectsFlow:false,needsCamera:false},
    {name:'Офис',type:'staff',x:0.2,y:3.0,w:left-0.4,h:2.2,rotation:0,affectsCapacity:false,affectsFlow:false,needsCamera:true},
    {name:'WC',type:'service',x:0.2,y:5.5,w:left-0.4,h:1.2,rotation:0,affectsCapacity:false,affectsFlow:false,needsCamera:false},
    storage,
    {name:'Центральный проход',type:'service',
      x:storage.x,y:storage.y+storage.h/2-state.centralAisle/2,
      w:storage.w,h:state.centralAisle,rotation:0,
      affectsCapacity:true,affectsFlow:true,needsCamera:false},
    {name:'Приёмка',type:'process',x:storage.x,y:processY,w:aw,h:procDepth,rotation:0,affectsCapacity:true,affectsFlow:true,needsCamera:true},
    {name:'Отгрузка',type:'process',x:storage.x+aw+pw,y:processY,w:sw,h:procDepth,rotation:0,affectsCapacity:true,affectsFlow:true,needsCamera:true},
    {name:'Вход поставщиков',type:'service',x:L/2-1.2,y:W-0.45,w:2.4,h:0.45,rotation:0,affectsCapacity:false,affectsFlow:true,needsCamera:true},
    {name:'Вход/выход персонала',type:'service',x:0,y:W/2-0.7,w:0.35,h:1.4,rotation:0,affectsCapacity:false,affectsFlow:false,needsCamera:true},
    {name:'Эвакуационный выход',type:'service',x:L-0.35,y:W/2-0.7,w:0.35,h:1.4,rotation:0,affectsCapacity:false,affectsFlow:false,needsCamera:true}
  ];

  normalizeSystemZones();
  renderAll();
}


function syncStorageWithProcessZones(){
  const storage=getZone('Хранение');
  if(!storage) return;

  const processZones=state.zones.filter(z=>z.type==='process' && ['Приёмка','Отгрузка'].includes(z.name));
  if(!processZones.length) return;

  // Нижняя граница хранения всегда подстраивается под самый верхний край process-зон.
  const processTop=Math.min(...processZones.map(z=>z.y));
  const newH=processTop-storage.y-0.15;

  if(newH>=2){
    storage.h=newH;
  }

  // Хранение растягиваем по ширине рабочей части помещения.
  const corridor=getZone('Коридор персонала');
  const left= corridor ? corridor.x+corridor.w+0.2 : storage.x;
  storage.x=left;
  storage.w=Math.max(2,state.roomL-left-0.2);

  // ЦП после изменения хранения сохраняем внутри новой геометрии.
  normalizeSystemZones();
}

function autoFillFreedSpace(){
  // Ничего вручную не расширяем: rackPlan() сам сканирует всю свободную площадь.
  normalizeSystemZones();
}

function splitStorageBlocks(){
  const s=getZone('Хранение'),c=getZone('Центральный проход');
  if(!s)return [];
  if(!c||!rectsOverlap(s,c))return [s];

  const blocks=[];

  if(centralIsVertical()){
    const leftW=Math.max(0,c.x-s.x);
    const rightX=c.x+c.w;
    const rightW=Math.max(0,s.x+s.w-rightX);
    if(leftW>.2)blocks.push({x:s.x,y:s.y,w:leftW,h:s.h});
    if(rightW>.2)blocks.push({x:rightX,y:s.y,w:rightW,h:s.h});
  }else{
    const topH=Math.max(0,c.y-s.y);
    const bottomY=c.y+c.h;
    const bottomH=Math.max(0,s.y+s.h-bottomY);
    if(topH>.2)blocks.push({x:s.x,y:s.y,w:s.w,h:topH});
    if(bottomH>.2)blocks.push({x:s.x,y:bottomY,w:s.w,h:bottomH});
  }
  return blocks;
}


function rackBlockers(){
  const blockers=[];

  // Реальные зоны блокируют хранение только в своей текущей геометрии.
  // Старую системную зону "Хранение" не используем как ограничитель.
  state.zones.forEach(z=>{
    if(z.name==='Хранение') return;
    if(z.blocksStorage===false || z.affectsCapacity===false) return;
    blockers.push({x:z.x,y:z.y,w:z.w,h:z.h,name:z.name,kind:'zone'});
  });

  // Колонны всегда являются жесткими препятствиями.
  state.columns.forEach((c,i)=>{
    blockers.push({x:c.x,y:c.y,w:c.w,h:c.h,name:'Колонна '+(i+1),kind:'column'});
  });

  // Пользовательские объекты блокируют только если включено влияние на вместимость.
  state.objects.forEach((o,i)=>{
    if(o.blocksStorage===false || o.affectsCapacity===false) return;
    blockers.push({
      x:o.x,y:o.y,w:o.w,h:o.h,
      name:o.name||('Объект '+(i+1)),
      kind:'object'
    });
  });

  return blockers;
}
function rackCandidateArea(){
  // Вся внутренняя площадь помещения является кандидатом под хранение.
  // Коридоры, WC, офис, приемка, отгрузка, ЦП и т.п. вырезаются
  // через rackBlockers() по их ФАКТИЧЕСКОМУ текущему положению.
  const margin=.15;
  return {
    x:margin,
    y:margin,
    w:Math.max(.5,state.roomL-margin*2),
    h:Math.max(.5,state.roomW-margin*2)
  };
}
function rackCellAllowed(rect, blockers){
  // Не выходим из помещения.
  if(rect.x<0 || rect.y<0 || rect.x+rect.w>state.roomL || rect.y+rect.h>state.roomW) return false;

  // Не пересекаем блокирующие зоны.
  if(blockers.some(b=>rectsOverlap(rect,b))) return false;

  return true;
}

function buildFreeRackPlan(orientation, offset=0){
  const bounds=rackCandidateArea();
  const blockers=rackBlockers();
  const racks=[];
  const streets=[];

  const rackLength=Math.max(.2,state.rackL);
  const rackDepth=Math.max(.15,state.rackD);
  const aisle=Math.max(.4,state.aisle);

  // Одна улица: стеллаж + рабочий проход + стеллаж.
  const streetWidth=rackDepth+aisle+rackDepth;

  const allowed=rect=>{
    if(rect.x<bounds.x-1e-9 || rect.y<bounds.y-1e-9 ||
       rect.x+rect.w>bounds.x+bounds.w+1e-9 ||
       rect.y+rect.h>bounds.y+bounds.h+1e-9) return false;
    return !blockers.some(b=>rectsOverlap(rect,b));
  };

  if(orientation==='horizontal'){
    // Улица идет вдоль X. Два ряда смотрят друг на друга через проход.
    for(let y=bounds.y+offset; y+streetWidth<=bounds.y+bounds.h+1e-9; y+=streetWidth){
      const street={orientation:'horizontal',x:bounds.x,y,w:bounds.w,h:streetWidth,sections:0,pairs:[]};

      for(let x=bounds.x; x+rackLength<=bounds.x+bounds.w+1e-9; x+=rackLength){
        const rackA={x,y,w:rackLength,h:rackDepth,street:streets.length,side:'A'};
        const aisleCell={x,y:y+rackDepth,w:rackLength,h:aisle};
        const rackB={x,y:y+rackDepth+aisle,w:rackLength,h:rackDepth,street:streets.length,side:'B'};

        // Для рабочей улицы обязательно должны существовать обе стороны
        // и сам проход между ними.
        if(allowed(rackA) && allowed(aisleCell) && allowed(rackB)){
          racks.push(rackA,rackB);
          street.pairs.push({x,y});
          street.sections+=2;
        }
      }

      if(street.sections>0) streets.push(street);
    }
  }else{
    // Улица идет вдоль Y.
    for(let x=bounds.x+offset; x+streetWidth<=bounds.x+bounds.w+1e-9; x+=streetWidth){
      const street={orientation:'vertical',x,y:bounds.y,w:streetWidth,h:bounds.h,sections:0,pairs:[]};

      for(let y=bounds.y; y+rackLength<=bounds.y+bounds.h+1e-9; y+=rackLength){
        const rackA={x,y,w:rackDepth,h:rackLength,street:streets.length,side:'A'};
        const aisleCell={x:x+rackDepth,y,w:aisle,h:rackLength};
        const rackB={x:x+rackDepth+aisle,y,w:rackDepth,h:rackLength,street:streets.length,side:'B'};

        if(allowed(rackA) && allowed(aisleCell) && allowed(rackB)){
          racks.push(rackA,rackB);
          street.pairs.push({x,y});
          street.sections+=2;
        }
      }

      if(street.sections>0) streets.push(street);
    }
  }

  return {
    orientation,
    total:racks.length,
    racks,
    streets,
    streetCount:streets.length,
    streetWidth,
    rackArea:racks.reduce((s,r)=>s+r.w*r.h,0)
  };
}
function freeRackPlan(){
  const rackDepth=Math.max(.15,state.rackD);
  const aisle=Math.max(.4,state.aisle);
  const streetWidth=rackDepth*2+aisle;

  // Сдвигаем сетку улиц несколькими способами.
  // Это позволяет использовать площадь, освободившуюся после перемещения зон.
  const offsets=[
    0,
    Math.min(rackDepth,streetWidth*.25),
    streetWidth*.25,
    streetWidth*.5
  ];

  const candidates=[];
  offsets.forEach(o=>{
    candidates.push(buildFreeRackPlan('horizontal',o));
    candidates.push(buildFreeRackPlan('vertical',o));
  });

  candidates.sort((a,b)=>{
    if(b.total!==a.total) return b.total-a.total;
    if(b.streetCount!==a.streetCount) return b.streetCount-a.streetCount;
    return b.rackArea-a.rackArea;
  });

  return candidates[0] || {
    orientation:'horizontal',
    total:0,
    racks:[],
    streets:[],
    streetCount:0,
    streetWidth
  };
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
function rackPlan(){ return freeRackPlan(); }

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
  const plan=rackPlan();
  const racks=plan.racks||[];
  const step=Math.max(.5,state.coverageStep);
  const range=Math.max(1,state.cameraRange);

  if(!racks.length) return {cams:[],uncovered:[],total:0,covered:0};

  // Контрольные точки строим только по фактической стеллажной геометрии
  // и проходам непосредственно вокруг неё.
  const samples=[];
  racks.forEach(r=>{
    const pts=[
      {x:r.x+r.w/2,y:r.y+r.h/2},
      {x:r.x+r.w/2,y:Math.max(.05,r.y-state.aisle/2)},
      {x:r.x+r.w/2,y:Math.min(state.roomW-.05,r.y+r.h+state.aisle/2)}
    ];
    pts.forEach(p=>{
      if(!state.columns.some(c=>pointInRect(p,c))) samples.push(p);
    });
  });

  // Убираем почти одинаковые точки.
  const uniq=[];
  const seen=new Set();
  samples.forEach(p=>{
    const key=(Math.round(p.x/step)*step).toFixed(2)+'|'+(Math.round(p.y/step)*step).toFixed(2);
    if(!seen.has(key)){ seen.add(key); uniq.push(p); }
  });

  // Кандидаты камер располагаем вдоль фактических рядов, а не старой зоны хранения.
  const candidates=[];
  racks.forEach(r=>{
    [
      {x:r.x+r.w/2,y:Math.max(.15,r.y-state.aisle*.45)},
      {x:r.x+r.w/2,y:Math.min(state.roomW-.15,r.y+r.h+state.aisle*.45)}
    ].forEach(p=>{
      if(!state.columns.some(c=>pointInRect(p,c))) candidates.push(p);
    });
  });

  const visible=(cam,p)=>{
    if(Math.hypot(cam.x-p.x,cam.y-p.y)>range) return false;
    if(state.columns.some(c=>lineHitsRect(cam,p,c))) return false;
    return true;
  };

  let uncovered=uniq.slice();
  const cams=[];
  while(uncovered.length && cams.length<80){
    let best=null,bestCover=[];
    for(const cand of candidates){
      if(cams.some(c=>Math.hypot(c.x-cand.x,c.y-cand.y)<.5)) continue;
      const cover=uncovered.filter(p=>visible(cand,p));
      if(cover.length>bestCover.length){best=cand;bestCover=cover;}
    }
    if(!best || !bestCover.length) break;
    cams.push(best);
    const set=new Set(bestCover.map(p=>p.x.toFixed(3)+'|'+p.y.toFixed(3)));
    uncovered=uncovered.filter(p=>!set.has(p.x.toFixed(3)+'|'+p.y.toFixed(3)));
  }

  return {cams,uncovered,total:uniq.length,covered:uniq.length-uncovered.length};
}


function estimatedRackableArea(){
  const candidate=rackCandidateArea();
  const blockers=rackBlockers();
  const step=.5;
  let free=0;

  for(let x=candidate.x;x<candidate.x+candidate.w;x+=step){
    for(let y=candidate.y;y<candidate.y+candidate.h;y+=step){
      const cell={
        x,y,
        w:Math.min(step,candidate.x+candidate.w-x),
        h:Math.min(step,candidate.y+candidate.h-y)
      };
      if(blockers.some(b=>rectsOverlap(cell,b))) continue;
      free+=area(cell);
    }
  }
  return free;
}

function rackUsedArea(){
  const plan=rackPlan();
  return (plan.racks||[]).reduce((s,r)=>s+area(r),0);
}

function rackableFreeArea(){
  return estimatedRackableArea();
}

function unusedRackableArea(){
  return Math.max(0,rackableFreeArea()-rackUsedArea());
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
  return {rp,vol,cap100,cap,pm,cams,totalCams:cams.cams.length+other,area:state.roomL*state.roomW,storageArea:estimatedRackableArea(),processArea,supportArea,currentFOT,autoFOT,currentOpex:currentFOT+state.rent,autoOpex:autoFOT+state.rent,userCams,streetCount:rp.streetCount||0,rackFootprint:rp.rackArea||0};
}


function clientToModel(e,svg,ox,oy,sc){
  const r=svg.getBoundingClientRect();
  const sx=1000/r.width;
  const sy=590/r.height;
  return {
    x:((e.clientX-r.left)*sx-ox)/sc,
    y:((e.clientY-r.top)*sy-oy)/sc
  };
}

function findEntityAtPoint(pt){
  for(let i=(state.objects||[]).length-1;i>=0;i--){
    if(pointInRect(pt,state.objects[i])) return {kind:'object',index:i};
  }
  for(let i=(state.columns||[]).length-1;i>=0;i--){
    if(pointInRect(pt,state.columns[i])) return {kind:'column',index:i};
  }

  const candidates=(state.zones||[])
    .map((z,index)=>({z,index,a:area(z)}))
    .filter(x=>x.z.name!=='Хранение' && pointInRect(pt,x.z))
    .sort((a,b)=>a.a-b.a);

  return candidates.length ? {kind:'zone',index:candidates[0].index} : null;
}

function draw(){
  const svg=$('plan');
  svg.innerHTML='';

  const ns='http://www.w3.org/2000/svg';
  const W=940,H=520;
  const sc=Math.min(W/state.roomL,H/state.roomW);
  const ox=(1000-state.roomL*sc)/2;
  const oy=(590-state.roomW*sc)/2;

  const add=(tag,attrs,parent=svg)=>{
    const e=document.createElementNS(ns,tag);
    for(const k in attrs)e.setAttribute(k,attrs[k]);
    parent.appendChild(e);
    return e;
  };

  add('rect',{x:ox,y:oy,width:state.roomL*sc,height:state.roomW*sc,class:'room'});

  // Сетка помещения: только визуальный слой.
  for(let i=1;i<state.roomL;i++) add('line',{x1:ox+i*sc,y1:oy,x2:ox+i*sc,y2:oy+state.roomW*sc,class:'grid'});
  for(let i=1;i<state.roomW;i++) add('line',{x1:ox,y1:oy+i*sc,x2:ox+state.roomL*sc,y2:oy+i*sc,class:'grid'});

  const actualRackPlan=rackPlan();
  const candidateArea=rackCandidateArea();
  const blockers=rackBlockers();

  // Единый фон потенциальной складской площади.
  add('rect',{
    x:ox+candidateArea.x*sc,
    y:oy+candidateArea.y*sc,
    width:candidateArea.w*sc,
    height:candidateArea.h*sc,
    class:'rackableBg'
  });

  // Блокирующие зоны "вырезаем" из складского фона визуально.
  blockers.forEach(b=>{
    add('rect',{
      x:ox+b.x*sc,
      y:oy+b.y*sc,
      width:b.w*sc,
      height:b.h*sc,
      class:'blockerCut'
    });
  });

  // Фактические стеллажи.
  (actualRackPlan.racks||[]).forEach(r=>{
    add('rect',{
      x:ox+r.x*sc+1,
      y:oy+r.y*sc+1,
      width:Math.max(2,r.w*sc-2),
      height:Math.max(2,r.h*sc-2),
      class:'rack'
    });
  });

  // Теперь рисуем реальные интерактивные зоны поверх складской геометрии.
  state.zones.forEach((z,idx)=>{
    if(z.name==='Хранение') return; // legacy zone больше не рисуем

    const g=add('g',{'data-kind':'zone','data-index':idx,class:'obj'});
    add('rect',{
      x:ox+z.x*sc,y:oy+z.y*sc,width:z.w*sc,height:z.h*sc,rx:7,
      fill:colors[z.type],
      class:'zone'+(selected.kind==='zone'&&selected.index===idx?' selected':'')
    },g);
    add('text',{x:ox+z.x*sc+7,y:oy+z.y*sc+18,class:'label'},g).textContent=z.name;
    add('text',{x:ox+z.x*sc+7,y:oy+z.y*sc+33,class:'sub'},g).textContent=fmt1(netArea(z))+' м²';
    if(mode==='resize'&&selected.kind==='zone'&&selected.index===idx){
      add('rect',{x:ox+(z.x+z.w)*sc-8,y:oy+(z.y+z.h)*sc-8,width:16,height:16,class:'handle'},g);
    }
  });

  state.objects.forEach((o,idx)=>{
    const g=add('g',{'data-kind':'object','data-index':idx,class:'obj'});
    add('rect',{
      x:ox+o.x*sc,y:oy+o.y*sc,width:o.w*sc,height:o.h*sc,rx:6,
      fill:objectColor(o),
      class:'zone'+(selected.kind==='object'&&selected.index===idx?' selected':'')
    },g);
    add('text',{x:ox+o.x*sc+7,y:oy+o.y*sc+18,class:'label'},g).textContent=o.name;
    add('text',{x:ox+o.x*sc+7,y:oy+o.y*sc+33,class:'sub'},g).textContent=fmt1(area(o))+' м²';
    if(mode==='resize'&&selected.kind==='object'&&selected.index===idx){
      add('rect',{x:ox+(o.x+o.w)*sc-8,y:oy+(o.y+o.h)*sc-8,width:16,height:16,class:'handle'},g);
    }
  });

  state.columns.forEach((c,idx)=>{
    const g=add('g',{'data-kind':'column','data-index':idx,class:'obj'});
    add('rect',{
      x:ox+c.x*sc,y:oy+c.y*sc,width:c.w*sc,height:c.h*sc,rx:4,
      class:'column'+(selected.kind==='column'&&selected.index===idx?' selected':'')
    },g);
    if(mode==='resize'&&selected.kind==='column'&&selected.index===idx){
      add('rect',{x:ox+(c.x+c.w)*sc-8,y:oy+(c.y+c.h)*sc-8,width:16,height:16,class:'handle'},g);
    }
  });

  // Камеры строятся по фактическим стеллажам.
  const a=analytics();
  a.cams.cams.forEach(p=>{
    add('circle',{cx:ox+p.x*sc,cy:oy+p.y*sc,r:4,class:'cam'});
    add('path',{d:`M ${ox+p.x*sc-10} ${oy+p.y*sc+8} Q ${ox+p.x*sc} ${oy+p.y*sc-6} ${ox+p.x*sc+10} ${oy+p.y*sc+8}`,class:'camarc'});
  });
  a.cams.uncovered.slice(0,150).forEach(p=>{
    add('circle',{cx:ox+p.x*sc,cy:oy+p.y*sc,r:2,class:'dead'});
  });

  svg.onmousedown=e=>{
    const pt=clientToModel(e,svg,ox,oy,sc);
    const obj=e.target.closest ? e.target.closest('.obj') : null;

    let hit=null;
    if(obj){
      hit={kind:obj.dataset.kind,index:+obj.dataset.index};
    }else{
      hit=findEntityAtPoint(pt);
    }
    if(!hit)return;

    const kind=hit.kind,index=hit.index;
    selected={kind,index};
    const arr=kind==='zone'?state.zones:kind==='column'?state.columns:state.objects;
    const target=arr[index];
    if(!target)return;

    const nearHandle=mode==='resize' &&
      Math.abs(pt.x-(target.x+target.w))<.35 &&
      Math.abs(pt.y-(target.y+target.h))<.35;

    drag={
      kind,index,
      startX:pt.x,startY:pt.y,
      orig:{...target},
      action:nearHandle?'resize':'move',
      ox,oy,sc
    };

    renderSelected();
    draw();
  };

  window.onmousemove=e=>{
    if(!drag)return;
    const svg=$('plan');
    const pt=clientToModel(e,svg,drag.ox,drag.oy,drag.sc);
    const target=drag.kind==='zone'?state.zones[drag.index]:drag.kind==='column'?state.columns[drag.index]:state.objects[drag.index];

    if(drag.action==='move'){
      if(target.name==='Центральный проход'){
        const candidate=rackCandidateArea();
        if(centralIsVertical()){
          target.y=candidate.y;
          target.h=candidate.h;
          target.x=clamp(drag.orig.x+(pt.x-drag.startX),candidate.x+.3,candidate.x+candidate.w-target.w-.3);
        }else{
          target.x=candidate.x;
          target.w=candidate.w;
          target.y=clamp(drag.orig.y+(pt.y-drag.startY),candidate.y+.3,candidate.y+candidate.h-target.h-.3);
        }
      }else{
        target.x=clamp(drag.orig.x+(pt.x-drag.startX),0,state.roomL-target.w);
        target.y=clamp(drag.orig.y+(pt.y-drag.startY),0,state.roomW-target.h);
      }
    }else{
      if(target.name==='Центральный проход'){
        if(centralIsVertical()){
          target.w=clamp(drag.orig.w+(pt.x-drag.startX),1.2,2.6);
          state.centralAisle=target.w;
        }else{
          target.h=clamp(drag.orig.h+(pt.y-drag.startY),1.2,2.6);
          state.centralAisle=target.h;
        }
      }else{
        target.w=clamp(drag.orig.w+(pt.x-drag.startX),.3,state.roomL-target.x);
        target.h=clamp(drag.orig.h+(pt.y-drag.startY),.3,state.roomW-target.y);
      }
    }

    save();
    draw();
    renderTabs();
    renderSelected();
  };

  window.onmouseup=()=>{
    if(drag){
      drag=null;
      renderAll();
    }
  };

  $('layoutSummary').textContent=`Свободная геометрия · улиц ${a.rp.streetCount||0} · секций ${a.rp.total} · стеллажи ${fmt1(a.rp.rackArea||0)} м² · свободный остаток ${fmt1(unusedRackableArea())} м² · ${a.rp.orientation==='horizontal'?'продольные':'поперечные'} улицы`;
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
  ${selected.kind!=='column'?`<label>Визуальный тип<select id="selType"><option value="storage">Хранение</option><option value="process">Операционная зона</option><option value="staff">Персонал</option><option value="service">Проход / сервис</option><option value="equipment">Оборудование</option><option value="custom">Кастомный</option></select></label>
  <label>Роль при оптимизации<select id="zoneRole"><option value="hard">Жёсткое препятствие</option><option value="process">Процессная зона</option><option value="service">Сервисная зона</option><option value="optional">Опциональная зона</option></select></label>
  <div class="toggles">
    <label><input id="blockStorageToggle" type="checkbox" ${obj.blocksStorage!==false?'checked':''}> занимает площадь для стеллажей</label>
    <label><input id="capToggle" type="checkbox" ${obj.affectsCapacity?'checked':''}> влияет на аналитику вместимости</label>
    <label><input id="flowToggle" type="checkbox" ${obj.affectsFlow?'checked':''}> влияет на поток</label>
    <label><input id="camToggle" type="checkbox" ${obj.needsCamera?'checked':''}> нужен контроль камерой</label>
  </div><div class="hint">Поворот: ${obj.rotation||0}°. Если снять «занимает площадь для стеллажей», оптимизатор сможет использовать эту область под хранение.</div>`:''}`;
  if($('selName'))$('selName').oninput=()=>{obj.name=$('selName').value;renderAll()};
  ['sx','sy','sw','sh'].forEach(id=>$(id).oninput=()=>{
    obj[{sx:'x',sy:'y',sw:'w',sh:'h'}[id]]=parseFloat($(id).value)||0;
    if(obj.name==='Центральный проход')state.centralAisle=centralIsVertical()?obj.w:obj.h;renderAll();
  });
  if($('selType')){$('selType').value=obj.type;$('selType').onchange=()=>{obj.type=$('selType').value;renderAll()}}
  if($('zoneRole')){$('zoneRole').value=obj.zoneRole||inferZoneRole(obj);$('zoneRole').onchange=()=>{obj.zoneRole=$('zoneRole').value;renderAll()}}
  if($('blockStorageToggle'))$('blockStorageToggle').onchange=()=>{obj.blocksStorage=$('blockStorageToggle').checked;renderAll()}
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
  <div class="emukpi ${ok?'goodbg':'badbg'}"><span>Статус</span><b>${ok?'Поток проходит':'Выше мощности'}</b><small>${fmt(state.simFlow)} ШК/мес</small></div>
  <div class="emukpi"><span>Загрузка</span><b>${fmt1(m.util*100)}%</b></div>
  <div class="emukpi"><span>Минимум</span><b>${m.min} оп./смену</b></div>
  <div class="emukpi"><span>Рекомендуемо</span><b>${m.rec} оп./смену</b></div></div>
  <div class="lineflow"><span>Приёмка</span><i>→</i><span>Раскладка</span><i>→</i><span>Сборка</span><i>→</i><span>Отгрузка</span></div>`
}

function tr(a,b,c,d){return `<tr><td>${a}</td><td>${b}</td>${c!==undefined?`<td>${c}</td>`:''}${d!==undefined?`<td>${d}</td>`:''}</tr>`}
function metric(name,val,sub=''){return `<div class="metricrow"><span>${name}</span><b>${val}</b>${sub?`<small>${sub}</small>`:''}</div>`}
function renderTabs(){
  const a=analytics(),pm=a.pm;
  $('mArea').textContent=fmt1(a.area)+' м²';$('mCapacity').textContent=fmt(a.cap)+' ШК';$('mThroughput').textContent=fmt(pm.maxMonthly)+' ШК/мес';$('mCams').textContent=fmt(a.totalCams)+' шт.';$('mStaff').textContent=pm.rec+' оп./смену';

  $('tab-capacity').innerHTML=`<div class="cards3">${metric('Площадь хранения',fmt1(a.storageArea)+' м²')}${metric('Секции',fmt(a.rp.total))}${metric('Рабочая вместимость',fmt(a.cap)+' ШК',state.fillPct+'% заполнения')}</div>
  <table class="tbl"><tr><th>Показатель</th><th>Значение</th></tr>${tr('Полезный объём',fmt1(a.vol)+' м³')}${tr('Вместимость 100%',fmt(a.cap100)+' ШК')}${tr('Рабочая вместимость',fmt(a.cap)+' ШК')}${tr('Центральный проход',fmt1(state.centralAisle)+' м · '+(centralIsVertical()?'вертикальный':'горизонтальный')+' · '+fmt1(area(getZone('Центральный проход')||{w:0,h:0}))+' м²')}</table>`;

  const oneTurn=processModel(a.cap),avg=processModel(state.avgFlow||100000),mx=processModel(state.maxFlow||120000);
  $('tab-throughput').innerHTML=`<div class="cards3">${metric('1 оборот рабочего стока',fmt(a.cap)+' ШК/мес',fmt(a.cap/30)+' ШК/сутки')}${metric('Средний рабочий',fmt(state.avgFlow||100000)+' ШК/мес',fmt1(avg.util*100)+'% загрузки')}${metric('Максимальный',fmt(state.maxFlow||120000)+' ШК/мес',fmt1(mx.util*100)+'% загрузки')}</div>
  <table class="tbl"><tr><th>Сценарий</th><th>Оборотов стока</th><th>Загрузка</th><th>Статус</th></tr>${tr('1 оборот',1,fmt1(oneTurn.util*100)+'%',oneTurn.util<=1?'проходит':'выше мощности')}${tr('Средний',((state.avgFlow||100000)/Math.max(1,a.cap)).toFixed(2),fmt1(avg.util*100)+'%',avg.util<=1?'проходит':'выше мощности')}${tr('Максимальный',((state.maxFlow||120000)/Math.max(1,a.cap)).toFixed(2),fmt1(mx.util*100)+'%',mx.util<=1?'проходит':'выше мощности')}${tr('Целевой',(state.targetFlow/Math.max(1,a.cap)).toFixed(2),fmt1(pm.util*100)+'%',pm.util<=1?'проходит':'выше мощности')}</table>`;

  $('tab-staff').innerHTML=`<div class="cards3">${metric('Минимум',pm.min+' оп./смену')}${metric('Рекомендуемо',pm.rec+' оп./смену','нагрузка до 85%')}${metric('Текущий состав',state.opsPerShift+' оп./смену',fmt1(pm.util*100)+'% загрузки')}</div>
  <table class="tbl"><tr><th>Операция</th><th>Норма</th><th>Чел.-смен/сутки</th><th>Доля труда</th></tr>${Object.keys(pm.req).map(k=>tr(names[k],fmt(pm.norms[k]),fmt1(pm.req[k]),fmt1(pm.req[k]/pm.total*100)+'%')).join('')}</table>`;

  $('tab-video').innerHTML=`<div class="cards3">${metric('Автокамеры склада',a.cams.cams.length)}${metric('Мёртвые точки',a.cams.uncovered.length,a.cams.uncovered.length?'нужно корректировать':'не обнаружены')}${metric('Итого камер',a.totalCams)}</div>
  <table class="tbl"><tr><th>Блок</th><th>Количество</th><th>Комментарий</th></tr>${tr('Склад',a.cams.cams.length,'автопокрытие')}${tr('Пользовательские камеры',a.userCams,'добавлены вручную')}${tr('Прочие точки',7,'входы, коридор, офис, отгрузка')}</table>`;

  $('tab-equip').innerHTML=`<div class="cards3">${metric('Пользовательские объекты',state.objects.length)}${metric('Колонны',state.columns.length)}${metric('Оборудование',state.objects.filter(o=>o.type==='equipment').length)}</div>
  <table class="tbl"><tr><th>Объект</th><th>Количество</th><th>Комментарий</th></tr>${tr('Стационарные ПК',state.fixedPC||2,'базовая модель')}${tr('ТСД',state.fixedTsd||3,'базовая модель')}${tr('Планшеты',state.fixedTablet||2,'базовая модель')}${tr('Столы, двери, кастомные зоны',state.objects.length,'созданы через библиотеку')}</table>`;

  const route='Сборка на мезонине';
  $('tab-analytics').innerHTML=`<div class="cards3">${metric('ФОТ текущий',money(a.currentFOT))}${metric('ФОТ с автоштатом',money(a.autoFOT))}${metric('OPEX с арендой',money(a.currentOpex))}</div>
  <table class="tbl"><tr><th>Аналитика</th><th>Значение</th></tr>${tr('Доля площади, занятой стеллажами',fmt1(a.rackUsedArea/a.area*100)+'%')}
    ${tr('Неиспользуемая доступная площадь',fmt1(a.unusedRackableArea)+' м²')}${tr('Доля процессных зон',fmt1(a.processArea/a.area*100)+'%')}${tr('Доля staff/service',fmt1(a.supportArea/a.area*100)+'%')}${tr('Секций на 1 м²',fmt1(a.rp.total/a.area))}
    ${tr('Алгоритм размещения стеллажей','автозаполнение всей свободной рабочей площади')}${tr('SKU на 1 м²',fmt1(a.cap/a.area))}${tr('Сборка',route+' · площадь 1 этажа не занимает')}${tr('Макс. сквозной поток',fmt(pm.maxMonthly)+' ШК/мес')}${tr('Запас мощности до таргета',fmt(pm.maxMonthly-state.targetFlow)+' ШК/мес')}${tr('CAPEX',money(state.capex||2921881))}${tr('Аренда',money(state.rent||300000))}</table>`;

  const warns=[],central=getZone('Центральный проход');
  if(central&&central.h<1.2)warns.push(['bad','Центральный проход меньше 1,2 м.']);
  if(state.aisle<1)warns.push(['bad','Проход между стеллажными рядами меньше 1 м.']);
  if(a.cams.uncovered.length)warns.push(['bad',`Есть ${a.cams.uncovered.length} контрольных точек без покрытия камер.`]);else warns.push(['good','Мёртвых зон по модели камер нет.']);
  if(pm.util>1)warns.push(['bad',`Целевой поток ${fmt(state.targetFlow)} ШК/мес выше мощности текущей команды.`]);
  if(central){const rc=rackCandidateArea();if(!rectsOverlap(rc,central))warns.push(['bad','Центральный проход находится вне рабочей складской площади.']);}
  if(central){
    const rc=rackCandidateArea();
    if(centralIsVertical()){
      const centerDelta=Math.abs((central.x+central.w/2)-(rc.x+rc.w/2));
      if(centerDelta>rc.w*.18) warns.push(['info','Центральный проход смещён от центра рабочей площади. Проверь логистику маршрутов.']);
    }else{
      const centerDelta=Math.abs((central.y+central.h/2)-(rc.y+rc.h/2));
      if(centerDelta>rc.h*.18) warns.push(['info','Центральный проход смещён от центра рабочей площади. Проверь логистику маршрутов.']);
    }
  }

  const rackArea=rackCandidateArea();
  state.objects
    .filter(o=>o.affectsCapacity && rectsOverlap(rackArea,o))
    .forEach(o=>warns.push(['info',`${o.name} занимает часть потенциальной площади под стеллажи.`]));
  warns.push(['info','Добавленные объекты можно двигать, менять по размеру, поворачивать, копировать и удалять.']);
  try{
    $('tab-checks').innerHTML=warns.map(([c,t])=>`<div class="warnbox ${c}">${t}</div>`).join('');
  }catch(e){
    console.error('Checks render error',e);
    $('tab-checks').innerHTML='<div class="warnbox bad">Не удалось отрисовать блок проверок. Остальные расчёты продолжают работать.</div>';
  }
}

function renderAll(full=true){save();if(full){renderColumns();renderSelected()}draw();renderEmu();renderTabs()}


function getSelectedObject(){
  if(!selected || !selected.kind) return null;
  if(selected.kind==='zone') return state.zones[selected.index] || null;
  if(selected.kind==='column') return state.columns[selected.index] || null;
  if(selected.kind==='object') return state.objects[selected.index] || null;
  return null;
}

function rotateSelected(){
  const o=getSelectedObject();
  if(!o)return;

  if(o.name==='Центральный проход'){
    const candidate=rackCandidateArea();
    o.rotation=centralIsVertical()?0:90;

    if(o.rotation===90){
      o.w=clamp(state.centralAisle||1.6,1.2,2.6);
      o.h=candidate.h;
      o.x=candidate.x+candidate.w/2-o.w/2;
      o.y=candidate.y;
    }else{
      o.w=candidate.w;
      o.h=clamp(state.centralAisle||1.6,1.2,2.6);
      o.x=candidate.x;
      o.y=candidate.y+candidate.h/2-o.h/2;
    }

    normalizeSystemZones();
    renderAll();
    return;
  }

  const oldW=o.w;
  o.w=o.h;
  o.h=oldW;
  o.rotation=((o.rotation||0)+90)%360;
  o.x=clamp(o.x,0,Math.max(0,state.roomL-o.w));
  o.y=clamp(o.y,0,Math.max(0,state.roomW-o.h));
  renderAll();
}

function cloneSelected(){
  if(!selected || !selected.kind) return;
  let arr=null;
  if(selected.kind==='zone') arr=state.zones;
  else if(selected.kind==='column') arr=state.columns;
  else if(selected.kind==='object') arr=state.objects;
  if(!arr) return;

  const src=arr[selected.index];
  if(!src) return;
  const copy=structuredClone(src);
  copy.x=clamp((copy.x||0)+0.5,0,Math.max(0,state.roomL-copy.w));
  copy.y=clamp((copy.y||0)+0.5,0,Math.max(0,state.roomW-copy.h));

  // Базовые системные зоны не клонируем с тем же уникальным именем.
  if(selected.kind==='zone' && ['Хранение','Центральный проход','Приёмка','Сборка','Отгрузка'].includes(copy.name)){
    copy.name=copy.name+' копия';
  }

  arr.push(copy);
  selected={kind:selected.kind,index:arr.length-1};
  renderAll();
}

function deleteSelected(){
  if(!selected || !selected.kind) return;
  let arr=null;
  if(selected.kind==='zone') arr=state.zones;
  else if(selected.kind==='column') arr=state.columns;
  else if(selected.kind==='object') arr=state.objects;
  if(!arr) return;

  if(selected.kind==='zone'){
    const z=arr[selected.index];
    // Legacy "Хранение" скрыто и не используется.
    // Центральный проход теперь опционален: его можно удалить.
    if(z && z.name==='Хранение'){
      alert('Системная зона совместимости "Хранение" не используется в расчете.');
      return;
    }
  }

  arr.splice(selected.index,1);
  selected={kind:null,index:null};
  renderAll();
}



function addTemplate(template){
  const b=rackCandidateArea();
  const x=clamp(b.x+b.w*.45,0,Math.max(0,state.roomL-2));
  const y=clamp(b.y+b.h*.45,0,Math.max(0,state.roomW-2));
  const catalog={
    courier:{name:'Зона курьеров',type:'process',zoneRole:'optional',w:2.5,h:2,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:true},
    returns:{name:'Возвраты',type:'process',zoneRole:'process',w:2.5,h:2,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:true},
    buffer_in:{name:'Буфер приемки',type:'process',zoneRole:'process',w:2.5,h:1.6,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:true},
    buffer_out:{name:'Буфер отгрузки',type:'process',zoneRole:'process',w:2.5,h:1.6,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:true},
    packing:{name:'Упаковка',type:'process',zoneRole:'process',w:2.4,h:1.8,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:true},
    quality:{name:'Контроль качества',type:'process',zoneRole:'process',w:2.2,h:1.8,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:true},
    pallet:{name:'Паллетная зона',type:'storage',zoneRole:'optional',w:2.4,h:2.4,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:true},
    charging:{name:'Зарядка ТСД',type:'equipment',zoneRole:'service',w:1.4,h:1,affectsCapacity:true,blocksStorage:true,affectsFlow:false,needsCamera:false},
    table:{name:'Стол',type:'equipment',zoneRole:'optional',w:1.4,h:.8,affectsCapacity:true,blocksStorage:true,affectsFlow:false,needsCamera:false},
    camera:{name:'Ручная камера',type:'equipment',zoneRole:'optional',w:.35,h:.35,affectsCapacity:false,blocksStorage:false,affectsFlow:false,needsCamera:false,objectKind:'camera'},
    door:{name:'Дверь',type:'service',zoneRole:'hard',w:1.2,h:.25,affectsCapacity:true,blocksStorage:true,affectsFlow:false,needsCamera:false,objectKind:'door'},
    custom:{name:'Своя зона',type:'custom',zoneRole:'optional',w:2,h:2,affectsCapacity:true,blocksStorage:true,affectsFlow:false,needsCamera:false}
  };
  const base=catalog[template]||catalog.custom;
  const o={...base,x,y,rotation:0};
  o.x=clamp(o.x,0,Math.max(0,state.roomL-o.w));
  o.y=clamp(o.y,0,Math.max(0,state.roomW-o.h));
  state.objects.push(o);
  selected={kind:'object',index:state.objects.length-1};
  renderAll();
}

const PROJECTS_KEY='mfcPlannerProjectsV743';
const CURRENT_PROJECT_KEY='mfcPlannerCurrentProjectV743';
let currentProjectId=localStorage.getItem(CURRENT_PROJECT_KEY)||'';

function escapeHtml(s){return String(s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));}
function readProjects(){
  try{
    const p=JSON.parse(localStorage.getItem(PROJECTS_KEY)||'[]');
    return Array.isArray(p)?p:[];
  }catch(e){return []}
}
function writeProjects(projects){localStorage.setItem(PROJECTS_KEY,JSON.stringify(projects));}
function projectSnapshot(){
  return JSON.parse(JSON.stringify(state));
}
function projectNameById(id){
  const p=readProjects().find(x=>x.id===id);
  return p?p.name:'Черновик';
}
function renderProjectSelector(){
  const sel=$('projectSelect');
  if(!sel)return;
  const projects=readProjects().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  sel.innerHTML='<option value="">Мои планы ('+projects.length+')</option>'+projects.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  if(currentProjectId&&projects.some(p=>p.id===currentProjectId))sel.value=currentProjectId;
  if($('currentProjectName'))$('currentProjectName').textContent=projectNameById(currentProjectId);
}
function saveNamedProject(forceNew=false){
  const projects=readProjects();
  const current=projects.find(p=>p.id===currentProjectId);
  const suggested=current&&!forceNew?current.name:`MFC ${fmt1(state.roomL*state.roomW)} м²`;
  const name=prompt(forceNew?'Название копии плана:':'Название плана:',suggested);
  if(!name||!name.trim())return;
  const clean=name.trim();
  const now=Date.now();
  let project;
  if(current&&!forceNew){
    current.name=clean; current.state=projectSnapshot(); current.updatedAt=now; project=current;
  }else{
    project={id:'p_'+now+'_'+Math.random().toString(36).slice(2,7),name:clean,state:projectSnapshot(),createdAt:now,updatedAt:now};
    projects.push(project);
    currentProjectId=project.id;
  }
  writeProjects(projects);
  localStorage.setItem(CURRENT_PROJECT_KEY,currentProjectId);
  renderProjectSelector();
  if($('projectSaveStatus'))$('projectSaveStatus').textContent='Сохранено: '+new Date(now).toLocaleString('ru-RU');
}
function openProject(id){
  if(!id)return;
  const p=readProjects().find(x=>x.id===id);
  if(!p||!p.state)return;
  state=Object.assign(structuredClone(defaults),JSON.parse(JSON.stringify(p.state)));
  sanitizeState(); migrateSmartZones(); migrateV69();
  currentProjectId=id;
  localStorage.setItem(CURRENT_PROJECT_KEY,id);
  inputIds.forEach(k=>{if($(k))$(k).value=state[k]});
  if($('layoutMode'))$('layoutMode').value=state.layoutMode;
  selected={kind:null,index:null};
  save(); renderProjectSelector(); renderAll();
}
function deleteCurrentProject(){
  if(!currentProjectId)return alert('Сначала выбери сохранённый план.');
  const projects=readProjects();
  const p=projects.find(x=>x.id===currentProjectId);
  if(!p)return;
  if(!confirm(`Удалить план «${p.name}»?`))return;
  writeProjects(projects.filter(x=>x.id!==currentProjectId));
  currentProjectId=''; localStorage.removeItem(CURRENT_PROJECT_KEY);
  renderProjectSelector();
}
function autosaveCurrentProject(){
  if(!currentProjectId)return;
  const projects=readProjects();
  const p=projects.find(x=>x.id===currentProjectId);
  if(!p)return;
  p.state=projectSnapshot(); p.updatedAt=Date.now(); writeProjects(projects);
  if($('projectSaveStatus'))$('projectSaveStatus').textContent='Автосохранение: '+new Date(p.updatedAt).toLocaleTimeString('ru-RU');
}

const inputIds=['roomL','roomW','roomH','avgSkuL','targetFlow','simFlow','centralAisle','rackL','rackD','rackH','shelves','aisle','fillPct','normAccept','normPutaway','normPick','normShip','opsPerShift','shiftsPerDay','paidHours','opRate','seniors','seniorSalary','managers','managerSalary','cameraRange','coverageStep'];
inputIds.forEach(id=>{const el=$(id);el.value=state[id];el.oninput=()=>{state[id]=parseFloat(el.value)||0;if(id==='centralAisle'){
  state.centralAisle=clamp(state.centralAisle,1.2,2.6);
  const c=getZone('Центральный проход');
  if(c){
    if(centralIsVertical()) c.w=state.centralAisle;
    else c.h=state.centralAisle;
  }
}renderAll()}});
$('layoutMode').value=state.layoutMode;$('layoutMode').onchange=()=>{state.layoutMode=$('layoutMode').value;renderAll()};
$('optBtn').onclick=optimize;
$('optSideBtn').onclick=optimize;
$('centerAisleBtn').onclick=()=>{
  let c=getZone('Центральный проход');
  if(!c){
    const b=rackCandidateArea();
    c={
      name:'Центральный проход',type:'service',
      x:b.x+b.w/2-state.centralAisle/2,y:b.y,
      w:state.centralAisle,h:b.h,
      rotation:90,
      affectsCapacity:true,affectsFlow:true,needsCamera:false
    };
    state.zones.push(c);
  }
  centerCentralAisle();
  renderAll();
};
$('addColumnBtn').onclick=()=>{state.columns.push({x:6,y:3,w:.6,h:.6,rotation:0});selected={kind:'column',index:state.columns.length-1};renderAll()};
document.querySelectorAll('.objbtn').forEach(b=>b.onclick=()=>addTemplate(b.dataset.template));
$('rotateBtn').onclick=()=>rotateSelected();$('cloneBtn').onclick=()=>cloneSelected();$('deleteBtn').onclick=()=>deleteSelected();
$('saveBtn').onclick=()=>saveNamedProject(false);
$('duplicateProjectBtn').onclick=()=>saveNamedProject(true);
$('deleteProjectBtn').onclick=deleteCurrentProject;
$('projectSelect').onchange=()=>{if($('projectSelect').value)openProject($('projectSelect').value)};
$('resetBtn').onclick=()=>{if(confirm('Сбросить текущий план? Сохранённые планы останутся.')){state=structuredClone(defaults);initZones();selected={kind:null};currentProjectId='';localStorage.removeItem(CURRENT_PROJECT_KEY);inputIds.forEach(id=>$(id).value=state[id]);renderProjectSelector();renderAll()}};
$('exportBtn').onclick=()=>{const b=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='mfc-planner-v7.4.3.json';a.click();URL.revokeObjectURL(a.href)};
$('importInput').onchange=async e=>{try{state=Object.assign(structuredClone(defaults),JSON.parse(await e.target.files[0].text()));selected={kind:null};inputIds.forEach(id=>$(id).value=state[id]);$('layoutMode').value=state.layoutMode;renderAll()}catch{alert('Не удалось загрузить проект')}}; 
document.querySelectorAll('.tool[data-mode]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tool[data-mode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');mode=b.dataset.mode;draw()});
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tabcontent').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('tab-'+b.dataset.tab).classList.add('active')});

renderProjectSelector();
if(currentProjectId){ const pp=readProjects().find(x=>x.id===currentProjectId); if(pp&&pp.state) openProject(currentProjectId); }
setInterval(autosaveCurrentProject,15000);
renderAll();
