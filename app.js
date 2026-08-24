const $=id=>document.getElementById(id);
const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Math.round(n||0));
const money=n=>fmt(n)+' ₽';
const colors={storage:'#d9c0f0',process:'#f3c3dc',staff:'#c8d6f2',service:'#d8dfd2'};

const defaultState={
  roomL:20,roomW:10,roomH:3,avgSkuL:4.5,rackL:1.2,rackD:.5,rackH:2.5,shelves:5,aisle:1.2,fillPct:95,
  opsPerShift:3,shiftsPerDay:2,paidHours:11,opRate:400,seniors:2,seniorSalary:90000,managers:1,managerSalary:130000,
  rent:300000,capex:2921881,acceptTariff:15,storageTariff:2,avgFlow:100000,maxFlow:120000,
  zones:[
    {id:1,name:'Хранение',type:'storage',x:5,y:8,w:11.2,h:8.6},
    {id:2,name:'Приёмка',type:'process',x:0.4,y:0.4,w:6,h:3},
    {id:3,name:'Отгрузка',type:'process',x:13.8,y:0.4,w:5.8,h:3},
    {id:4,name:'Сборка',type:'process',x:7,y:0.4,w:6.2,h:3},
    {id:5,name:'Раздевалка',type:'staff',x:.4,y:7.2,w:3.8,h:2.4},
    {id:6,name:'Офис',type:'staff',x:.4,y:4.2,w:3.8,h:2.4}
  ]
};
let state=JSON.parse(localStorage.getItem('mfcPlannerState')||'null')||structuredClone(defaultState);
let selectedZoneId=null,drag=null;
const fieldIds=['roomL','roomW','roomH','avgSkuL','rackL','rackD','rackH','shelves','aisle','fillPct','opsPerShift','shiftsPerDay','paidHours','opRate','seniors','seniorSalary','managers','managerSalary','rent','capex','acceptTariff','storageTariff','avgFlow','maxFlow'];

function syncInputs(){fieldIds.forEach(id=>$(id).value=state[id]);}
function bindInputs(){fieldIds.forEach(id=>$(id).addEventListener('input',()=>{state[id]=parseFloat($(id).value)||0;render();}));}
function clampZone(z){z.w=Math.max(.4,Math.min(z.w,state.roomL));z.h=Math.max(.4,Math.min(z.h,state.roomW));z.x=Math.max(0,Math.min(z.x,state.roomL-z.w));z.y=Math.max(0,Math.min(z.y,state.roomW-z.h));}

function renderZonesList(){
  const el=$('zoneList');el.innerHTML='';
  state.zones.forEach(z=>{
    const row=document.createElement('div');row.className='zone-row';
    row.innerHTML=`<div class="zone-row-top"><input data-k="name" value="${z.name}"><select data-k="type"><option value="storage">Хранение</option><option value="process">Процесс</option><option value="staff">Персонал</option><option value="service">Сервис</option></select><button class="remove">×</button></div><div class="zone-row-dims"><label>X<input data-k="x" type="number" step="0.1" value="${z.x}"></label><label>Y<input data-k="y" type="number" step="0.1" value="${z.y}"></label><label>Дл.<input data-k="w" type="number" step="0.1" value="${z.w}"></label><label>Шир.<input data-k="h" type="number" step="0.1" value="${z.h}"></label></div>`;
    row.querySelector('select').value=z.type;
    row.querySelectorAll('input,select').forEach(inp=>inp.addEventListener('input',()=>{const k=inp.dataset.k;z[k]=(k==='name'||k==='type')?inp.value:(parseFloat(inp.value)||0);clampZone(z);renderPlan();renderMetrics();}));
    row.querySelector('.remove').onclick=()=>{state.zones=state.zones.filter(a=>a.id!==z.id);if(selectedZoneId===z.id)selectedZoneId=null;render();};
    row.onclick=e=>{if(!['INPUT','SELECT','BUTTON'].includes(e.target.tagName)){selectedZoneId=z.id;renderPlan();}};
    el.appendChild(row);
  });
}

function storageZones(){return state.zones.filter(z=>z.type==='storage');}
function calcRackLayout(z){
  // Rows run along zone width. Each row has rack depth plus aisle. Sections run along zone length.
  const pitch=state.rackD+state.aisle;
  const rows=Math.max(0,Math.floor((z.h+state.aisle)/pitch));
  const sectionsPerRow=Math.max(0,Math.floor(z.w/state.rackL));
  return {rows,sectionsPerRow,total:rows*sectionsPerRow};
}
function calc(){
  const roomArea=state.roomL*state.roomW;
  let rackSections=0,rackVolume=0;
  storageZones().forEach(z=>{const r=calcRackLayout(z);rackSections+=r.total;rackVolume+=r.total*state.rackL*state.rackD*state.rackH;});
  const liters=rackVolume*1000;
  const maxCapacity=liters/state.avgSkuL;
  const workingCapacity=maxCapacity*state.fillPct/100;
  const stockTurn=workingCapacity;
  const dailyStockTurn=stockTurn/30;
  const avgDaily=state.avgFlow/30,maxDaily=state.maxFlow/30;
  const operatorFOT=state.opsPerShift*state.shiftsPerDay*state.paidHours*30*state.opRate;
  const seniorFOT=state.seniors*state.seniorSalary;
  const managerFOT=state.managers*state.managerSalary;
  const fot=operatorFOT+seniorFOT+managerFOT;
  const opex=fot+state.rent;
  const storageIncome=workingCapacity*state.avgSkuL*state.storageTariff*30;
  const revenueBase=storageIncome+stockTurn*state.acceptTariff;
  const revenueAvg=storageIncome+state.avgFlow*state.acceptTariff;
  const revenueMax=storageIncome+state.maxFlow*state.acceptTariff;
  return {roomArea,rackSections,rackVolume,liters,maxCapacity,workingCapacity,stockTurn,dailyStockTurn,avgDaily,maxDaily,operatorFOT,seniorFOT,managerFOT,fot,opex,storageIncome,revenueBase,revenueAvg,revenueMax,
    profitBase:revenueBase-opex,profitAvg:revenueAvg-opex,profitMax:revenueMax-opex};
}

function renderPlan(){
  const svg=$('plan');svg.innerHTML='';
  const pad=35,W=930,H=450,sx=W/state.roomL,sy=H/state.roomW,scale=Math.min(sx,sy),rw=state.roomL*scale,rh=state.roomW*scale,ox=(1000-rw)/2,oy=(520-rh)/2;
  const ns='http://www.w3.org/2000/svg';
  const rect=document.createElementNS(ns,'rect');rect.setAttribute('x',ox);rect.setAttribute('y',oy);rect.setAttribute('width',rw);rect.setAttribute('height',rh);rect.setAttribute('class','room-border');svg.appendChild(rect);
  for(let x=1;x<state.roomL;x++){let l=document.createElementNS(ns,'line');l.setAttribute('x1',ox+x*scale);l.setAttribute('x2',ox+x*scale);l.setAttribute('y1',oy);l.setAttribute('y2',oy+rh);l.setAttribute('class','gridline');svg.appendChild(l)}
  for(let y=1;y<state.roomW;y++){let l=document.createElementNS(ns,'line');l.setAttribute('y1',oy+y*scale);l.setAttribute('y2',oy+y*scale);l.setAttribute('x1',ox);l.setAttribute('x2',ox+rw);l.setAttribute('class','gridline');svg.appendChild(l)}
  state.zones.forEach(z=>{
    const g=document.createElementNS(ns,'g');
    const r=document.createElementNS(ns,'rect');r.setAttribute('x',ox+z.x*scale);r.setAttribute('y',oy+z.y*scale);r.setAttribute('width',z.w*scale);r.setAttribute('height',z.h*scale);r.setAttribute('rx',7);r.setAttribute('fill',colors[z.type]);r.setAttribute('class','zone'+(selectedZoneId===z.id?' selected':''));r.dataset.id=z.id;g.appendChild(r);
    if(z.type==='storage'){
      const layout=calcRackLayout(z);
      for(let row=0;row<layout.rows;row++){
        for(let s=0;s<layout.sectionsPerRow;s++){
          const rr=document.createElementNS(ns,'rect');rr.setAttribute('x',ox+(z.x+s*state.rackL)*scale+1);rr.setAttribute('y',oy+(z.y+row*(state.rackD+state.aisle))*scale+2);rr.setAttribute('width',Math.max(2,state.rackL*scale-2));rr.setAttribute('height',Math.max(2,state.rackD*scale-4));rr.setAttribute('class',state.rackL<.8?'rack-small':'rack');g.appendChild(rr);
        }
      }
    }
    const t=document.createElementNS(ns,'text');t.setAttribute('x',ox+z.x*scale+8);t.setAttribute('y',oy+z.y*scale+18);t.setAttribute('class','zone-label');t.textContent=z.name;g.appendChild(t);
    svg.appendChild(g);
  });
  svg.onmousedown=e=>{const target=e.target.closest('.zone');if(!target)return;const id=+target.dataset.id;selectedZoneId=id;const z=state.zones.find(a=>a.id===id);drag={z,startX:e.clientX,startY:e.clientY,x:z.x,y:z.y,scale};renderPlan();};
  window.onmousemove=e=>{if(!drag)return;drag.z.x=drag.x+(e.clientX-drag.startX)/drag.scale;drag.z.y=drag.y+(e.clientY-drag.startY)/drag.scale;clampZone(drag.z);renderPlan();renderMetrics();};
  window.onmouseup=()=>{if(drag){drag=null;renderZonesList();}};
}

function renderMetrics(){
  const c=calc();$('mArea').textContent=fmt(c.roomArea)+' м²';$('mRacks').textContent=fmt(c.rackSections);$('mCapacity').textContent=fmt(c.workingCapacity)+' SKU';$('mStockTurn').textContent=fmt(c.stockTurn)+' SKU/мес';
  $('tab-capacity').innerHTML=`<div class="stats-grid"><div class="statbox">Полезный объём стеллажей<b>${fmt(c.rackVolume)} м³</b></div><div class="statbox">Максимальная вместимость 100%<b>${fmt(c.maxCapacity)} SKU</b></div><div class="statbox">Рабочая вместимость ${state.fillPct}%<b>${fmt(c.workingCapacity)} SKU</b></div></div><table class="table"><tr><th>Показатель</th><th>Значение</th></tr><tr><td>Стеллажных секций</td><td>${fmt(c.rackSections)}</td></tr><tr><td>Полезный объём</td><td>${fmt(c.liters)} л</td></tr><tr><td>Средний объём SKU</td><td>${state.avgSkuL} л</td></tr><tr><td>Резерв до 100%</td><td>${fmt(c.maxCapacity-c.workingCapacity)} SKU</td></tr></table>`;
  $('tab-throughput').innerHTML=`<div class="stats-grid"><div class="statbox">1 оборот рабочего стока за 30 дней<b>${fmt(c.stockTurn)} SKU/мес</b><span>${fmt(c.dailyStockTurn)} SKU/сутки сквозного объёма</span></div><div class="statbox">Работа выше среднего<b>${fmt(state.avgFlow)} SKU/мес</b><span>${fmt(c.avgDaily)} SKU/сутки</span></div><div class="statbox">Предел текущего состава<b>${fmt(state.maxFlow)} SKU/мес</b><span>${fmt(c.maxDaily)} SKU/сутки</span></div></div><table class="table"><tr><th>Сценарий</th><th>Оборотов рабочего стока / мес</th></tr><tr><td>1 полный оборот</td><td>1,00</td></tr><tr><td>Средний рабочий оборот</td><td>${(state.avgFlow/Math.max(1,c.workingCapacity)).toFixed(2)}</td></tr><tr><td>Максимальный оборот</td><td>${(state.maxFlow/Math.max(1,c.workingCapacity)).toFixed(2)}</td></tr></table>`;
  $('tab-staff').innerHTML=`<div class="stats-grid"><div class="statbox">Операторы<b>${state.opsPerShift*state.shiftsPerDay}</b><span>${state.opsPerShift} в смену × ${state.shiftsPerDay} смены</span></div><div class="statbox">Старшие<b>${state.seniors}</b></div><div class="statbox">Руководитель<b>${state.managers}</b></div></div><table class="table"><tr><th>Статья</th><th>В месяц</th></tr><tr><td>Операторы</td><td>${money(c.operatorFOT)}</td></tr><tr><td>Старшие</td><td>${money(c.seniorFOT)}</td></tr><tr><td>Руководитель</td><td>${money(c.managerFOT)}</td></tr><tr><td><b>ФОТ</b></td><td><b>${money(c.fot)}</b></td></tr></table>`;
  $('tab-finance').innerHTML=`<div class="stats-grid"><div class="statbox">OPEX / мес<b>${money(c.opex)}</b></div><div class="statbox">CAPEX<b>${money(state.capex)}</b></div><div class="statbox">Доход хранения / мес<b>${money(c.storageIncome)}</b></div></div><table class="table"><tr><th>Сценарий</th><th>Выручка</th><th>Прибыль до прочих расходов</th></tr><tr><td>1 оборот рабочего стока</td><td>${money(c.revenueBase)}</td><td>${money(c.profitBase)}</td></tr><tr><td>${fmt(state.avgFlow)} SKU/мес</td><td>${money(c.revenueAvg)}</td><td>${money(c.profitAvg)}</td></tr><tr><td>${fmt(state.maxFlow)} SKU/мес</td><td>${money(c.revenueMax)}</td><td>${money(c.profitMax)}</td></tr></table>`;
  const warnings=[];if(state.aisle<1)warnings.push(['bad','Проход меньше 1 м. Для рабочего склада это может быть слишком узко.']);if(storageZones().length===0)warnings.push(['bad','Не задана зона хранения. Вместимость не рассчитывается.']);if(c.rackSections===0)warnings.push(['bad','В зоне хранения не помещается ни одной секции с текущими размерами и проходами.']);
  const overlaps=[];for(let i=0;i<state.zones.length;i++)for(let j=i+1;j<state.zones.length;j++){const a=state.zones[i],b=state.zones[j];if(a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y)overlaps.push(`${a.name} ↔ ${b.name}`)}if(overlaps.length)warnings.push(['warn','Есть пересечения зон: '+overlaps.join(', ')]);if(!warnings.length)warnings.push(['good','Критичных геометрических ошибок не обнаружено.']);
  $('tab-warnings').innerHTML=warnings.map(([cl,t])=>`<div class="notice ${cl}">${t}</div>`).join('');
}
function render(){state.zones.forEach(clampZone);renderZonesList();renderPlan();renderMetrics();}

$('addZoneBtn').onclick=()=>{const id=Math.max(0,...state.zones.map(z=>z.id))+1;state.zones.push({id,name:'Новая зона',type:'service',x:.5,y:.5,w:3,h:2});selectedZoneId=id;render();};
$('saveBtn').onclick=()=>{localStorage.setItem('mfcPlannerState',JSON.stringify(state));$('saveBtn').textContent='Сохранено';setTimeout(()=>$('saveBtn').textContent='Сохранить',1000)};
$('exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='mfc-planner-project.json';a.click();URL.revokeObjectURL(a.href)};
$('importInput').onchange=async e=>{try{const text=await e.target.files[0].text();state=JSON.parse(text);syncInputs();render()}catch{alert('Не удалось прочитать JSON проекта')}};
$('resetBtn').onclick=()=>{if(confirm('Сбросить проект к исходным данным?')){state=structuredClone(defaultState);localStorage.removeItem('mfcPlannerState');syncInputs();render();}};
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab,.tab-content').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('tab-'+b.dataset.tab).classList.add('active')});

syncInputs();bindInputs();render();
