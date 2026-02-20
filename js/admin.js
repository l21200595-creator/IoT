/* ============================================================
   NEXUS·IOT Smart Home — admin.js
   ============================================================ */
const BASE = 'https://698a1772c04d974bc6a1532f.mockapi.io/api/v1';

function sysOf(d) {
  if (!d) return 'hub';
  const loc = (d.location || '').toLowerCase();
  if (loc.includes('rack') || loc.includes('servidor')) return 'rack';
  if (loc.includes('entrada') || loc.includes('caja') || loc.includes('puerta')) return 'access';
  if (loc.includes('tablero') || loc.includes('sala') || loc.includes('cocina')) return 'energy';
  if (d.type === 'gateway') return 'hub';
  return 'hub';
}

const ICON_MAP = { sensor:'🔬', actuador:'⚙️', camara:'📷', controlador:'🎛️', gateway:'🔀' };
function getIcon(type) { return ICON_MAP[type] || '📡'; }

/* ── API ────────────────────────────────────────────────── */
const API = {
  getAll: async () => {
    const r = await fetch(`${BASE}/devices`);
    if (!r.ok) throw new Error('Error MockAPI');
    return (await r.json()).map(d => ({ ...d, icon: d.icon || getIcon(d.type) }));
  },
  create: async (data) => {
    const r = await fetch(`${BASE}/devices`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ...data, icon: data.icon || getIcon(data.type), powered: data.status==='online', value:'N/A', lastPing: new Date().toISOString(), createdAt: new Date().toISOString() })
    });
    if (!r.ok) throw new Error('Error al crear');
    return r.json();
  },
  update: async (id, data) => {
    const r = await fetch(`${BASE}/devices/${id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ...data, icon: data.icon || getIcon(data.type), lastPing: new Date().toISOString() })
    });
    if (!r.ok) throw new Error('Error al actualizar');
    return r.json();
  },
  delete: async (id) => {
    const r = await fetch(`${BASE}/devices/${id}`, { method:'DELETE' });
    if (!r.ok) throw new Error('Error al eliminar');
    return r.json();
  }
};

/* ── State ──────────────────────────────────────────────── */
let devices = [], editingId = null, filterSys = 'all';

async function loadAll() {
  showLoading();
  try {
    devices = await API.getAll();
    renderStats();
    renderTable();
  } catch(e) {
    document.getElementById('deviceTableBody').innerHTML =
      `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--danger);font-family:var(--font-mono);font-size:0.8rem">❌ ${e.message}</td></tr>`;
    toast('❌ Error MockAPI', 'danger');
  }
}

function showLoading() {
  document.getElementById('deviceTableBody').innerHTML =
    `<tr><td colspan="8" style="text-align:center;padding:2.5rem;color:var(--muted);font-family:var(--font-mono);font-size:0.8rem">
      <div style="display:inline-block;width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--rack);border-radius:50%;animation:spin 0.8s linear infinite"></div>
      <br><br>Cargando dispositivos...
    </td></tr>`;
}

/* ── Stats ──────────────────────────────────────────────── */
function renderStats() {
  const online = devices.filter(d => d.status==='online').length;
  const rack   = devices.filter(d => sysOf(d)==='rack').length;
  const access = devices.filter(d => sysOf(d)==='access').length;
  const energy = devices.filter(d => sysOf(d)==='energy').length;
  document.getElementById('statTotal').textContent  = devices.length;
  document.getElementById('statOnline').textContent = online;
  document.getElementById('statRack').textContent   = rack;
  document.getElementById('statAccess').textContent = access;
  document.getElementById('statEnergy').textContent = energy;
}

/* ── Table ──────────────────────────────────────────────── */
function renderTable() {
  const q  = (document.getElementById('searchInput').value || '').toLowerCase();
  let list = devices.filter(d =>
    d.name.toLowerCase().includes(q) || d.location.toLowerCase().includes(q) || d.type.toLowerCase().includes(q)
  );
  if (filterSys !== 'all') list = list.filter(d => sysOf(d) === filterSys);

  const tbody = document.getElementById('deviceTableBody');
  tbody.innerHTML = '';
  document.getElementById('emptyState').style.display = list.length===0 ? 'block' : 'none';

  const SYS_LABELS = { rack:'🖥️ Rack', access:'📦 Acceso', energy:'⚡ Energía', hub:'🔀 Hub' };

  list.forEach(d => {
    const sys  = sysOf(d);
    const diff = Math.floor((Date.now() - new Date(d.lastPing).getTime()) / 1000);
    const ago  = isNaN(diff)||diff<0 ? 'N/A' : diff<60 ? `${diff}s` : diff<3600 ? `${Math.floor(diff/60)}m` : `${Math.floor(diff/3600)}h`;
    tbody.innerHTML += `
      <tr class="sys-stripe-${sys}">
        <td><div class="device-icon-cell">${d.icon}</div></td>
        <td><div class="device-name">${d.name}</div><div class="device-meta">${d.id} · ${d.ip} · ${d.protocol}</div></td>
        <td><span class="badge-type">${d.type.toUpperCase()}</span></td>
        <td><span class="badge-location">${d.location}</span></td>
        <td style="font-family:var(--font-mono);font-size:0.72rem;color:var(--muted)">${SYS_LABELS[sys]||sys}</td>
        <td><div class="status-dot"><span class="dot ${d.status==='online'?'on':'off'}"></span>${d.status}</div></td>
        <td style="font-family:var(--font-mono);font-size:0.72rem;color:var(--muted)">hace ${ago}</td>
        <td>
          <div class="action-btns">
            <button class="btn-icon edit" onclick="openModal('${d.id}')" title="Editar">✏️</button>
            <button class="btn-icon del"  onclick="deleteDev('${d.id}')" title="Eliminar">🗑️</button>
          </div>
        </td>
      </tr>`;
  });
}

function setFilter(sys) {
  filterSys = sys;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-filter="${sys}"]`)?.classList.add('active');
  renderTable();
}

/* ── Modal ──────────────────────────────────────────────── */
function openModal(id = null) {
  editingId = id;
  document.getElementById('deviceForm').reset();
  document.getElementById('devId').value = '';
  if (id) {
    const d = devices.find(x=>x.id===id);
    document.getElementById('modalTitleText').textContent = 'Editar';
    ['Name','Type','Location','Ip','Protocol','Status','Desc'].forEach(f => {
      const el = document.getElementById('f'+f); if (!el) return;
      const key = f.toLowerCase() === 'desc' ? 'description' : f.toLowerCase().replace(/^ip$/, 'ip');
      el.value = d[key] || d[f.toLowerCase()] || '';
    });
    document.getElementById('fStatus').value = d.status;
    document.getElementById('devId').value = d.id;
  } else {
    document.getElementById('modalTitleText').textContent = 'Nuevo';
    document.getElementById('fIp').value = `192.168.1.${Math.floor(Math.random()*150+20)}`;
  }
  document.getElementById('modalOverlay').classList.add('open');
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); editingId=null; }

async function saveDevice(e) {
  e.preventDefault();
  const data = {
    name:        document.getElementById('fName').value,
    type:        document.getElementById('fType').value,
    location:    document.getElementById('fLocation').value,
    ip:          document.getElementById('fIp').value,
    protocol:    document.getElementById('fProtocol').value,
    status:      document.getElementById('fStatus').value,
    description: document.getElementById('fDesc').value
  };
  const id = document.getElementById('devId').value;
  try {
    if (id) { await API.update(id,data); toast('✅ Dispositivo actualizado','rack'); }
    else    { await API.create(data);    toast('✅ Dispositivo creado','rack'); }
    closeModal(); await loadAll();
  } catch { toast('❌ Error al guardar','danger'); }
}

async function deleteDev(id) {
  const d = devices.find(x=>x.id===id);
  if (!confirm(`¿Eliminar "${d?.name}"?`)) return;
  try { await API.delete(id); toast(`🗑️ "${d?.name}" eliminado`,'warn'); await loadAll(); }
  catch { toast('❌ Error al eliminar','danger'); }
}

/* ── Toast ──────────────────────────────────────────────── */
function toast(msg, type='rack') {
  const el = document.createElement('div');
  el.className = `toast-item ${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(()=>el.remove(), 4000);
}

/* ── Init ───────────────────────────────────────────────── */
document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target===document.getElementById('modalOverlay')) closeModal();
});
setInterval(async()=>{ try { devices=await API.getAll(); renderStats(); renderTable(); } catch{} }, 6000);
loadAll();
