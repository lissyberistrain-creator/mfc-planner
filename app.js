const $=id=>document.getElementById(id);
const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Math.round(Number(n)||0));
const fmt1=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(Number(n)||0);
const money=n=>fmt(n)+' ₽';
const colors={storage:'#d9c0f0',process:'#f3c3dc',staff:'#c8d6f2',service:'#d8dfd2'};
const opNames={accept:'Приёмка',putaway:'Раскладка',pick:'Сборка',ship:'Отгрузка'};

const defaultState={
  roomL:20,roomW:10,roomH:3,avgSkuL:4.5,rackL:1.2,rackD:.5,rackH:2.5,shelves:5,aisle:1.2,fillPct:95,
  normAccept:2750,normPutaway:2750,normPick:1500,normShip:3500,
  opsPerShift:3,shiftsPerDay:2,paidHours:11,opRate:400,seniors:2,seniorSalary:90000,managers:1,managerSalary:130000,
  rent:300000,capex:2921881,acceptTariff:15,storageTariff:2,avgFlow:100000,maxFlow:120000,
  targetFlow:100000,simFlow:100000,layoutMode:'balanced',rackOrientation:'horizontal',
  zones:[
    {id:1,name:'Хранение',type:'storage',x:4.4,y:4.0,w:15.2,h:5.6},
    {id:2,name:'Приёмка',type:'process',x:.4,y:.4,w:5.8,h:3.0},
    {id:3,name:'Сборка',type:'process',x:6.5,y:.4,w:7.0,h:3.0},
    {id:4,name:'Отгрузка',type:'process',x:13.8,y:.4,w:5.8,h:3.0},
    {id:5,name:'Раздевалка',type:'staff',x:.4,y:4.0,w:3.5,h:2.4},
    {id:6,name:'Офис',type:'staff',x:.4,y:6.8,w:3.5,h:2.8}
  ]
};

function migrateState(s){
  const out={...structuredClone(defaultState),...(s||{})};
  out.zones=Array.isArray(s?.zones)&&s.zones.length?s.zones:structuredClone(defaultState.zones);
  return out;
}
let state=migrateState(JSON.parse(localStorage.getItem('mfcPlannerState')||'null'));
let selectedZoneId=null,drag=null;

const fieldIds=['roomL','roomW','roomH','avgSkuL','rackL','rackD','rackH','shelves','aisle','fillPct',
'normAccept','normPutaway','normPick','normShip','opsPerShift','shiftsPerDay','paidHours','opRate','seniors',
'seniorSalary','managers','managerSalary','rent','capex','acceptTariff','storageTariff','avgFlow','maxFlow','targetFlow','simFlow'];
const selectIds=['layoutMode'];

function syncInputs(){
  fieldIds.forEach(id=>{if($(id)) $(id).value=state[id]});
  selectIds.forEach(id=>{if($(id)) $(id).value=state[id]});
}
function bindInputs(){
  fieldIds.forEach(id=>$(id)?.addEventListener('input',()=>{
    state[id]=parseFloat($(id).value)||0;
    if(id==='targetFlow' && !document.activeElement?.matches('#simFlow')) state.simFlow=state.targetFlow;
    render();
  }));
  selectIds.forEach(id=>$(id)?.addEventListener('change',()=>{state[id]=$(id).value;render()}));
}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function clampZone(z){
  z.w=Math.max(.4,Math.min(z.w,state.roomL));
  z.h=Math.max(.4,Math.min(z.h,state.roomW));
  z.x=Math.max(0,Math.min(z.x,state.roomL-z.w));
  z.y=Math.max(0,Math.min(z.y,state.roomW-z.h));
}
function storageZones(){return state.zones.filter(z=>z.type==='storage')}
function findZone(name){return state.zones.find(z=>z.name.toLowerCase().includes(name.toLowerCase()))}

function renderZonesList(){
  const el=$('zoneList');el.innerHTML='';
  state.zones.forEach(z=>{
    const row=document.createElement('div');row.className='zone-row'+(selectedZoneId===z.id?' selected-row':'');
    row.innerHTML=`<div class="zone-row-top"><input data-k="name" value="${escapeHtml(z.name)}"><select data-k="type"><option value="storage">Хранение</option><option value="process">Процесс</option><option value="staff">Персонал</option><option value="service">Сервис</option></select><button class="remove">×</button></div>
    <div class="zone-row-dims"><label>X<input data-k="x" type="number" step="0.1" value="${z.x.toFixed(1)}"></label><label>Y<input data-k="y" type="number" step="0.1" value="${z.y.toFixed(1)}"></label><label>Дл.<input data-k="w" type="number" step="0.1" value="${z.w.toFixed(1)}"></label><label>Шир.<input data-k="h" type="number" step="0.1" value="${z.h.toFixed(1)}"></label></div>`;
    row.querySelector('select').value=z.type;
    row.querySelectorAll('input,select').forEach(inp=>inp.addEventListener('input',()=>{
      const k=inp.dataset.k;z[k]=(k==='name'||k==='type')?inp.value:(parseFloat(inp.value)||0);clampZone(z);renderPlan();renderMetrics();
    }));
    row.querySelector('.remove').onclick=()=>{state.zones=state.zones.filter(a=>a.id!==z.id);if(selectedZoneId===z.id)selectedZoneId=null;render()};
    row.onclick=e=>{if(!['INPUT','SELECT','BUTTON'].includes(e.target.tagName)){selectedZoneId=z.id;renderPlan();renderZonesList()}};
    el.appendChild(row);
  });
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}

function rackLayoutFor(z,orientation='horizontal'){
  const len=orientation==='horizontal'?z.w:z.h;
  const dep=orientation==='horizontal'?z.h:z.w;
  const sectionsPerRow=Math.max(0,Math.floor(len/Math.max(.01,state.rackL)));
  const pitch=Math.max(.01,state.rackD+state.aisle);
  const rows=Math.max(0,Math.floor((dep+state.aisle)/pitch));
  return {orientation,rows,sectionsPerRow,total:rows*sectionsPerRow};
}
function bestRackLayout(z){
  const a=rackLayoutFor(z,'horizontal'),b=rackLayoutFor(z,'vertical');
  return b.total>a.total?b:a;
}

function operationModel(flowMonthly,opsPerShift=state.opsPerShift){
  const daily=Math.max(0,flowMonthly)/30;
  const norms={
    accept:Math.max(1,state.normAccept),
    putaway:Math.max(1,state.normPutaway),
    pick:Math.max(1,state.normPick),
    ship:Math.max(1,state.normShip)
  };
  const shifts=Math.max(1,state.shiftsPerDay);
  const req={};
  let totalWorkerShifts=0;
  Object.keys(norms).forEach(k=>{
    req[k]=daily/norms[k];
    totalWorkerShifts+=req[k];
  });
  const teamWorkerShifts=Math.max(0,opsPerShift)*shifts;
  const utilization=teamWorkerShifts?totalWorkerShifts/teamWorkerShifts:Infinity;
  const laborPerSku=Object.values(norms).reduce((s,n)=>s+1/n,0);
  const maxDaily=teamWorkerShifts/laborPerSku;
  const maxMonthly=maxDaily*30;
  const minOpsPerShift=Math.ceil(totalWorkerShifts/shifts-1e-9);
  const recommendedOpsPerShift=Math.ceil((totalWorkerShifts/.85)/shifts-1e-9);
  const bottleneckKey=Object.keys(req).sort((a,b)=>req[b]-req[a])[0];
  return {daily,norms,req,totalWorkerShifts,teamWorkerShifts,utilization,maxDaily,maxMonthly,minOpsPerShift,recommendedOpsPerShift,bottleneckKey};
}

function calc(){
  const roomArea=state.roomL*state.roomW;
  let rackSections=0,rackVolume=0;
  const storageLayouts=[];
  storageZones().forEach(z=>{
    const r=bestRackLayout(z);
    storageLayouts.push({z,r});
    rackSections+=r.total;
    rackVolume+=r.total*state.rackL*state.rackD*state.rackH;
  });
  const liters=rackVolume*1000;
  const maxCapacity=liters/Math.max(.01,state.avgSkuL);
  const workingCapacity=maxCapacity*state.fillPct/100;
  const stockTurn=workingCapacity;
  const dailyStockTurn=stockTurn/30;
  const team=operationModel(state.targetFlow,state.opsPerShift);
  const teamMax=operationModel(0,state.opsPerShift).maxMonthly;

  const operatorFOT=state.opsPerShift*state.shiftsPerDay*state.paidHours*30*state.opRate;
  const autoOperatorFOT=team.recommendedOpsPerShift*state.shiftsPerDay*state.paidHours*30*state.opRate;
  const seniorFOT=state.seniors*state.seniorSalary;
  const managerFOT=state.managers*state.managerSalary;
  const fot=operatorFOT+seniorFOT+managerFOT;
  const autoFot=autoOperatorFOT+seniorFOT+managerFOT;
  const opex=fot+state.rent;
  const autoOpex=autoFot+state.rent;
  const storageIncome=workingCapacity*state.avgSkuL*state.storageTariff*30;
  const revenueBase=storageIncome+stockTurn*state.acceptTariff;
  const revenueAvg=storageIncome+state.avgFlow*state.acceptTariff;
  const revenueMax=storageIncome+state.maxFlow*state.acceptTariff;
  return {roomArea,rackSections,rackVolume,liters,maxCapacity,workingCapacity,stockTurn,dailyStockTurn,storageLayouts,
    team,teamMax,operatorFOT,autoOperatorFOT,seniorFOT,managerFOT,fot,autoFot,opex,autoOpex,storageIncome,revenueBase,revenueAvg,revenueMax,
    profitBase:revenueBase-opex,profitAvg:revenueAvg-opex,profitMax:revenueMax-opex};
}

function zoneAreaHeuristics(flowMonthly,mode){
  const daily=Math.max(0,flowMonthly)/30;
  // Планировочные коэффициенты. Это эвристика для моделирования, не строительная норма.
  let accept=Math.max(8,daily/280);
  let pick=Math.max(10,daily/220);
  let ship=Math.max(8,daily/320);
  let staff=16;
  if(mode==='capacity'){accept*=.82;pick*=.82;ship*=.82;staff*=.85}
  if(mode==='flow'){accept*=1.20;pick*=1.30;ship*=1.20;staff*=1.05}
  return {accept,pick,ship,staff,total:accept+pick+ship+staff};
}

function autoOptimize(){
  const L=Math.max(2,state.roomL),W=Math.max(2,state.roomW),A=L*W;
  const h=zoneAreaHeuristics(state.targetFlow,state.layoutMode);
  const maxNonStorage=A*(state.layoutMode==='capacity'?.28:state.layoutMode==='flow'?.45:.36);
  const desiredNonStorage=Math.min(h.total,maxNonStorage);
  const scale=desiredNonStorage/h.total;
  const acceptA=h.accept*scale,pickA=h.pick*scale,shipA=h.ship*scale,staffA=h.staff*scale;

  // Процессная полоса у одной стороны помещения. Глубина выбирается из требуемой площади,
  // но ограничивается, чтобы оставить непрерывную зону хранения.
  let processDepth=clamp((acceptA+pickA+shipA)/L,1.8,W*.42);
  if(W-processDepth<2.5) processDepth=Math.max(1.2,W-2.5);

  const processUsable=L;
  const totalProcessA=Math.max(.01,acceptA+pickA+shipA);
  let acceptW=processUsable*(acceptA/totalProcessA);
  let pickW=processUsable*(pickA/totalProcessA);
  let shipW=Math.max(.8,processUsable-acceptW-pickW);
  const minW=Math.min(2.2,L/5);
  acceptW=Math.max(minW,acceptW); pickW=Math.max(minW,pickW);
  if(acceptW+pickW+shipW>L){
    const k=L/(acceptW+pickW+shipW);acceptW*=k;pickW*=k;shipW*=k;
  }

  const rearY=processDepth+.25;
  const rearH=Math.max(.5,W-rearY-.25);
  const staffW=rearH>0?clamp(staffA/rearH,1.6,L*.25):0;
  const storageX=staffW+.25;
  const storageW=Math.max(.5,L-storageX-.25);

  state.zones=[
    {id:1,name:'Хранение',type:'storage',x:storageX,y:rearY,w:storageW,h:rearH},
    {id:2,name:'Приёмка',type:'process',x:0,y:0,w:acceptW,h:processDepth},
    {id:3,name:'Сборка',type:'process',x:acceptW,y:0,w:pickW,h:processDepth},
    {id:4,name:'Отгрузка',type:'process',x:acceptW+pickW,y:0,w:Math.max(.4,L-acceptW-pickW),h:processDepth}
  ];

  if(staffW>.5 && rearH>.8){
    const officeH=rearH*.48;
    state.zones.push({id:5,name:'Офис',type:'staff',x:0,y:rearY,w:staffW,h:officeH});
    state.zones.push({id:6,name:'Раздевалка',type:'staff',x:0,y:rearY+officeH+.15,w:staffW,h:Math.max(.4,rearH-officeH-.15)});
  }
  state.zones.forEach(clampZone);
  selectedZoneId=1;
  const storage=findZone('Хранение');
  if(storage) state.rackOrientation=bestRackLayout(storage).orientation;
  localStorage.setItem('mfcPlannerState',JSON.stringify(state));
  render();
  showToast('План подобран');
}

function renderPlan(){
  const svg=$('plan');svg.innerHTML='';
  const W=930,H=450,scale=Math.min(W/state.roomL,H/state.roomW),rw=state.roomL*scale,rh=state.roomW*scale,ox=(1000-rw)/2,oy=(520-rh)/2;
  const ns='http://www.w3.org/2000/svg';
  const rect=document.createElementNS(ns,'rect');rect.setAttribute('x',ox);rect.setAttribute('y',oy);rect.setAttribute('width',rw);rect.setAttribute('height',rh);rect.setAttribute('class','room-border');svg.appendChild(rect);
  for(let x=1;x<state.roomL;x++){let l=document.createElementNS(ns,'line');l.setAttribute('x1',ox+x*scale);l.setAttribute('x2',ox+x*scale);l.setAttribute('y1',oy);l.setAttribute('y2',oy+rh);l.setAttribute('class','gridline');svg.appendChild(l)}
  for(let y=1;y<state.roomW;y++){let l=document.createElementNS(ns,'line');l.setAttribute('y1',oy+y*scale);l.setAttribute('y2',oy+y*scale);l.setAttribute('x1',ox);l.setAttribute('x2',ox+rw);l.setAttribute('class','gridline');svg.appendChild(l)}
  state.zones.forEach(z=>{
    const g=document.createElementNS(ns,'g');
    const r=document.createElementNS(ns,'rect');r.setAttribute('x',ox+z.x*scale);r.setAttribute('y',oy+z.y*scale);r.setAttribute('width',z.w*scale);r.setAttribute('height',z.h*scale);r.setAttribute('rx',7);r.setAttribute('fill',colors[z.type]);r.setAttribute('class','zone'+(selectedZoneId===z.id?' selected':''));r.dataset.id=z.id;g.appendChild(r);

    if(z.type==='storage'){
      const layout=bestRackLayout(z);
      if(layout.orientation==='horizontal'){
        for(let row=0;row<layout.rows;row++)for(let s=0;s<layout.sectionsPerRow;s++) addRack(g,ox+(z.x+s*state.rackL)*scale+1,oy+(z.y+row*(state.rackD+state.aisle))*scale+2,state.rackL*scale-2,state.rackD*scale-4,ns);
      }else{
        for(let row=0;row<layout.rows;row++)for(let s=0;s<layout.sectionsPerRow;s++) addRack(g,ox+(z.x+row*(state.rackD+state.aisle))*scale+2,oy+(z.y+s*state.rackL)*scale+1,state.rackD*scale-4,state.rackL*scale-2,ns);
      }
    }
    const t=document.createElementNS(ns,'text');t.setAttribute('x',ox+z.x*scale+8);t.setAttribute('y',oy+z.y*scale+18);t.setAttribute('class','zone-label');t.textContent=z.name;g.appendChild(t);
    const ta=document.createElementNS(ns,'text');ta.setAttribute('x',ox+z.x*scale+8);ta.setAttribute('y',oy+z.y*scale+34);ta.setAttribute('class','zone-area');ta.textContent=fmt1(z.w*z.h)+' м²';g.appendChild(ta);
    svg.appendChild(g);
  });
  svg.onmousedown=e=>{
    const target=e.target.closest('.zone');if(!target)return;
    const id=+target.dataset.id;selectedZoneId=id;const z=state.zones.find(a=>a.id===id);
    drag={z,startX:e.clientX,startY:e.clientY,x:z.x,y:z.y,scale};renderPlan();renderZonesList();
  };
}
function addRack(g,x,y,w,h,ns){
  const rr=document.createElementNS(ns,'rect');rr.setAttribute('x',x);rr.setAttribute('y',y);rr.setAttribute('width',Math.max(2,w));rr.setAttribute('height',Math.max(2,h));rr.setAttribute('class',state.rackL<.8?'rack-small':'rack');g.appendChild(rr);
}
window.addEventListener('mousemove',e=>{
  if(!drag)return;drag.z.x=drag.x+(e.clientX-drag.startX)/drag.scale;drag.z.y=drag.y+(e.clientY-drag.startY)/drag.scale;clampZone(drag.z);renderPlan();renderMetrics();
});
window.addEventListener('mouseup',()=>{if(drag){drag=null;renderZonesList()}});

function progressBar(label,req,share,norm){
  const pct=Math.min(100,share*100);
  return `<div class="stage"><div class="stage-head"><b>${label}</b><span>${fmt1(req)} чел.-смен/сутки · норма ${fmt(norm)}</span></div><div class="bar"><i style="width:${pct}%"></i></div><small>${fmt1(share*100)}% трудозатрат сквозного потока</small></div>`;
}
function renderEmulator(){
  const flow=state.simFlow;
  const m=operationModel(flow,state.opsPerShift);
  const ok=m.utilization<=1;
  const totalReq=Math.max(.00001,m.totalWorkerShifts);
  const reqTable=Object.keys(m.req).map(k=>progressBar(opNames[k],m.req[k],m.req[k]/totalReq,m.norms[k])).join('');
  $('emulatorBody').innerHTML=`
  <div class="emu-grid">
    <div class="emu-status ${ok?'ok':'over'}">
      <span>${ok?'Поток проходит':'Поток выше мощности команды'}</span>
      <b>${fmt(flow)} SKU/мес</b>
      <small>${fmt(m.daily)} SKU/сутки сквозного объёма</small>
    </div>
    <div class="emu-kpi"><span>Загрузка команды</span><b>${Number.isFinite(m.utilization)?fmt1(m.utilization*100):'∞'}%</b><small>${state.opsPerShift} операторов × ${state.shiftsPerDay} смены</small></div>
    <div class="emu-kpi"><span>Минимум операторов</span><b>${m.minOpsPerShift} / смену</b><small>математический минимум</small></div>
    <div class="emu-kpi"><span>Рекомендуемо</span><b>${m.recommendedOpsPerShift} / смену</b><small>целевая загрузка до 85%</small></div>
  </div>
  <div class="stage-grid">${reqTable}</div>
  <div class="flow-line"><span>Приёмка</span><i>→</i><span>Раскладка</span><i>→</i><span>Сборка</span><i>→</i><span>Отгрузка</span></div>
  <div class="notice ${ok?'good-bg':'bad-bg'}">Текущая команда пропускает расчетно до <b>${fmt(m.maxMonthly)} SKU/мес</b> сквозного потока. Самый трудоёмкий этап: <b>${opNames[m.bottleneckKey]}</b>.</div>`;
}

function renderMetrics(){
  const c=calc();
  $('mArea').textContent=fmt(c.roomArea)+' м²';
  $('mCapacity').textContent=fmt(c.workingCapacity)+' SKU';
  $('mTeamThroughput').textContent=fmt(c.teamMax)+' SKU/мес';
  $('mAutoStaff').textContent=c.team.recommendedOpsPerShift+' оп./смену';
  const storage=findZone('Хранение');
  const layout=storage?bestRackLayout(storage):null;
  $('layoutSummary').textContent=storage?`Хранение ${fmt1(storage.w*storage.h)} м² · ${fmt(c.rackSections)} секций · ориентация ${layout?.orientation==='vertical'?'вертикальная':'горизонтальная'}`:'Нет зоны хранения';

  $('tab-capacity').innerHTML=`
  <div class="stats-grid">
    <div class="statbox">Площадь хранения<b>${fmt1(storageZones().reduce((s,z)=>s+z.w*z.h,0))} м²</b></div>
    <div class="statbox">Стеллажных секций<b>${fmt(c.rackSections)}</b></div>
    <div class="statbox">Рабочая вместимость ${state.fillPct}%<b>${fmt(c.workingCapacity)} SKU</b></div>
  </div>
  <table class="table"><tr><th>Показатель</th><th>Значение</th></tr>
  <tr><td>Полезный объём стеллажей</td><td>${fmt1(c.rackVolume)} м³</td></tr>
  <tr><td>Максимальная вместимость 100%</td><td>${fmt(c.maxCapacity)} SKU</td></tr>
  <tr><td>Рабочая вместимость</td><td>${fmt(c.workingCapacity)} SKU</td></tr>
  <tr><td>Резерв до 100%</td><td>${fmt(c.maxCapacity-c.workingCapacity)} SKU</td></tr></table>`;

  const oneTurn=operationModel(c.stockTurn,state.opsPerShift);
  const avg=operationModel(state.avgFlow,state.opsPerShift);
  const max=operationModel(state.maxFlow,state.opsPerShift);
  $('tab-throughput').innerHTML=`
  <div class="stats-grid">
    <div class="statbox">1 оборот рабочего стока<b>${fmt(c.stockTurn)} SKU/мес</b><span>${fmt(c.dailyStockTurn)} SKU/сутки</span></div>
    <div class="statbox">Мощность текущей команды<b>${fmt(c.teamMax)} SKU/мес</b><span>${fmt(c.teamMax/30)} SKU/сутки</span></div>
    <div class="statbox">Целевой поток<b>${fmt(state.targetFlow)} SKU/мес</b><span>${fmt(state.targetFlow/30)} SKU/сутки</span></div>
  </div>
  <table class="table"><tr><th>Сценарий</th><th>Оборотов стока</th><th>Загрузка команды</th><th>Статус</th></tr>
  ${scenarioRow('1 полный оборот',c.stockTurn,c.workingCapacity,oneTurn)}
  ${scenarioRow('Средний рабочий',state.avgFlow,c.workingCapacity,avg)}
  ${scenarioRow('Максимальный заданный',state.maxFlow,c.workingCapacity,max)}
  ${scenarioRow('Целевой для планировки',state.targetFlow,c.workingCapacity,c.team)}
  </table>`;

  const team=c.team;
  $('tab-staff').innerHTML=`
  <div class="stats-grid">
    <div class="statbox">Минимум на поток<b>${team.minOpsPerShift} оп./смену</b><span>без запаса по загрузке</span></div>
    <div class="statbox">Рекомендуемый состав<b>${team.recommendedOpsPerShift} оп./смену</b><span>целевая загрузка ≤85%</span></div>
    <div class="statbox">Текущий состав<b>${state.opsPerShift} оп./смену</b><span>${fmt1(team.utilization*100)}% загрузки</span></div>
  </div>
  <table class="table"><tr><th>Операция</th><th>Норма / смену</th><th>Нужно чел.-смен / сутки</th><th>Доля труда</th></tr>
  ${staffOpRows(team)}
  </table>
  <div class="notice info-bg">Автоштат считается из одного и того же сквозного объёма на всех четырех этапах. Сотрудники считаются взаимозаменяемыми между операциями.</div>`;

  $('tab-finance').innerHTML=`
  <div class="stats-grid">
    <div class="statbox">Текущий ФОТ<b>${money(c.fot)}</b></div>
    <div class="statbox">ФОТ с автоштатом<b>${money(c.autoFot)}</b><span>${team.recommendedOpsPerShift} операторов/смену</span></div>
    <div class="statbox">OPEX с автоштатом<b>${money(c.autoOpex)}</b></div>
  </div>
  <table class="table"><tr><th>Сценарий</th><th>Выручка</th><th>Прибыль при текущем OPEX</th></tr>
  <tr><td>1 оборот рабочего стока</td><td>${money(c.revenueBase)}</td><td>${money(c.profitBase)}</td></tr>
  <tr><td>${fmt(state.avgFlow)} SKU/мес</td><td>${money(c.revenueAvg)}</td><td>${money(c.profitAvg)}</td></tr>
  <tr><td>${fmt(state.maxFlow)} SKU/мес</td><td>${money(c.revenueMax)}</td><td>${money(c.profitMax)}</td></tr></table>`;

  const warnings=[];
  if(state.aisle<1)warnings.push(['bad','Проход меньше 1 м. Для рабочего склада это может быть слишком узко.']);
  if(storageZones().length===0)warnings.push(['bad','Не задана зона хранения.']);
  if(c.rackSections===0)warnings.push(['bad','С текущими размерами в зоне хранения не помещаются стеллажные секции.']);
  if(c.team.utilization>1)warnings.push(['bad',`Целевой поток ${fmt(state.targetFlow)} SKU/мес превышает расчетную мощность текущей команды ${fmt(c.teamMax)} SKU/мес.`]);
  const overlaps=[];
  for(let i=0;i<state.zones.length;i++)for(let j=i+1;j<state.zones.length;j++){
    const a=state.zones[i],b=state.zones[j];
    if(a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y)overlaps.push(`${a.name} ↔ ${b.name}`);
  }
  if(overlaps.length)warnings.push(['warn','Есть пересечения зон: '+overlaps.join(', ')]);
  warnings.push(['info','Авторазмещение является планировочной эвристикой. Пожарные, эвакуационные и строительные требования необходимо валидировать отдельно.']);
  if(!warnings.some(x=>x[0]==='bad'||x[0]==='warn'))warnings.unshift(['good','Критичных геометрических или производственных ограничений в модели не обнаружено.']);
  $('tab-warnings').innerHTML=warnings.map(([cl,t])=>`<div class="notice ${cl}">${t}</div>`).join('');
  renderEmulator();
}
function scenarioRow(name,flow,capacity,m){
  const util=m.utilization;
  return `<tr><td>${name}</td><td>${(flow/Math.max(1,capacity)).toFixed(2)}</td><td>${fmt1(util*100)}%</td><td><span class="pill ${util<=1?'pill-good':'pill-bad'}">${util<=1?'проходит':'выше мощности'}</span></td></tr>`;
}
function staffOpRows(m){
  const total=Math.max(.0001,m.totalWorkerShifts);
  return Object.keys(m.req).map(k=>`<tr><td>${opNames[k]}</td><td>${fmt(m.norms[k])}</td><td>${fmt1(m.req[k])}</td><td>${fmt1(m.req[k]/total*100)}%</td></tr>`).join('');
}
function render(){state.zones.forEach(clampZone);renderZonesList();renderPlan();renderMetrics()}

$('addZoneBtn').onclick=()=>{
  const id=Math.max(0,...state.zones.map(z=>z.id))+1;state.zones.push({id,name:'Новая зона',type:'service',x:.5,y:.5,w:3,h:2});selectedZoneId=id;render()
};
$('optimizeBtn').onclick=autoOptimize;
$('optimizeSideBtn').onclick=autoOptimize;
$('saveBtn').onclick=()=>{localStorage.setItem('mfcPlannerState',JSON.stringify(state));showToast('Проект сохранён')};
$('exportBtn').onclick=()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='mfc-planner-project-v2.json';a.click();URL.revokeObjectURL(a.href)
};
$('importInput').onchange=async e=>{try{const text=await e.target.files[0].text();state=migrateState(JSON.parse(text));syncInputs();render();showToast('Проект загружен')}catch{alert('Не удалось прочитать JSON проекта')}};
$('resetBtn').onclick=()=>{if(confirm('Сбросить проект к исходным данным?')){state=structuredClone(defaultState);localStorage.removeItem('mfcPlannerState');syncInputs();render()}};
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tab,.tab-content').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('tab-'+b.dataset.tab).classList.add('active')
});
function showToast(text){
  let t=document.querySelector('.toast');if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t)}
  t.textContent=text;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1400)
}
syncInputs();bindInputs();render();
