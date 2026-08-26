
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
  activeLevel:'ground',mezzanineL:20,mezzanineW:10,floor2Enabled:false,floor2Mode:'process',floor2MigrationDone:false,mfGoal:'balanced',
  centralAisle:1.6,rackL:1.2,rackD:0.5,rackH:2.5,shelves:5,aisle:1.2,fillPct:95,
  sideWallGapEnabled:true,sideWallGap:0.15,
  normAccept:2750,normPutaway:2750,normPick:1500,normShip:3500,
  opsPerShift:3,shiftsPerDay:2,paidHours:11,opRate:400,seniors:2,seniorSalary:90000,managers:1,managerSalary:130000,
  turnoverMode:'working',turnoverRate:2.65,staffingTargetUtil:85,scaleBaselineCapacity:0,scaleBaselineArea:0,
  cameraRange:3.4,coverageStep:0.8,zones:[],columns:[],objects:[],avgFlow:100000,maxFlow:120000,fixedPC:2,fixedTsd:3,fixedTablet:2,rent:300000,capex:2921881
};

let state=JSON.parse(localStorage.getItem('mfcPlannerDraftV81')||'null');
if(!state){
  const previousKeys=['mfcPlannerV78','mfcPlannerV77','mfcPlannerV76','mfcPlannerV744','mfcPlannerV743','mfcPlannerV742','mfcPlannerV69','mfcPlannerV68','mfcPlannerV67','mfcPlannerV66','mfcPlannerV65','mfcPlannerV64','mfcPlannerV63','mfcPlannerV62','mfcPlannerV61','mfcPlannerV5'];
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
    'roomL','roomW','roomH','mezzanineL','mezzanineW','avgSkuL','targetFlow','simFlow','centralAisle',
    'rackL','rackD','rackH','shelves','aisle','fillPct','sideWallGap',
    'normAccept','normPutaway','normPick','normShip',
    'opsPerShift','shiftsPerDay','paidHours','opRate',
    'seniors','seniorSalary','managers','managerSalary',
    'turnoverRate','staffingTargetUtil','scaleBaselineCapacity','scaleBaselineArea',
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
  state.sideWallGapEnabled=state.sideWallGapEnabled!==false;
  state.sideWallGap=Math.max(0,Number(state.sideWallGap)||0);
  if(!state.layoutMode) state.layoutMode=defaults.layoutMode;
  if(!['one','working','high','custom'].includes(state.turnoverMode)) state.turnoverMode='working';
  state.turnoverRate=Math.max(.1,Number(state.turnoverRate)||2.65);
  state.staffingTargetUtil=clamp(Number(state.staffingTargetUtil)||85,50,100);
  if(!['ground','mezzanine'].includes(state.activeLevel)) state.activeLevel='ground';
  // 8.4.1: второй этаж никогда не создаётся автоматически.
  // Если в старых данных остались объекты уровня mezzanine, они сами по себе
  // НЕ включают Этаж 2. Этаж появляется только после явного нажатия пользователя.
  if(state.floor2MigrationDone!==true){
    if(typeof state.floor2Enabled!=='boolean') state.floor2Enabled=false;
    state.floor2MigrationDone=true;
  }
  state.floor2Enabled=state.floor2Enabled===true;
  if(!['process','storage','mixed'].includes(state.floor2Mode))state.floor2Mode='process';
  if(!['capacity','balanced','staff'].includes(state.mfGoal))state.mfGoal='balanced';
  if(!state.floor2Enabled&&state.activeLevel==='mezzanine')state.activeLevel='ground';
  // Скрытые legacy-объекты второго этажа сохраняем в JSON, но они не участвуют
  // в геометрии/аналитике, пока пользователь сам не добавит Этаж 2.
  state.mezzanineL=Math.max(2,Number(state.mezzanineL)||state.roomL||20);
  state.mezzanineW=Math.max(2,Number(state.mezzanineW)||state.roomW||10);
  if(!Array.isArray(state.zones)) state.zones=[];
  if(!Array.isArray(state.columns)) state.columns=[];
  if(!Array.isArray(state.objects)) state.objects=[];
}
sanitizeState();

function entityLevel(o){
  if(!o) return 'ground';
  return o.level||'ground';
}
function onLevel(o,level=state.activeLevel){
  const l=entityLevel(o);
  return l==='both'||l===level;
}
function levelDims(level=state.activeLevel){
  return level==='mezzanine'
    ? {L:Math.max(2,state.mezzanineL),W:Math.max(2,state.mezzanineW)}
    : {L:state.roomL,W:state.roomW};
}
function levelTitle(level=state.activeLevel){
  return level==='mezzanine'?'Этаж 2':'Этаж 1';
}
function entityBounds(o){
  return levelDims(entityLevel(o)==='both'?state.activeLevel:entityLevel(o));
}
function levelArea(level){
  const d=levelDims(level);
  return d.L*d.W;
}
function fixedEntityLevel(o){
  if(!o) return null;
  if(o.name==='Сборка') return 'mezzanine';
  if(['Хранение','Центральный проход','Приёмка','Отгрузка','Коридор персонала','Раздевалка','Офис','WC','Вход поставщиков','Вход/выход персонала','Эвакуационный выход'].includes(o.name)) return 'ground';
  if(o.objectKind==='vertical_link') return 'both';
  return null;
}

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
  // 7.7: каждому объекту назначается уровень.
  (state.zones||[]).forEach(z=>{
    z.level=fixedEntityLevel(z)||z.level||(z.name==='Сборка'?'mezzanine':'ground');
  });
  (state.objects||[]).forEach(o=>{
    o.level=fixedEntityLevel(o)||o.level||'ground';
  });
  (state.columns||[]).forEach(c=>{
    if(!c.level) c.level='ground';
  });

  const storage=(state.zones||[]).find(z=>z.name==='Хранение');
  if(storage) storage.level='ground';

  const picking=(state.zones||[]).find(z=>z.name==='Сборка');
  if(picking){
    picking.level='mezzanine';
    picking.type='process';
    picking.zoneRole='process';
    picking.affectsFlow=true;
    picking.blocksStorage=true;
  }else if((state.zones||[]).length){
    const L=Math.max(2,state.mezzanineL),W=Math.max(2,state.mezzanineW);
    state.zones.push({
      name:'Сборка',type:'process',zoneRole:'process',level:'mezzanine',
      x:.5,y:.5,w:Math.min(6,Math.max(2,L-1)),h:Math.min(3,Math.max(1.5,W-1)),
      rotation:0,affectsCapacity:false,blocksStorage:true,affectsFlow:true,needsCamera:true
    });
  }
}
migrateV69();

let selected={kind:null,index:null,name:null};
let mode='move', drag=null;

function save(){localStorage.setItem('mfcPlannerDraftV81',JSON.stringify(state));}
function rectsOverlap(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function pointInRect(p,r){return p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function getZone(n){return state.zones.find(z=>z.name===n)}
function area(r){return Math.max(0,r.w*r.h)}
function colAreaIn(r){return state.columns.reduce((s,c)=>{if(!onLevel(c,entityLevel(r)))return s;if(!rectsOverlap(r,c))return s;const x1=Math.max(r.x,c.x),x2=Math.min(r.x+r.w,c.x+c.w),y1=Math.max(r.y,c.y),y2=Math.min(r.y+r.h,c.y+c.h);return s+Math.max(0,x2-x1)*Math.max(0,y2-y1)},0)}
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
    {name:'Коридор персонала',type:'service',level:'ground',x:0,y:0,w:2.2,h:W,locked:false},
    {name:'Раздевалка',type:'staff',level:'ground',x:.2,y:1,w:1.8,h:2,locked:false},
    {name:'Офис',type:'staff',level:'ground',x:.2,y:3.3,w:1.8,h:2.4,locked:false},
    {name:'WC',type:'service',level:'ground',x:.2,y:6,w:1.8,h:1.3,locked:false},
    {name:'Хранение',type:'storage',level:'ground',x:2.4,y:.2,w:L-2.8,h:W-3.2,locked:false},
    {name:'Центральный проход',type:'service',level:'ground',x:2.4,y:(W-3.2)/2-state.centralAisle/2+.2,w:L-2.8,h:state.centralAisle,locked:false},
    {name:'Приёмка',type:'process',level:'ground',x:2.4,y:W-2.6,w:5,h:2.2,locked:false},
    {name:'Отгрузка',type:'process',level:'ground',x:13,y:W-2.6,w:4.2,h:2.2,locked:false},
    {name:'Вход поставщиков',type:'service',level:'ground',x:L/2-1.5,y:W-.6,w:3,h:.6,locked:false},
    {name:'Вход/выход персонала',type:'service',level:'ground',x:0,y:W/2-.8,w:.4,h:1.6,locked:false},
    {name:'Эвакуационный выход',type:'service',level:'ground',x:L-.4,y:W/2-.8,w:.4,h:1.6,locked:false},
    {name:'Сборка',type:'process',zoneRole:'process',level:'mezzanine',
      x:.5,y:.5,w:Math.min(6,Math.max(2,state.mezzanineL-1)),h:Math.min(3,Math.max(1.5,state.mezzanineW-1)),
      rotation:0,affectsCapacity:false,blocksStorage:true,affectsFlow:true,needsCamera:true}
  ];
}

if(!state.zones.length)initZones();
migrateSmartZones();
migrateV69();


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
    name:'Хранение',type:'storage',level:'ground',
    x:left+0.2,y:0.2,w:mainW,h:Math.max(2.4,processY-0.4),
    rotation:0,affectsCapacity:true,affectsFlow:false,needsCamera:true
  };

  // На 1 этаже размещаем приёмку и отгрузку. Средний промежуток остаётся доступным хранению; сборка находится на этаже.
  let acceptRatio=0.30,pickRatio=0.42,shipRatio=0.28;
  if(state.layoutMode==='capacity'){acceptRatio=0.29;pickRatio=0.39;shipRatio=0.32;}
  if(state.layoutMode==='flow'){acceptRatio=0.31;pickRatio=0.45;shipRatio=0.24;}
  const aw=mainW*acceptRatio;
  const pw=mainW*pickRatio;
  const sw=mainW-aw-pw;

  state.zones=[
    {name:'Коридор персонала',type:'service',level:'ground',x:0,y:0,w:left,h:W,rotation:0,affectsCapacity:false,affectsFlow:false,needsCamera:true},
    {name:'Раздевалка',type:'staff',level:'ground',x:0.2,y:0.8,w:left-0.4,h:1.9,rotation:0,affectsCapacity:false,affectsFlow:false,needsCamera:false},
    {name:'Офис',type:'staff',level:'ground',x:0.2,y:3.0,w:left-0.4,h:2.2,rotation:0,affectsCapacity:false,affectsFlow:false,needsCamera:true},
    {name:'WC',type:'service',level:'ground',x:0.2,y:5.5,w:left-0.4,h:1.2,rotation:0,affectsCapacity:false,affectsFlow:false,needsCamera:false},
    storage,
    {name:'Центральный проход',type:'service',level:'ground',
      x:storage.x,y:storage.y+storage.h/2-state.centralAisle/2,
      w:storage.w,h:state.centralAisle,rotation:0,
      affectsCapacity:true,affectsFlow:true,needsCamera:false},
    {name:'Приёмка',type:'process',level:'ground',x:storage.x,y:processY,w:aw,h:procDepth,rotation:0,affectsCapacity:true,affectsFlow:true,needsCamera:true},
    {name:'Отгрузка',type:'process',level:'ground',x:storage.x+aw+pw,y:processY,w:sw,h:procDepth,rotation:0,affectsCapacity:true,affectsFlow:true,needsCamera:true},
    {name:'Вход поставщиков',type:'service',level:'ground',x:L/2-1.2,y:W-0.45,w:2.4,h:0.45,rotation:0,affectsCapacity:false,affectsFlow:true,needsCamera:true},
    {name:'Вход/выход персонала',type:'service',level:'ground',x:0,y:W/2-0.7,w:0.35,h:1.4,rotation:0,affectsCapacity:false,affectsFlow:false,needsCamera:true},
    {name:'Эвакуационный выход',type:'service',level:'ground',x:L-0.35,y:W/2-0.7,w:0.35,h:1.4,rotation:0,affectsCapacity:false,affectsFlow:false,needsCamera:true},
    {name:'Сборка',type:'process',level:'mezzanine',zoneRole:'process',
      x:.5,y:.5,w:Math.min(6,Math.max(2,state.mezzanineL-1)),h:Math.min(3,Math.max(1.5,state.mezzanineW-1)),
      rotation:0,affectsCapacity:false,blocksStorage:true,affectsFlow:true,needsCamera:true}
  ];

  migrateSmartZones();
  migrateV69();
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

  // Стеллажи и вместимость в 7.7 рассчитываются только для 1 этажа.
  state.zones.forEach(z=>{
    if(!onLevel(z,'ground')) return;
    if(z.name==='Хранение') return;
    if(z.blocksStorage===false || z.affectsCapacity===false) return;
    blockers.push({x:z.x,y:z.y,w:z.w,h:z.h,name:z.name,kind:'zone',level:'ground'});
  });

  state.columns.forEach((c,i)=>{
    if(!onLevel(c,'ground')) return;
    blockers.push({x:c.x,y:c.y,w:c.w,h:c.h,name:'Колонна '+(i+1),kind:'column',level:'ground'});
  });

  state.objects.forEach((o,i)=>{
    if(!onLevel(o,'ground')) return;
    if(o.blocksStorage===false || o.affectsCapacity===false) return;
    blockers.push({
      x:o.x,y:o.y,w:o.w,h:o.h,
      name:o.name||('Объект '+(i+1)),
      kind:'object',level:'ground'
    });
  });

  return blockers;
}
function rackCandidateArea(){
  // Боковые интервалы (левая/правая стены) теперь управляются пользователем.
  // Верх/низ сохраняют небольшой технический край модели 0.15 м.
  const sideGap=state.sideWallGapEnabled?Math.max(0,Number(state.sideWallGap)||0):0;
  const endGap=.15;
  return {
    x:sideGap,
    y:endGap,
    w:Math.max(.5,state.roomL-sideGap*2),
    h:Math.max(.5,state.roomW-endGap*2)
  };
}
function rackCellAllowed(rect, blockers){
  // Не выходим из помещения.
  if(rect.x<0 || rect.y<0 || rect.x+rect.w>state.roomL || rect.y+rect.h>state.roomW) return false;

  // Не пересекаем блокирующие зоны.
  if(blockers.some(b=>rectsOverlap(rect,b))) return false;

  return true;
}


function rackAccessBlockers(){
  const hard=[];

  const zoneWalkable=z=>{
    if(!z) return false;
    if(z.type==='process') return true;
    if(['Центральный проход','Коридор персонала','Приёмка','Отгрузка','Вход поставщиков','Вход/выход персонала','Эвакуационный выход'].includes(z.name)) return true;
    return /коридор|проход|вход|выход/i.test(String(z.name||''));
  };

  (state.zones||[]).forEach(z=>{
    if(!onLevel(z,'ground') || z.name==='Хранение') return;
    if(zoneWalkable(z)) return;
    hard.push({x:z.x,y:z.y,w:z.w,h:z.h,name:z.name,kind:'zone'});
  });

  (state.columns||[]).forEach((c,i)=>{
    if(!onLevel(c,'ground')) return;
    hard.push({x:c.x,y:c.y,w:c.w,h:c.h,name:'Колонна '+(i+1),kind:'column'});
  });

  (state.objects||[]).forEach((o,i)=>{
    if(!onLevel(o,'ground')) return;
    if(o.objectKind==='door' || o.name==='Дверь' || o.objectKind==='camera' || o.name==='Ручная камера') return;
    if(o.type==='process') return;
    if(o.blocksStorage===false && o.type!=='equipment') return;
    hard.push({x:o.x,y:o.y,w:o.w,h:o.h,name:o.name||('Объект '+(i+1)),kind:'object'});
  });

  return hard;
}

function rectInsideRoom(r){
  return r.x>=-1e-9 && r.y>=-1e-9 &&
    r.x+r.w<=state.roomL+1e-9 &&
    r.y+r.h<=state.roomW+1e-9;
}

function splitRackPairGroups(pairs,orientation,rackLength){
  if(!pairs.length) return [];
  const axis=orientation==='horizontal'?'x':'y';
  const sorted=[...pairs].sort((a,b)=>a[axis]-b[axis]);
  const groups=[];
  let current=[sorted[0]];

  for(let i=1;i<sorted.length;i++){
    const delta=sorted[i][axis]-sorted[i-1][axis];
    if(delta<=rackLength*1.08){
      current.push(sorted[i]);
    }else{
      groups.push(current);
      current=[sorted[i]];
    }
  }
  groups.push(current);
  return groups;
}

function aisleRectForGroup(group,orientation,street,rackLength,rackDepth,aisle){
  const first=group[0];
  const last=group[group.length-1];

  if(orientation==='horizontal'){
    return {
      x:first.x,
      y:street.y+rackDepth,
      w:(last.x+rackLength)-first.x,
      h:aisle
    };
  }
  return {
    x:street.x+rackDepth,
    y:first.y,
    w:aisle,
    h:(last.y+rackLength)-first.y
  };
}

function aisleEndProbe(aisleRect,orientation,side,aisle){
  // Чтобы считать конец рабочим, нужен свободный участок не уже самого прохода.
  const depth=Math.max(.4,aisle);

  if(orientation==='horizontal'){
    return side==='start'
      ? {x:aisleRect.x-depth,y:aisleRect.y,w:depth,h:aisleRect.h}
      : {x:aisleRect.x+aisleRect.w,y:aisleRect.y,w:depth,h:aisleRect.h};
  }

  return side==='start'
    ? {x:aisleRect.x,y:aisleRect.y-depth,w:aisleRect.w,h:depth}
    : {x:aisleRect.x,y:aisleRect.y+aisleRect.h,w:aisleRect.w,h:depth};
}

function aisleEndAccessible(aisleRect,orientation,side,aisle,hardAccessBlockers){
  const probe=aisleEndProbe(aisleRect,orientation,side,aisle);

  // Стена сама по себе не считается входом в улицу.
  if(!rectInsideRoom(probe)) return false;

  // ЦП, приемка, отгрузка и другие рабочие проходные зоны сюда не входят:
  // они исключены из hardAccessBlockers и поэтому могут служить входом.
  if(hardAccessBlockers.some(b=>rectsOverlap(probe,b))) return false;

  return true;
}

function racksForAccessibleGroup(group,orientation,street,rackLength,rackDepth,aisle,streetIndex){
  const out=[];

  group.forEach(p=>{
    if(orientation==='horizontal'){
      out.push(
        {x:p.x,y:street.y,w:rackLength,h:rackDepth,street:streetIndex,side:'A'},
        {x:p.x,y:street.y+rackDepth+aisle,w:rackLength,h:rackDepth,street:streetIndex,side:'B'}
      );
    }else{
      out.push(
        {x:street.x,y:p.y,w:rackDepth,h:rackLength,street:streetIndex,side:'A'},
        {x:street.x+rackDepth+aisle,y:p.y,w:rackDepth,h:rackLength,street:streetIndex,side:'B'}
      );
    }
  });

  return out;
}

function buildFreeRackPlan(orientation, offset=0){
  const bounds=rackCandidateArea();
  const blockers=rackBlockers();
  const hardAccessBlockers=rackAccessBlockers();

  const racks=[];
  const streets=[];
  const aisles=[];

  let rejectedSections=0;
  let deadEndAisles=0;

  const rackLength=Math.max(.2,state.rackL);
  const rackDepth=Math.max(.15,state.rackD);
  const aisle=Math.max(.4,state.aisle);

  // Повторяющийся модуль:
  // [стеллаж] [рабочий проход] [стеллаж]
  // Следующий модуль может начинаться сразу за вторым стеллажом:
  // соседние стеллажи тогда стоят back-to-back и обслуживаются с разных проходов.
  const streetWidth=rackDepth+aisle+rackDepth;

  const allowed=rect=>{
    if(rect.x<bounds.x-1e-9 || rect.y<bounds.y-1e-9 ||
       rect.x+rect.w>bounds.x+bounds.w+1e-9 ||
       rect.y+rect.h>bounds.y+bounds.h+1e-9) return false;
    return !blockers.some(b=>rectsOverlap(rect,b));
  };

  const candidateStreets=[];

  if(orientation==='horizontal'){
    for(let y=bounds.y+offset; y+streetWidth<=bounds.y+bounds.h+1e-9; y+=streetWidth){
      const street={orientation:'horizontal',x:bounds.x,y,w:bounds.w,h:streetWidth,sections:0,pairs:[]};

      for(let x=bounds.x; x+rackLength<=bounds.x+bounds.w+1e-9; x+=rackLength){
        const rackA={x,y,w:rackLength,h:rackDepth};
        const aisleCell={x,y:y+rackDepth,w:rackLength,h:aisle};
        const rackB={x,y:y+rackDepth+aisle,w:rackLength,h:rackDepth};

        if(allowed(rackA) && allowed(aisleCell) && allowed(rackB)){
          street.pairs.push({x,y});
        }
      }

      if(street.pairs.length) candidateStreets.push(street);
    }
  }else{
    for(let x=bounds.x+offset; x+streetWidth<=bounds.x+bounds.w+1e-9; x+=streetWidth){
      const street={orientation:'vertical',x,y:bounds.y,w:streetWidth,h:bounds.h,sections:0,pairs:[]};

      for(let y=bounds.y; y+rackLength<=bounds.y+bounds.h+1e-9; y+=rackLength){
        const rackA={x,y,w:rackDepth,h:rackLength};
        const aisleCell={x:x+rackDepth,y,w:aisle,h:rackLength};
        const rackB={x:x+rackDepth+aisle,y,w:rackDepth,h:rackLength};

        if(allowed(rackA) && allowed(aisleCell) && allowed(rackB)){
          street.pairs.push({x,y});
        }
      }

      if(street.pairs.length) candidateStreets.push(street);
    }
  }

  candidateStreets.forEach((street,streetIndex)=>{
    const groups=splitRackPairGroups(street.pairs,orientation,rackLength);
    const keptPairs=[];

    groups.forEach(group=>{
      const aisleRect=aisleRectForGroup(group,orientation,street,rackLength,rackDepth,aisle);
      const accessStart=aisleEndAccessible(aisleRect,orientation,'start',aisle,hardAccessBlockers);
      const accessEnd=aisleEndAccessible(aisleRect,orientation,'end',aisle,hardAccessBlockers);

      // Ключевое правило 8.2:
      // если сотрудник не может войти в рабочий проход ни с одного конца,
      // обе стороны этого участка стеллажей НЕ размещаем и НЕ считаем в ШК.
      if(!accessStart && !accessEnd){
        rejectedSections+=group.length*2;
        return;
      }

      if(accessStart !== accessEnd) deadEndAisles++;

      const groupRacks=racksForAccessibleGroup(
        group,orientation,street,rackLength,rackDepth,aisle,streetIndex
      );
      racks.push(...groupRacks);
      keptPairs.push(...group);

      aisles.push({
        ...aisleRect,
        orientation,
        street:streetIndex,
        accessStart,
        accessEnd,
        deadEnd:accessStart !== accessEnd,
        sections:group.length*2
      });
    });

    if(keptPairs.length){
      streets.push({
        ...street,
        pairs:keptPairs,
        sections:keptPairs.length*2
      });
    }
  });

  return {
    orientation,
    total:racks.length,
    accessibleSections:racks.length,
    rejectedSections,
    racks,
    aisles,
    streets,
    streetCount:streets.length,
    aisleCount:aisles.length,
    deadEndAisles,
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
    accessibleSections:0,
    rejectedSections:0,
    racks:[],
    aisles:[],
    streets:[],
    streetCount:0,
    aisleCount:0,
    deadEndAisles:0,
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
      if(!state.columns.some(c=>onLevel(c,'ground')&&pointInRect(p,c))) samples.push(p);
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
      if(!state.columns.some(c=>onLevel(c,'ground')&&pointInRect(p,c))) candidates.push(p);
    });
  });

  const visible=(cam,p)=>{
    if(Math.hypot(cam.x-p.x,cam.y-p.y)>range) return false;
    if(state.columns.some(c=>onLevel(c,'ground')&&lineHitsRect(cam,p,c))) return false;
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


// ============================================================
// MFC Planner 7.8 — Capacity & Staffing Scaling
// Связка: вместимость → оборот → поток → операторы → ФОТ/OPEX.
// ============================================================

function turnoverRateValue(){
  if(state.turnoverMode==='one') return 1;
  if(state.turnoverMode==='high') return 3.18;
  if(state.turnoverMode==='custom') return Math.max(.1,Number(state.turnoverRate)||1);
  return 2.65;
}

function processLaborCoefficient(){
  const norms=[state.normAccept,state.normPutaway,state.normPick,state.normShip];
  return norms.reduce((s,n)=>s+1/Math.max(1,Number(n)||1),0);
}

function maxThroughputForOperators(opsPerShift){
  const labor=processLaborCoefficient();
  if(!labor) return 0;
  return Math.max(0,Number(opsPerShift)||0)*Math.max(1,state.shiftsPerDay)/labor*30;
}

function operatorMonthlyCostPerPosition(){
  return Math.max(0,state.paidHours)*30*Math.max(0,state.opRate);
}

function ensureScalingBaseline(capacity,areaValue){
  if(!(state.scaleBaselineCapacity>0) && capacity>0){
    state.scaleBaselineCapacity=capacity;
  }
  if(!(state.scaleBaselineArea>0) && areaValue>0){
    state.scaleBaselineArea=areaValue;
  }
}

function staffingScaleModel(capacity,groundArea){
  ensureScalingBaseline(capacity,groundArea);

  const turnover=turnoverRateValue();
  const plannedFlow=Math.max(0,capacity)*turnover;
  const targetUtil=clamp((Number(state.staffingTargetUtil)||85)/100,.5,1);
  const labor=processLaborCoefficient();

  const operatorShiftsPerDay=plannedFlow/30*labor;
  const minimumPerShift=Math.ceil(operatorShiftsPerDay/Math.max(1,state.shiftsPerDay));
  const recommendedPerShift=Math.ceil(
    (operatorShiftsPerDay/targetUtil)/Math.max(1,state.shiftsPerDay)
  );

  const currentPerShift=Math.max(0,Math.round(state.opsPerShift||0));
  const addPerShift=Math.max(0,recommendedPerShift-currentPerShift);
  const surplusPerShift=Math.max(0,currentPerShift-recommendedPerShift);

  const currentOperatorPositions=currentPerShift*Math.max(1,state.shiftsPerDay);
  const addedOperatorPositions=addPerShift*Math.max(1,state.shiftsPerDay);
  const recommendedOperatorPositions=recommendedPerShift*Math.max(1,state.shiftsPerDay);

  const currentHeadcount=currentOperatorPositions+state.seniors+state.managers;
  const recommendedHeadcount=recommendedOperatorPositions+state.seniors+state.managers;
  const afterAddPerShift=Math.max(currentPerShift,recommendedPerShift);
  const afterAddHeadcount=afterAddPerShift*Math.max(1,state.shiftsPerDay)+state.seniors+state.managers;

  const currentMax=maxThroughputForOperators(currentPerShift);
  const recommendedMax=maxThroughputForOperators(recommendedPerShift);
  const afterAddMax=maxThroughputForOperators(afterAddPerShift);
  const throughputIncrease=Math.max(0,afterAddMax-currentMax);
  const flowGap=Math.max(0,plannedFlow-currentMax);

  const monthlyPerOperator=operatorMonthlyCostPerPosition();
  const addFOT=addedOperatorPositions*monthlyPerOperator;
  const currentFOT=currentOperatorPositions*monthlyPerOperator
    +state.seniors*state.seniorSalary
    +state.managers*state.managerSalary;
  const afterAddFOT=currentFOT+addFOT;
  const currentOpex=currentFOT+state.rent;
  const afterAddOpex=afterAddFOT+state.rent;

  const baseCap=Math.max(0,state.scaleBaselineCapacity||capacity);
  const baseArea=Math.max(0,state.scaleBaselineArea||groundArea);
  const storageDelta=capacity-baseCap;
  const areaDelta=groundArea-baseArea;
  const storageDeltaPct=baseCap?storageDelta/baseCap*100:0;
  const areaDeltaPct=baseArea?areaDelta/baseArea*100:0;

  const capacityUse=plannedFlow>0?Math.min(100,currentMax/plannedFlow*100):100;
  const bottleneck=plannedFlow>currentMax?'personnel':'none';

  return {
    turnover,plannedFlow,targetUtil,labor,
    operatorShiftsPerDay,minimumPerShift,recommendedPerShift,currentPerShift,
    addPerShift,surplusPerShift,
    currentOperatorPositions,addedOperatorPositions,recommendedOperatorPositions,
    currentHeadcount,recommendedHeadcount,afterAddHeadcount,
    currentMax,recommendedMax,afterAddMax,throughputIncrease,flowGap,
    monthlyPerOperator,addFOT,currentFOT,afterAddFOT,currentOpex,afterAddOpex,
    baseCap,baseArea,storageDelta,areaDelta,storageDeltaPct,areaDeltaPct,
    capacityUse,bottleneck
  };
}

function setScalingBaseline(){
  const a=analytics();
  state.scaleBaselineCapacity=a.cap;
  state.scaleBaselineArea=a.groundArea;
  save();
  renderAll();
  if($('projectSaveStatus')){
    $('projectSaveStatus').textContent=`База зафиксирована: ${fmt(a.cap)} ШК · ${fmt1(a.groundArea)} м².`;
  }
}

function applyScalingFlow(){
  const a=analytics();
  state.targetFlow=Math.round(a.scaling.plannedFlow);
  state.simFlow=Math.round(a.scaling.plannedFlow);
  if($('targetFlow'))$('targetFlow').value=state.targetFlow;
  if($('simFlow'))$('simFlow').value=state.simFlow;
  renderAll();
}

function applyScalingStaff(){
  const a=analytics();
  const s=a.scaling;
  if(s.recommendedPerShift<=state.opsPerShift){
    if($('projectSaveStatus'))$('projectSaveStatus').textContent='Текущего количества операторов достаточно для выбранного сценария.';
    return;
  }
  state.opsPerShift=s.recommendedPerShift;
  if($('opsPerShift'))$('opsPerShift').value=state.opsPerShift;
  renderAll();
  if($('projectSaveStatus')){
    $('projectSaveStatus').textContent=`Применено: ${state.opsPerShift} операторов в смену. Старшие и руководитель не изменены.`;
  }
}

function syncScalingControls(){
  if($('turnoverMode'))$('turnoverMode').value=state.turnoverMode;
  if($('turnoverRate'))$('turnoverRate').value=state.turnoverRate;
  if($('staffingTargetUtil'))$('staffingTargetUtil').value=state.staffingTargetUtil;
  if($('customTurnoverWrap'))$('customTurnoverWrap').classList.toggle('hidden',state.turnoverMode!=='custom');
}

function renderScalingSidebar(scale){
  syncScalingControls();

  const box=$('scalingSidebarSummary');
  const badge=$('scalingStatusBadge');
  if(!box||!badge)return;

  const need=scale.addedOperatorPositions;
  const statusClass=need>0?'bad':scale.surplusPerShift>0?'warn':'good';
  badge.className=`scaling-badge ${statusClass}`;
  badge.textContent=need>0?'не хватает людей':scale.surplusPerShift>0?'есть запас':'состав подходит';

  box.innerHTML=`
    <div><span>Поток от хранения</span><b>${fmt(scale.plannedFlow)} ШК/мес</b></div>
    <div><span>Нужно / смену</span><b>${fmt(scale.recommendedPerShift)} оператора</b></div>
    <div><span>Добавить в штат</span><b>${need?`+${fmt(need)}`:'0'} операторов</b></div>
    <div><span>Прирост мощности</span><b>${scale.throughputIncrease?`+${fmt(scale.throughputIncrease)}`:'0'} ШК/мес</b></div>
  `;
}

function analytics(){
  const rp=rackPlan(),vol=rp.total*state.rackL*state.rackD*state.rackH,cap100=vol*1000/state.avgSkuL,cap=cap100*state.fillPct/100;
  const pm=processModel(state.targetFlow),cams=storageCameras();
  const userCams=state.objects.filter(o=>o.objectKind==='camera').length;
  const other=7+userCams;
  const currentFOT=state.opsPerShift*state.shiftsPerDay*state.paidHours*30*state.opRate + state.seniors*state.seniorSalary + state.managers*state.managerSalary;
  const autoFOT=pm.rec*state.shiftsPerDay*state.paidHours*30*state.opRate + state.seniors*state.seniorSalary + state.managers*state.managerSalary;

  const zonesByLevel=level=>(state.zones||[]).filter(z=>z.name!=='Хранение'&&onLevel(z,level));
  const objectsByLevel=level=>(state.objects||[]).filter(o=>onLevel(o,level));

  const gp=zonesByLevel('ground').filter(z=>z.type==='process').reduce((s,z)=>s+netArea(z),0)
    +objectsByLevel('ground').filter(o=>o.type==='process').reduce((s,o)=>s+area(o),0);
  const gs=zonesByLevel('ground').filter(z=>z.type!=='process'&&z.type!=='storage').reduce((s,z)=>s+netArea(z),0)
    +objectsByLevel('ground').filter(o=>o.type!=='process'&&o.type!=='storage').reduce((s,o)=>s+area(o),0);

  const mp=zonesByLevel('mezzanine').filter(z=>z.type==='process').reduce((s,z)=>s+netArea(z),0)
    +objectsByLevel('mezzanine').filter(o=>o.type==='process').reduce((s,o)=>s+area(o),0);
  const ms=zonesByLevel('mezzanine').filter(z=>z.type!=='process'&&z.type!=='storage').reduce((s,z)=>s+netArea(z),0)
    +objectsByLevel('mezzanine').filter(o=>o.type!=='process'&&o.type!=='storage').reduce((s,o)=>s+area(o),0);

  const groundArea=state.roomL*state.roomW;
  const mezzanineArea=state.mezzanineL*state.mezzanineW;
  const scaling=staffingScaleModel(cap,groundArea);

  return {
    rp,vol,cap100,cap,pm,scaling,cams,totalCams:cams.cams.length+other,
    area:groundArea,groundArea,mezzanineArea,totalOperationalArea:groundArea+mezzanineArea,
    storageArea:estimatedRackableArea(),
    processArea:gp,supportArea:gs,
    groundProcessArea:gp,groundSupportArea:gs,
    mezzanineProcessArea:mp,mezzanineSupportArea:ms,
    currentFOT,autoFOT,currentOpex:currentFOT+state.rent,autoOpex:autoFOT+state.rent,
    userCams,streetCount:rp.streetCount||0,rackFootprint:rp.rackArea||0,
    rackUsedArea:rackUsedArea(),unusedRackableArea:unusedRackableArea()
  };
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
    if(onLevel(state.objects[i])&&pointInRect(pt,state.objects[i])) return {kind:'object',index:i};
  }
  for(let i=(state.columns||[]).length-1;i>=0;i--){
    if(onLevel(state.columns[i])&&pointInRect(pt,state.columns[i])) return {kind:'column',index:i};
  }

  const candidates=(state.zones||[])
    .map((z,index)=>({z,index,a:area(z)}))
    .filter(x=>x.z.name!=='Хранение' && onLevel(x.z) && pointInRect(pt,x.z))
    .sort((a,b)=>a.a-b.a);

  return candidates.length ? {kind:'zone',index:candidates[0].index} : null;
}
function draw(){
  const svg=$('plan');
  svg.innerHTML='';

  const ns='http://www.w3.org/2000/svg';
  const W=940,H=520;
  const dims=levelDims();
  const sc=Math.min(W/dims.L,H/dims.W);
  const ox=(1000-dims.L*sc)/2;
  const oy=(590-dims.W*sc)/2;

  const add=(tag,attrs,parent=svg)=>{
    const e=document.createElementNS(ns,tag);
    for(const k in attrs)e.setAttribute(k,attrs[k]);
    parent.appendChild(e);
    return e;
  };

  add('rect',{x:ox,y:oy,width:dims.L*sc,height:dims.W*sc,class:state.activeLevel==='mezzanine'?'room mezzanineRoom':'room'});

  for(let i=1;i<dims.L;i++) add('line',{x1:ox+i*sc,y1:oy,x2:ox+i*sc,y2:oy+dims.W*sc,class:'grid'});
  for(let i=1;i<dims.W;i++) add('line',{x1:ox,y1:oy+i*sc,x2:ox+dims.L*sc,y2:oy+i*sc,class:'grid'});

  const a=analytics();

  if(state.activeLevel==='ground'){
    const actualRackPlan=a.rp;
    const candidateArea=rackCandidateArea();
    const blockers=rackBlockers();

    add('rect',{
      x:ox+candidateArea.x*sc,y:oy+candidateArea.y*sc,
      width:candidateArea.w*sc,height:candidateArea.h*sc,class:'rackableBg'
    });

    blockers.forEach(b=>{
      add('rect',{
        x:ox+b.x*sc,y:oy+b.y*sc,width:b.w*sc,height:b.h*sc,class:'blockerCut'
      });
    });

    // Рабочие проходы, через которые сотрудник реально обслуживает обе стороны улицы.
    (actualRackPlan.aisles||[]).forEach(a=>{
      add('rect',{
        x:ox+a.x*sc,
        y:oy+a.y*sc,
        width:Math.max(2,a.w*sc),
        height:Math.max(2,a.h*sc),
        class:a.deadEnd?'workingAisle deadEndAisle':'workingAisle'
      });
    });

    (actualRackPlan.racks||[]).forEach(r=>{
      add('rect',{
        x:ox+r.x*sc+1,y:oy+r.y*sc+1,
        width:Math.max(2,r.w*sc-2),height:Math.max(2,r.h*sc-2),class:'rack'
      });
    });

    (optimizerPreviewRacks||[]).forEach(r=>{
      add('rect',{
        x:ox+r.x*sc+2,y:oy+r.y*sc+2,
        width:Math.max(2,r.w*sc-4),height:Math.max(2,r.h*sc-4),class:'rackPreview'
      });
    });

    if($('showValidationOverlay')?.checked && validationIsCurrent()){
      (validationOverlayRects||[]).filter(v=>['ground','both'].includes(v.level||'ground')).forEach(v=>{
        add('rect',{
          x:ox+v.x*sc,y:oy+v.y*sc,width:Math.max(2,v.w*sc),height:Math.max(2,v.h*sc),
          class:v.severity==='bad'?'validationIssueBad':'validationIssueWarn'
        });
      });
    }
  }else{
    add('text',{x:ox+12,y:oy+22,class:'levelCanvasTitle'}).textContent='Этаж · процессный уровень';
    if($('showValidationOverlay')?.checked && validationIsCurrent()){
      (validationOverlayRects||[]).filter(v=>['mezzanine','both'].includes(v.level)).forEach(v=>{
        add('rect',{
          x:ox+v.x*sc,y:oy+v.y*sc,width:Math.max(2,v.w*sc),height:Math.max(2,v.h*sc),
          class:v.severity==='bad'?'validationIssueBad':'validationIssueWarn'
        });
      });
    }
  }

  state.zones.forEach((z,idx)=>{
    if(z.name==='Хранение') return;
    if(!onLevel(z)) return;

    const g=add('g',{'data-kind':'zone','data-index':idx,class:'obj'});
    add('rect',{
      x:ox+z.x*sc,y:oy+z.y*sc,width:z.w*sc,height:z.h*sc,rx:7,
      fill:colors[z.type],
      class:'zone'+(selected.kind==='zone'&&selected.index===idx?' selected':'')
    },g);
    add('text',{x:ox+z.x*sc+7,y:oy+z.y*sc+18,class:'label'},g).textContent=z.name;
    add('text',{x:ox+z.x*sc+7,y:oy+z.y*sc+33,class:'sub'},g).textContent=fmt1(netArea(z))+' м² · '+levelTitle(entityLevel(z)==='both'?state.activeLevel:entityLevel(z));
    if(mode==='resize'&&selected.kind==='zone'&&selected.index===idx){
      add('rect',{x:ox+(z.x+z.w)*sc-8,y:oy+(z.y+z.h)*sc-8,width:16,height:16,class:'handle'},g);
    }
  });

  state.objects.forEach((o,idx)=>{
    if(!onLevel(o)) return;
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
    if(!onLevel(c)) return;
    const g=add('g',{'data-kind':'column','data-index':idx,class:'obj'});
    add('rect',{
      x:ox+c.x*sc,y:oy+c.y*sc,width:c.w*sc,height:c.h*sc,rx:4,
      class:'column'+(selected.kind==='column'&&selected.index===idx?' selected':'')
    },g);
    if(mode==='resize'&&selected.kind==='column'&&selected.index===idx){
      add('rect',{x:ox+(c.x+c.w)*sc-8,y:oy+(c.y+c.h)*sc-8,width:16,height:16,class:'handle'},g);
    }
  });

  if(state.activeLevel==='ground'){
    a.cams.cams.forEach(p=>{
      add('circle',{cx:ox+p.x*sc,cy:oy+p.y*sc,r:4,class:'cam'});
      add('path',{d:`M ${ox+p.x*sc-10} ${oy+p.y*sc+8} Q ${ox+p.x*sc} ${oy+p.y*sc-6} ${ox+p.x*sc+10} ${oy+p.y*sc+8}`,class:'camarc'});
    });
    a.cams.uncovered.slice(0,150).forEach(p=>{
      add('circle',{cx:ox+p.x*sc,cy:oy+p.y*sc,r:2,class:'dead'});
    });
  }

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
    if(!target||!onLevel(target))return;

    const nearHandle=mode==='resize' &&
      Math.abs(pt.x-(target.x+target.w))<.35 &&
      Math.abs(pt.y-(target.y+target.h))<.35;

    drag={
      kind,index,startX:pt.x,startY:pt.y,
      orig:{...target},action:nearHandle?'resize':'move',ox,oy,sc
    };

    renderSelected();
    draw();
  };

  window.onmousemove=e=>{
    if(!drag)return;
    const svg=$('plan');
    const pt=clientToModel(e,svg,drag.ox,drag.oy,drag.sc);
    const target=drag.kind==='zone'?state.zones[drag.index]:drag.kind==='column'?state.columns[drag.index]:state.objects[drag.index];
    if(!target)return;
    const bd=levelDims(entityLevel(target)==='both'?state.activeLevel:entityLevel(target));

    if(drag.action==='move'){
      if(target.name==='Центральный проход'&&onLevel(target,'ground')){
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
        target.x=clamp(drag.orig.x+(pt.x-drag.startX),0,Math.max(0,bd.L-target.w));
        target.y=clamp(drag.orig.y+(pt.y-drag.startY),0,Math.max(0,bd.W-target.h));
      }
    }else{
      if(target.name==='Центральный проход'&&onLevel(target,'ground')){
        if(centralIsVertical()){
          target.w=clamp(drag.orig.w+(pt.x-drag.startX),1.2,2.6);
          state.centralAisle=target.w;
        }else{
          target.h=clamp(drag.orig.h+(pt.y-drag.startY),1.2,2.6);
          state.centralAisle=target.h;
        }
      }else{
        target.w=clamp(drag.orig.w+(pt.x-drag.startX),.3,Math.max(.3,bd.L-target.x));
        target.h=clamp(drag.orig.h+(pt.y-drag.startY),.3,Math.max(.3,bd.W-target.y));
      }
    }

    save();draw();renderTabs();renderSelected();
  };

  window.onmouseup=()=>{
    if(drag){drag=null;renderAll();}
  };

  if(state.activeLevel==='ground'){
    $('layoutSummary').textContent=`1 этаж · ${fmt1(a.groundArea)} м² · улиц ${a.rp.streetCount||0} · рабочих проходов ${a.rp.aisleCount||0} · доступных секций ${a.rp.total} · отсеяно недоступных ${a.rp.rejectedSections||0} · стеллажи ${fmt1(a.rp.rackArea||0)} м² · боковые отступы ${state.sideWallGapEnabled?fmt1(state.sideWallGap)+' м':'выкл'}`;
  }else{
    const zones=(state.zones||[]).filter(z=>z.name!=='Хранение'&&onLevel(z,'mezzanine'));
    const process=zones.filter(z=>z.type==='process').reduce((s,z)=>s+netArea(z),0)
      +(state.objects||[]).filter(o=>onLevel(o,'mezzanine')&&o.type==='process').reduce((s,o)=>s+area(o),0);
    $('layoutSummary').textContent=`Этаж · ${fmt1(a.mezzanineArea)} м² · процессные зоны ${fmt1(process)} м² · не уменьшает вместимость стеллажей 1 этажа`;
  }
}
function renderSelected(){
  const box=$('selectedEditor');
  if(!selected.kind){box.innerHTML='<div class="hint">Кликни по зоне, проходу, колонне или добавленному объекту.</div>';return}
  const arr=selectedArray(),obj=arr[selected.index];
  if(!obj){selected={kind:null,index:null};return renderSelected()}
  const lvl=entityLevel(obj);

  box.innerHTML=`<div class="selname">${selected.kind==='column'?'Колонна '+(selected.index+1):obj.name}</div>
  ${selected.kind!=='column'?`<label>Название<input id="selName" value="${obj.name}"></label>`:''}
  <label>Уровень
    <select id="selLevel">
      <option value="ground">1 этаж</option>
      <option value="mezzanine">Этаж</option>
      <option value="both">Оба уровня</option>
    </select>
  </label>
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
  </div><div class="hint">Уровень: ${lvl==='both'?'оба уровня':levelTitle(lvl)}. Объекты этажа не блокируют стеллажи 1 этажа.</div>`:''}`;

  if($('selLevel')){
    const fixed=fixedEntityLevel(obj);
    $('selLevel').value=fixed||lvl;
    $('selLevel').disabled=!!fixed;
    $('selLevel').onchange=()=>{
      if(fixed)return;
      obj.level=$('selLevel').value;
      const bd=levelDims(obj.level==='both'?state.activeLevel:obj.level);
      obj.x=clamp(obj.x,0,Math.max(0,bd.L-obj.w));
      obj.y=clamp(obj.y,0,Math.max(0,bd.W-obj.h));
      selected={kind:null,index:null};
      if(obj.level!=='both')state.activeLevel=obj.level;
      renderAll();
    };
  }
  if($('selName'))$('selName').oninput=()=>{obj.name=$('selName').value;renderAll()};
  ['sx','sy','sw','sh'].forEach(id=>$(id).oninput=()=>{
    obj[{sx:'x',sy:'y',sw:'w',sh:'h'}[id]]=parseFloat($(id).value)||0;
    if(obj.name==='Центральный проход')state.centralAisle=centralIsVertical()?obj.w:obj.h;
    renderAll();
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
  const visible=state.columns.map((c,i)=>({c,i})).filter(x=>onLevel(x.c));
  if(!visible.length){
    w.innerHTML='<div class="hint">На активном уровне колонн нет.</div>';
    return;
  }
  visible.forEach(({c,i})=>{
    const d=document.createElement('div');
    d.className='colitem';
    d.innerHTML=`<div class="headrow"><b>Колонна ${i+1}</b><button class="delbtn">×</button></div><div class="hint">${fmt1(c.x)} × ${fmt1(c.y)} · ${fmt1(c.w)}×${fmt1(c.h)} м · ${entityLevel(c)==='both'?'оба уровня':levelTitle(entityLevel(c))}</div>`;
    d.querySelector('.delbtn').onclick=()=>{state.columns.splice(i,1);if(selected.kind==='column'&&selected.index===i)selected={kind:null};renderAll()};
    d.onclick=e=>{if(e.target.tagName!=='BUTTON'){selected={kind:'column',index:i};renderSelected();draw()}};
    w.appendChild(d)
  })
}
function renderEmu(){
  const m=processModel(state.simFlow),ok=m.util<=1,total=m.total||1;
  const pickLevel=((state.zones||[]).find(z=>z.name==='Сборка')?.level)==='mezzanine'?'этаж':'1 этаж';
  $('emulatorBody').innerHTML=`<div class="emugrid">
  <div class="emukpi ${ok?'goodbg':'badbg'}"><span>Статус</span><b>${ok?'Поток проходит':'Выше мощности'}</b><small>${fmt(state.simFlow)} ШК/мес</small></div>
  <div class="emukpi"><span>Загрузка</span><b>${fmt1(m.util*100)}%</b></div>
  <div class="emukpi"><span>Минимум</span><b>${m.min} оп./смену</b></div>
  <div class="emukpi"><span>Рекомендуемо</span><b>${m.rec} оп./смену</b></div></div>
  <div class="lineflow levelFlow"><span>Приёмка<small>1 этаж</small></span><i>→</i><span>Раскладка<small>1 этаж</small></span><i>⇅</i><span>Сборка<small>${pickLevel}</small></span><i>⇅</i><span>Отгрузка<small>1 этаж</small></span></div>`
}
function tr(a,b,c,d){return `<tr><td>${a}</td><td>${b}</td>${c!==undefined?`<td>${c}</td>`:''}${d!==undefined?`<td>${d}</td>`:''}</tr>`}
function metric(name,val,sub=''){return `<div class="metricrow"><span>${name}</span><b>${val}</b>${sub?`<small>${sub}</small>`:''}</div>`}
function renderTabs(){
  const a=analytics(),pm=a.pm,scale=a.scaling;

  $('mArea').textContent=fmt1(a.groundArea)+' м²';
  if($('mStorageArea'))$('mStorageArea').textContent=fmt1(a.rackUsedArea)+' м²';
  $('mCapacity').textContent=fmt(a.cap)+' ШК';
  $('mThroughput').textContent=fmt(pm.maxMonthly)+' ШК/мес';
  $('mCams').textContent=fmt(a.totalCams)+' шт.';
  $('mStaff').textContent=pm.rec+' оп./смену';
  if($('mScaledFlow'))$('mScaledFlow').textContent=fmt(scale.plannedFlow)+' ШК/мес';
  if($('mAddStaff'))$('mAddStaff').textContent=scale.addedOperatorPositions?`+${fmt(scale.addedOperatorPositions)} чел.`:'0';
  renderScalingSidebar(scale);

  const central=getZone('Центральный проход');
  const centralText=central&&onLevel(central,'ground')
    ? `${fmt1(state.centralAisle)} м · ${centralIsVertical()?'вертикальный':'горизонтальный'} · ${fmt1(area(central))} м²`
    : 'нет';

  $('tab-capacity').innerHTML=`<div class="cards3">
    ${metric('Площадь хранения 1 этажа',fmt1(a.storageArea)+' м²')}
    ${metric('Доступные секции',fmt(a.rp.total),`отсеяно ${fmt(a.rp.rejectedSections||0)}`)}
    ${metric('Рабочая вместимость',fmt(a.cap)+' ШК',state.fillPct+'% заполнения')}
  </div>
  <table class="tbl"><tr><th>Показатель</th><th>Значение</th></tr>
    ${tr('Полезный объём',fmt1(a.vol)+' м³')}
    ${tr('Вместимость 100%',fmt(a.cap100)+' ШК')}
    ${tr('Рабочая вместимость',fmt(a.cap)+' ШК')}
    ${tr('Рабочие проходы',fmt(a.rp.aisleCount||0))}
    ${tr('Тупиковые проходы',fmt(a.rp.deadEndAisles||0))}
    ${tr('Недоступные секции исключены',fmt(a.rp.rejectedSections||0))}
    ${tr('Изменение к базе',`${scale.storageDelta>=0?'+':''}${fmt(scale.storageDelta)} ШК (${scale.storageDeltaPct>=0?'+':''}${fmt1(scale.storageDeltaPct)}%)`)}
    ${tr('Изменение площади к базе',`${scale.areaDelta>=0?'+':''}${fmt1(scale.areaDelta)} м² (${scale.areaDeltaPct>=0?'+':''}${fmt1(scale.areaDeltaPct)}%)`)}
    ${tr('Центральный проход',centralText)}
    ${tr('Этаж','не уменьшает расчёт стеллажной вместимости 1 этажа')}
  </table>`;

  const oneTurn=processModel(a.cap);
  const avg=processModel(state.avgFlow||100000);
  const mx=processModel(state.maxFlow||120000);
  const scaled=processModel(scale.plannedFlow);

  $('tab-throughput').innerHTML=`<div class="cards3">
    ${metric('1 оборот рабочего стока',fmt(a.cap)+' ШК/мес',fmt(a.cap/30)+' ШК/сутки')}
    ${metric(`Сценарий × ${fmt1(scale.turnover)}`,fmt(scale.plannedFlow)+' ШК/мес',fmt(scale.plannedFlow/30)+' ШК/сутки')}
    ${metric('Мощность текущего штата',fmt(scale.currentMax)+' ШК/мес',fmt1(scale.capacityUse)+'% требуемого потока')}
  </div>
  <table class="tbl"><tr><th>Сценарий</th><th>Оборотов стока</th><th>Загрузка</th><th>Статус</th></tr>
    ${tr('1 оборот',1,fmt1(oneTurn.util*100)+'%',oneTurn.util<=1?'проходит':'выше мощности')}
    ${tr('Средний',((state.avgFlow||100000)/Math.max(1,a.cap)).toFixed(2),fmt1(avg.util*100)+'%',avg.util<=1?'проходит':'выше мощности')}
    ${tr('Максимальный',((state.maxFlow||120000)/Math.max(1,a.cap)).toFixed(2),fmt1(mx.util*100)+'%',mx.util<=1?'проходит':'выше мощности')}
    ${tr('По вместимости',fmt1(scale.turnover),fmt1(scaled.util*100)+'%',scale.addPerShift?`нужно +${scale.addPerShift} оп./смену`:'текущий штат проходит')}
    ${tr('Целевой',(state.targetFlow/Math.max(1,a.cap)).toFixed(2),fmt1(pm.util*100)+'%',pm.util<=1?'проходит':'выше мощности')}
  </table>`;

  const bottleneckText=scale.bottleneck==='personnel'
    ? `Персонал ограничивает использование потенциала хранения: текущая мощность покрывает ${fmt1(scale.capacityUse)}% сценарного потока.`
    : 'Текущий штат покрывает выбранный сценарий оборота.';

  $('tab-scaling').innerHTML=`<div class="cards3">
    ${metric('Рабочая вместимость',fmt(a.cap)+' ШК',`${scale.storageDelta>=0?'+':''}${fmt(scale.storageDelta)} к базе`)}
    ${metric('Плановый оборот',fmt1(scale.turnover)+'× / мес',fmt(scale.plannedFlow)+' ШК/мес')}
    ${metric('Добавить операторов',scale.addedOperatorPositions?`+${fmt(scale.addedOperatorPositions)} чел.`:'0',scale.addPerShift?`+${scale.addPerShift} в каждую смену`:'штат достаточен')}
  </div>
  <div class="scaling-callout ${scale.bottleneck==='personnel'?'bad':'good'}">
    <b>${scale.bottleneck==='personnel'?'Персонал — узкое место':'Штат соответствует сценарию'}</b>
    <span>${bottleneckText}</span>
  </div>
  <table class="tbl"><tr><th>Масштабирование</th><th>Сейчас</th><th>После расчёта</th><th>Изменение</th></tr>
    <tr><td>Площадь 1 этажа</td><td>${fmt1(scale.baseArea)} м²</td><td>${fmt1(a.groundArea)} м²</td><td>${scale.areaDelta>=0?'+':''}${fmt1(scale.areaDelta)} м²</td></tr>
    <tr><td>Рабочая вместимость</td><td>${fmt(scale.baseCap)} ШК</td><td>${fmt(a.cap)} ШК</td><td>${scale.storageDelta>=0?'+':''}${fmt(scale.storageDelta)} ШК</td></tr>
    <tr><td>Поток при выбранном обороте</td><td>—</td><td>${fmt(scale.plannedFlow)} ШК/мес</td><td>${fmt1(scale.turnover)} оборота</td></tr>
    <tr><td>Операторы / смена</td><td>${fmt(scale.currentPerShift)}</td><td>${fmt(scale.recommendedPerShift)}</td><td>${scale.addPerShift?`+${fmt(scale.addPerShift)}`:scale.surplusPerShift?`запас ${fmt(scale.surplusPerShift)}`:'0'}</td></tr>
    <tr><td>Операторы в двух сменах</td><td>${fmt(scale.currentOperatorPositions)}</td><td>${fmt(scale.recommendedOperatorPositions)}</td><td>${scale.addedOperatorPositions?`+${fmt(scale.addedOperatorPositions)}`:'0'}</td></tr>
    <tr><td>Общий штат</td><td>${fmt(scale.currentHeadcount)}</td><td>${fmt(scale.recommendedHeadcount)}</td><td>${scale.recommendedHeadcount-scale.currentHeadcount>=0?'+':''}${fmt(scale.recommendedHeadcount-scale.currentHeadcount)}</td></tr>
    <tr><td>Макс. сквозной поток команды</td><td>${fmt(scale.currentMax)} ШК/мес</td><td>${fmt(scale.afterAddMax)} ШК/мес</td><td>${scale.throughputIncrease?`+${fmt(scale.throughputIncrease)}`:'0'}</td></tr>
    <tr><td>ФОТ</td><td>${money(scale.currentFOT)}</td><td>${money(scale.afterAddFOT)}</td><td>${scale.addFOT?`+${money(scale.addFOT)}`:'0 ₽'}</td></tr>
    <tr><td>OPEX с арендой</td><td>${money(scale.currentOpex)}</td><td>${money(scale.afterAddOpex)}</td><td>${scale.addFOT?`+${money(scale.addFOT)}`:'0 ₽'}</td></tr>
  </table>
  <div class="hint scaling-footnote">
    Расчёт сотрудников основан на нормах четырёх этапов и целевой загрузке ${fmt1(scale.targetUtil*100)}%.
    Старшие и руководитель автоматически не масштабируются.
  </div>`;

  $('tab-staff').innerHTML=`<div class="cards3">
    ${metric('Текущий состав',state.opsPerShift+' оп./смену',fmt(scale.currentOperatorPositions)+' операторских позиций')}
    ${metric('Нужно по вместимости',scale.recommendedPerShift+' оп./смену',`${fmt1(scale.turnover)} оборота / мес`)}
    ${metric('Добавить',scale.addedOperatorPositions?`+${fmt(scale.addedOperatorPositions)} операторов`:'0',scale.addPerShift?`+${scale.addPerShift} день +${scale.addPerShift} ночь при 2 сменах`:'текущего состава достаточно')}
  </div>
  <table class="tbl"><tr><th>Операция</th><th>Норма</th><th>Чел.-смен/сутки для сценария</th><th>Доля труда</th></tr>
    ${Object.keys(scaled.req).map(k=>tr(names[k],fmt(scaled.norms[k]),fmt1(scaled.req[k]),fmt1(scaled.req[k]/scaled.total*100)+'%')).join('')}
  </table>`;

  $('tab-video').innerHTML=`<div class="cards3">
    ${metric('Автокамеры склада',a.cams.cams.length)}
    ${metric('Мёртвые точки',a.cams.uncovered.length,a.cams.uncovered.length?'нужно корректировать':'не обнаружены')}
    ${metric('Итого камер',a.totalCams)}
  </div>
  <table class="tbl"><tr><th>Блок</th><th>Количество</th><th>Комментарий</th></tr>
    ${tr('Склад 1 этажа',a.cams.cams.length,'автопокрытие')}
    ${tr('Пользовательские камеры',a.userCams,'все уровни')}
    ${tr('Прочие точки',7,'базовые точки модели')}
  </table>`;

  $('tab-equip').innerHTML=`<div class="cards3">
    ${metric('Пользовательские объекты',state.objects.length)}
    ${metric('Колонны',state.columns.length)}
    ${metric('Оборудование',state.objects.filter(o=>o.type==='equipment').length)}
  </div>
  <table class="tbl"><tr><th>Объект</th><th>Количество</th><th>Комментарий</th></tr>
    ${tr('Стационарные ПК',state.fixedPC||2,'базовая модель')}
    ${tr('ТСД',state.fixedTsd||3,'базовая модель')}
    ${tr('Планшеты',state.fixedTablet||2,'базовая модель')}
    ${tr('Столы, двери, кастомные зоны',state.objects.length,'могут быть назначены на любой уровень')}
  </table>`;

  const picking=(state.zones||[]).find(z=>z.name==='Сборка');
  const verticalLinks=(state.objects||[]).filter(o=>o.objectKind==='vertical_link');


  if($('tab-floor-opt')){
    if(!state.floor2Enabled){
      $('tab-floor-opt').innerHTML='<div class="warnbox info"><b>Этаж 2 не добавлен</b><div class="validation-detail">Добавь второй этаж, чтобы сравнить сценарии.</div></div>';
    }else if(!mfVariants.length){
      $('tab-floor-opt').innerHTML='<div class="warnbox info"><b>Сравнение ещё не запускалось</b><div class="validation-detail">Нажми «Сравнить варианты этажей».</div></div>';
    }else{
      $('tab-floor-opt').innerHTML=`<div class="cards3">
        ${metric('Рекомендация',mfVariants[0].title,`${fmt1(mfVariants[0].score)}/100`)}
        ${metric('Вместимость',fmt(mfVariants[0].capacity)+' ШК',`${fmt(mfVariants[0].totalSections)} секций`)}
        ${metric('Операторы',fmt(mfVariants[0].requiredOps)+' / смену',`${fmt(mfVariants[0].addOps)} добавить`)}
      </div>
      <table class="tbl"><tr><th>Вариант</th><th>Score</th><th>Секции</th><th>Вместимость</th><th>Операторы</th><th>OPEX</th></tr>
        ${mfVariants.map(v=>`<tr><td>${v.title}</td><td>${fmt1(v.score)}</td><td>${fmt(v.totalSections)}</td><td>${fmt(v.capacity)} ШК</td><td>${fmt(v.requiredOps)} / смену</td><td>${money(v.opex)}</td></tr>`).join('')}
      </table>`;
    }
  }

  if($('tab-levels')){
    $('tab-levels').innerHTML=`<div class="cards3">
      ${metric('1 этаж',fmt1(a.groundArea)+' м²',fmt1(a.groundProcessArea)+' м² процессов')}
      ${metric('Этаж',fmt1(a.mezzanineArea)+' м²',fmt1(a.mezzanineProcessArea)+' м² процессов')}
      ${metric('Вертикальные связи',verticalLinks.length,verticalLinks.length?'лестница / подъёмник':'добавь через библиотеку')}
    </div>
    <table class="tbl"><tr><th>Этап</th><th>Уровень</th><th>Комментарий</th></tr>
      ${tr('Приёмка','1 этаж','участвует в площади 1 этажа')}
      ${tr('Раскладка','1 этаж','проходит в стеллажных улицах')}
      ${tr('Сборка',picking?levelTitle(entityLevel(picking)):'не задана',picking?fmt1(area(picking))+' м²':'добавь зону')}
      ${tr('Отгрузка','1 этаж','участвует в площади 1 этажа')}
      ${tr('Сквозной поток','оба уровня','расчёт производительности сохраняет все четыре этапа')}
    </table>`;
  }

  $('tab-analytics').innerHTML=`<div class="cards3">
    ${metric('ФОТ текущий',money(a.currentFOT))}
    ${metric('ФОТ после масштабирования',money(scale.afterAddFOT),scale.addFOT?`+${money(scale.addFOT)}`:'без изменений')}
    ${metric('OPEX после масштабирования',money(scale.afterAddOpex))}
  </div>
  <table class="tbl"><tr><th>Аналитика</th><th>Значение</th></tr>
    ${tr('Площадь 1 этажа',fmt1(a.groundArea)+' м²')}
    ${tr('Площадь этажа',fmt1(a.mezzanineArea)+' м²')}
    ${tr('Суммарная моделируемая площадь уровней',fmt1(a.totalOperationalArea)+' м²')}
    ${tr('Доля 1 этажа, занятая стеллажами',fmt1(a.rackUsedArea/a.groundArea*100)+'%')}
    ${tr('Неиспользуемая доступная площадь 1 этажа',fmt1(a.unusedRackableArea)+' м²')}
    ${tr('Процессные зоны 1 этажа',fmt1(a.groundProcessArea)+' м²')}
    ${tr('Процессные зоны этажа',fmt1(a.mezzanineProcessArea)+' м²')}
    ${tr('Секций на 1 м² первого этажа',fmt1(a.rp.total/a.groundArea))}
    ${tr('ШК на 1 м² первого этажа',fmt1(a.cap/a.groundArea))}
    ${tr('Сборка',picking&&entityLevel(picking)==='mezzanine'?'этаж · площадь 1 этажа не занимает':'проверь уровень')}
    ${tr('Поток при выбранном обороте',fmt(scale.plannedFlow)+' ШК/мес')}
    ${tr('Мощность текущего штата',fmt(scale.currentMax)+' ШК/мес')}
    ${tr('Мощность после добавления операторов',fmt(scale.afterAddMax)+' ШК/мес')}
    ${tr('Добавить операторов',fmt(scale.addedOperatorPositions))}
    ${tr('CAPEX',money(state.capex||2921881))}
    ${tr('Аренда',money(state.rent||300000))}
  </table>`;

  renderValidationPanels();
}
function renderLevelControls(){
  document.querySelectorAll('[data-level-switch]').forEach(b=>{
    b.classList.toggle('active',b.dataset.levelSwitch===state.activeLevel);
  });
  if($('activeLevelBadge'))$('activeLevelBadge').textContent=levelTitle();
  if($('planLevelBadge'))$('planLevelBadge').textContent=`${levelTitle()} · ${fmt1(levelArea(state.activeLevel))} м²`;
  if($('mezzanineL'))$('mezzanineL').value=state.mezzanineL;
  if($('mezzanineW'))$('mezzanineW').value=state.mezzanineW;
}

function switchLevel(level){
  if(!['ground','mezzanine'].includes(level))return;
  state.activeLevel=level;
  selected={kind:null,index:null};
  drag=null;
  renderAll();
}


function syncSideWallGapControls(){
  const enabled=state.sideWallGapEnabled!==false;
  const btn=$('sideWallGapToggleBtn');
  const input=$('sideWallGap');
  const wrap=$('sideWallGapWrap');
  const status=$('sideWallGapStatus');

  if(btn){
    btn.textContent=enabled?'ВКЛ':'ВЫКЛ';
    btn.classList.toggle('on',enabled);
    btn.classList.toggle('off',!enabled);
  }
  if(input){
    input.value=state.sideWallGap;
    input.disabled=!enabled;
  }
  if(wrap)wrap.classList.toggle('disabled-field',!enabled);
  if(status){
    status.textContent=enabled
      ? `Активно: ${fmt1(state.sideWallGap)} м слева + ${fmt1(state.sideWallGap)} м справа.`
      : 'Отключено: стеллажная сетка может начинаться от боковых стен без модельного отступа.';
  }
}
function toggleSideWallGap(){
  state.sideWallGapEnabled=!state.sideWallGapEnabled;
  optimizerAllCandidates=[];
  optimizerVariants=[];
  renderVariantSelector();
  renderAll();
}
function renderAll(full=true){
  renderMultiFloorOptimizer84();
  save();
  syncSideWallGapControls();
  renderLevelControls();
  if(full){renderColumns();renderSelected()}
  draw();renderEmu();renderTabs();
}


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
  const bd=levelDims(entityLevel(o)==='both'?state.activeLevel:entityLevel(o));
  o.x=clamp(o.x,0,Math.max(0,bd.L-o.w));
  o.y=clamp(o.y,0,Math.max(0,bd.W-o.h));
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
  const bd=levelDims(entityLevel(copy)==='both'?state.activeLevel:entityLevel(copy));
  copy.x=clamp((copy.x||0)+0.5,0,Math.max(0,bd.L-copy.w));
  copy.y=clamp((copy.y||0)+0.5,0,Math.max(0,bd.W-copy.h));

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
  const catalog={
    courier:{name:'Зона курьеров',type:'process',zoneRole:'optional',w:2.5,h:2,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:true},
    returns:{name:'Возвраты',type:'process',zoneRole:'process',w:2.5,h:2,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:true},
    buffer_in:{name:'Буфер приемки',type:'process',zoneRole:'process',w:2.5,h:1.6,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:true},
    buffer_out:{name:'Буфер отгрузки',type:'process',zoneRole:'process',w:2.5,h:1.6,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:true},
    packing:{name:'Упаковка',type:'process',zoneRole:'process',w:2.4,h:1.8,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:true},
    quality:{name:'Контроль качества',type:'process',zoneRole:'process',w:2.2,h:1.8,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:true},
    picking:{name:'Сборка',type:'process',zoneRole:'process',level:'mezzanine',w:5,h:2.5,affectsCapacity:false,blocksStorage:true,affectsFlow:true,needsCamera:true},
    pallet:{name:'Паллетная зона',type:'storage',zoneRole:'optional',w:2.4,h:2.4,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:true},
    charging:{name:'Зарядка ТСД',type:'equipment',zoneRole:'service',w:1.4,h:1,affectsCapacity:true,blocksStorage:true,affectsFlow:false,needsCamera:false},
    table:{name:'Стол',type:'equipment',zoneRole:'optional',w:1.4,h:.8,affectsCapacity:true,blocksStorage:true,affectsFlow:false,needsCamera:false},
    camera:{name:'Ручная камера',type:'equipment',zoneRole:'optional',w:.35,h:.35,affectsCapacity:false,blocksStorage:false,affectsFlow:false,needsCamera:false,objectKind:'camera'},
    door:{name:'Дверь',type:'service',zoneRole:'hard',w:1.2,h:.25,affectsCapacity:true,blocksStorage:true,affectsFlow:false,needsCamera:false,objectKind:'door'},
    vertical:{name:'Лестница / подъёмник',type:'service',zoneRole:'hard',level:'both',w:1.8,h:1.8,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:true,objectKind:'vertical_link'},
    custom:{name:'Своя зона',type:'custom',zoneRole:'optional',w:2,h:2,affectsCapacity:true,blocksStorage:true,affectsFlow:false,needsCamera:false}
  };
  const base=catalog[template]||catalog.custom;
  const level=base.level||state.activeLevel;
  const bd=levelDims(level==='both'?state.activeLevel:level);
  const o={...base,level,rotation:0};
  o.w=Math.min(o.w,Math.max(.3,bd.L));
  o.h=Math.min(o.h,Math.max(.3,bd.W));
  o.x=clamp(bd.L*.45,0,Math.max(0,bd.L-o.w));
  o.y=clamp(bd.W*.45,0,Math.max(0,bd.W-o.h));

  if(template==='picking'){
    const existing=(state.zones||[]).find(z=>z.name==='Сборка');
    if(existing){
      selected={kind:'zone',index:state.zones.indexOf(existing)};
      state.floor2Enabled=true;state.activeLevel='mezzanine';
      renderAll();
      return;
    }
    state.zones.push(o);
    selected={kind:'zone',index:state.zones.length-1};
    state.floor2Enabled=true;state.activeLevel='mezzanine';
  }else{
    state.objects.push(o);
    selected={kind:'object',index:state.objects.length-1};
  }
  renderAll();
}

const PROJECTS_KEY='mfcPlannerProjectsV81';
const CURRENT_PROJECT_KEY='mfcPlannerCurrentProjectV81';
const CLOUD_API_KEY='mfcPlannerCloudApiV81';
const CLOUD_TOKEN_KEY='mfcPlannerCloudTokenV81';

let currentProjectId=localStorage.getItem(CURRENT_PROJECT_KEY)||'';
let cloudApiBase=(localStorage.getItem(CLOUD_API_KEY)||'').replace(/\/+$/,'');
let cloudToken=localStorage.getItem(CLOUD_TOKEN_KEY)||'';
let cloudUser=null;
let cloudProjects=[];
let cloudLastSync=null;
let cloudAutosaveBusy=false;

function escapeHtml(s){return String(s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));}

function readProjects(){
  try{
    let p=JSON.parse(localStorage.getItem(PROJECTS_KEY)||'[]');
    if(!Array.isArray(p))p=[];
    if(!p.length){
      const legacyKeys=['mfcPlannerProjectsV78','mfcPlannerProjectsV77','mfcPlannerProjectsV76','mfcPlannerProjectsV744','mfcPlannerProjectsV743'];
      for(const key of legacyKeys){
        const legacy=JSON.parse(localStorage.getItem(key)||'[]');
        if(Array.isArray(legacy)&&legacy.length){
          p=legacy;
          localStorage.setItem(PROJECTS_KEY,JSON.stringify(p));
          break;
        }
      }
    }
    return p;
  }catch(e){return []}
}
function writeProjects(projects){localStorage.setItem(PROJECTS_KEY,JSON.stringify(projects));}
function projectSnapshot(){return JSON.parse(JSON.stringify(state));}
function cloudConnected(){return !!(cloudApiBase&&cloudToken&&cloudUser);}

function currentProjectList(){
  return cloudConnected()?cloudProjects:readProjects();
}
function projectNameById(id){
  const p=currentProjectList().find(x=>String(x.id)===String(id));
  return p?p.name:'Черновик';
}

async function cloudFetch(path,options={}){
  if(!cloudApiBase)throw new Error('Cloud API не настроен');
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  if(cloudToken)headers.Authorization='Bearer '+cloudToken;

  const res=await fetch(cloudApiBase+path,{...options,headers});
  let data=null;
  try{data=await res.json()}catch(e){data=null}
  if(!res.ok){
    const message=data?.detail||data?.message||`HTTP ${res.status}`;
    if(res.status===401){
      cloudToken='';
      cloudUser=null;
      localStorage.removeItem(CLOUD_TOKEN_KEY);
      renderCloudStatus();
    }
    throw new Error(message);
  }
  return data;
}

function setCloudSyncMessage(text){
  if($('cloudSyncInfo'))$('cloudSyncInfo').textContent=text;
}

function renderCloudStatus(){
  const connected=cloudConnected();
  const configured=!!cloudApiBase;
  const badge=$('cloudStatusBadge');
  const top=$('cloudTopStatus');

  if(badge){
    badge.className='cloud-badge '+(connected?'cloud':configured?'pending':'local');
    badge.textContent=connected?'Облако':configured?'API задан':'Локально';
  }
  if(top){
    top.className='cloud-top-status '+(connected?'cloud':configured?'pending':'local');
    top.textContent=connected?'● облако':'● локально';
  }

  if($('cloudApiBase'))$('cloudApiBase').value=cloudApiBase;
  if($('cloudLoggedOut'))$('cloudLoggedOut').classList.toggle('hidden',connected);
  if($('cloudLoggedIn'))$('cloudLoggedIn').classList.toggle('hidden',!connected);
  if($('cloudUserLabel'))$('cloudUserLabel').textContent=cloudUser?`${cloudUser.display_name||cloudUser.email} · ${cloudUser.email}`:'—';

  if(connected){
    const host=(()=>{
      try{return new URL(cloudApiBase).host}catch(e){return cloudApiBase}
    })();
    const sync=cloudLastSync?` · синхр. ${cloudLastSync.toLocaleTimeString('ru-RU')}`:'';
    setCloudSyncMessage(`☁ Данные планов сохраняются на сервере ${host}${sync}. Локально остаётся только резервный черновик.`);
  }else if(configured){
    setCloudSyncMessage('API указан, но вход в облачный аккаунт не выполнен.');
  }else{
    setCloudSyncMessage('Сервер не настроен. Сохранённые планы работают локально.');
  }
}

async function cloudCheck(){
  cloudApiBase=($('cloudApiBase')?.value||'').trim().replace(/\/+$/,'');
  if(!cloudApiBase)return alert('Укажи адрес Cloud API.');
  localStorage.setItem(CLOUD_API_KEY,cloudApiBase);
  renderCloudStatus();
  try{
    const h=await cloudFetch('/health');
    setCloudSyncMessage(`Сервер отвечает: ${h.status||'ok'}. Можно войти или зарегистрироваться.`);
  }catch(e){
    setCloudSyncMessage('Ошибка подключения: '+e.message);
  }
}

async function cloudRegister(){
  cloudApiBase=($('cloudApiBase')?.value||cloudApiBase).trim().replace(/\/+$/,'');
  localStorage.setItem(CLOUD_API_KEY,cloudApiBase);
  const email=($('cloudEmail')?.value||'').trim();
  const password=$('cloudPassword')?.value||'';
  if(!email||password.length<8)return alert('Укажи email и пароль минимум 8 символов.');
  try{
    const data=await cloudFetch('/auth/register',{
      method:'POST',
      body:JSON.stringify({email,password,display_name:email.split('@')[0]})
    });
    cloudToken=data.token;
    cloudUser=data.user;
    localStorage.setItem(CLOUD_TOKEN_KEY,cloudToken);
    await cloudRefreshProjects();
    renderCloudStatus();
    renderProjectSelector();
  }catch(e){alert('Регистрация: '+e.message)}
}

async function cloudLogin(){
  cloudApiBase=($('cloudApiBase')?.value||cloudApiBase).trim().replace(/\/+$/,'');
  localStorage.setItem(CLOUD_API_KEY,cloudApiBase);
  const email=($('cloudEmail')?.value||'').trim();
  const password=$('cloudPassword')?.value||'';
  if(!email||!password)return alert('Укажи email и пароль.');
  try{
    const data=await cloudFetch('/auth/login',{
      method:'POST',
      body:JSON.stringify({email,password})
    });
    cloudToken=data.token;
    cloudUser=data.user;
    localStorage.setItem(CLOUD_TOKEN_KEY,cloudToken);
    currentProjectId='';
    localStorage.removeItem(CURRENT_PROJECT_KEY);
    await cloudRefreshProjects();
    renderCloudStatus();
    renderProjectSelector();
  }catch(e){alert('Вход: '+e.message)}
}

function cloudLogout(){
  cloudToken='';
  cloudUser=null;
  cloudProjects=[];
  currentProjectId='';
  localStorage.removeItem(CLOUD_TOKEN_KEY);
  localStorage.removeItem(CURRENT_PROJECT_KEY);
  renderCloudStatus();
  renderProjectSelector();
}

async function cloudRestoreSession(){
  if(!cloudApiBase||!cloudToken){renderCloudStatus();return}
  try{
    cloudUser=await cloudFetch('/auth/me');
    await cloudRefreshProjects();
  }catch(e){
    cloudToken='';
    cloudUser=null;
    localStorage.removeItem(CLOUD_TOKEN_KEY);
  }
  renderCloudStatus();
  renderProjectSelector();
}

async function cloudRefreshProjects(){
  if(!cloudToken)return;
  cloudProjects=await cloudFetch('/projects');
  cloudProjects=(cloudProjects||[]).map(p=>({
    ...p,
    id:String(p.id),
    updatedAt:p.updated_at?new Date(p.updated_at).getTime():Date.now()
  }));
  cloudLastSync=new Date();
  renderCloudStatus();
}

function renderProjectSelector(){
  const sel=$('projectSelect');
  if(!sel)return;
  const projects=[...currentProjectList()].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  const prefix=cloudConnected()?'☁ Мои облачные планы':'Мои локальные планы';
  sel.innerHTML=`<option value="">${prefix} (${projects.length})</option>`+
    projects.map(p=>`<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.name)}</option>`).join('');
  if(currentProjectId&&projects.some(p=>String(p.id)===String(currentProjectId)))sel.value=String(currentProjectId);
  if($('currentProjectName'))$('currentProjectName').textContent=projectNameById(currentProjectId);
}

async function saveNamedProject(forceNew=false){
  if(cloudConnected())return saveCloudProject(forceNew);

  const projects=readProjects();
  const current=projects.find(p=>p.id===currentProjectId);
  const defaultName=forceNew
    ? (current?current.name+' — копия':`MFC ${fmt1(state.roomL*state.roomW)} м² — вариант`)
    : (current?current.name:`MFC ${fmt1(state.roomL*state.roomW)} м²`);

  const name=prompt(forceNew?'Название нового плана:':'Название плана:',defaultName);
  if(!name||!name.trim())return;
  const clean=name.trim();
  const now=Date.now();

  if(current&&!forceNew&&clean.toLocaleLowerCase('ru-RU')===current.name.toLocaleLowerCase('ru-RU')){
    current.state=projectSnapshot();current.updatedAt=now;
  }else{
    const project={id:'p_'+now+'_'+Math.random().toString(36).slice(2,8),name:clean,state:projectSnapshot(),createdAt:now,updatedAt:now};
    projects.push(project);currentProjectId=project.id;
  }
  writeProjects(projects);
  localStorage.setItem(CURRENT_PROJECT_KEY,currentProjectId);
  renderProjectSelector();
  if($('projectSaveStatus'))$('projectSaveStatus').textContent='Локально сохранено планов: '+projects.length;
}

async function saveCloudProject(forceNew=false){
  const current=cloudProjects.find(p=>String(p.id)===String(currentProjectId));
  const defaultName=forceNew
    ? (current?current.name+' — копия':`MFC ${fmt1(state.roomL*state.roomW)} м² — вариант`)
    : (current?current.name:`MFC ${fmt1(state.roomL*state.roomW)} м²`);
  const name=prompt(forceNew?'Название нового облачного плана:':'Название облачного плана:',defaultName);
  if(!name||!name.trim())return;
  try{
    let item;
    if(current&&!forceNew){
      item=await cloudFetch(`/projects/${current.id}`,{
        method:'PUT',
        body:JSON.stringify({name:name.trim(),layout:projectSnapshot()})
      });
    }else{
      item=await cloudFetch('/projects',{
        method:'POST',
        body:JSON.stringify({name:name.trim(),layout:projectSnapshot()})
      });
    }
    currentProjectId=String(item.id);
    localStorage.setItem(CURRENT_PROJECT_KEY,currentProjectId);
    cloudLastSync=new Date();
    await cloudRefreshProjects();
    renderProjectSelector();
    if($('projectSaveStatus'))$('projectSaveStatus').textContent='☁ Сохранено в облако: '+new Date().toLocaleString('ru-RU');
  }catch(e){alert('Облачное сохранение: '+e.message)}
}

async function openProject(id){
  if(!id)return;
  let p=null;
  if(cloudConnected()){
    try{
      p=await cloudFetch(`/projects/${id}`);
      p={...p,state:p.layout};
    }catch(e){return alert('Не удалось открыть облачный план: '+e.message)}
  }else{
    p=readProjects().find(x=>String(x.id)===String(id));
  }
  if(!p||!p.state)return;
  state=Object.assign(structuredClone(defaults),JSON.parse(JSON.stringify(p.state)));
  sanitizeState();migrateSmartZones();migrateV69();
  currentProjectId=String(id);
  localStorage.setItem(CURRENT_PROJECT_KEY,currentProjectId);
  inputIds.forEach(k=>{if($(k))$(k).value=state[k]});
  if($('layoutMode'))$('layoutMode').value=state.layoutMode;
  if($('turnoverMode'))$('turnoverMode').value=state.turnoverMode;
  selected={kind:null,index:null};
  save();renderProjectSelector();renderAll();
}

async function deleteCurrentProject(){
  if(!currentProjectId)return alert('Сначала выбери сохранённый план.');
  const p=currentProjectList().find(x=>String(x.id)===String(currentProjectId));
  if(!p)return;
  if(!confirm(`Удалить план «${p.name}»?`))return;

  if(cloudConnected()){
    try{
      await cloudFetch(`/projects/${currentProjectId}`,{method:'DELETE'});
      currentProjectId='';
      localStorage.removeItem(CURRENT_PROJECT_KEY);
      await cloudRefreshProjects();
    }catch(e){return alert('Удаление из облака: '+e.message)}
  }else{
    writeProjects(readProjects().filter(x=>String(x.id)!==String(currentProjectId)));
    currentProjectId='';
    localStorage.removeItem(CURRENT_PROJECT_KEY);
  }
  renderProjectSelector();
}

async function autosaveCurrentProject(){
  if(!currentProjectId)return;

  if(cloudConnected()){
    if(cloudAutosaveBusy)return;
    const current=cloudProjects.find(p=>String(p.id)===String(currentProjectId));
    if(!current)return;
    cloudAutosaveBusy=true;
    try{
      await cloudFetch(`/projects/${currentProjectId}`,{
        method:'PUT',
        body:JSON.stringify({name:current.name,layout:projectSnapshot()})
      });
      cloudLastSync=new Date();
      renderCloudStatus();
      if($('projectSaveStatus'))$('projectSaveStatus').textContent='☁ Автосохранение на сервер: '+cloudLastSync.toLocaleTimeString('ru-RU');
    }catch(e){
      if($('projectSaveStatus'))$('projectSaveStatus').textContent='⚠ Облачное автосохранение не выполнено: '+e.message;
    }finally{cloudAutosaveBusy=false}
    return;
  }

  const projects=readProjects();
  const p=projects.find(x=>String(x.id)===String(currentProjectId));
  if(!p)return;
  p.state=projectSnapshot();p.updatedAt=Date.now();writeProjects(projects);
  if($('projectSaveStatus'))$('projectSaveStatus').textContent='Локальное автосохранение: '+new Date(p.updatedAt).toLocaleTimeString('ru-RU');
}

async function migrateLocalProjectsToCloud(){
  if(!cloudConnected())return alert('Сначала войди в облачный аккаунт.');
  const locals=readProjects();
  if(!locals.length)return alert('Локальных сохранённых планов нет.');
  if(!confirm(`Перенести ${locals.length} локальных планов в облако? Локальные копии останутся.`))return;

  let ok=0,failed=0;
  for(const p of locals){
    try{
      await cloudFetch('/projects',{
        method:'POST',
        body:JSON.stringify({name:p.name||'Локальный план',layout:p.state||{}})
      });
      ok++;
    }catch(e){failed++}
  }
  await cloudRefreshProjects();
  renderProjectSelector();
  alert(`Перенос завершён. В облаке создано: ${ok}. Ошибок: ${failed}.`);
}

async function initCloudWorkspace(){
  renderCloudStatus();
  await cloudRestoreSession();
}


const VARIANT_KEY='mfcPlannerVariantsV75';
let optimizerVariants=[];
let optimizerBaseState=null;
let optimizerAllCandidates=[];
let optimizerSearchCount=0;
let optimizerCurrentMetrics=null;
let optimizerPreviewRacks=[];
let validationReport=null;
let validationOverlayRects=[];


function setCentralAisleConfig(config){
  state.zones=(state.zones||[]).filter(z=>z.name!=='Центральный проход');
  if(!config || config.enabled===false) return;

  const b=rackCandidateArea();
  const width=clamp(Number(config.width)||1.2,0.9,2.6);
  const position=clamp(config.position??.5,0,1);

  if(config.orientation==='horizontal'){
    const y=b.y+(b.h-width)*position;
    state.zones.push({name:'Центральный проход',type:'service',zoneRole:'service',level:'ground',x:b.x,y,w:b.w,h:width,rotation:0,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:false});
  }else{
    const x=b.x+(b.w-width)*position;
    state.zones.push({name:'Центральный проход',type:'service',zoneRole:'service',level:'ground',x,y:b.y,w:width,h:b.h,rotation:90,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:false});
  }
  state.centralAisle=width;
}

function capacityFromRackPlan(rp){
  const volume=rp.total*state.rackL*state.rackD*state.rackH;
  return volume*1000/Math.max(.1,state.avgSkuL)*state.fillPct/100;
}

function optimizerFreeArea(rp){
  return Math.max(0,estimatedRackableArea()-(rp.rackArea||0));
}

function evaluateLayoutCandidate(base,config,label){
  state=JSON.parse(JSON.stringify(base));
  sanitizeState();migrateSmartZones();migrateV69();
  setCentralAisleConfig(config);

  const rp=rackPlan();
  const capacity=capacityFromRackPlan(rp);
  const free=optimizerFreeArea(rp);

  let centrality=0,crossAccess=0,aisleScore=0;
  if(config && config.enabled!==false){
    centrality=1-Math.min(1,Math.abs((config.position??.5)-.5)*2);
    crossAccess=1;
    aisleScore=Math.min(1,(config.width||1)/1.6);
  }

  return {
    id:'v_'+Math.random().toString(36).slice(2,10),
    label,
    config:config?JSON.parse(JSON.stringify(config)):{enabled:false},
    sections:rp.total,
    streets:rp.streetCount||0,
    capacity,free,
    rackArea:rp.rackArea||0,
    orientation:rp.orientation,
    centrality,crossAccess,aisleScore,
    racks:(rp.racks||[]).map(r=>({x:r.x,y:r.y,w:r.w,h:r.h})),
    snapshot:JSON.parse(JSON.stringify(state))
  };
}

function optimizerCurrentPlanMetrics(){
  const rp=rackPlan();
  return {
    sections:rp.total,
    capacity:capacityFromRackPlan(rp),
    free:optimizerFreeArea(rp),
    rackArea:rp.rackArea||0,
    streets:rp.streetCount||0,
    racks:(rp.racks||[]).map(r=>({x:r.x,y:r.y,w:r.w,h:r.h}))
  };
}

function candidateScore(v,goal,n){
  const sections=v.sections/n.maxSections;
  const used=1-(v.free/n.maxFree);
  const streets=Math.min(1,v.streets/n.maxStreets);
  if(goal==='flow') return v.crossAccess*35+v.centrality*25+v.aisleScore*15+sections*15+streets*10;
  if(goal==='balanced') return sections*58+v.crossAccess*14+v.centrality*13+used*10+streets*5;
  return sections*90+used*7+streets*3;
}

function findBestVariants(){
  const original=JSON.parse(JSON.stringify(state));
  optimizerBaseState=JSON.parse(JSON.stringify(state));
  optimizerCurrentMetrics=optimizerCurrentPlanMetrics();
  optimizerPreviewRacks=[];

  const candidates=[];
  candidates.push(evaluateLayoutCandidate(optimizerBaseState,{enabled:false},'Без ЦП'));

  const widths=[1.0,1.2,1.4,1.6,1.8];
  const positions=[.20,.30,.40,.50,.60,.70,.80];

  ['vertical','horizontal'].forEach(orientation=>{
    widths.forEach(width=>positions.forEach(position=>{
      candidates.push(evaluateLayoutCandidate(
        optimizerBaseState,
        {enabled:true,orientation,width,position},
        `${orientation==='vertical'?'Вертикальный':'Горизонтальный'} ЦП ${width} м · ${Math.round(position*100)}%`
      ));
    }));
  });

  optimizerAllCandidates=candidates;
  optimizerSearchCount=candidates.length*8;

  const n={
    maxSections:Math.max(1,...candidates.map(v=>v.sections)),
    maxFree:Math.max(1,...candidates.map(v=>v.free)),
    maxStreets:Math.max(1,...candidates.map(v=>v.streets))
  };

  const goal=$('optimizerGoal')?.value||'capacity';
  candidates.forEach(v=>{
    v.score=candidateScore(v,goal,n);
    v.deltaSections=v.sections-optimizerCurrentMetrics.sections;
    v.deltaCapacity=v.capacity-optimizerCurrentMetrics.capacity;
    v.extraRackArea=Math.max(0,v.deltaSections)*state.rackL*state.rackD;
  });

  const seen=new Set(),unique=[];
  [...candidates]
    .sort((a,b)=>b.score-a.score||b.sections-a.sections||a.free-b.free)
    .forEach(v=>{
      const key=[v.sections,v.streets,Math.round(v.free*10),v.orientation,
        v.config.enabled===false?'none':v.config.orientation,
        v.config.enabled===false?0:Math.round((v.config.width||0)*10),
        v.config.enabled===false?0:Math.round((v.config.position||0)*100)].join('|');
      if(!seen.has(key)){seen.add(key);unique.push(v)}
    });

  optimizerVariants=unique.slice(0,10).map((v,i)=>({...v,rank:i+1,title:`#${i+1}`}));

  state=original;
  sanitizeState();migrateSmartZones();migrateV69();
  renderVariantSelector();
  renderAll();
}

function renderVariantSelector(){
  const sel=$('variantSelect'),box=$('variantDetails'),stats=$('optimizerStats');
  if(!sel||!box)return;
  if(!optimizerVariants.length){
    sel.innerHTML='<option value="">Сначала нажми «Найти ТОП-10»</option>';
    box.innerHTML='<div class="hint">Проверим сотни внутренних раскладок.</div>';
    if(stats)stats.innerHTML='<span>Поиск ещё не запускался</span>';
    return;
  }

  sel.innerHTML=optimizerVariants.map((v,i)=>{
    const plus=v.deltaSections>0?` · +${fmt(v.deltaSections)} сек.`:'';
    return `<option value="${i}">#${i+1}: ${fmt(v.sections)} секций · ${fmt(v.capacity)} ШК${plus}</option>`;
  }).join('');

  if(stats){
    const best=Math.max(...optimizerAllCandidates.map(v=>v.sections));
    const delta=best-(optimizerCurrentMetrics?.sections||0);
    stats.innerHTML=`<b>Проверено ${fmt(optimizerSearchCount)} внутренних раскладок</b>
      <span>Текущий план: ${fmt(optimizerCurrentMetrics?.sections||0)} секций</span>
      <span>Максимум: ${fmt(best)} секций ${delta>0?`(+${fmt(delta)})`:'(текущий уже максимум)'}</span>`;
  }
  showVariantDetails(0);
}

function selectedOptimizerVariant(){
  return optimizerVariants[Number($('variantSelect')?.value)];
}

function showVariantDetails(index){
  optimizerPreviewRacks=[];
  const v=optimizerVariants[Number(index)],box=$('variantDetails');
  if(!v||!box)return;
  const cp=v.config.enabled===false?'без ЦП':`${v.config.orientation==='vertical'?'вертикальный':'горизонтальный'} ЦП ${fmt1(v.config.width)} м · ${Math.round((v.config.position||0)*100)}%`;
  box.innerHTML=`<div class="variant-kpis">
    <div><span>Секции</span><b>${fmt(v.sections)}</b><small>${v.deltaSections>0?'+'+fmt(v.deltaSections):fmt(v.deltaSections)} к текущему</small></div>
    <div><span>Вместимость</span><b>${fmt(v.capacity)} ШК</b><small>${v.deltaCapacity>0?'+'+fmt(v.deltaCapacity):fmt(v.deltaCapacity)} ШК</small></div>
    <div><span>Улицы</span><b>${fmt(v.streets)}</b></div>
    <div><span>Свободный остаток</span><b>${fmt1(v.free)} м²</b></div>
    <div><span>Доп. footprint</span><b>${fmt1(v.extraRackArea)} м²</b></div>
    <div><span>Рейтинг</span><b>${fmt1(v.score)}/100</b></div>
  </div><div class="hint">${cp} · улицы ${v.orientation==='horizontal'?'продольные':'поперечные'}</div>`;
}

function rackKey(r){
  return [Math.round(r.x*100),Math.round(r.y*100),Math.round(r.w*100),Math.round(r.h*100)].join('|');
}

function previewSelectedVariant(){
  const v=selectedOptimizerVariant();
  if(!v)return alert('Сначала найди и выбери вариант.');
  const current=rackPlan();
  const keys=new Set((current.racks||[]).map(rackKey));
  optimizerPreviewRacks=(v.racks||[]).filter(r=>!keys.has(rackKey(r))).map(r=>({...r}));
  draw();
  if($('projectSaveStatus'))$('projectSaveStatus').textContent=optimizerPreviewRacks.length
    ?`Зелёным показано ${optimizerPreviewRacks.length} дополнительных секций.`
    :'Дополнительных секций относительно текущего плана нет.';
}

function applySelectedVariant(){
  const v=selectedOptimizerVariant();
  if(!v)return alert('Сначала найди и выбери вариант.');
  optimizerPreviewRacks=[];
  state=JSON.parse(JSON.stringify(v.snapshot));
  sanitizeState();migrateSmartZones();migrateV69();
  inputIds.forEach(k=>{if($(k))$(k).value=state[k]});
  if($('layoutMode'))$('layoutMode').value=state.layoutMode;
  selected={kind:null,index:null};
  renderAll();
  if($('projectSaveStatus'))$('projectSaveStatus').textContent=`Применён вариант #${v.rank}.`;
}

function fillStorageToMaximum(){
  if(!optimizerAllCandidates.length)findBestVariants();
  const max=[...optimizerAllCandidates].sort((a,b)=>b.sections-a.sections||a.free-b.free)[0];
  if(!max)return alert('Не удалось подобрать вариант.');
  const before=optimizerCurrentMetrics?.sections??rackPlan().total;
  optimizerPreviewRacks=[];
  state=JSON.parse(JSON.stringify(max.snapshot));
  state.layoutMode='capacity';
  sanitizeState();migrateSmartZones();migrateV69();
  inputIds.forEach(k=>{if($(k))$(k).value=state[k]});
  if($('layoutMode'))$('layoutMode').value=state.layoutMode;
  selected={kind:null,index:null};
  renderAll();
  if($('projectSaveStatus')){
    const delta=max.sections-before;
    $('projectSaveStatus').textContent=delta>0?`Хранение дозаполнено: +${fmt(delta)} секций.`:'Текущий план уже соответствует максимуму.';
  }
}


// ============================================================
// MFC Planner 7.6 — Validation Engine
// Это эвристическая проверка работоспособности планировки.
// Она НЕ является подтверждением нормативного соответствия.
// ============================================================

function validationSignature(){
  const payload={
    roomL:state.roomL,roomW:state.roomW,mezzanineL:state.mezzanineL,mezzanineW:state.mezzanineW,
    rackL:state.rackL,rackD:state.rackD,aisle:state.aisle,
    targetFlow:state.targetFlow,opsPerShift:state.opsPerShift,
    zones:(state.zones||[]).filter(z=>z.name!=='Хранение').map(z=>({
      n:z.name,level:entityLevel(z),x:+z.x.toFixed(2),y:+z.y.toFixed(2),w:+z.w.toFixed(2),h:+z.h.toFixed(2),
      r:z.rotation||0,role:z.zoneRole,bs:z.blocksStorage
    })),
    columns:(state.columns||[]).map(c=>({
      level:entityLevel(c),x:+c.x.toFixed(2),y:+c.y.toFixed(2),w:+c.w.toFixed(2),h:+c.h.toFixed(2)
    })),
    objects:(state.objects||[]).map(o=>({
      n:o.name,k:o.objectKind,level:entityLevel(o),x:+o.x.toFixed(2),y:+o.y.toFixed(2),w:+o.w.toFixed(2),h:+o.h.toFixed(2),
      role:o.zoneRole,bs:o.blocksStorage
    }))
  };
  return JSON.stringify(payload);
}

function entityInsideRoom(o){
  const inside=level=>{
    const d=levelDims(level);
    return o.x>=-1e-6 && o.y>=-1e-6 &&
      o.x+o.w<=d.L+1e-6 &&
      o.y+o.h<=d.W+1e-6;
  };
  return entityLevel(o)==='both'
    ? inside('ground')&&inside('mezzanine')
    : inside(entityLevel(o));
}

function expandAndClampRect(r,m){
  const x=Math.max(0,r.x-m),y=Math.max(0,r.y-m);
  const x2=Math.min(state.roomL,r.x+r.w+m);
  const y2=Math.min(state.roomW,r.y+r.h+m);
  return {x,y,w:Math.max(0,x2-x),h:Math.max(0,y2-y)};
}

function validationWalkableZone(z){
  if(!z)return false;
  if(['Центральный проход','Коридор персонала','Приёмка','Отгрузка','Вход поставщиков','Вход/выход персонала','Эвакуационный выход'].includes(z.name)) return true;
  if(z.zoneRole==='process') return true;
  return false;
}

function validationWalkableObject(o){
  if(!o)return false;
  if(o.objectKind==='door'||o.objectKind==='camera'||o.objectKind==='vertical_link') return true;
  if(o.name==='Дверь'||o.name==='Ручная камера') return true;
  return false;
}

function validationPointBlocked(p,rp){
  if(p.x<0||p.y<0||p.x>state.roomL||p.y>state.roomW)return true;

  for(const r of (rp.racks||[])){
    if(pointInRect(p,r)) return true;
  }
  for(const c of (state.columns||[])){
    if(!onLevel(c,'ground')) continue;
    if(pointInRect(p,c)) return true;
  }

  for(const z of (state.zones||[])){
    if(!onLevel(z,'ground')) continue;
    if(z.name==='Хранение') continue;
    if(validationWalkableZone(z)) continue;
    if(pointInRect(p,z)) return true;
  }

  for(const o of (state.objects||[])){
    if(!onLevel(o,'ground')) continue;
    if(validationWalkableObject(o)) continue;
    if(o.blocksStorage===false && o.type!=='equipment') continue;
    if(pointInRect(p,o)) return true;
  }

  return false;
}

function buildValidationNetwork(rp){
  // 0,4 м достаточно для планировочной оценки и остаётся лёгким для браузера.
  const nominal=.4;
  const nx=Math.max(2,Math.ceil(state.roomL/nominal));
  const ny=Math.max(2,Math.ceil(state.roomW/nominal));
  const dx=state.roomL/nx,dy=state.roomW/ny;
  const N=nx*ny;
  const blocked=new Uint8Array(N);
  const dist=new Float64Array(N);
  dist.fill(-1);

  const idx=(ix,iy)=>iy*nx+ix;
  const point=(ix,iy)=>({x:(ix+.5)*dx,y:(iy+.5)*dy});

  for(let iy=0;iy<ny;iy++){
    for(let ix=0;ix<nx;ix++){
      if(validationPointBlocked(point(ix,iy),rp)) blocked[idx(ix,iy)]=1;
    }
  }

  function nearestWalkable(x,y){
    let cx=clamp(Math.floor(x/dx),0,nx-1);
    let cy=clamp(Math.floor(y/dy),0,ny-1);
    let best=-1,bestD=Infinity;
    for(let radius=0;radius<=5;radius++){
      for(let yy=Math.max(0,cy-radius);yy<=Math.min(ny-1,cy+radius);yy++){
        for(let xx=Math.max(0,cx-radius);xx<=Math.min(nx-1,cx+radius);xx++){
          const i=idx(xx,yy);
          if(blocked[i])continue;
          const p=point(xx,yy),d=(p.x-x)*(p.x-x)+(p.y-y)*(p.y-y);
          if(d<bestD){bestD=d;best=i}
        }
      }
      if(best>=0)return best;
    }
    return -1;
  }

  const seeds=[];
  const seedNames=['Приёмка','Отгрузка','Вход поставщиков','Вход/выход персонала','Эвакуационный выход'];

  (state.zones||[]).forEach(z=>{
    if(!onLevel(z,'ground')) return;
    if(seedNames.includes(z.name) || z.zoneRole==='process'){
      const i=nearestWalkable(z.x+z.w/2,z.y+z.h/2);
      if(i>=0)seeds.push(i);
    }
  });

  (state.objects||[]).forEach(o=>{
    if(!onLevel(o,'ground')) return;
    if(o.objectKind==='door'||o.name==='Дверь'){
      const i=nearestWalkable(o.x+o.w/2,o.y+o.h/2);
      if(i>=0)seeds.push(i);
    }
  });

  // Если входов/процессов нет, используем свободные клетки по периметру.
  if(!seeds.length){
    for(let ix=0;ix<nx;ix++){
      [idx(ix,0),idx(ix,ny-1)].forEach(i=>{if(!blocked[i])seeds.push(i)});
    }
    for(let iy=0;iy<ny;iy++){
      [idx(0,iy),idx(nx-1,iy)].forEach(i=>{if(!blocked[i])seeds.push(i)});
    }
  }

  const q=new Int32Array(N);
  let qh=0,qt=0;

  [...new Set(seeds)].forEach(i=>{
    if(i>=0&&!blocked[i]&&dist[i]<0){
      dist[i]=0;
      q[qt++]=i;
    }
  });

  const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  while(qh<qt){
    const cur=q[qh++];
    const cy=Math.floor(cur/nx),cx=cur-cy*nx;
    for(const [sx,sy] of dirs){
      const xx=cx+sx,yy=cy+sy;
      if(xx<0||yy<0||xx>=nx||yy>=ny)continue;
      const ni=idx(xx,yy);
      if(blocked[ni]||dist[ni]>=0)continue;
      dist[ni]=dist[cur]+(sx?dx:dy);
      q[qt++]=ni;
    }
  }

  function sample(x,y){
    const ix=clamp(Math.floor(x/dx),0,nx-1);
    const iy=clamp(Math.floor(y/dy),0,ny-1);
    const i=idx(ix,iy);
    return {blocked:!!blocked[i],reachable:dist[i]>=0,distance:dist[i],index:i};
  }

  function anyReachableInRect(r){
    const x1=clamp(Math.floor(r.x/dx),0,nx-1);
    const x2=clamp(Math.floor((r.x+r.w)/dx),0,nx-1);
    const y1=clamp(Math.floor(r.y/dy),0,ny-1);
    const y2=clamp(Math.floor((r.y+r.h)/dy),0,ny-1);
    let min=Infinity,count=0;
    for(let iy=y1;iy<=y2;iy++){
      for(let ix=x1;ix<=x2;ix++){
        const i=idx(ix,iy);
        if(!blocked[i]&&dist[i]>=0){
          count++;
          if(dist[i]<min)min=dist[i];
        }
      }
    }
    return {reachable:count>0,distance:Number.isFinite(min)?min:-1,count};
  }

  return {nx,ny,dx,dy,sample,anyReachableInRect};
}

function rackAisleSegments(rp){
  const out=[];
  const tol=Math.max(.08,state.rackL*.18);

  (rp.streets||[]).forEach((street,streetIndex)=>{
    const pairs=[...(street.pairs||[])];
    if(!pairs.length)return;

    const axis=street.orientation==='horizontal'?'x':'y';
    pairs.sort((a,b)=>a[axis]-b[axis]);

    let group=[pairs[0]];
    const flush=()=>{
      if(!group.length)return;
      const first=group[0],last=group[group.length-1];
      let rect,length;

      if(street.orientation==='horizontal'){
        rect={
          x:first.x,
          y:street.y+state.rackD,
          w:(last.x+state.rackL)-first.x,
          h:state.aisle
        };
        length=rect.w;
      }else{
        rect={
          x:street.x+state.rackD,
          y:first.y,
          w:state.aisle,
          h:(last.y+state.rackL)-first.y
        };
        length=rect.h;
      }

      out.push({
        streetIndex,
        orientation:street.orientation,
        rect,
        length,
        sectionPairs:group.length,
        sections:group.length*2
      });
      group=[];
    };

    for(let i=1;i<pairs.length;i++){
      const prev=pairs[i-1][axis];
      const cur=pairs[i][axis];
      if(cur-prev<=state.rackL+tol){
        group.push(pairs[i]);
      }else{
        flush();
        group=[pairs[i]];
      }
    }
    flush();
  });

  return out;
}

function validationEndpointConnections(seg,net){
  const d=Math.max(.25,Math.min(.55,state.aisle*.45));
  let points;

  if(seg.orientation==='horizontal'){
    const cy=seg.rect.y+seg.rect.h/2;
    points=[
      {x:seg.rect.x-d,y:cy},
      {x:seg.rect.x+seg.rect.w+d,y:cy}
    ];
  }else{
    const cx=seg.rect.x+seg.rect.w/2;
    points=[
      {x:cx,y:seg.rect.y-d},
      {x:cx,y:seg.rect.y+seg.rect.h+d}
    ];
  }

  return points.reduce((n,p)=>{
    if(p.x<0||p.y<0||p.x>state.roomL||p.y>state.roomW)return n;
    const s=net.sample(p.x,p.y);
    return n+(!s.blocked&&s.reachable?1:0);
  },0);
}

function validateExitClearance(rp,exitObj,clearance=1){
  const zone=expandAndClampRect(exitObj,clearance);
  const hits=(rp.racks||[]).filter(r=>rectsOverlap(zone,r));
  return {zone,hits:hits.length};
}

function buildValidationReport(){
  const signature=validationSignature();
  const rp=rackPlan();
  const segments=rackAisleSegments(rp);
  const net=buildValidationNetwork(rp);
  const issues=[];
  const overlay=[];

  const push=(severity,title,detail='')=>issues.push({severity,title,detail});

  // 1. Геометрия помещения
  const entities=[
    ...(state.zones||[]).filter(z=>z.name!=='Хранение').map(o=>({kind:'zone',o})),
    ...(state.objects||[]).map(o=>({kind:'object',o})),
    ...(state.columns||[]).map(o=>({kind:'column',o}))
  ];
  const outside=entities.filter(x=>!entityInsideRoom(x.o));
  if(outside.length){
    push('bad','Есть объекты за границей своего уровня',`${outside.length} шт. Нужно вернуть их внутрь контура соответствующего этажа.`);
  }else{
    push('good','Все зоны и объекты находятся внутри контуров своих уровней');
  }
  outside.forEach(x=>{
    overlay.push({...x.o,severity:'bad',label:'За границей уровня',level:entityLevel(x.o)});
  });

  // 2. Межрядный проход
  if(state.aisle<1){
    push('bad','Межрядный проход меньше 1,0 м',`Сейчас ${fmt1(state.aisle)} м. В модели принят планировочный минимум 1,0 м.`);
  }else if(state.aisle<1.2){
    push('warn','Межрядный проход 1,0–1,2 м',`Сейчас ${fmt1(state.aisle)} м. Для модели допустимо, но при интенсивном встречном движении стоит проверить запас.`);
  }else{
    push('good','Ширина межрядного прохода',`${fmt1(state.aisle)} м.`);
  }

  // 3. Центральный проход
  const central=getZone('Центральный проход');
  if(central){
    const thickness=centralIsVertical()?central.w:central.h;
    if(thickness<1.2){
      push('bad','Центральный проход уже 1,2 м',`Сейчас ${fmt1(thickness)} м.`);
    }else{
      push('good','Центральный проход',`${fmt1(thickness)} м.`);
    }

    const centralOrientation=centralIsVertical()?'vertical':'horizontal';
    if(rp.total>0 && centralOrientation===rp.orientation){
      push('bad','ЦП идёт параллельно стеллажным улицам','Он не выполняет роль поперечного связующего прохода. Лучше развернуть ЦП на 90°.');
    }else if(rp.total>0){
      push('good','ЦП пересекает направление улиц','Ориентация ЦП перпендикулярна стеллажным улицам.');
    }
  }else{
    const longest=segments.length?Math.max(...segments.map(s=>s.length)):0;
    if(longest>12){
      push('warn','Центральный проход отсутствует',`Есть улицы длиной до ${fmt1(longest)} м. Для рабочего проекта стоит проверить необходимость поперечного прохода.`);
    }else{
      push('info','Центральный проход отсутствует','Для режима «Максимум хранения» это допустимый планировочный сценарий.');
    }
  }

  // 4. Доступность улиц
  // Storage Accessibility Engine уже исключает участки, у которых нет входа
  // в рабочий проход ни с одного конца.
  if((rp.rejectedSections||0)>0){
    push('warn','Недоступные секции автоматически исключены',
      `${rp.rejectedSections} секций не вошли в вместимость, потому что к их рабочему проходу нельзя подойти.`);
  }else{
    push('good','Недоступных секций Storage Engine не обнаружил');
  }

  let accessible=0,inaccessible=0,deadEnds=0,twoWay=0;
  const distances=[];
  let longestSegment=0;

  segments.forEach((seg,i)=>{
    longestSegment=Math.max(longestSegment,seg.length);
    const access=net.anyReachableInRect(seg.rect);
    const connections=validationEndpointConnections(seg,net);

    if(access.reachable){
      accessible++;
      if(access.distance>=0)distances.push(access.distance);

      if(connections>=2){
        twoWay++;
      }else if(connections===1){
        deadEnds++;
        overlay.push({...seg.rect,severity:'warn',label:`Тупик ${i+1}`});
      }else{
        // Маршрут мог войти через разрыв в боковой части улицы.
        // Считаем доступным, но требующим внимания.
        deadEnds++;
        overlay.push({...seg.rect,severity:'warn',label:`Один доступ ${i+1}`});
      }
    }else{
      inaccessible++;
      overlay.push({...seg.rect,severity:'bad',label:`Нет доступа ${i+1}`});
    }
  });

  if(!segments.length){
    push('bad','Стеллажные улицы не сформированы','Проверь размеры помещения, зоны и параметры стеллажей.');
  }else if(inaccessible){
    push('bad','Есть недоступные участки стеллажных улиц',`${inaccessible} из ${segments.length} участков не имеют маршрута от входов/процессных зон.`);
  }else{
    push('good','Все участки улиц доступны',`${accessible} из ${segments.length}.`);
  }

  if(deadEnds){
    push('warn','Есть тупиковые участки',`${deadEnds} из ${segments.length}. Для интенсивного потока лучше иметь второй выход или связь с поперечным проходом.`);
  }else if(segments.length){
    push('good','Тупиков по модели не обнаружено',`${twoWay} участков имеют два конца, связанные с доступной сетью.`);
  }

  if(longestSegment>15){
    push('warn','Есть длинные непрерывные улицы',`Максимальный участок ${fmt1(longestSegment)} м. Проверь необходимость дополнительной поперечной связи.`);
  }else if(longestSegment>0){
    push('info','Максимальная длина участка улицы',`${fmt1(longestSegment)} м.`);
  }

  // 5. Маршруты
  const avgRoute=distances.length?distances.reduce((s,x)=>s+x,0)/distances.length:0;
  const maxRoute=distances.length?Math.max(...distances):0;
  if(distances.length){
    if(maxRoute>25){
      push('warn','Длинный маршрут до части хранения',`Оценочно до ${fmt1(maxRoute)} м по сетке проходов; средний ${fmt1(avgRoute)} м.`);
    }else{
      push('info','Маршрут до хранения',`Средний ${fmt1(avgRoute)} м, максимальный ${fmt1(maxRoute)} м по планировочной сетке.`);
    }
  }

  // 6. Эвакуационный / обычные выходы — только геометрическая проверка буфера
  const evac=[
    ...(state.zones||[]).filter(z=>z.name==='Эвакуационный выход'&&onLevel(z,'ground')),
    ...(state.objects||[]).filter(o=>onLevel(o,'ground')&&String(o.name||'').toLowerCase().includes('эвакуац'))
  ];

  if(!evac.length){
    push('bad','На плане нет эвакуационного выхода','Добавь отдельный выход/маркер. Это только геометрическая проверка, не нормативная экспертиза.');
  }else{
    let blockedEvac=0;
    evac.forEach(e=>{
      const c=validateExitClearance(rp,e,1);
      blockedEvac+=c.hits;
      if(c.hits)overlay.push({...c.zone,severity:'bad',label:'Буфер выхода'});
    });
    if(blockedEvac){
      push('bad','Стеллажи попадают в 1 м планировочного буфера эвакуационного выхода',`${blockedEvac} пересечений. Освободи пространство около выхода.`);
    }else{
      push('good','Планировочный буфер эвакуационного выхода свободен','В радиусе около 1 м стеллажи не обнаружены.');
    }
  }

  // 7. Входы / двери
  const accessMarkers=[
    ...(state.zones||[]).filter(z=>onLevel(z,'ground')&&['Вход поставщиков','Вход/выход персонала'].includes(z.name)),
    ...(state.objects||[]).filter(o=>onLevel(o,'ground')&&(o.objectKind==='door'||o.name==='Дверь'))
  ];
  if(!accessMarkers.length){
    push('warn','Нет отдельных входов/дверей','Маршрутная модель использует процессные зоны как точки доступа.');
  }else{
    let blocked=0;
    accessMarkers.forEach(e=>{
      const c=validateExitClearance(rp,e,.6);
      blocked+=c.hits;
      if(c.hits)overlay.push({...c.zone,severity:'warn',label:'Буфер двери'});
    });
    if(blocked)push('warn','Есть стеллажи слишком близко к входам/дверям',`${blocked} пересечений с планировочным буфером 0,6 м.`);
    else push('good','Подходы к входам/дверям по геометрии свободны');
  }

  // 8. Связь уровней
  const picking=(state.zones||[]).find(z=>z.name==='Сборка');
  const mezzProcesses=[
    ...(state.zones||[]).filter(z=>onLevel(z,'mezzanine')&&z.type==='process'),
    ...(state.objects||[]).filter(o=>onLevel(o,'mezzanine')&&o.type==='process')
  ];
  const verticalLinks=(state.objects||[]).filter(o=>o.objectKind==='vertical_link');

  if(picking&&entityLevel(picking)==='mezzanine'){
    push('good','Сборка вынесена на этаж',`${fmt1(area(picking))} м² процессной зоны не занимают площадь хранения 1 этажа.`);
  }else if(picking){
    push('warn','Сборка находится на 1 этаже',`Она занимает ${fmt1(area(picking))} м² и может уменьшать доступную площадь хранения.`);
  }else{
    push('warn','Зона сборки не задана','Производительность сборки учитывается в потоке, но геометрическая зона отсутствует.');
  }

  if(mezzProcesses.length && !verticalLinks.length){
    push('warn','Нет вертикальной связи с этажом','Добавь «Лестница / подъёмник» через библиотеку объектов, чтобы зафиксировать связь уровней.');
  }else if(mezzProcesses.length){
    push('good','Вертикальная связь уровней задана',`${verticalLinks.length} объект(а) лестницы / подъёмника.`);
  }
  if(mezzProcesses.length){
    push('info','Эвакуация этажа не подтверждается этой моделью','Validation Engine показывает геометрию и связь уровней, но не рассчитывает обязательные нормативные пути эвакуации этажа.');
  }

  // 9. Сквозной поток персонала
  const pm=processModel(state.targetFlow);
  if(pm.util>1){
    push('bad','Целевой поток выше мощности текущего состава',`${fmt(state.targetFlow)} ШК/мес против расчётной мощности ${fmt(pm.maxMonthly)} ШК/мес.`);
  }else if(pm.util>.9){
    push('warn','Целевой поток близок к пределу команды',`Расчётная загрузка ${fmt1(pm.util*100)}%.`);
  }else{
    push('good','Целевой поток проходит по текущему составу',`Расчётная загрузка ${fmt1(pm.util*100)}%.`);
  }

  // 10. Масштабирование персонала относительно фактической вместимости.
  const validationCapacity=capacityFromRackPlan(rp);
  const scale=staffingScaleModel(validationCapacity,state.roomL*state.roomW);
  if(scale.addedOperatorPositions>0){
    push('warn','Площадь и хранение требуют увеличения операторского штата',
      `При ${fmt1(scale.turnover)} оборота/мес нужно ${scale.recommendedPerShift} операторов в смену. Добавить ${scale.addPerShift} в смену, всего +${scale.addedOperatorPositions} операторов.`);
  }else{
    push('good','Операторского состава хватает для выбранного оборота',
      `${fmt(scale.plannedFlow)} ШК/мес при ${fmt1(scale.turnover)} оборота/мес.`);
  }

  const bad=issues.filter(x=>x.severity==='bad').length;
  const warn=issues.filter(x=>x.severity==='warn').length;
  const score=clamp(Math.round(100-bad*17-warn*6),0,100);

  let status='рабочая';
  if(score<65)status='требует переработки';
  else if(score<85)status='с корректировками';

  return {
    signature,
    score,status,
    issues,
    overlay,
    metrics:{
      segments:segments.length,
      accessible,
      inaccessible,
      deadEnds,
      twoWay,
      avgRoute,
      maxRoute,
      longestSegment,
      sections:rp.total,
      streets:rp.streetCount||0
    }
  };
}

function validationIsCurrent(){
  return !!validationReport && validationReport.signature===validationSignature();
}

function renderValidationPanels(){
  const badge=$('validationBadge');
  const stats=$('validationStats');
  const note=$('validationNote');
  const hero=$('mValidation');
  const tab=$('tab-checks');

  if(!validationReport){
    if(badge){badge.className='validation-badge neutral';badge.textContent='не проверен'}
    if(hero)hero.textContent='—';
    if(stats)stats.innerHTML='<div><span>Улицы</span><b>—</b></div><div><span>Тупики</span><b>—</b></div><div><span>Маршрут</span><b>—</b></div>';
    if(tab)tab.innerHTML='<div class="warnbox info">Нажми «Проверить жизнеспособность». Validation Engine проверит доступность улиц, тупики, ЦП, буферы выходов и маршрутную связность.</div>';
    return;
  }

  const current=validationIsCurrent();
  const r=validationReport;
  const cls=r.score>=85?'good':r.score>=65?'warn':'bad';

  if(badge){
    badge.className=`validation-badge ${current?cls:'neutral'}`;
    badge.textContent=current?`${r.score}/100`:'план изменён';
  }

  if(hero)hero.textContent=current?`${r.score}/100`:'перепроверь';

  if(stats){
    stats.innerHTML=`
      <div><span>Доступно улиц</span><b>${r.metrics.accessible}/${r.metrics.segments}</b></div>
      <div><span>Тупики</span><b>${r.metrics.deadEnds}</b></div>
      <div><span>Макс. маршрут</span><b>${fmt1(r.metrics.maxRoute)} м</b></div>
    `;
  }

  if(note){
    note.textContent=current
      ? `Статус: ${r.status}. Score — эвристическая планировочная оценка, не нормативное заключение.`
      : 'План изменён после последней проверки. Запусти Validation Engine повторно.';
  }

  if(tab){
    const summary=`<div class="validation-summary">
      <div><span>Score</span><b>${r.score}/100</b></div>
      <div><span>Статус</span><b>${r.status}</b></div>
      <div><span>Участков улиц</span><b>${r.metrics.segments}</b></div>
      <div><span>Недоступно</span><b>${r.metrics.inaccessible}</b></div>
      <div><span>Тупики</span><b>${r.metrics.deadEnds}</b></div>
      <div><span>Макс. маршрут</span><b>${fmt1(r.metrics.maxRoute)} м</b></div>
    </div>`;

    const issueHtml=r.issues.map(x=>`
      <div class="warnbox ${x.severity==='warn'?'warn':x.severity}">
        <b>${x.title}</b>${x.detail?`<div class="validation-detail">${x.detail}</div>`:''}
      </div>`).join('');

    tab.innerHTML=summary+
      (!current?'<div class="warnbox warn"><b>Результат устарел</b><div class="validation-detail">Планировка изменилась после проверки.</div></div>':'')+
      issueHtml+
      '<div class="warnbox info"><b>Важно</b><div class="validation-detail">Проверки ширины, выходов и маршрутов здесь являются проектными эвристиками. Для реального объекта нормативные требования нужно проверять отдельно.</div></div>';
  }
}

function runValidation(){
  validationReport=buildValidationReport();
  validationOverlayRects=validationReport.overlay||[];
  renderValidationPanels();
  draw();
}



// ============================================================
// MFC Planner 8.3 — Floors + Reports
// ============================================================
function floor2HasStorage(){return state.floor2Enabled&&(state.floor2Mode==='storage'||state.floor2Mode==='mixed');}
function floor2HasProcesses(){return state.floor2Enabled&&(state.floor2Mode==='process'||state.floor2Mode==='mixed');}
function emptyRackPlan83(){return {orientation:'horizontal',total:0,accessibleSections:0,rejectedSections:0,racks:[],aisles:[],streets:[],streetCount:0,aisleCount:0,deadEndAisles:0,streetWidth:0,rackArea:0};}
function rackPlanForLevel83(level){
  if(level==='ground')return rackPlan();
  if(level!=='mezzanine'||!floor2HasStorage())return emptyRackPlan83();
  ensureFloor2StorageAccess83();
  const oldL=state.roomL,oldW=state.roomW,oldA=state.activeLevel;
  const all=[...(state.zones||[]),...(state.objects||[]),...(state.columns||[])];const levels=all.map(o=>o.level);
  try{
    state.roomL=state.mezzanineL;state.roomW=state.mezzanineW;state.activeLevel='ground';
    all.forEach(o=>{if(o.level==='mezzanine'||o.level==='both')o.level='ground';else if(o.level==='ground')o.level='__floor1_hidden__';});
    return freeRackPlan();
  }finally{all.forEach((o,i)=>o.level=levels[i]);state.roomL=oldL;state.roomW=oldW;state.activeLevel=oldA;}
}
const analytics82=analytics;
analytics=function(){
  const a=analytics82();
  const rp2=floor2HasStorage()?rackPlanForLevel83('mezzanine'):emptyRackPlan83();
  const totalSections=(a.rp?.total||0)+(rp2.total||0);
  const vol=totalSections*state.rackL*state.rackD*state.rackH;
  const cap100=vol*1000/Math.max(.1,Number(state.avgSkuL)||.1);const cap=cap100*state.fillPct/100;
  const floor2Area=state.floor2Enabled?state.mezzanineL*state.mezzanineW:0;
  const scaling=staffingScaleModel(cap,a.groundArea+floor2Area);
  const rackArea=(a.rp?.rackArea||0)+(rp2.rackArea||0);
  return {...a,rp2,totalSections,totalStreets:(a.rp?.streetCount||0)+(rp2.streetCount||0),totalAisles:(a.rp?.aisleCount||0)+(rp2.aisleCount||0),vol,cap100,cap,scaling,mezzanineArea:floor2Area,totalOperationalArea:a.groundArea+floor2Area,rackUsedArea:rackArea,rackFootprint:rackArea,groundRackArea:a.rp?.rackArea||0,floor2RackArea:rp2.rackArea||0};
};
const draw82=draw;
draw=function(){
  draw82();
  if(state.activeLevel!=='mezzanine'||!floor2HasStorage())return;
  const svg=$('plan'),plan=rackPlanForLevel83('mezzanine'),dims=levelDims('mezzanine');
  const W=940,H=520,sc=Math.min(W/dims.L,H/dims.W),ox=(1000-dims.L*sc)/2,oy=(590-dims.W*sc)/2,ns='http://www.w3.org/2000/svg';
  const before=svg.querySelector('.obj')||null;
  const add=(attrs,cls)=>{const e=document.createElementNS(ns,'rect');for(const k in attrs)e.setAttribute(k,attrs[k]);e.setAttribute('class',cls);svg.insertBefore(e,before);};
  (plan.aisles||[]).forEach(ai=>add({x:ox+ai.x*sc,y:oy+ai.y*sc,width:Math.max(2,ai.w*sc),height:Math.max(2,ai.h*sc)},ai.deadEnd?'workingAisle deadEndAisle':'workingAisle'));
  (plan.racks||[]).forEach(r=>add({x:ox+r.x*sc+1,y:oy+r.y*sc+1,width:Math.max(2,r.w*sc-2),height:Math.max(2,r.h*sc-2)},'rack'));
};
const renderTabs82=renderTabs;
renderTabs=function(){
  renderTabs82();const a=analytics();
  if($('mStorageArea'))$('mStorageArea').textContent=fmt1(a.rackUsedArea)+' м²';
  if($('mCapacity'))$('mCapacity').textContent=fmt(a.cap)+' ШК';
  if($('mScaledFlow'))$('mScaledFlow').textContent=fmt(a.scaling.plannedFlow)+' ШК/мес';
  if($('mAddStaff'))$('mAddStaff').textContent=a.scaling.addedOperatorPositions?`+${fmt(a.scaling.addedOperatorPositions)} чел.`:'0';
  if(state.activeLevel==='mezzanine')$('layoutSummary').textContent=`Этаж 2 · ${fmt1(a.mezzanineArea)} м² · ${state.floor2Mode==='process'?'только процессы':state.floor2Mode==='storage'?'хранение':'смешанный'} · улиц ${a.rp2.streetCount||0} · секций ${a.rp2.total||0} · стеллажи ${fmt1(a.rp2.rackArea||0)} м²`;
  if($('tab-levels')){
    const cap1=(a.rp.total||0)*state.rackL*state.rackD*state.rackH*1000/Math.max(.1,state.avgSkuL)*state.fillPct/100;
    const cap2=(a.rp2.total||0)*state.rackL*state.rackD*state.rackH*1000/Math.max(.1,state.avgSkuL)*state.fillPct/100;
    $('tab-levels').innerHTML=`<div class="cards3">${metric('Этаж 1',fmt1(a.groundArea)+' м²',`${fmt(a.rp.total)} секций`)}${metric('Этаж 2',state.floor2Enabled?fmt1(a.mezzanineArea)+' м²':'не добавлен',state.floor2Enabled?(state.floor2Mode==='process'?'процессы':state.floor2Mode==='storage'?'хранение':'смешанный'):'добавляется отдельно')}${metric('Итого хранение',fmt1(a.rackUsedArea)+' м²',fmt(a.cap)+' ШК')}</div><table class="tbl"><tr><th>Этаж</th><th>Назначение</th><th>Секции</th><th>Вместимость</th></tr><tr><td>Этаж 1</td><td>смешанный</td><td>${fmt(a.rp.total)}</td><td>${fmt(cap1)} ШК</td></tr>${state.floor2Enabled?`<tr><td>Этаж 2</td><td>${state.floor2Mode==='process'?'процессы':state.floor2Mode==='storage'?'хранение':'смешанный'}</td><td>${fmt(a.rp2.total)}</td><td>${fmt(cap2)} ШК</td></tr>`:''}<tr><td><b>Итого</b></td><td></td><td><b>${fmt(a.totalSections)}</b></td><td><b>${fmt(a.cap)} ШК</b></td></tr></table>`;
  }
};
const renderLevelControls82=renderLevelControls;
renderLevelControls=function(){
  renderLevelControls82();
  document.querySelectorAll('[data-level-switch="mezzanine"]').forEach(b=>b.classList.toggle('hidden',!state.floor2Enabled));
  if($('floor2Settings'))$('floor2Settings').classList.toggle('hidden',!state.floor2Enabled);
  if($('addFloorBtn'))$('addFloorBtn').classList.toggle('hidden',state.floor2Enabled);
  if($('removeFloorBtn'))$('removeFloorBtn').classList.toggle('hidden',!state.floor2Enabled);
  if($('floor2Mode'))$('floor2Mode').value=state.floor2Mode;
};
const switchLevel82=switchLevel;
switchLevel=function(level){if(level==='mezzanine'&&!state.floor2Enabled)return;switchLevel82(level);};
function ensureFloor2StorageAccess83(){
  if(!floor2HasStorage())return;
  let cp=(state.zones||[]).find(z=>z.level==='mezzanine'&&z.name==='Центральный проход');
  if(cp)return;
  const w=Math.max(1.0,Math.min(2.2,Number(state.centralAisle)||1.6));
  state.zones.push({name:'Центральный проход',type:'service',zoneRole:'service',level:'mezzanine',x:Math.max(0,state.mezzanineL/2-w/2),y:0,w,h:state.mezzanineW,rotation:90,affectsCapacity:true,blocksStorage:true,affectsFlow:true,needsCamera:false});
}
function addFloor2(){
  if(state.floor2Enabled)return;
  state.floor2Enabled=true;
  state.floor2Mode='process';
  state.mezzanineL=Math.max(2,Number(state.mezzanineL)||state.roomL);
  state.mezzanineW=Math.max(2,Number(state.mezzanineW)||state.roomW);
  state.activeLevel='mezzanine';
  selected={kind:null,index:null};
  renderAll();
}
function removeFloor2(){
  if(!state.floor2Enabled)return;const count=[...(state.zones||[]),...(state.objects||[]),...(state.columns||[])].filter(o=>o?.level==='mezzanine').length;
  if(!confirm(`Удалить этаж 2? Объекты этажа будут удалены (${count} шт.).`))return;
  state.zones=(state.zones||[]).filter(o=>o.level!=='mezzanine');state.objects=(state.objects||[]).filter(o=>o.level!=='mezzanine');state.columns=(state.columns||[]).filter(o=>o.level!=='mezzanine');state.floor2Enabled=false;state.floor2Mode='process';state.activeLevel='ground';selected={kind:null,index:null};renderAll();
}
function safeFileName83(name){return String(name||'MFC-Plan').replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,' ').trim().slice(0,90)||'MFC-Plan';}
function reportProjectName83(){const p=(typeof currentProjectList==='function'?currentProjectList():[]).find(x=>String(x.id)===String(currentProjectId));return p?.name||$('currentProjectName')?.textContent||`MFC ${fmt1(state.roomL*state.roomW)} м²`;}
function downloadBlob83(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1200);}
function inlineSvg83(){const svg=$('plan'),clone=svg.cloneNode(true),src=[svg,...svg.querySelectorAll('*')],dst=[clone,...clone.querySelectorAll('*')],props=['fill','stroke','stroke-width','stroke-dasharray','opacity','font-family','font-size','font-weight'];src.forEach((el,i)=>{if(!dst[i])return;const cs=getComputedStyle(el);dst[i].setAttribute('style',props.map(p=>`${p}:${cs.getPropertyValue(p)}`).join(';'));});clone.setAttribute('xmlns','http://www.w3.org/2000/svg');return new XMLSerializer().serializeToString(clone);}
function captureFloorSvg83(level){const old=state.activeLevel;if(level==='mezzanine'&&!state.floor2Enabled)return '';state.activeLevel=level;draw();const s=inlineSvg83();state.activeLevel=old;draw();return s;}
function htmlEsc83(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function reportRows83(){const a=analytics(),s=a.scaling;return {summary:[['Площадь этажа 1, м²',a.groundArea],['Площадь этажа 2, м²',a.mezzanineArea],['Площадь стеллажей, м²',a.rackUsedArea],['Секции',a.totalSections],['Рабочая вместимость, ШК',a.cap],['Поток от вместимости, ШК/мес',s.plannedFlow],['Добавить операторов',s.addedOperatorPositions],['ФОТ после масштабирования, ₽',s.afterAddFOT],['OPEX после масштабирования, ₽',s.afterAddOpex]],floors:[['Этаж 1','смешанный',a.groundArea,a.rp.total,a.groundRackArea],...(state.floor2Enabled?[['Этаж 2',state.floor2Mode,a.mezzanineArea,a.rp2.total,a.floor2RackArea]]:[])],storage:[['Длина секции, м',state.rackL],['Глубина, м',state.rackD],['Высота, м',state.rackH],['Проход, м',state.aisle],['Заполнение, %',state.fillPct],['Секции этаж 1',a.rp.total],['Секции этаж 2',a.rp2.total]],process:[['Приёмка',state.normAccept],['Раскладка',state.normPutaway],['Сборка',state.normPick],['Отгрузка',state.normShip]],staff:[['Операторы / смену',state.opsPerShift],['Смен / сутки',state.shiftsPerDay],['Старшие',state.seniors],['Руководители',state.managers]],finance:[['Аренда, ₽/мес',state.rent],['CAPEX, ₽',state.capex],['ФОТ текущий, ₽',s.currentFOT],['ФОТ после, ₽',s.afterAddFOT],['OPEX после, ₽',s.afterAddOpex]]};}
function buildReportHtml(){const a=analytics(),s=a.scaling,name=reportProjectName83(),svg1=captureFloorSvg83('ground'),svg2=state.floor2Enabled?captureFloorSvg83('mezzanine'):'';const checks=validationIsCurrent()?validationReport.issues.map(x=>`<li class="${x.severity}">${htmlEsc83(x.title)}${x.detail?' — '+htmlEsc83(x.detail):''}</li>`).join(''):'<li>Validation Engine не запускался после последних изменений.</li>';return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEsc83(name)}</title><style>@page{size:A4 landscape;margin:11mm}*{box-sizing:border-box}body{font-family:Arial;color:#281b31}h1,h2{color:#552879}.meta{color:#766b7d;font-size:11px}.page{break-after:page}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.kpi{border:1px solid #e4d9ea;border-radius:10px;padding:10px}.kpi span{font-size:10px;color:#7d7184}.kpi b{display:block;font-size:18px;color:#5a2a80}.plan svg{width:100%;max-height:155mm}.tbl{border-collapse:collapse;width:100%;font-size:11px}.tbl th,.tbl td{border:1px solid #e4dce8;padding:6px;text-align:left}.tbl th{background:#f3edf7}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.bad{color:#a12f49}.warn{color:#986719}.good{color:#27733b}</style></head><body><section class="page"><h1>MFC Planner — ${htmlEsc83(name)}</h1><div class="meta">${new Date().toLocaleString('ru-RU')} · версия 8.3</div><div class="kpis"><div class="kpi"><span>Общая площадь</span><b>${fmt1(a.totalOperationalArea)} м²</b></div><div class="kpi"><span>Стеллажи</span><b>${fmt1(a.rackUsedArea)} м²</b></div><div class="kpi"><span>Вместимость</span><b>${fmt(a.cap)} ШК</b></div><div class="kpi"><span>Поток</span><b>${fmt(s.plannedFlow)} ШК/мес</b></div></div><h2>Сводка</h2><table class="tbl"><tr><th>Показатель</th><th>Значение</th></tr><tr><td>Этажей</td><td>${state.floor2Enabled?2:1}</td></tr><tr><td>Рекомендованный сценарий этажей</td><td>${mfVariants.length?htmlEsc83(mfVariants[0].title):'не рассчитывался'}</td></tr><tr><td>Секции</td><td>${fmt(a.totalSections)}</td></tr><tr><td>Добавить операторов</td><td>${fmt(s.addedOperatorPositions)}</td></tr><tr><td>ФОТ после масштабирования</td><td>${money(s.afterAddFOT)}</td></tr><tr><td>OPEX после масштабирования</td><td>${money(s.afterAddOpex)}</td></tr></table></section><section class="page plan"><h2>Этаж 1 — план</h2>${svg1}</section>${state.floor2Enabled?`<section class="page plan"><h2>Этаж 2 — план</h2>${svg2}</section>`:''}<section><div class="two"><div><h2>Хранение</h2><table class="tbl"><tr><th>Показатель</th><th>Значение</th></tr><tr><td>Секции этаж 1</td><td>${fmt(a.rp.total)}</td></tr><tr><td>Секции этаж 2</td><td>${fmt(a.rp2.total)}</td></tr><tr><td>Рабочая вместимость</td><td>${fmt(a.cap)} ШК</td></tr><tr><td>Заполнение</td><td>${fmt1(state.fillPct)}%</td></tr></table></div><div><h2>Персонал</h2><table class="tbl"><tr><th>Показатель</th><th>Значение</th></tr><tr><td>Плановый поток</td><td>${fmt(s.plannedFlow)} ШК/мес</td></tr><tr><td>Текущая мощность</td><td>${fmt(s.currentMax)} ШК/мес</td></tr><tr><td>Рекомендуемые операторы</td><td>${s.recommendedPerShift} / смену</td></tr><tr><td>Добавить</td><td>${fmt(s.addedOperatorPositions)}</td></tr></table></div></div><h2>Проверка</h2><ul>${checks}</ul></section></body></html>`;}
function exportProjectPdf(){const w=window.open('','_blank');if(!w)return alert('Разреши всплывающие окна для формирования PDF.');w.document.open();w.document.write(buildReportHtml());w.document.close();setTimeout(()=>{w.focus();w.print();},300);}
function excelEsc83(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function excelSheet83(name,headers,rows){return `<Worksheet ss:Name="${excelEsc83(name)}"><Table>${[headers,...rows].map(row=>'<Row>'+row.map(v=>{const num=typeof v==='number'&&Number.isFinite(v);return `<Cell><Data ss:Type="${num?'Number':'String'}">${excelEsc83(v)}</Data></Cell>`}).join('')+'</Row>').join('')}</Table></Worksheet>`;}
function buildExcelXml(){const r=reportRows83();return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${excelSheet83('Сводка',['Показатель','Значение'],r.summary)}${excelSheet83('Этажи',['Этаж','Назначение','Площадь м2','Секции','Стеллажи м2'],r.floors)}${excelSheet83('Хранение',['Показатель','Значение'],r.storage)}${excelSheet83('Процессы',['Операция','Норма ШК/смену'],r.process)}${excelSheet83('Персонал',['Показатель','Значение'],r.staff)}${excelSheet83('Экономика',['Показатель','Значение'],r.finance)}</Workbook>`;}
function exportProjectExcel(){downloadBlob83(new Blob(['\ufeff'+buildExcelXml()],{type:'application/vnd.ms-excel;charset=utf-8'}),`${safeFileName83(reportProjectName83())}-расчёты.xls`);}
function exportPlanPng(){const svgText=inlineSvg83(),url=URL.createObjectURL(new Blob([svgText],{type:'image/svg+xml;charset=utf-8'})),img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=2000;c.height=1180;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);c.toBlob(b=>downloadBlob83(b,`${safeFileName83(reportProjectName83())}-${levelTitle()}.png`),'image/png');};img.onerror=()=>{URL.revokeObjectURL(url);alert('Не удалось сформировать PNG.');};img.src=url;}

// ============================================================
// MFC Planner 8.4 — Multi-floor Optimizer
// ============================================================
let mfVariants=[];
let mfLastGoal='';

function floorModeTitle84(mode){
  return mode==='process'?'Этаж 2: процессы':mode==='storage'?'Этаж 2: хранение':'Этаж 2: смешанный';
}
function verticalProcessPenalty84(mode){
  const process2=(state.zones||[]).filter(z=>z.level==='mezzanine'&&z.type==='process').length+
    (state.objects||[]).filter(o=>o.level==='mezzanine'&&o.type==='process').length;
  if(mode==='storage')return process2*4;
  if(mode==='mixed')return process2*2;
  return process2>0?process2:1;
}
function evaluateFloorScenario84(mode){
  const backup={
    floor2Enabled:state.floor2Enabled,
    floor2Mode:state.floor2Mode,
    zones:JSON.parse(JSON.stringify(state.zones||[])),
    objects:JSON.parse(JSON.stringify(state.objects||[])),
    columns:JSON.parse(JSON.stringify(state.columns||[]))
  };
  try{
    state.floor2Enabled=true;
    state.floor2Mode=mode;
    if(mode==='storage'||mode==='mixed')ensureFloor2StorageAccess83();
    const a=analytics(),s=a.scaling;
    return {
      mode,title:floorModeTitle84(mode),
      totalSections:a.totalSections,capacity:a.cap,rackArea:a.rackUsedArea,
      floor1Sections:a.rp.total||0,floor2Sections:a.rp2.total||0,
      plannedFlow:s.plannedFlow,requiredOps:s.recommendedPerShift,
      addOps:s.addedOperatorPositions,opex:s.afterAddOpex,fot:s.afterAddFOT,
      routePenalty:verticalProcessPenalty84(mode)
    };
  }finally{
    state.floor2Enabled=backup.floor2Enabled;
    state.floor2Mode=backup.floor2Mode;
    state.zones=backup.zones;state.objects=backup.objects;state.columns=backup.columns;
  }
}
function scoreFloorVariant84(v,goal,n){
  const cap=v.capacity/Math.max(1,n.maxCap);
  const sec=v.totalSections/Math.max(1,n.maxSections);
  const staff=1-(v.requiredOps-1)/Math.max(1,n.maxOps-1);
  const route=1-Math.min(1,v.routePenalty/Math.max(1,n.maxRoute));
  if(goal==='capacity')return cap*65+sec*25+route*10;
  if(goal==='staff')return staff*55+route*25+cap*20;
  return cap*40+staff*25+route*25+sec*10;
}
function runMultiFloorOptimizer84(){
  if(!state.floor2Enabled){alert('Сначала добавь этаж 2.');return;}
  const goal=$('mfGoal')?.value||state.mfGoal||'balanced';
  state.mfGoal=goal;mfLastGoal=goal;
  const candidates=['process','storage','mixed'].map(evaluateFloorScenario84);
  const n={
    maxCap:Math.max(...candidates.map(v=>v.capacity),1),
    maxSections:Math.max(...candidates.map(v=>v.totalSections),1),
    maxOps:Math.max(...candidates.map(v=>v.requiredOps),1),
    maxRoute:Math.max(...candidates.map(v=>v.routePenalty),1)
  };
  candidates.forEach(v=>v.score=scoreFloorVariant84(v,goal,n));
  mfVariants=candidates.sort((a,b)=>b.score-a.score||b.capacity-a.capacity);
  renderMultiFloorOptimizer84();renderTabs();
}
function renderMultiFloorOptimizer84(){
  if($('mfGoal'))$('mfGoal').value=state.mfGoal||'balanced';
  const sel=$('mfVariantSelect'),box=$('mfVariantDetails'),badge=$('mfOptimizerBadge'),hero=$('mFloorStrategy');
  if(!mfVariants.length){
    if(sel)sel.innerHTML='<option value="">Сначала запусти сравнение</option>';
    if(box)box.innerHTML='<div class="hint">Сравним три сценария использования этажа 2.</div>';
    if(badge)badge.textContent='сценарии этажей';
    if(hero)hero.textContent=state.floor2Enabled?(state.floor2Mode==='process'?'процессы':state.floor2Mode==='storage'?'хранение':'смешанный'):'1 этаж';
    return;
  }
  if(sel){
    const old=sel.value;
    sel.innerHTML=mfVariants.map((v,i)=>`<option value="${i}">#${i+1} · ${v.title} · ${fmt(v.capacity)} ШК</option>`).join('');
    sel.value=mfVariants[Number(old)]?old:'0';
  }
  const v=mfVariants[Number(sel?.value||0)]||mfVariants[0];
  if(badge)badge.textContent=`лучший score ${fmt1(mfVariants[0].score)}/100`;
  if(hero)hero.textContent=v.mode==='process'?'процессы':v.mode==='storage'?'хранение':'смешанный';
  if(box)box.innerHTML=`<div class="mf-kpis">
    <div><span>Score</span><b>${fmt1(v.score)}/100</b></div>
    <div><span>Секции</span><b>${fmt(v.totalSections)}</b></div>
    <div><span>Вместимость</span><b>${fmt(v.capacity)} ШК</b></div>
    <div><span>Операторы</span><b>${fmt(v.requiredOps)} / смену</b></div>
    <div><span>Поток</span><b>${fmt(v.plannedFlow)} ШК/мес</b></div>
    <div><span>OPEX</span><b>${money(v.opex)}</b></div>
  </div><div class="hint">${v.title} · этаж 1: ${fmt(v.floor1Sections)} секций · этаж 2: ${fmt(v.floor2Sections)} секций · вертикальный штраф ${fmt1(v.routePenalty)}</div>`;
}
function applyMultiFloorVariant84(){
  const v=mfVariants[Number($('mfVariantSelect')?.value)];
  if(!v){alert('Сначала запусти сравнение вариантов.');return;}
  state.floor2Enabled=true;state.floor2Mode=v.mode;
  if(v.mode==='storage'||v.mode==='mixed')ensureFloor2StorageAccess83();
  if($('floor2Mode'))$('floor2Mode').value=state.floor2Mode;
  renderAll();
  if($('projectSaveStatus'))$('projectSaveStatus').textContent=`Применён сценарий: ${v.title}.`;
}
const inputIds=['roomL','roomW','roomH','mezzanineL','mezzanineW','avgSkuL','targetFlow','simFlow','centralAisle','rackL','rackD','rackH','shelves','aisle','fillPct','normAccept','normPutaway','normPick','normShip','opsPerShift','shiftsPerDay','paidHours','opRate','seniors','seniorSalary','managers','managerSalary','turnoverRate','staffingTargetUtil','cameraRange','coverageStep','sideWallGap'];
inputIds.forEach(id=>{const el=$(id);el.value=state[id];el.oninput=()=>{state[id]=parseFloat(el.value)||0;if(id==='centralAisle'){
  state.centralAisle=clamp(state.centralAisle,1.2,2.6);
  const c=getZone('Центральный проход');
  if(c){
    if(centralIsVertical()) c.w=state.centralAisle;
    else c.h=state.centralAisle;
  }
}renderAll()}});
$('layoutMode').value=state.layoutMode;$('layoutMode').onchange=()=>{state.layoutMode=$('layoutMode').value;renderAll()};
$('turnoverMode').value=state.turnoverMode;
$('turnoverMode').onchange=()=>{state.turnoverMode=$('turnoverMode').value;renderAll()};
$('setScalingBaselineBtn').onclick=setScalingBaseline;
$('applyScalingFlowBtn').onclick=applyScalingFlow;
$('applyScalingStaffBtn').onclick=applyScalingStaff;
document.querySelectorAll('[data-level-switch]').forEach(b=>b.onclick=()=>switchLevel(b.dataset.levelSwitch));
$('addFloorBtn').onclick=addFloor2;
$('removeFloorBtn').onclick=removeFloor2;
$('floor2Mode').onchange=()=>{state.floor2Mode=$('floor2Mode').value;if(floor2HasStorage())ensureFloor2StorageAccess83();optimizerAllCandidates=[];optimizerVariants=[];renderVariantSelector();renderAll();};
$('mfGoal').onchange=()=>{state.mfGoal=$('mfGoal').value;if(mfVariants.length)runMultiFloorOptimizer84();};
$('mfRunBtn').onclick=runMultiFloorOptimizer84;
$('mfVariantSelect').onchange=()=>{renderMultiFloorOptimizer84();renderTabs();};
$('mfApplyBtn').onclick=applyMultiFloorVariant84;

$('optBtn').onclick=optimize;
$('optSideBtn').onclick=optimize;
$('centerAisleBtn').onclick=()=>{
  state.activeLevel='ground';
  let c=getZone('Центральный проход');
  if(!c){
    const b=rackCandidateArea();
    c={
      name:'Центральный проход',type:'service',level:'ground',
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
$('addColumnBtn').onclick=()=>{
  const bd=levelDims();
  state.columns.push({x:Math.min(6,bd.L*.3),y:Math.min(3,bd.W*.3),w:.6,h:.6,rotation:0,level:state.activeLevel});
  selected={kind:'column',index:state.columns.length-1};renderAll()
};
document.querySelectorAll('.objbtn').forEach(b=>b.onclick=()=>addTemplate(b.dataset.template));
$('rotateBtn').onclick=()=>rotateSelected();$('cloneBtn').onclick=()=>cloneSelected();$('deleteBtn').onclick=()=>deleteSelected();
$('saveBtn').onclick=()=>saveNamedProject(false);
$('duplicateProjectBtn').onclick=()=>saveNamedProject(true);
$('deleteProjectBtn').onclick=deleteCurrentProject;
$('projectSelect').onchange=()=>{if($('projectSelect').value)openProject($('projectSelect').value)};
$('findVariantsBtn').onclick=findBestVariants;
$('optimizerGoal').onchange=()=>{if(optimizerAllCandidates.length)findBestVariants();};
$('variantSelect').onchange=()=>{optimizerPreviewRacks=[];showVariantDetails($('variantSelect').value);draw();};
$('previewVariantBtn').onclick=previewSelectedVariant;
$('applyVariantBtn').onclick=applySelectedVariant;
$('fillStorageBtn').onclick=fillStorageToMaximum;
$('validateBtn').onclick=runValidation;
$('showValidationOverlay').onchange=()=>draw();
$('sideWallGapToggleBtn').onclick=toggleSideWallGap;
$('cloudCheckBtn').onclick=cloudCheck;
$('cloudLoginBtn').onclick=cloudLogin;
$('cloudRegisterBtn').onclick=cloudRegister;
$('cloudLogoutBtn').onclick=cloudLogout;
$('cloudMigrateBtn').onclick=migrateLocalProjectsToCloud;
$('cloudApiBase').onchange=()=>{
  cloudApiBase=$('cloudApiBase').value.trim().replace(/\/+$/,'');
  localStorage.setItem(CLOUD_API_KEY,cloudApiBase);
  renderCloudStatus();
};
$('resetBtn').onclick=()=>{if(confirm('Сбросить текущий план? Сохранённые планы останутся.')){state=structuredClone(defaults);state.floor2Enabled=false;state.floor2Mode='process';state.activeLevel='ground';initZones();migrateV69();selected={kind:null};currentProjectId='';localStorage.removeItem(CURRENT_PROJECT_KEY);inputIds.forEach(id=>{if($(id))$(id).value=state[id]});if($('turnoverMode'))$('turnoverMode').value=state.turnoverMode;renderProjectSelector();renderAll()}};
$('exportPdfBtn').onclick=exportProjectPdf;
$('exportExcelBtn').onclick=exportProjectExcel;
$('exportPngBtn').onclick=exportPlanPng;
$('exportBtn').onclick=()=>{const b=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='mfc-planner-v8.4.1.json';a.click();URL.revokeObjectURL(a.href)};
$('importInput').onchange=async e=>{try{state=Object.assign(structuredClone(defaults),JSON.parse(await e.target.files[0].text()));sanitizeState();migrateSmartZones();migrateV69();selected={kind:null};inputIds.forEach(id=>{if($(id))$(id).value=state[id]});$('layoutMode').value=state.layoutMode;if($('turnoverMode'))$('turnoverMode').value=state.turnoverMode;renderAll()}catch{alert('Не удалось загрузить проект')}}; 
document.querySelectorAll('.tool[data-mode]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tool[data-mode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');mode=b.dataset.mode;draw()});
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tabcontent').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('tab-'+b.dataset.tab).classList.add('active')});

renderProjectSelector();
renderVariantSelector();
initCloudWorkspace();
if(currentProjectId){ const pp=readProjects().find(x=>x.id===currentProjectId); if(pp&&pp.state) openProject(currentProjectId); }
setInterval(autosaveCurrentProject,15000);
renderAll();
