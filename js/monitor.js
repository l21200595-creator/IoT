/* ============================================================
   NEXUS·IOT Smart Home — monitor.js
   Dashboard unificado de los 3 sistemas
   ============================================================ */
const BASE = 'https://698a1772c04d974bc6a1532f.mockapi.io/api/v1';

let devices=[], thermalEvents=[], accessLogs=[], energyEvents=[], statusMap={};
let refreshCycle=0, countdown=3;
const histRack=[], histAccess=[], histEnergy=[];

/* ── Fetch ──────────────────────────────────────────────── */
async function fetchAll() {
  const [dr,tr,ar,er,sr] = await Promise.all([
    fetch(`${BASE}/devices`),
    fetch(`${BASE}/thermalEvents`),
    fetch(`${BASE}/accessLog`),
    fetch(`${BASE}/energyEvents`),
    fetch(`${BASE}/statusHistory`)
  ]);
  devices       = dr.ok?(await dr.json()).map(d=>({...d,icon:d.icon||'📡'})):[];
  thermalEvents = tr.ok?(await tr.json()).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).slice(0,10):[];
  accessLogs    = ar.ok?(await ar.json()).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).slice(0,10):[];
  energyEvents  = er.ok?(await er.json()).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).slice(0,10):[];
  if (sr.ok) {
    const all=await sr.json();
    all.forEach(h=>{ if(!statusMap[h.deviceId])statusMap[h.deviceId]=[]; statusMap[h.deviceId].push(h); });
    Object.keys(statusMap).forEach(k=>{ statusMap[k].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)); statusMap[k]=statusMap[k].slice(0,8); });
  }
}

function devByKw(kw) { return devices.find(d=>d.name.toLowerCase().includes(kw.toLowerCase())); }
function fmtTs(ts) {
  const d=new Date(ts); if(isNaN(d)) return 'N/A';
  return d.toLocaleDateString('es-MX',{day:'2-digit',month:'short'})+' '+d.toLocaleTimeString('es-MX',{hour12:false,hour:'2-digit',minute:'2-digit'});
}

/* ── KPI Strip ──────────────────────────────────────────── */
function renderKPI() {
  const online=devices.filter(d=>d.status==='online').length;
  const critical=thermalEvents.filter(e=>e.status==='critical').length;
  const packages=accessLogs.filter(e=>e.packageDetected).length;
  const gasAlerts=energyEvents.filter(e=>e.gasAlert).length;
  const temp=parseFloat(devByKw('DHT22')?.value)||0;
  const watts=parseFloat(devByKw('ACS712')?.value?.split('/')[1])||0;
  document.getElementById('kpiStrip').innerHTML=`
    <div class="kpi-cell"><div class="kpi-val cyan">${online}/${devices.length}</div><div class="kpi-lbl">Dispositivos Online</div></div>
    <div class="kpi-cell"><div class="kpi-val ${temp>55?'red':temp>40?'yellow':'cyan'}">${temp.toFixed(1)}°C</div><div class="kpi-lbl">Temp. Rack Actual</div></div>
    <div class="kpi-cell"><div class="kpi-val ${critical>0?'red':'green'}">${critical}</div><div class="kpi-lbl">Eventos Críticos</div></div>
    <div class="kpi-cell"><div class="kpi-val green">${packages}</div><div class="kpi-lbl">Paquetes Recibidos</div></div>
    <div class="kpi-cell"><div class="kpi-val ${gasAlerts>0?'red':'green'}">${gasAlerts}</div><div class="kpi-lbl">Alertas de Gas</div></div>
    <div class="kpi-cell"><div class="kpi-val yellow">${watts} W</div><div class="kpi-lbl">Consumo Actual</div></div>
    <div class="kpi-cell"><div class="kpi-val purple">${refreshCycle}</div><div class="kpi-lbl">Ciclos Refresco</div></div>`;
}

/* ── System overview cards ──────────────────────────────── */
function renderOverview() {
  const tempDev=devByKw('DHT22'), fanDev=devByKw('Extractor'), airDev=devByKw('Anemómetro');
  const temp=parseFloat(tempDev?.value)||0;
  const fan=parseInt(fanDev?.value)||0;
  const air=parseFloat(airDev?.value)||0;
  const rackStatus=temp>55?'critical':temp>40?'warning':'normal';

  const lockDev=devByKw('Cerradura'), cajaDev=devByKw('Presión Caja');
  const locked=lockDev?.powered===false;
  const hasPkg=parseFloat(cajaDev?.value||0)>0;
  const accessStatus=locked?'normal':(hasPkg?'normal':'pending');

  const gasDev=devByKw('MQ-2'), currentDev=devByKw('ACS712');
  const gasLevel=parseInt(gasDev?.value)||0;
  const watts2=parseFloat(currentDev?.value?.split('/')[1])||0;
  const energyStatus=gasLevel>50?'critical':watts2>800?'warning':'normal';

  document.getElementById('overviewGrid').innerHTML=`
    <!-- Rack -->
    <div class="sys-overview-card">
      <div class="soc-header rack">
        <div class="soc-icon">🖥️</div>
        <div><div class="soc-title">Smart Rack</div><div class="soc-sub">Monitoreo térmico del servidor</div></div>
        <span class="badge ${rackStatus}" style="margin-left:auto">${rackStatus.toUpperCase()}</span>
      </div>
      <div class="soc-body">
        <div class="soc-row"><span class="soc-key">Temperatura</span><span class="soc-val ${temp>55?'red':temp>40?'yellow':'cyan'}">${temp.toFixed(1)}°C</span></div>
        <div class="soc-row"><span class="soc-key">Flujo de Aire</span><span class="soc-val ${air<0.5?'red':'green'}">${air.toFixed(1)} m/s</span></div>
        <div class="soc-row"><span class="soc-key">Ventiladores</span><span class="soc-val ${fan>=100?'red':'cyan'}">${fan}%</span></div>
        <div class="soc-row"><span class="soc-key">Eventos críticos</span><span class="soc-val ${thermalEvents.filter(e=>e.status==='critical').length>0?'red':'green'}">${thermalEvents.filter(e=>e.status==='critical').length}</span></div>
        <div class="soc-sparkline"><canvas class="soc-canvas" id="sparkRack"></canvas></div>
      </div>
    </div>
    <!-- Acceso -->
    <div class="sys-overview-card">
      <div class="soc-header access">
        <div class="soc-icon">📦</div>
        <div><div class="soc-title">Paquetería Segura</div><div class="soc-sub">Control de acceso y caja</div></div>
        <span class="badge ${accessStatus}" style="margin-left:auto">${accessStatus.toUpperCase()}</span>
      </div>
      <div class="soc-body">
        <div class="soc-row"><span class="soc-key">Cerradura</span><span class="soc-val ${locked?'green':'yellow'}">${locked?'🔒 CERRADA':'🔓 ABIERTA'}</span></div>
        <div class="soc-row"><span class="soc-key">Paquete en caja</span><span class="soc-val ${hasPkg?'green':'white'}">${hasPkg?'📦 Sí':'Vacía'}</span></div>
        <div class="soc-row"><span class="soc-key">Visitas hoy</span><span class="soc-val cyan">${accessLogs.length}</span></div>
        <div class="soc-row"><span class="soc-key">Paquetes recibidos</span><span class="soc-val green">${accessLogs.filter(e=>e.packageDetected).length}</span></div>
        <div class="soc-sparkline"><canvas class="soc-canvas" id="sparkAccess"></canvas></div>
      </div>
    </div>
    <!-- Energía -->
    <div class="sys-overview-card">
      <div class="soc-header energy">
        <div class="soc-icon">⚡</div>
        <div><div class="soc-title">Energía Hogar</div><div class="soc-sub">Gas, corriente y relevadores</div></div>
        <span class="badge ${energyStatus}" style="margin-left:auto">${energyStatus.toUpperCase()}</span>
      </div>
      <div class="soc-body">
        <div class="soc-row"><span class="soc-key">Consumo Total</span><span class="soc-val ${watts2>800?'red':watts2>500?'yellow':'green'}">${watts2} W</span></div>
        <div class="soc-row"><span class="soc-key">Nivel de Gas</span><span class="soc-val ${gasLevel>50?'red':gasLevel>25?'yellow':'green'}">${gasLevel} ppm</span></div>
        <div class="soc-row"><span class="soc-key">Alertas gas</span><span class="soc-val ${energyEvents.filter(e=>e.gasAlert).length>0?'red':'green'}">${energyEvents.filter(e=>e.gasAlert).length}</span></div>
        <div class="soc-row"><span class="soc-key">Relevadores on</span><span class="soc-val cyan">${devices.filter(d=>d.type==='actuador'&&(d.location?.toLowerCase().includes('sala')||d.location?.toLowerCase().includes('cocina'))&&d.powered).length}/2</span></div>
        <div class="soc-sparkline"><canvas class="soc-canvas" id="sparkEnergy"></canvas></div>
      </div>
    </div>`;

  // Sparklines
  requestAnimationFrame(()=>{
    drawSparkline('sparkRack',   histRack,   '#00e5ff');
    drawSparkline('sparkAccess', histAccess, '#00ff9d');
    drawSparkline('sparkEnergy', histEnergy, '#ffb300');
  });
}

function drawSparkline(id, data, color) {
  const canvas=document.getElementById(id); if (!canvas||data.length<2) return;
  const ctx=canvas.getContext('2d'), w=canvas.offsetWidth||300, h=36;
  canvas.width=w; canvas.height=h;
  ctx.clearRect(0,0,w,h);
  const max=Math.max(...data,1);
  ctx.beginPath(); ctx.strokeStyle=color; ctx.lineWidth=1.5; ctx.shadowColor=color; ctx.shadowBlur=4;
  data.forEach((v,i)=>{
    const x=(i/(data.length-1))*w, y=h-(v/max)*(h-4)-2;
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  }); ctx.stroke(); ctx.shadowBlur=0;
  ctx.beginPath(); ctx.fillStyle=color+'22';
  data.forEach((v,i)=>{ const x=(i/(data.length-1))*w,y=h-(v/max)*(h-4)-2; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
  ctx.lineTo(w,h); ctx.lineTo(0,h); ctx.closePath(); ctx.fill();
}

/* ── Mini charts ────────────────────────────────────────── */
function renderCharts() {
  drawBarChart('chartRack',   histRack,   '#00e5ff', 'Temperatura (sim.)');
  drawBarChart('chartAccess', histAccess, '#00ff9d', 'Eventos Acceso');
  drawBarChart('chartEnergy', histEnergy, '#ffb300', 'Consumo Watts (sim.)');
}

function drawBarChart(id, data, color, label) {
  const canvas=document.getElementById(id); if(!canvas) return;
  const ctx=canvas.getContext('2d'), w=canvas.offsetWidth||300, h=100;
  canvas.width=w; canvas.height=h; ctx.clearRect(0,0,w,h);
  if (data.length<2) { ctx.fillStyle=color+'33'; ctx.fillRect(0,0,w,h); return; }
  const max=Math.max(...data,1), pad={t:8,b:20,l:30,r:8};
  const cW=w-pad.l-pad.r, cH=h-pad.t-pad.b;
  ctx.strokeStyle='rgba(30,48,80,0.5)'; ctx.lineWidth=1;
  for(let i=0;i<=3;i++){const y=pad.t+(cH/3)*i;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();}
  const bW=(cW/data.length)*0.6, gap=cW/data.length;
  data.forEach((v,i)=>{
    const x=pad.l+gap*i+(gap-bW)/2, bH=Math.max((v/max)*cH,v>0?2:0), y=pad.t+cH-bH;
    const g=ctx.createLinearGradient(0,y,0,pad.t+cH); g.addColorStop(0,color); g.addColorStop(1,color+'33');
    ctx.fillStyle=g; ctx.fillRect(x,y,bW,bH);
    ctx.fillStyle='#3d6080'; ctx.font='8px Space Mono'; ctx.textAlign='center';
    ctx.fillText(`T-${data.length-i-1}`,x+bW/2,h-6);
  });
}

/* ── Event tables ───────────────────────────────────────── */
function renderEventTables() {
  renderEventTable('thermalTable', thermalEvents, [
    {k:'timestamp', label:'Hora', fmt: r=>`<span class="et-time">${fmtTs(r.timestamp)}</span>`},
    {k:'temperature', label:'Temp', fmt: r=>`<span class="et-val" style="color:${r.status==='critical'?'var(--danger)':r.status==='warning'?'var(--warn)':'var(--rack)'}">${r.temperature}°C</span>`},
    {k:'fanSpeed', label:'Fan', fmt: r=>`<span style="color:var(--muted);font-family:var(--font-mono)">${r.fanSpeed}%</span>`},
    {k:'status', label:'Estado', fmt: r=>`<span class="badge ${r.status}">${r.status.toUpperCase()}</span>`},
    {k:'action', label:'Acción', fmt: r=>`<span style="color:var(--muted)">${r.action||'none'}</span>`}
  ]);
  renderEventTable('accessTable', accessLogs, [
    {k:'timestamp', label:'Hora', fmt: r=>`<span class="et-time">${fmtTs(r.timestamp)}</span>`},
    {k:'eventType', label:'Tipo', fmt: r=>`<span style="color:var(--access);font-family:var(--font-mono)">${r.eventType}</span>`},
    {k:'boxOpened', label:'Caja', fmt: r=>`<span style="color:${r.boxOpened?'var(--warn)':'var(--muted)'}">${r.boxOpened?'🔓 Abierta':'Cerrada'}</span>`},
    {k:'packageDetected', label:'Paquete', fmt: r=>`<span style="color:${r.packageDetected?'var(--access)':'var(--muted)'}">${r.packageDetected?'📦 Sí':'No'}</span>`},
    {k:'status', label:'Estado', fmt: r=>`<span class="badge ${r.status||'pending'}">${(r.status||'pending').toUpperCase()}</span>`}
  ]);
  renderEventTable('energyTable', energyEvents, [
    {k:'timestamp', label:'Hora', fmt: r=>`<span class="et-time">${fmtTs(r.timestamp)}</span>`},
    {k:'sector', label:'Sector', fmt: r=>`<span style="color:var(--energy);font-family:var(--font-mono)">${r.sector||'N/A'}</span>`},
    {k:'powerWatts', label:'Watts', fmt: r=>`<span class="et-val" style="color:${(r.powerWatts||0)>800?'var(--danger)':(r.powerWatts||0)>500?'var(--warn)':'var(--access)'}">${r.powerWatts||0}W</span>`},
    {k:'gasAlert', label:'Gas', fmt: r=>`<span style="color:${r.gasAlert?'var(--danger)':'var(--muted)'}">${r.gasAlert?'🚨 ALERTA':'Normal'}</span>`},
    {k:'action', label:'Acción', fmt: r=>`<span style="color:var(--muted);font-size:0.65rem">${r.action||'none'}</span>`}
  ]);
}

function renderEventTable(id, data, cols) {
  const el=document.getElementById(id); if(!el) return;
  if (!data.length) { el.innerHTML='<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--muted);font-family:var(--font-mono);font-size:0.78rem">Sin eventos registrados aún.</td></tr>'; return; }
  el.innerHTML=data.map((r,i)=>`
    <tr>
      <td class="row-idx">${String(i+1).padStart(2,'0')}</td>
      ${cols.map(c=>`<td>${c.fmt(r)}</td>`).join('')}
    </tr>`).join('');
}

/* ── Full refresh ───────────────────────────────────────── */
async function fullRefresh() {
  refreshCycle++;
  try { await fetchAll(); } catch(e){ console.warn(e.message); }

  // Update sparkline history arrays
  const temp=parseFloat(devByKw('DHT22')?.value)||0;
  const visits=accessLogs.length;
  const watts=parseFloat(devByKw('ACS712')?.value?.split('/')[1])||0;
  histRack.push(temp);   if(histRack.length>10)   histRack.shift();
  histAccess.push(visits); if(histAccess.length>10) histAccess.shift();
  histEnergy.push(watts); if(histEnergy.length>10) histEnergy.shift();

  renderKPI();
  renderOverview();
  renderCharts();
  renderEventTables();
  countdown=3;
}

setInterval(()=>{
  countdown--;
  const el=document.getElementById('countdown'); if(el) el.textContent=countdown;
  if(countdown<=0) fullRefresh();
},1000);

fullRefresh();
