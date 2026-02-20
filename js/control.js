/* ============================================================
   NEXUS·IOT Smart Home — control.js
   3 sistemas: Rack / Acceso / Energía
   ============================================================ */
const BASE = 'https://698a1772c04d974bc6a1532f.mockapi.io/api/v1';

/* ── State ──────────────────────────────────────────────── */
let devices       = [];
let thermalEvents = [], accessLogs = [], energyEvents = [];
let audioCtx      = null;
let shutdownTimer = null, shutdownSecs = 60;
let boxTimer      = null, boxSecs     = 0;
let travelMode    = false;
const actionLogs  = { rack:[], access:[], energy:[] };

/* ── Audio alerts ───────────────────────────────────────── */
function playAudio(type) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    const ctx = audioCtx;
    const patterns = {
      warn:     [{f:880,t:0},{f:660,t:0.2}],
      critical: [{f:1200,t:0},{f:800,t:0.15},{f:1200,t:0.3},{f:800,t:0.45}],
      access:   [{f:600,t:0},{f:900,t:0.18}],
      gas:      [{f:440,t:0},{f:440,t:0.15},{f:440,t:0.3}]
    };
    (patterns[type]||patterns.warn).forEach(({f,t}) => {
      const osc=ctx.createOscillator(), gain=ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type='sine'; osc.frequency.value=f;
      gain.gain.setValueAtTime(0.3, ctx.currentTime+t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+t+0.12);
      osc.start(ctx.currentTime+t); osc.stop(ctx.currentTime+t+0.13);
    });
  } catch {}
}

/* ── API helpers ────────────────────────────────────────── */
async function patchDevice(id, patch) {
  await fetch(`${BASE}/devices/${id}`, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ ...patch, lastPing: new Date().toISOString() })
  }).catch(()=>{});
}
async function postEvent(table, data) {
  await fetch(`${BASE}/${table}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ ...data, timestamp: new Date().toISOString() })
  }).catch(()=>{});
}
async function fetchAll() {
  const [dr, tr, ar, er] = await Promise.all([
    fetch(`${BASE}/devices`),
    fetch(`${BASE}/thermalEvents`),
    fetch(`${BASE}/accessLog`),
    fetch(`${BASE}/energyEvents`)
  ]);
  devices       = dr.ok ? (await dr.json()).map(d=>({...d, icon:d.icon||'📡'})) : [];
  thermalEvents = tr.ok ? await tr.json() : [];
  accessLogs    = ar.ok ? await ar.json() : [];
  energyEvents  = er.ok ? await er.json() : [];
}

function devByName(kw) { return devices.find(d=>d.name.toLowerCase().includes(kw.toLowerCase())); }

/* ── Logging ────────────────────────────────────────────── */
function log(sys, msg) {
  const t = new Date().toLocaleTimeString('es-MX',{hour12:false});
  actionLogs[sys].unshift({t,msg});
  if (actionLogs[sys].length>30) actionLogs[sys].pop();
  const el=document.getElementById(`log-${sys}`);
  if (el) el.innerHTML=actionLogs[sys].slice(0,12).map(l=>
    `<div class="log-row"><span class="log-time">${l.t}</span><span class="log-msg">${l.msg}</span></div>`
  ).join('');
}

/* ── Toast ──────────────────────────────────────────────── */
function toast(msg, type='rack') {
  const el=document.createElement('div');
  el.className=`toast-item ${type}`; el.innerHTML=msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(()=>el.remove(), type==='danger'?7000:4500);
}

/* ══════════════════════════════════════════════════════════
   SISTEMA 1 — SMART RACK
   ══════════════════════════════════════════════════════════ */

function renderRack() {
  const tempDev = devByName('DHT22');
  const fanDev  = devByName('Extractor');
  const airDev  = devByName('Anemómetro');
  const relDev  = devByName('Relevador Corte');

  const temp    = parseFloat(tempDev?.value) || 35;
  const humid   = tempDev?.value?.split('/')[1]?.trim().replace('%','') || '45';
  const airflow = parseFloat(airDev?.value) || 1.5;
  const fanPct  = parseInt(fanDev?.value) || 65;
  const relOn   = relDev?.powered || false;

  // Gauge
  drawTempGauge(temp);

  // Fan icon spin speed
  const fanIcon = document.getElementById('fanIcon');
  if (fanIcon) {
    const rpm = fanPct * 0.05;
    fanIcon.style.animation = fanPct > 0 ? `spin ${Math.max(0.3, 2 - rpm)}s linear infinite` : 'none';
  }

  // Fan bar
  const bar = document.getElementById('fanBar');
  if (bar) {
    bar.style.width = fanPct+'%';
    bar.className   = 'speed-fill' + (temp>55?' crit':temp>40?' hot':'');
  }
  const fanLabel = document.getElementById('fanLabel');
  if (fanLabel) fanLabel.textContent = fanPct+'%';

  // Metrics
  setValue('rackTemp',    temp.toFixed(1)+'°C',   temp>55?'var(--danger)':temp>40?'var(--warn)':'var(--rack)');
  setValue('rackHumid',   humid+'%',               'var(--rack)');
  setValue('rackAirflow', airflow.toFixed(1)+' m/s', airflow<0.5?'var(--danger)':'var(--access)');

  // Relay badge
  const relBadge = document.getElementById('relayBadge');
  if (relBadge) {
    relBadge.textContent   = relOn ? '⚡ ENERGIZADO' : '🔒 CORTADO';
    relBadge.className     = 'badge ' + (relOn ? 'normal' : 'critical');
  }

  // Auto-logic
  checkRackLogic(temp, airflow, fanDev, tempDev);
}

function drawTempGauge(temp) {
  const canvas = document.getElementById('gaugeCanvas');
  if (!canvas) return;
  const ctx=canvas.getContext('2d'), w=180, h=180, cx=90, cy=90, r=70;
  canvas.width=w; canvas.height=h;
  const startAngle=0.75*Math.PI, endAngle=2.25*Math.PI;
  const pct=Math.min(temp/80, 1);
  const color=temp>55?'#ff3d5a':temp>40?'#ffb300':'#00e5ff';

  ctx.beginPath(); ctx.arc(cx,cy,r,startAngle,endAngle);
  ctx.strokeStyle='rgba(30,48,80,0.8)'; ctx.lineWidth=10; ctx.lineCap='round'; ctx.stroke();

  ctx.beginPath(); ctx.arc(cx,cy,r,startAngle,startAngle+(endAngle-startAngle)*pct);
  ctx.strokeStyle=color; ctx.lineWidth=10; ctx.lineCap='round';
  ctx.shadowColor=color; ctx.shadowBlur=12; ctx.stroke(); ctx.shadowBlur=0;

  document.getElementById('gaugeValue').textContent = temp.toFixed(1);
  document.getElementById('gaugeValue').style.color = color;
}

function setValue(id, val, color='var(--rack)') {
  const el=document.getElementById(id); if (!el) return;
  el.textContent=val; el.style.color=color;
}

function checkRackLogic(temp, airflow, fanDev, tempDev) {
  // Warning threshold
  if (temp > 40 && temp < 55 && fanDev && parseInt(fanDev.value||0) < 100) {
    log('rack', `<span style="color:var(--warn)">⚠️ ALERTA</span> — ${temp.toFixed(1)}°C. Ventiladores al 100%`);
    toast(`🌡️ Temperatura alta: ${temp.toFixed(1)}°C — Ventiladores al máximo`, 'warn');
    playAudio('warn');
    patchDevice(fanDev.id, {value:'100', powered:true});
    postEvent('thermalEvents',{deviceId:fanDev.id,temperature:temp,fanSpeed:100,status:'warning',action:'fans_max',message:`⚠️ ${temp.toFixed(1)}°C. Fans al 100%`});
    fanDev.value='100';
  }
  // Critical threshold
  if (temp >= 55 && airflow < 0.5 && !shutdownTimer) {
    log('rack','<span style="color:var(--danger)">🚨 CRÍTICO</span> — Fallo ventilación. Apagado en 60s');
    toast('🚨 CRÍTICO: Fallo ventilación detectado. Servidor apagando en 60s','danger');
    playAudio('critical');
    postEvent('thermalEvents',{deviceId:tempDev?.id||'1',temperature:temp,airflow,fanSpeed:100,status:'critical',action:'ssh_shutdown',message:`🚨 ${temp.toFixed(1)}°C y flujo=0. SSH shutdown iniciado`});
    startShutdownCountdown();
  }
}

function startShutdownCountdown(secs=60) {
  if (shutdownTimer) return;
  shutdownSecs=secs;
  const panel=document.getElementById('shutdownPanel'); if (panel) panel.classList.add('active');
  shutdownTimer=setInterval(()=>{
    shutdownSecs--;
    const el=document.getElementById('shutdownTimer'); if (el) el.textContent=shutdownSecs+'s';
    if (shutdownSecs<=0) {
      clearInterval(shutdownTimer); shutdownTimer=null;
      log('rack','<span style="color:var(--danger)">🔌 RELAY CORTADO</span> — Servidor apagado por seguridad');
      toast('🔌 Relevador de energía cortado — servidor apagado','danger');
      playAudio('critical');
      const panel=document.getElementById('shutdownPanel'); if (panel) panel.classList.remove('active');
    }
  },1000);
}

function cancelShutdown() {
  if (shutdownTimer) { clearInterval(shutdownTimer); shutdownTimer=null; }
  const panel=document.getElementById('shutdownPanel'); if (panel) panel.classList.remove('active');
  log('rack','<span style="color:var(--access)">✅ Apagado cancelado</span> — intervenido manualmente');
  toast('✅ Apagado de emergencia cancelado','rack');
}

function fanMax() {
  const d=devByName('Extractor');
  if (d) { patchDevice(d.id,{value:'100',powered:true}); d.value='100'; renderRack(); }
  log('rack','<span style="color:var(--rack)">💨 Fans al 100%</span> — activado manualmente');
  toast('🌀 Extractores al 100% activados','rack');
}

function triggerSSH() {
  log('rack','<span style="color:var(--warn)">💻 SSH Shutdown</span> — comando enviado al servidor');
  toast('💻 Comando SSH shutdown enviado al servidor','warn');
  playAudio('warn');
}

function cutRelay() {
  const d=devByName('Relevador Corte');
  if (d) { patchDevice(d.id,{powered:false,value:'CORTADO'}); d.powered=false; }
  log('rack','<span style="color:var(--danger)">🔌 RELAY CORTADO</span> — energía del rack desconectada');
  toast('🔌 Relevador de energía cortado','danger');
  playAudio('critical');
}

/* ══════════════════════════════════════════════════════════
   SISTEMA 2 — PAQUETERÍA SEGURA
   ══════════════════════════════════════════════════════════ */

function renderAccess() {
  const camDev    = devByName('ESP32');
  const lockDev   = devByName('Cerradura');
  const tapeteDev = devByName('Tapete');
  const cajaDev   = devByName('Presión Caja');
  const alarmDev  = devByName('Alarma');

  const lockOpen    = lockDev?.powered || false;
  const tapWeight   = parseFloat(tapeteDev?.value) || 0;
  const cajaWeight  = parseFloat(cajaDev?.value) || 0;
  const alarmActive = alarmDev?.powered || false;

  const doorVisual = document.getElementById('doorVisual');
  if (doorVisual) {
    doorVisual.textContent = lockOpen ? '🔓' : '🔐';
    doorVisual.className   = 'door-visual' + (alarmActive?' alert': lockOpen?' open':'');
  }

  setValue('sensorTapete', tapWeight>0 ? `${tapWeight} kg — ⚠️ PRESENCIA`:`Sin peso`, tapWeight>0?'var(--warn)':'var(--muted)');
  setValue('sensorCaja',   cajaWeight>0 ? `${cajaWeight} kg — 📦 PAQUETE`:`Vacía`,   cajaWeight>0?'var(--access)':'var(--muted)');
  setValue('lockStatus',   lockOpen ? '🔓 ABIERTA' : '🔒 CERRADA', lockOpen?'var(--access)':'var(--text)');
  setValue('camStatus',    camDev?.status==='online' ? '🟢 Online' : '🔴 Offline', camDev?.status==='online'?'var(--access)':'var(--danger)');
}

function unlockBox() {
  const d=devByName('Cerradura');
  if (d) { patchDevice(d.id,{powered:true,value:'ABIERTA'}); d.powered=true; }
  log('access','<span class="log-ok">🔓 CAJA ABIERTA</span> — cerradura liberada manualmente');
  toast('🔓 Caja de seguridad abierta','access');
  playAudio('access');
  startBoxTimer();
  postEvent('accessLog',{deviceId:d?.id||'7',eventType:'doorbell',hasPhoto:false,boxOpened:true,packageDetected:false,boxOpenDuration:0,status:'pending',notes:'Apertura manual desde control'});
  renderAccess();
}

function lockBox() {
  const d=devByName('Cerradura'), alarm=devByName('Alarma');
  if (d)     { patchDevice(d.id,{powered:false,value:'CERRADA'}); d.powered=false; }
  if (alarm) { patchDevice(alarm.id,{powered:false,value:'SILENCIO'}); alarm.powered=false; }
  stopBoxTimer();
  log('access','<span class="log-ok">🔒 CAJA CERRADA</span> — cerradura asegurada');
  toast('🔒 Caja de seguridad cerrada y asegurada','access');
  renderAccess();
}

function triggerCamera() {
  log('access','<span style="color:var(--rack)">📷 FOTO CAPTURADA</span> — imagen tomada desde ESP32-CAM');
  toast('📷 Foto capturada y enviada — presencia detectada en entrada','rack');
  playAudio('access');
  postEvent('accessLog',{deviceId:'6',eventType:'pressure',hasPhoto:true,boxOpened:false,packageDetected:false,boxOpenDuration:0,status:'pending',notes:'Foto tomada por trigger manual'});
}

function startBoxTimer() {
  if (boxTimer) return;
  boxSecs=0;
  const wrap=document.getElementById('boxTimerWrap'); if(wrap) wrap.classList.add('active');
  boxTimer=setInterval(()=>{
    boxSecs++;
    const el=document.getElementById('boxTimerVal'); if(el) el.textContent=boxSecs+'s';
    // Warn at 2 min
    if (boxSecs===120) {
      playAudio('warn');
      toast('🚨 Caja abierta +2 minutos. Alarma activada — cerrando en 30s','danger');
      log('access','<span class="log-danger">🚨 TIEMPO EXCEDIDO</span> — caja abierta 120s, alarma activada');
      const alarm=devByName('Alarma');
      if (alarm) { patchDevice(alarm.id,{powered:true,value:'ALARMA ACTIVA'}); alarm.powered=true; }
    }
    // Auto-close at 2:30 min
    if (boxSecs===150) {
      log('access','<span class="log-danger">🔒 CIERRE AUTOMÁTICO</span> — caja cerrada tras 150s');
      lockBox();
    }
  },1000);
}

function stopBoxTimer() {
  if (boxTimer) { clearInterval(boxTimer); boxTimer=null; boxSecs=0; }
  const wrap=document.getElementById('boxTimerWrap'); if(wrap) wrap.classList.remove('active');
}

/* ══════════════════════════════════════════════════════════
   SISTEMA 3 — ENERGÍA HOGAR
   ══════════════════════════════════════════════════════════ */

function renderEnergy() {
  const currentDev = devByName('ACS712');
  const gasDev     = devByName('MQ-2');
  const salaDev    = devByName('Sala');
  const cocinaDev  = devByName('Cocina');
  const valveDev   = devByName('Válvula');

  const watts     = parseFloat(currentDev?.value?.split('/')[1]) || 253;
  const gasLevel  = parseInt(gasDev?.value) || 12;
  const salaOn    = salaDev?.powered !== false;
  const cocinaOn  = cocinaDev?.powered !== false;
  const valveOpen = valveDev?.powered === false; // powered=false means valve open (fail-safe)

  // Watts
  const wattColor = watts>800?'var(--danger)':watts>500?'var(--warn)':'var(--access)';
  const wattClass = watts>800?'danger':watts>500?'high':'normal';
  setValue('totalWatts', watts+' W', wattColor);
  const pwFill=document.getElementById('powerFill');
  if (pwFill) {
    pwFill.style.width=Math.min(watts/1500*100,100)+'%';
    pwFill.style.background=watts>800?'var(--danger)':watts>500?'var(--warn)':'var(--access)';
  }

  // Sala
  setValue('salaWatts', (salaOn ? Math.floor(watts*0.6) : 0)+' W', salaOn&&watts>500?'var(--warn)':'var(--access)');
  const salaPF=document.getElementById('salaPowerFill');
  if (salaPF) { salaPF.style.width=(salaOn?Math.min(watts*0.6/800*100,100):0)+'%'; salaPF.style.background=salaOn&&watts>500?'var(--warn)':'var(--access)'; }

  // Cocina
  setValue('cocinaWatts', (cocinaOn ? Math.floor(watts*0.4) : 0)+' W', 'var(--access)');
  const cocinaPF=document.getElementById('cocinaPowerFill');
  if (cocinaPF) { cocinaPF.style.width=(cocinaOn?Math.min(watts*0.4/600*100,100):0)+'%'; cocinaPF.style.background='var(--access)'; }

  // Gas
  const gasColor=gasLevel>50?'var(--danger)':gasLevel>25?'var(--warn)':'var(--access)';
  setValue('gasLevel', gasLevel+' ppm', gasColor);
  const gasFill=document.getElementById('gasFill');
  if (gasFill) {
    gasFill.style.width=Math.min(gasLevel/100*100,100)+'%';
    gasFill.style.background=gasColor;
  }
  const gasCard=document.getElementById('gasCard');
  if (gasCard) gasCard.className='gas-card'+(gasLevel>50?' alerting':'');

  // Valve
  setValue('valveStatus', valveOpen?'🟢 ABIERTA':'🔴 CERRADA', valveOpen?'var(--access)':'var(--danger)');

  // Travel mode UI
  const tmStatus=document.getElementById('travelStatus');
  if (tmStatus) {
    tmStatus.textContent = travelMode ? '✈️ MODO VIAJE ACTIVO' : 'Modo viaje desactivado';
    tmStatus.className   = 'travel-status' + (travelMode?' active':'');
  }

  // Auto-logic gas
  checkEnergyLogic(gasLevel, watts, gasDev, valveDev);
}

function checkEnergyLogic(gasLevel, watts, gasDev, valveDev) {
  if (gasLevel > 50) {
    log('energy','<span style="color:var(--danger)">🚨 GAS DETECTADO</span> — válvula cerrando automáticamente');
    toast(`🚨 ALERTA GAS: ${gasLevel}ppm detectados. Válvula cerrada automáticamente`,'danger');
    playAudio('gas');
    if (valveDev) { patchDevice(valveDev.id,{powered:true,value:'CERRADA'}); valveDev.powered=true; }
    postEvent('energyEvents',{deviceId:gasDev?.id||'12',sector:'cocina',gasLevel,gasAlert:true,action:'gas_valve_close',message:`🚨 GAS ${gasLevel}ppm. Válvula cerrada`});
  }
  if (travelMode && watts > 800) {
    log('energy','<span style="color:var(--warn)">⚠️ CONSUMO ALTO</span> — Modo Viaje: '+watts+'W en sala');
    toast(`⚠️ Modo Viaje: consumo alto (${watts}W) ¿TV encendida? Responde en 15min`,'energy');
    playAudio('warn');
    postEvent('energyEvents',{sector:'sala',powerWatts:watts,travelMode:true,action:'alert',message:`⚠️ Modo Viaje: ${watts}W en sala`});
  }
}

function toggleTravelMode() {
  travelMode = !travelMode;
  log('energy', travelMode ? '<span style="color:var(--energy)">✈️ MODO VIAJE</span> — activado' : '<span style="color:var(--muted)">🏠 Modo normal</span> — desactivado');
  toast(travelMode ? '✈️ Modo Viaje activado — monitoreando consumo' : '🏠 Modo normal restaurado', 'energy');
  renderEnergy();
}

function setRelay(sector, state) {
  const dev=devByName(sector==='sala'?'Sala':'Cocina');
  if (dev) { patchDevice(dev.id,{powered:state,value:state?'ENCENDIDO':'CORTADO'}); dev.powered=state; }
  log('energy',`<span style="color:${state?'var(--access)':'var(--danger)'}">${state?'🟢 ENCENDIDO':'🔌 CORTADO'}</span> — Relevador ${sector}`);
  toast(`${state?'🟢':'🔌'} Relevador ${sector} ${state?'encendido':'cortado'}`, state?'energy':'danger');
  renderEnergy();
}

function setGasValve(open) {
  const d=devByName('Válvula');
  if (d) { patchDevice(d.id,{powered:!open,value:open?'ABIERTA':'CERRADA'}); d.powered=!open; }
  log('energy',`<span style="color:${open?'var(--access)':'var(--danger)'}">${open?'🟢 VÁLVULA ABIERTA':'🔴 VÁLVULA CERRADA'}</span>`);
  toast(`${open?'🟢 Válvula de gas abierta':'🔴 Válvula de gas cerrada — emergencia'}`, open?'energy':'danger');
  if (!open) playAudio('gas');
  renderEnergy();
}

/* ══════════════════════════════════════════════════════════
   TABS & MAIN LOOP
   ══════════════════════════════════════════════════════════ */

function switchTab(tab) {
  document.querySelectorAll('.sys-tab').forEach(t=>t.className='sys-tab');
  document.querySelectorAll('.sys-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById(`tab-${tab}`).className=`sys-tab active-${tab}`;
  document.getElementById(`panel-${tab}`).classList.add('active');
}

function renderAll() {
  renderRack();
  renderAccess();
  renderEnergy();
}

async function tick() {
  try { await fetchAll(); } catch {}
  renderAll();
}

/* ── Init ───────────────────────────────────────────────── */
tick();
setInterval(tick, 3000);
log('rack',   '🚀 Sistema Smart Rack iniciado');
log('access', '🚀 Sistema Paquetería iniciado');
log('energy', '🚀 Sistema Energía iniciado');
