/* =====================================================
   CORO SAN PABLO · v2 (Supabase: usuarios, roles y nube)
   ===================================================== */
const CFG = window.CORO_CONFIG || {};
const VERSION = 'v3.4';
const DEF_SETTINGS = {
  tolerance: 5, mode: 'proporcional', start: '18:00', step: 50,
  tramos: [ {upto:10,pct:100}, {upto:30,pct:75}, {upto:60,pct:50}, {upto:9999,pct:25} ]
};

let sb = null, authUser = null, me = null;           // me = perfil
let D = { members:[], sessions:[], att:[], profiles:[], bote:[], settings:{...DEF_SETTINGS}, lastBackup:null };
let tab = 'hoy', loading = true, booting = false;

/* ---------- utilidades ---------- */
const pad = n => String(n).padStart(2,'0');
const nowHM = () => { const d=new Date(); return pad(d.getHours())+':'+pad(d.getMinutes()); };
const today = () => { const d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); };
const toMin = hm => { const [h,m] = String(hm).split(':').map(Number); return h*60+m; };
function rel(hm, start){ let d = toMin(hm) - toMin(start); if(d < -720) d += 1440; if(d > 720) d -= 1440; return d; }
function durOf(start, end){ let d = toMin(end) - toMin(start); if(d <= 0) d += 1440; return d; }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eur = c => ((c||0)/100).toLocaleString('es-ES',{minimumFractionDigits:2, maximumFractionDigits:2}) + ' €';
const toCents = v => { let s = String(v||'').replace(/\s|€/g,''); if(s.includes(',')) s = s.replace(/\./g,'').replace(',','.'); const n = parseFloat(s); return isNaN(n)?0:Math.round(n*100); };
const fmtDate = d => { try{ return new Date(d+'T12:00:00').toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short'}); }catch(e){ return d; } };
const minTxt = m => m >= 60 ? Math.floor(m/60)+' h'+(m%60? ' '+(m%60)+' min':'') : m+' min';
const member = id => D.members.find(m => m.id === id);
const openSession = () => D.sessions.find(s => !s.closed && s.started !== false);
const plannedSessions = () => D.sessions.filter(s => !s.closed && s.started === false).sort((x,y)=>(x.date+x.start_time).localeCompare(y.date+y.start_time));
const mapUrl = p => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p + ', Sevilla');
const placeHtml = s => s && s.place ? `📍 <a href="${mapUrl(s.place)}" target="_blank" rel="noopener">${esc(s.place)}</a>` : '<span class="muted">Sitio sin indicar</span>';
async function notify(body, quiet){
  try{
    const { data, error } = await sb.functions.invoke('notify', { body });
    if(error) throw error;
    if(!quiet && data && typeof data.sent === 'number') toast(data.sent ? `📣 Aviso enviado a ${data.sent} móvil${data.sent>1?'es':''}` : '📣 Nadie tiene los avisos activados todavía');
    return data;
  }catch(e){
    console.warn('notify', e);
    let det = e && e.message || String(e);
    try{ const r = e && e.context; if(r && typeof r.status==='number'){ let t=''; try{ t = await r.clone().text(); }catch(_){} det = `HTTP ${r.status}` + (t ? ` · ${t.slice(0,160)}` : ''); } }catch(_){}
    if(!quiet){ sheet(`<h2>⚠️ No se pudo enviar el aviso</h2><p class="muted">Manda una captura de esto a quien configuró la app:</p><pre style="white-space:pre-wrap;background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px;font-size:13px">${esc(det)}</pre><button class="btn sec" data-act="closeSheet">Cerrar</button>`); }
    return null;
  }
}
const attOf = sid => D.att.filter(a => a.session_id === sid);
const attGet = (sid, mid) => D.att.find(a => a.session_id === sid && a.member_id === mid);
const isAdmin = () => !!(me && me.is_admin && me.status === 'approved');
const sortName = (a,b) => (a.name||'').localeCompare(b.name||'', 'es');
const userEmail = u => `${u.toLowerCase()}@${CFG.EMAIL_DOMAIN || 'corosanpablo.app'}`;
const S = () => D.settings;
const val = id => (document.getElementById(id)||{}).value;

function toast(t){ const el=document.getElementById('toast'); el.textContent=t; el.classList.add('on'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('on'),2400); }
function sheet(html){ document.getElementById('sheet').innerHTML = html ? `<div class="sheet-bg" data-act="closeSheet"><div class="sheet">${html}</div></div>` : ''; }
async function q(promise, silent){
  const { data, error } = await promise;
  if(error){ console.error(error); if(!silent) toast('⚠️ ' + traducir(error.message)); throw error; }
  return data;
}
function traducir(m){
  m = String(m||'');
  if(/Invalid login credentials/i.test(m)) return 'Usuario o contraseña incorrectos';
  if(/already registered|already been registered|duplicate key/i.test(m)) return 'Ese nombre de usuario ya existe';
  if(/Password should be at least/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres';
  if(/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sin conexión. Inténtalo de nuevo';
  if(/Email not confirmed/i.test(m)) return 'Falta desactivar «Confirm email» en Supabase';
  if(/rate limit/i.test(m)) return 'Demasiados intentos, espera un poco';
  return m;
}
function busy(el, on){ if(!el) return; el.disabled = on; el.style.opacity = on ? .6 : 1; }

/* ---------- cálculo del reparto ---------- */
function calc(s, rows, end, botinC, gastosC, st){
  st = st || S();
  const dur = durOf(s.start_time, end);
  const tol = Number(st.tolerance)||0;
  const step = Math.max(1, Number(st.step)||1);
  const out = rows.map(a => {
    const m = member(a.member_id);
    const r = { member_id:a.member_id, name: m ? m.name : '?', status:a.status, arrive:a.arrive||null, leave:a.leave||null, late:0, early:0, present:0, w:0 };
    if(a.status === 'present'){
      let ar = a.arrive ? rel(a.arrive, s.start_time) : 0;
      if(ar < 0) ar = 0; if(ar > dur) ar = dur; if(ar <= tol) ar = 0;
      let lv = a.leave ? rel(a.leave, s.start_time) : dur;
      if(lv > dur) lv = dur; if(dur - lv <= tol) lv = dur; if(lv < ar) lv = ar;
      r.late = ar; r.early = dur - lv; r.present = lv - ar;
      if(r.present > 0){
        if(st.mode === 'tramos'){
          const miss = r.late + r.early;
          const t = [...(st.tramos||[])].sort((x,y)=>x.upto-y.upto).find(t => miss <= Number(t.upto));
          r.w = (t ? Number(t.pct) : 0) / 100;
        } else r.w = r.present / dur;
      }
    }
    return r;
  });
  const sum = out.reduce((acc,r)=>acc+r.w, 0);
  const repartible = Math.max(0, (botinC||0) - (gastosC||0));
  out.forEach(r => { const exact = sum ? repartible*r.w/sum : 0; r.cents = Math.floor(exact/step + 1e-9) * step; });
  const repartido = out.reduce((acc,r)=>acc+r.cents, 0);
  return { rows: out, dur, botin: botinC||0, gastos: gastosC||0, repartible, repartido, sobrante: repartible - repartido };
}

/* ---------- carga de datos ---------- */
async function loadAll(){
  const st = await q(sb.from('settings').select('data').eq('id',1).maybeSingle(), true).catch(()=>null);
  D.settings = Object.assign({...DEF_SETTINGS}, (st && st.data) || {});
  if(isAdmin()){
    const [members, sessions, att, profiles, bote, bk] = await Promise.all([
      q(sb.from('members').select('*')),
      q(sb.from('sessions').select('*')),
      q(sb.from('attendance').select('*')),
      q(sb.from('profiles').select('*')),
      q(sb.from('bote').select('*').order('created_at',{ascending:false})),
      q(sb.from('backups').select('id,created_at').order('id',{ascending:false}).limit(1), true).catch(()=>[])
    ]);
    Object.assign(D, {members, sessions, att, profiles, bote});
    D.lastBackup = bk && bk[0] ? bk[0].created_at : null;
  } else {
    const [members, sessions, att, bote] = await Promise.all([
      q(sb.from('members').select('*')),
      q(sb.from('sessions').select('*')),
      q(sb.from('attendance').select('*')),
      q(sb.from('bote').select('amount_cents'))
    ]);
    Object.assign(D, {members, sessions, att, bote, profiles:[]});
  }
}
let reloadT = null;
function scheduleReload(){ clearTimeout(reloadT); reloadT = setTimeout(async ()=>{
  try{ const wasAdmin = isAdmin(), wasSt = me && me.status; await refreshMe();
       if(!me || me.status !== wasSt || isAdmin() !== wasAdmin) return boot();
       await loadAll(); render(); }catch(e){} }, 700); }
let meErr = '';
async function refreshMe(){ if(!authUser) return; meErr = ''; me = await q(sb.from('profiles').select('*').eq('id', authUser.id).maybeSingle(), true).catch(e=>{ meErr = e.message || String(e); return me; }); }

let channel = null;
function subscribe(){
  if(channel) return;
  channel = sb.channel('coro-cambios');
  ['attendance','sessions','members','profiles'].forEach(t => channel.on('postgres_changes', {event:'*', schema:'public', table:t}, scheduleReload));
  channel.subscribe();
}

/* ---------- arranque / sesión ---------- */
async function boot(){
  if(booting) return; booting = true;
  try{
    const { data:{ session } } = await sb.auth.getSession();
    authUser = session ? session.user : null;
    if(!authUser){ me = null; renderAuth(); return; }
    await refreshMe();
    if(!me){ renderMsg('No se encontró tu perfil', 'Vuelve a intentarlo en un momento.' + (meErr ? `<br><small>Detalle: ${esc(meErr)}</small>` : '')); return; }
    if(me.status === 'pending'){ renderMsg('⏳ Solicitud pendiente', `Hola ${esc(me.full_name)}. Un responsable del coro tiene que aceptar tu registro. Vuelve a entrar más tarde.`); return; }
    if(me.status === 'rejected'){ renderMsg('Acceso no autorizado', 'Tu solicitud no ha sido aceptada. Habla con un responsable del coro.'); return; }
    tab = isAdmin() ? (['hoy','coro','historial','yo','ajustes'].includes(tab)?tab:'hoy') : 'yo';
    loading = true; render();
    await loadAll(); await checkPush(); loading = false;
    subscribe(); render();
    const np = D.profiles.filter(p=>p.status==='pending').length;
    if(isAdmin() && np) toast(`🔔 Tienes ${np} solicitud${np>1?'es':''} de acceso pendiente${np>1?'s':''} (pestaña Coro)`);
  } catch(e){ renderMsg('Sin conexión', 'No se ha podido conectar. Comprueba la cobertura y vuelve a intentarlo.'); }
  finally{ booting = false; }
}

/* ---------- pantallas de acceso ---------- */
let authMode = 'login';
function chrome(showNav){
  document.querySelector('nav').style.display = showNav ? 'flex' : 'none';
  document.getElementById('sub').textContent = me && me.status==='approved' ? `${me.full_name}${isAdmin()?' · súper usuario':''}` : 'Lista y reparto';
}
function renderAuth(){
  chrome(false);
  const L = authMode === 'login';
  document.getElementById('app').innerHTML = `
    <div class="card" style="margin-top:10px">
      <div class="seg"><button data-act="authMode" data-v="login" class="${L?'on':''}">Entrar</button><button data-act="authMode" data-v="signup" class="${L?'':'on'}">Registrarse</button></div>
      ${L ? `
        <label>Nombre de usuario</label><input id="aUser" autocapitalize="none" autocorrect="off" autocomplete="username" spellcheck="false">
        <label>Contraseña</label><input id="aPass" type="password" autocomplete="current-password">
        <button class="btn" data-act="login">Entrar</button>
        <p class="hint">¿Olvidaste la contraseña? Pídele a un responsable del coro que te ponga una nueva.</p>`
      : `
        <label>Nombre completo</label><input id="aName" autocomplete="name" placeholder="Nombre y apellidos">
        <label>Nombre de usuario</label><input id="aUser" autocapitalize="none" autocorrect="off" autocomplete="username" spellcheck="false" placeholder="sin espacios, p. ej. maria.lopez">
        <label>Contraseña (mínimo 6 caracteres)</label><input id="aPass" type="password" autocomplete="new-password">
        <label>Repite la contraseña</label><input id="aPass2" type="password" autocomplete="new-password">
        <button class="btn" data-act="signup">Enviar solicitud</button>
        <p class="hint">Un responsable del coro revisará tu solicitud. Cuando la acepte podrás entrar y ver tus asistencias y lo que llevas ganado.</p>`}
    </div>`;
}
function renderMsg(title, txt){
  chrome(false);
  document.getElementById('app').innerHTML = `<div class="card" style="margin-top:10px;text-align:center"><h2>${title}</h2><p class="muted">${txt}</p>
    <button class="btn sec" data-act="retry">↻ Volver a comprobar</button>${authUser?'<button class="btn danger" data-act="logout">Salir</button>':''}</div>`;
}
function renderSetup(){
  chrome(false);
  document.getElementById('app').innerHTML = `<div class="card" style="margin-top:10px"><h2>Falta configurar</h2><p class="muted">Hay que poner la dirección y la clave de Supabase en el archivo <b>config.js</b> del repositorio.</p></div>`;
}

/* ---------- render principal ---------- */
function render(){
  if(!me || me.status !== 'approved') return;
  chrome(true);
  const nav = document.querySelector('nav');
  const pend = D.profiles.filter(p=>p.status==='pending').length;
  nav.innerHTML = isAdmin() ? `
    <button data-tab="hoy"><span>📋</span>Hoy</button>
    <button data-tab="coro"><span>👥${pend?`<i class="badge">${pend}</i>`:''}</span>Coro</button>
    <button data-tab="historial"><span>📒</span>Historial</button>
    <button data-tab="yo"><span>🙋</span>Lo mío</button>
    <button data-tab="ajustes"><span>⚙️</span>Ajustes</button>`
    : `<button data-tab="yo"><span>🙋</span>Mis asistencias</button>`;
  nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab===tab));
  const os = openSession();
  if(isAdmin() && os) document.getElementById('sub').textContent = `Quedada abierta · ${fmtDate(os.date)} · ${os.start_time}${os.place?' · '+os.place:''}`;
  if(loading){ document.getElementById('app').innerHTML = '<div class="empty">Cargando…</div>'; return; }
  const views = {hoy:renderHoy, coro:renderCoro, historial:renderHistorial, yo:renderYo, ajustes:renderAjustes};
  (isAdmin() ? (views[tab]||renderHoy) : renderYo)();
}

function statusInfo(s, a){
  const tol = Number(S().tolerance)||0;
  if(!a || a.status==='pending') return {dot:'', txt:'Sin marcar'};
  if(a.status==='absent') return {dot:'abs', txt:'<span class="tag abs">No viene</span>'};
  const late = a.arrive ? rel(a.arrive, s.start_time) : 0;
  let t = `Llegó ${esc(a.arrive||s.start_time)} ` + (late>tol ? `<span class="tag late">${late} min tarde</span>` : `<span class="tag ok">a su hora</span>`);
  if(a.leave) t += ` · se fue ${esc(a.leave)} <span class="tag left">antes</span>`;
  return {dot: a.leave ? 'left' : (late>tol ? 'late':'ok'), txt:t};
}

/* ----- HOY ----- */
function renderHoy(){
  const $ = document.getElementById('app');
  const s = openSession();
  if(!s){
    const n = D.members.filter(m=>m.active!==false).length;
    const pl = plannedSessions();
    $.innerHTML = `
      ${pl.length?`<div class="card"><h2>📅 Próximas quedadas</h2>
        ${pl.map(p=>`<div class="list-item" style="align-items:flex-start"><span><b>${fmtDate(p.date)} · ${esc(p.start_time)}</b><br><span class="det">${placeHtml(p)}</span></span>
          <span class="row" style="flex:0;gap:6px"><button class="ic" data-act="editPlanned" data-id="${p.id}">✎</button><button class="ic g" data-act="startPlanned" data-id="${p.id}" ${n?'':'disabled'}>▶️ Pasar lista</button></span></div>`).join('')}
      </div>`:''}
      <div class="card"><h2>Nueva quedada</h2>
        <label>Fecha</label><input type="date" id="nsDate" value="${today()}">
        <label>Hora de quedada</label><input type="time" id="nsStart" value="${esc(S().start)}">
        <label>Sitio (punto exacto de encuentro)</label><input id="nsPlace" placeholder="p. ej. Puerta de la parroquia de San Pablo" autocomplete="off" value="${esc(S().place||'')}">
        <button class="btn" data-act="planSession">📣 Programar y avisar a todos</button>
        <button class="btn sec" data-act="startSession" ${n?'':'disabled style="opacity:.5"'}>▶️ Empezar ya a pasar lista (sin avisar)</button>
        <p class="hint">Al programarla, a todos les llega un aviso con día, hora y sitio, y otro recordatorio 1 hora antes.</p>
        ${n?'':'<p class="hint">Primero apunta a la gente en la pestaña <b>Coro</b>.</p>'}
        <p class="hint">Margen de cortesía: <b>${S().tolerance} min</b> · Reparto: <b>${S().mode==='tramos'?'por tramos':'proporcional al tiempo'}</b> · Redondeo: <b>${eur(S().step)}</b></p>
      </div>`;
    return;
  }
  const rows = attOf(s.id);
  const tol = Number(S().tolerance)||0;
  const c = {present:0, late:0, absent:0, left:0};
  rows.forEach(a => { if(a.status==='absent') c.absent++; else if(a.status==='present'){ c.present++; if(a.leave) c.left++; if(a.arrive && rel(a.arrive,s.start_time)>tol) c.late++; } });
  const rowHtml = a => {
    const m = member(a.member_id); const info = statusInfo(s,a); const id = a.member_id;
    let acts = '';
    if(a.status==='pending') acts = `<button class="ic g" data-act="arrive" data-id="${id}">✓ Llegó</button><button class="ic r" data-act="absent" data-id="${id}">✗</button>`;
    else if(a.status==='present' && !a.leave) acts = `<button class="ic v" data-act="leave" data-id="${id}">Se va</button><button class="ic" data-act="edit" data-id="${id}">✎</button>`;
    else acts = `<button class="ic" data-act="edit" data-id="${id}">✎</button>`;
    return `<div class="p"><div class="dot ${info.dot}"></div><div class="info"><div class="name">${esc(m?m.name:'?')}</div><div class="det">${info.txt}</div></div><div class="acts">${acts}</div></div>`;
  };
  const byName = (x,y) => sortName(member(x.member_id)||{}, member(y.member_id)||{});
  const pend = rows.filter(a=>a.status==='pending').sort(byName), done = rows.filter(a=>a.status!=='pending').sort(byName);
  const items = (pend.length ? `<h3 style="margin-top:0">⏳ Faltan por llegar (${pend.length})</h3>${pend.map(rowHtml).join('')}` : '')
    + (done.length ? `<h3 ${pend.length?'':'style="margin-top:0"'}>✅ Ya marcados (${done.length})</h3>${done.map(rowHtml).join('')}` : '');
  $.innerHTML = `
    <div class="card">
      <div class="row" style="align-items:flex-start"><div><h2 style="margin:0">${fmtDate(s.date)}</h2><div class="muted">Quedada a las <b>${esc(s.start_time)}</b> · ahora ${nowHM()}</div><div class="det" style="margin-top:4px">${placeHtml(s)}</div></div>
      <button class="ic" style="flex:0" data-act="editSession">✎</button></div>
      <div class="stats">
        <div class="stat"><b>${c.present}</b><small>presentes</small></div>
        <div class="stat"><b>${c.late}</b><small>tarde</small></div>
        <div class="stat"><b>${c.left}</b><small>se fueron</small></div>
        <div class="stat"><b>${c.absent}</b><small>no vienen</small></div>
      </div>
      ${pend.length?`<button class="btn sec" data-act="allOnTime">✓ Marcar los ${pend.length} sin marcar como llegados a las ${esc(s.start_time)}</button>`:''}
    </div>
    <div class="card">${items || '<div class="empty">No hay nadie en la lista.</div>'}
      <button class="btn sec" data-act="addInSession">＋ Añadir a alguien a la lista de hoy</button>
    </div>
    <button class="btn oro" data-act="closeAsk">💰 Terminar quedada y repartir</button>`;
}

/* ----- CORO (gente + usuarios) ----- */
function renderCoro(){
  const act = D.members.filter(m=>m.active!==false).sort(sortName), ina = D.members.filter(m=>m.active===false).sort(sortName);
  const linked = id => D.profiles.find(p => p.member_id === id && p.status==='approved');
  const li = m => { const u = linked(m.id); return `<div class="list-item"><span>${esc(m.name)}${u?` <span class="tag ok">@${esc(u.username)}</span>`:''}</span><span class="row" style="flex:0;gap:6px">
     <button class="ic" data-act="rename" data-id="${m.id}">✎</button>
     <button class="ic ${m.active===false?'g':'r'}" data-act="toggleMember" data-id="${m.id}">${m.active===false?'Reactivar':'Quitar'}</button></span></div>`; };
  const pend = D.profiles.filter(p=>p.status==='pending').sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
  const appr = D.profiles.filter(p=>p.status==='approved').sort((a,b)=>a.full_name.localeCompare(b.full_name,'es'));
  const rej = D.profiles.filter(p=>p.status==='rejected');
  document.getElementById('app').innerHTML = `
    ${pend.length?`<div class="card" style="border:2px solid var(--oro)"><h2>🔔 Solicitudes de acceso (${pend.length})</h2>
      ${pend.map(p=>`<div class="list-item"><span><b>${esc(p.full_name)}</b><br><span class="muted">@${esc(p.username)} · ${new Date(p.created_at).toLocaleDateString('es-ES')}</span></span>
        <button class="ic g" style="flex:0" data-act="userSheet" data-id="${p.id}">Revisar</button></div>`).join('')}</div>`:''}
    <div class="card">
      <h2>Gente apuntada (${act.length})</h2>
      <div class="row"><input id="newName" placeholder="Nombre" autocomplete="off"><button class="btn sm" style="flex:0" data-act="addMember">Añadir</button></div>
      <p class="hint">¿Muchos de golpe? <a href="#" data-act="bulkAsk">Pega una lista de nombres</a> (uno por línea).</p>
      ${act.length ? act.map(li).join('') : '<div class="empty">Todavía no hay nadie apuntado.</div>'}
    </div>
    <div class="card"><h2>Usuarios con acceso (${appr.length})</h2>
      ${appr.map(p=>{ const m = member(p.member_id); return `<div class="list-item" data-act="userSheet" data-id="${p.id}"><span><b>${esc(p.full_name)}</b> ${p.is_admin?'<span class="tag late">⭐ súper</span>':''}<br><span class="muted">@${esc(p.username)} · ${m?'🔗 '+esc(m.name):'<span style="color:var(--bad)">sin asociar</span>'}</span></span><span class="muted">›</span></div>`; }).join('') || '<div class="empty">Nadie todavía.</div>'}
    </div>
    ${ina.length?`<div class="card"><h3 style="margin-top:0">Ya no vienen</h3>${ina.map(li).join('')}<p class="hint">Se conservan para que el historial siga cuadrando.</p></div>`:''}
    ${rej.length?`<div class="card"><h3 style="margin-top:0">Sin acceso / rechazados</h3>${rej.map(p=>`<div class="list-item" data-act="userSheet" data-id="${p.id}"><span>${esc(p.full_name)} <span class="muted">@${esc(p.username)}</span></span><span class="muted">›</span></div>`).join('')}</div>`:''}`;
}

function userSheet(id){
  const p = D.profiles.find(x=>x.id===id); if(!p) return;
  const used = new Set(D.profiles.filter(x=>x.id!==id && x.member_id && x.status==='approved').map(x=>x.member_id));
  const opts = D.members.filter(m=>m.active!==false || m.id===p.member_id).sort(sortName)
     .map(m=>`<option value="${m.id}" ${p.member_id===m.id?'selected':''} ${used.has(m.id)?'disabled':''}>${esc(m.name)}${used.has(m.id)?' (ya asociado)':''}</option>`).join('');
  const self = p.id === me.id;
  sheet(`<h2>${esc(p.full_name)}</h2><p class="muted" style="margin-top:-6px">@${esc(p.username)} · ${p.status==='pending'?'⏳ pendiente':p.status==='approved'?'✅ aceptado':'⛔ sin acceso'}</p>
    <label>Asociar a su nombre de la lista del coro</label>
    <select id="uMember"><option value="">— Sin asociar —</option><option value="__new">＋ Crear «${esc(p.full_name)}» en la lista</option>${opts}</select>
    <label class="check"><input type="checkbox" id="uAdmin" ${p.is_admin?'checked':''} ${self?'disabled':''}> <span>⭐ Súper usuario<br><small class="muted">Puede pasar lista y gestionarlo todo</small></span></label>
    ${p.status!=='approved'
      ? `<button class="btn" data-act="userSave" data-id="${id}" data-st="approved">✅ Aceptar</button>${p.status==='pending'?`<button class="btn danger" data-act="userSave" data-id="${id}" data-st="rejected">Rechazar</button>`:''}`
      : `<button class="btn" data-act="userSave" data-id="${id}" data-st="approved">Guardar</button>
         <label>Poner contraseña nueva (si la ha olvidado)</label><div class="row"><input id="uPass" type="text" autocomplete="off" autocapitalize="none" placeholder="mínimo 6 caracteres"><button class="btn sm sec" style="flex:0" data-act="userPass" data-id="${id}">Cambiar</button></div>
         ${self?'':`<button class="btn danger" data-act="userSave" data-id="${id}" data-st="rejected">Quitar el acceso</button>`}`}`);
}

/* ----- HISTORIAL ----- */
function renderHistorial(){
  const closed = D.sessions.filter(s=>s.closed).sort((a,b)=> (b.date+b.start_time).localeCompare(a.date+a.start_time));
  const closedIds = new Set(closed.map(s=>s.id));
  const tot = {};
  D.att.forEach(a => { if(!closedIds.has(a.session_id)) return; const k=a.member_id; tot[k] = tot[k] || {name:member(k)?.name||'?', cents:0, n:0, min:0}; tot[k].cents += a.amount_cents; if(a.present_min>0){ tot[k].n++; tot[k].min += a.present_min; } });
  const totRows = Object.values(tot).sort((a,b)=>b.cents-a.cents);
  const sum = f => closed.reduce((a,s)=>a+(s[f]||0),0);
  const boteSaldo = D.bote.reduce((a,b)=>a+b.amount_cents,0);
  document.getElementById('app').innerHTML = `
    <div class="card"><h2>💰 Bote común</h2><div class="big">${eur(boteSaldo)}</div>
      <p class="hint">Se llena con lo que sobra al redondear. Úsalo para gastos o añade aportaciones.</p>
      <div class="row"><button class="btn sm sec" data-act="boteAsk" data-v="-1">− Pagar un gasto</button><button class="btn sm sec" data-act="boteAsk" data-v="1">＋ Añadir dinero</button></div>
      ${D.bote.length?`<details style="margin-top:10px"><summary class="muted">Movimientos (${D.bote.length})</summary>${D.bote.slice(0,60).map(b=>`<div class="list-item"><span>${esc(b.note||'')}<br><span class="muted">${new Date(b.created_at).toLocaleDateString('es-ES')}</span></span><span style="color:${b.amount_cents<0?'var(--bad)':'var(--ok)'};font-weight:700;white-space:nowrap">${b.amount_cents>0?'+':''}${eur(b.amount_cents)}</span>${b.session_id?'':`<button class="ic r" style="flex:0;margin-left:6px" data-act="boteDel" data-id="${b.id}">✕</button>`}</div>`).join('')}</details>`:''}
    </div>
    <div class="card"><h2>Quedadas</h2>
      ${closed.length ? closed.map(s=>`<div class="list-item" data-act="viewSession" data-id="${s.id}"><span><b>${fmtDate(s.date)}</b><br><span class="muted">${esc(s.start_time)}–${esc(s.end_time)} · ${attOf(s.id).filter(a=>a.present_min>0).length} personas</span></span><span class="big" style="font-size:18px">${eur(s.botin_cents)} ›</span></div>`).join('') : '<div class="empty">Aún no hay quedadas cerradas.</div>'}
    </div>
    ${totRows.length?`<div class="card"><h2>Acumulado</h2>
      <p class="muted" style="margin-top:-4px">Recaudado <b>${eur(sum('botin_cents'))}</b> · gastos <b>${eur(sum('gastos_cents'))}</b> · repartido <b>${eur(sum('repartido_cents'))}</b></p>
      <table><tr><th>Persona</th><th class="n">Días</th><th class="n">Horas</th><th class="n">Total</th></tr>
      ${totRows.map(t=>`<tr><td>${esc(t.name)}</td><td class="n">${t.n}</td><td class="n">${(t.min/60).toFixed(1)}</td><td class="n"><b>${eur(t.cents)}</b></td></tr>`).join('')}</table></div>`:''}`;
}

/* ----- LO MÍO / MIS ASISTENCIAS ----- */
function renderYo(){
  const mid = me.member_id; const m = member(mid);
  let body = '';
  if(!mid){
    body = `<div class="card"><h2>Mis asistencias</h2><p class="muted">Tu usuario todavía no está asociado a tu nombre de la lista del coro. Cuando un responsable lo asocie, aquí verás tus asistencias y lo que llevas ganado.</p></div>`;
  } else {
    const mine = D.att.filter(a => a.member_id === mid).map(a => ({a, s: D.sessions.find(x=>x.id===a.session_id)})).filter(x=>x.s && x.s.closed)
      .sort((x,y)=>(y.s.date+y.s.start_time).localeCompare(x.s.date+x.s.start_time));
    const total = mine.reduce((acc,x)=>acc+x.a.amount_cents,0);
    const dias = mine.filter(x=>x.a.present_min>0).length;
    const mins = mine.reduce((acc,x)=>acc+x.a.present_min,0);
    const open = D.sessions.find(s=>!s.closed && s.started!==false && attGet(s.id, mid));
    let hoy = '';
    if(open){ const a = attGet(open.id, mid); hoy = `<div class="card" style="border:2px solid var(--oro)"><b>Quedada en curso · ${fmtDate(open.date)} ${esc(open.start_time)}</b><div class="det" style="margin-top:6px">${statusInfo(open,a).txt}</div></div>`; }
    body = `${hoy}
      <div class="card"><h2>${esc(m?m.name:me.full_name)}</h2>
        <div class="muted">Total ganado hasta ahora</div><div class="big" style="font-size:34px">${eur(total)}</div>
        <div class="stats"><div class="stat"><b>${dias}</b><small>días</small></div><div class="stat"><b>${(mins/60).toFixed(1)}</b><small>horas</small></div><div class="stat"><b>${dias?eur(Math.round(total/dias)):'–'}</b><small>media/día</small></div></div>
      </div>
      <div class="card"><h2>Mis asistencias</h2>
        ${mine.length ? `<table><tr><th>Día</th><th>Tiempo</th><th class="n">Ganado</th></tr>${mine.map(({a,s})=>{
          const t = a.status==='present' && a.present_min>0 ? minTxt(a.present_min) : 'No vino';
          const notes=[]; if(a.late_min) notes.push(`llegó ${a.late_min}′ tarde`); if(a.early_min) notes.push(`se fue ${a.early_min}′ antes`);
          return `<tr><td><b>${fmtDate(s.date)}</b><br><span class="muted" style="font-size:12px">${esc(s.start_time)}–${esc(s.end_time)}</span></td><td>${t}${notes.length?`<br><span class="muted" style="font-size:12px">${notes.join(' · ')}</span>`:''}</td><td class="n"><b>${eur(a.amount_cents)}</b></td></tr>`;}).join('')}</table>`
          : '<div class="empty">Todavía no hay quedadas cerradas.</div>'}
      </div>`;
  }
  const bote = D.bote.reduce((a,b)=>a+b.amount_cents,0);
  document.getElementById('app').innerHTML = upcomingCard() + body + pushCard() + `
    <div class="card"><div class="row"><span class="muted">💰 Bote común del coro</span><b style="text-align:right">${eur(bote)}</b></div></div>
    <div class="card"><h2>Mi cuenta</h2><p class="muted" style="margin-top:-4px">@${esc(me.username)}</p>
      <label>Cambiar mi contraseña</label><div class="row"><input id="myPass" type="password" autocomplete="new-password" placeholder="nueva contraseña"><button class="btn sm sec" style="flex:0" data-act="myPass">Cambiar</button></div>
      <button class="btn danger" data-act="logout">Cerrar sesión</button></div>
    <p class="muted" style="text-align:center">Coro San Pablo · ${VERSION}</p>`;
}

/* ----- AJUSTES ----- */
function renderAjustes(){
  const st = S();
  document.getElementById('app').innerHTML = `
    <div class="card"><h2>Reglas del reparto</h2>
      <label>Hora de quedada habitual</label><input type="time" id="sStart" value="${esc(st.start)}">
      <label>Sitio habitual (opcional)</label><input id="sPlace" value="${esc(st.place||'')}" placeholder="Se propone al crear cada quedada" autocomplete="off">
      <label>Margen de cortesía (minutos)</label><input type="number" inputmode="numeric" min="0" id="sTol" value="${st.tolerance}">
      <p class="hint">Si alguien llega con menos de este retraso (o se va con menos de esta antelación), cuenta como si hubiera estado todo el rato.</p>
      <label>Redondear lo de cada uno a</label>
      <select id="sStep">${[1,10,20,50,100].map(v=>`<option value="${v}" ${Number(st.step)===v?'selected':''}>${v===1?'céntimos exactos':eur(v)}</option>`).join('')}</select>
      <p class="hint">Se redondea hacia abajo; lo que sobra va al bote común.</p>
      <label>Cómo se calcula lo que cobra cada uno</label>
      <div class="seg"><button data-act="mode" data-v="proporcional" class="${st.mode!=='tramos'?'on':''}">Proporcional al tiempo</button><button data-act="mode" data-v="tramos" class="${st.mode==='tramos'?'on':''}">Por tramos</button></div>
      ${st.mode==='tramos' ? `
        <p class="hint">Se suman los minutos perdidos (llegar tarde + irse antes) y se aplica el porcentaje del tramo. 100% = una parte entera.</p>
        ${[...st.tramos].sort((a,b)=>a.upto-b.upto).map((t,i)=>`<div class="tramo"><span class="muted" style="flex:0 0 auto">Hasta</span><input type="number" inputmode="numeric" data-tr="upto" data-i="${i}" value="${t.upto>=9999?'':t.upto}" placeholder="∞"><span class="muted" style="flex:0 0 auto">min →</span><input type="number" inputmode="numeric" data-tr="pct" data-i="${i}" value="${t.pct}"><span class="muted" style="flex:0 0 auto">%</span><button class="ic r" style="flex:0" data-act="delTramo" data-i="${i}">✕</button></div>`).join('')}
        <button class="btn sec sm" data-act="addTramo">＋ Añadir tramo</button>
        <p class="hint">Deja «Hasta» vacío en el último tramo para que cubra cualquier retraso mayor.</p>`
      : `<p class="hint">Cada uno cobra según los minutos que ha estado. Ejemplo: quedada de 3 h, quien está 1,5 h cobra media parte. Lo que queda tras los gastos se reparte entre los que vinieron.</p>`}
      <button class="btn" data-act="saveSettings">Guardar reglas</button>
    </div>
    <div class="card"><h2>Copias de seguridad</h2>
      <p class="hint" style="margin-top:0">Todo se guarda en la nube al momento. Además, cada vez que se cierra una quedada se guarda una copia completa automática (se conservan las 60 últimas).${D.lastBackup?`<br>Última copia: <b>${new Date(D.lastBackup).toLocaleString('es-ES')}</b>`:''}</p>
      <button class="btn sec" data-act="export">⬇️ Hacer copia y descargarla</button>
    </div>
    <p class="muted" style="text-align:center">Coro San Pablo · ${VERSION}</p>`;
}

/* ---------- hojas ---------- */
function editSheet(mid){
  const s = openSession(); const a = attGet(s.id, mid) || {status:'pending'}; const m = member(mid);
  sheet(`<h2>${esc(m?m.name:'?')}</h2>
    <label>Estado</label>
    <select id="eSt"><option value="pending" ${a.status==='pending'?'selected':''}>Sin marcar</option><option value="present" ${a.status==='present'?'selected':''}>Presente</option><option value="absent" ${a.status==='absent'?'selected':''}>No viene (enfermo, etc.)</option></select>
    <label>Hora de llegada</label><input type="time" id="eAr" value="${esc(a.arrive||s.start_time)}">
    <label>Hora en que se fue (vacío = hasta el final)</label><input type="time" id="eLv" value="${esc(a.leave||'')}">
    <button class="btn sec" data-act="clearLeave">Se queda hasta el final</button>
    <button class="btn" data-act="saveEdit" data-id="${mid}">Guardar</button>
    <button class="btn danger" data-act="removeFromSession" data-id="${mid}">Quitar de la lista de hoy</button>`);
}

function closeSheet(){
  const s = openSession();
  sheet(`<h2>Terminar quedada</h2>
    <label>Hora de fin</label><input type="time" id="cEnd" value="${nowHM()}">
    <label>Botín del día (€)</label><input id="cBotin" inputmode="decimal" placeholder="0,00" autocomplete="off">
    <label>Gastos del día (€)</label><input id="cGastos" inputmode="decimal" placeholder="0,00" autocomplete="off">
    <div id="cPrev" style="margin-top:12px"></div>
    <button class="btn oro" data-act="confirmClose">Guardar y cerrar quedada</button>
    <button class="btn sec" data-act="closeSheet">Seguir pasando lista</button>`);
  const upd = () => {
    const r = calc(s, attOf(s.id), val('cEnd') || nowHM(), toCents(val('cBotin')), toCents(val('cGastos')));
    document.getElementById('cPrev').innerHTML = resultTable(r, true);
  };
  ['cEnd','cBotin','cGastos'].forEach(i => document.getElementById(i).oninput = upd); upd();
}

function resultTable(r, preview){
  const rows = [...r.rows].sort((a,b)=>b.cents-a.cents || a.name.localeCompare(b.name,'es'));
  return `${preview && r.dur>720?'<p class="hint" style="color:var(--bad)">⚠️ Más de 12 horas de quedada: revisa la hora de fin.</p>':''}
  <div class="sumbox">
    <div><span>Botín</span><b>${eur(r.botin)}</b></div>
    <div><span>− Gastos</span><b>${eur(r.gastos)}</b></div>
    <div><span>= A repartir</span><b>${eur(r.repartible)}</b></div>
    <div><span>Al bote (redondeo)</span><b>${eur(r.sobrante)}</b></div>
  </div>
  <p class="muted">Duración: <b>${minTxt(r.dur||0)}</b></p>
  <table><tr><th>Persona</th><th>Tiempo</th><th class="n">%</th><th class="n">Cobra</th></tr>
  ${rows.map(x=>{
    const t = x.status==='present' ? minTxt(x.present) : (x.status==='absent' ? 'No vino' : 'Sin marcar');
    const notes = []; if(x.late) notes.push(`+${x.late}′ tarde`); if(x.early) notes.push(`−${x.early}′ antes`);
    return `<tr><td>${esc(x.name)}</td><td>${t}${notes.length?`<br><span class="muted" style="font-size:12px">${notes.join(' · ')}</span>`:''}</td><td class="n">${Math.round(x.w*100)}%</td><td class="n"><b>${eur(x.cents)}</b></td></tr>`;}).join('')}
  </table>${r.rows.some(x=>x.status==='pending')?'<p class="hint">⚠️ Quien está «sin marcar» cuenta como que no ha venido.</p>':''}`;
}

function storedResult(s){
  const rows = attOf(s.id).map(a => ({member_id:a.member_id, name:member(a.member_id)?.name||'?', status:a.status, late:a.late_min, early:a.early_min, present:a.present_min, w:Number(a.weight), cents:a.amount_cents}));
  return { rows, dur:s.duration_min, botin:s.botin_cents, gastos:s.gastos_cents, repartible:Math.max(0,s.botin_cents-s.gastos_cents), repartido:s.repartido_cents, sobrante:s.sobrante_cents };
}

function shareText(s){
  const r = storedResult(s);
  let t = `🎶 Coro San Pablo – ${fmtDate(s.date)} (${s.start_time}–${s.end_time})\nBotín: ${eur(r.botin)}${r.gastos?` · Gastos: ${eur(r.gastos)}`:''}\nRepartido: ${eur(r.repartido)} · Al bote: ${eur(r.sobrante)}\n\n`;
  [...r.rows].filter(x=>x.cents>0).sort((a,b)=>b.cents-a.cents).forEach(x=>{ t += `• ${x.name}: ${eur(x.cents)}${x.late||x.early?` (${[x.late?x.late+' min tarde':'',x.early?'se fue '+x.early+' min antes':''].filter(Boolean).join(', ')})`:''}\n`; });
  const no = r.rows.filter(x=>x.cents===0).map(x=>x.name);
  if(no.length) t += `\nSin cobro: ${no.join(', ')}`;
  return t;
}

function viewSession(id){
  const s = D.sessions.find(x=>x.id===id); if(!s) return;
  sheet(`<h2>${fmtDate(s.date)} · ${esc(s.start_time)}–${esc(s.end_time)}</h2>
    ${resultTable(storedResult(s))}
    <button class="btn" data-act="share" data-id="${id}">📤 Compartir (WhatsApp…)</button>
    <button class="btn sec" data-act="reopen" data-id="${id}">Reabrir para corregir</button>
    <button class="btn danger" data-act="delSession" data-id="${id}">Borrar esta quedada</button>`);
}

/* ---------- acciones ---------- */
async function fillAttendance(sid){
  const have = new Set(attOf(sid).map(a=>a.member_id));
  const rows = D.members.filter(m=>m.active!==false && !have.has(m.id)).map(m=>({session_id:sid, member_id:m.id, status:'pending'}));
  if(rows.length) await q(sb.from('attendance').insert(rows));
}
function sessionSheet(s){
  if(!s) return;
  const isOpen = s.started !== false;
  sheet(`<h2>${isOpen?'Datos de la quedada':'Editar quedada programada'}</h2>
    <label>Fecha</label><input type="date" id="esD" value="${esc(s.date)}">
    <label>Hora de quedada</label><input type="time" id="esS" value="${esc(s.start_time)}">
    <label>Sitio</label><input id="esP" value="${esc(s.place||'')}" placeholder="Punto exacto de encuentro" autocomplete="off">
    <label class="check"><input type="checkbox" id="esN" checked> <span>📣 Avisar a todos del cambio</span></label>
    <button class="btn" data-act="saveSession" data-id="${s.id}">Guardar</button>
    <button class="btn danger" data-act="cancelSession" data-id="${s.id}">Cancelar quedada (borrarla)</button>`);
}
async function setAtt(sid, mid, patch){
  let a = attGet(sid, mid);
  if(!a){ a = {session_id:sid, member_id:mid, status:'pending', arrive:null, leave:null, late_min:0, early_min:0, present_min:0, weight:0, amount_cents:0}; D.att.push(a); }
  Object.assign(a, patch); render();
  try{ await q(sb.from('attendance').upsert({session_id:sid, member_id:mid, status:a.status, arrive:a.arrive||null, leave:a.leave||null})); }
  catch(e){ scheduleReload(); }
}
async function backup(){
  try{
    const [members, sessions, att, profiles, bote, st] = await Promise.all([
      q(sb.from('members').select('*')), q(sb.from('sessions').select('*')), q(sb.from('attendance').select('*')),
      q(sb.from('profiles').select('id,full_name,username,status,is_admin,member_id')), q(sb.from('bote').select('*')), q(sb.from('settings').select('*'))]);
    const data = {fecha:new Date().toISOString(), version:VERSION, members, sessions, attendance:att, profiles, bote, settings:st};
    await q(sb.from('backups').insert({data}), true);
    const old = await q(sb.from('backups').select('id').order('id',{ascending:false}).range(60, 1000), true);
    if(old && old.length) await q(sb.from('backups').delete().in('id', old.map(o=>o.id)), true);
    D.lastBackup = data.fecha;
    return data;
  }catch(e){ return null; }
}

const A = {
  closeSheet: () => sheet(''),
  async enablePush(el){
    const st = pushSupport();
    if(st !== 'ok') return toast(st==='ios' ? 'Primero instala la app: Compartir → Añadir a pantalla de inicio, y ábrela desde ahí' : 'Este navegador no admite avisos');
    if(!CFG.VAPID_PUBLIC_KEY) return toast('Falta configurar los avisos');
    busy(el,true);
    try{
      const perm = await Notification.requestPermission();
      if(perm !== 'granted'){ toast('No has dado permiso. Actívalo en Ajustes del móvil → Notificaciones'); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if(!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: b64ToBytes(CFG.VAPID_PUBLIC_KEY) });
      const j = sub.toJSON();
      await q(sb.from('push_subscriptions').upsert({ endpoint:j.endpoint, user_id:authUser.id, p256dh:j.keys.p256dh, auth:j.keys.auth }));
      pushOn = true; render(); toast('🔔 Avisos activados en este móvil');
    }catch(e){ console.warn(e); toast('⚠️ No se pudieron activar los avisos'); }
    finally{ busy(el,false); }
  },
  async testPush(){ await notify({type:'test'}); },
  retry: () => boot(),
  authMode(el){ authMode = el.dataset.v; renderAuth(); },
  async login(el){
    const u = (val('aUser')||'').trim().toLowerCase(), p = val('aPass')||'';
    if(!u || !p) return toast('Pon usuario y contraseña');
    busy(el,true);
    try{ await q(sb.auth.signInWithPassword({email:userEmail(u), password:p})); await boot(); }
    catch(e){} finally{ busy(el,false); }
  },
  async signup(el){
    const name = (val('aName')||'').trim().replace(/\s+/g,' '), u = (val('aUser')||'').trim().toLowerCase(), p = val('aPass')||'', p2 = val('aPass2')||'';
    if(name.length < 3) return toast('Escribe tu nombre completo');
    if(!/^[a-z0-9._-]{3,20}$/.test(u)) return toast('Usuario: 3-20 letras o números, sin espacios ni tildes');
    if(p.length < 6) return toast('La contraseña debe tener al menos 6 caracteres');
    if(p !== p2) return toast('Las contraseñas no coinciden');
    busy(el,true);
    try{
      const ok = await q(sb.rpc('username_available', {u}));
      if(!ok){ toast('Ese nombre de usuario ya existe'); return; }
      const res = await q(sb.auth.signUp({email:userEmail(u), password:p, options:{data:{full_name:name, username:u}}}));
      notifyAdmin(name, u);
      if(!res.session){ renderMsg('Solicitud enviada', 'Cuando un responsable te acepte, entra con tu usuario y contraseña.'); return; }
      notify({type:'new_user'}, true);
      await boot();
    }catch(e){} finally{ busy(el,false); }
  },
  async logout(){ try{ const sub = await currentSub(); if(sub) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); }catch(e){} try{ await sb.auth.signOut(); }catch(e){} if(channel){ try{ sb.removeChannel(channel); }catch(e){} channel=null; } me=null; authUser=null; authMode='login'; renderAuth(); },
  async myPass(){ const p = val('myPass')||''; if(p.length<6) return toast('Mínimo 6 caracteres'); try{ await q(sb.auth.updateUser({password:p})); toast('Contraseña cambiada'); document.getElementById('myPass').value=''; }catch(e){} },

  async startSession(el){
    if(openSession()) return;
    busy(el,true);
    try{
      const s = await q(sb.from('sessions').insert({date:val('nsDate')||today(), start_time:val('nsStart')||S().start, place:(val('nsPlace')||'').trim()||null, started:true}).select().single());
      await fillAttendance(s.id);
      await loadAll(); render();
    }catch(e){ busy(el,false); }
  },
  async planSession(el){
    const date=val('nsDate'), time=val('nsStart'), place=(val('nsPlace')||'').trim();
    if(!date || !time) return toast('Pon fecha y hora');
    if(!place && !confirm('No has puesto el sitio. ¿Programar igualmente?')) return;
    busy(el,true);
    try{
      const s = await q(sb.from('sessions').insert({date, start_time:time, place:place||null, started:false}).select().single());
      await loadAll(); render(); await notify({type:'session_new', session_id:s.id});
    }catch(e){ busy(el,false); }
  },
  async startPlanned(el){
    if(openSession()) return toast('Ya hay una quedada abierta');
    const s = D.sessions.find(x=>x.id===el.dataset.id); if(!s) return;
    busy(el,true);
    try{ await q(sb.from('sessions').update({started:true}).eq('id', s.id)); await fillAttendance(s.id); await loadAll(); render(); }
    catch(e){ busy(el,false); }
  },
  editPlanned(el){ sessionSheet(D.sessions.find(x=>x.id===el.dataset.id)); },
  arrive(el){ const s=openSession(); setAtt(s.id, el.dataset.id, {status:'present', arrive:nowHM(), leave:null}); toast('Llegada anotada a las '+nowHM()); },
  absent(el){ const s=openSession(); setAtt(s.id, el.dataset.id, {status:'absent', arrive:null, leave:null}); },
  leave(el){ const s=openSession(); if(!confirm(`¿${member(el.dataset.id)?.name||''} se va ahora (${nowHM()})?`)) return; setAtt(s.id, el.dataset.id, {leave:nowHM()}); toast('Salida anotada'); },
  edit(el){ editSheet(el.dataset.id); },
  clearLeave(){ document.getElementById('eLv').value=''; },
  saveEdit(el){
    const s=openSession(); const st=val('eSt');
    const patch = st==='present' ? {status:st, arrive:val('eAr')||s.start_time, leave:val('eLv')||null} : {status:st, arrive:null, leave:null};
    sheet(''); setAtt(s.id, el.dataset.id, patch);
  },
  async removeFromSession(el){ const s=openSession(); sheet(''); D.att = D.att.filter(a=>!(a.session_id===s.id && a.member_id===el.dataset.id)); render();
    try{ await q(sb.from('attendance').delete().eq('session_id',s.id).eq('member_id',el.dataset.id)); }catch(e){ scheduleReload(); } },
  async allOnTime(){
    const s=openSession(); const pend = attOf(s.id).filter(a=>a.status==='pending');
    if(!confirm(`¿Seguro que han llegado TODOS a su hora (${s.start_time})?\n\n${pend.map(a=>member(a.member_id)?.name).join(', ')}\n\nSi falta alguien, márcalo uno a uno.`)) return;
    pend.forEach(a=>{ a.status='present'; a.arrive=s.start_time; a.leave=null; }); render();
    try{ await q(sb.from('attendance').upsert(pend.map(a=>({session_id:s.id, member_id:a.member_id, status:'present', arrive:s.start_time, leave:null})))); }catch(e){ scheduleReload(); }
  },
  addInSession(){
    const s=openSession(); const inList = new Set(attOf(s.id).map(a=>a.member_id));
    const fuera = D.members.filter(m=>!inList.has(m.id)).sort(sortName);
    sheet(`<h2>Añadir a la lista de hoy</h2>
      ${fuera.map(m=>`<div class="list-item"><span>${esc(m.name)}</span><button class="ic g" data-act="addExisting" data-id="${m.id}">Añadir</button></div>`).join('')}
      <label>Persona nueva</label><div class="row"><input id="sNew" placeholder="Nombre"><button class="btn sm" style="flex:0" data-act="addNewInSession">Añadir</button></div>`);
  },
  async addExisting(el){ const s=openSession(); const m=member(el.dataset.id); sheet('');
    try{ if(m.active===false) await q(sb.from('members').update({active:true}).eq('id',m.id)); m.active=true; await setAtt(s.id, m.id, {status:'pending'}); }catch(e){} },
  async addNewInSession(){ const n=(val('sNew')||'').trim(); if(!n) return; sheet('');
    try{ const m = await q(sb.from('members').insert({name:n}).select().single()); D.members.push(m); await setAtt(openSession().id, m.id, {status:'pending'}); }catch(e){} },
  editSession(){ sessionSheet(openSession()); },
  async saveSession(el){
    const s = D.sessions.find(x=>x.id===el.dataset.id); if(!s) return;
    const before = {date:s.date, start_time:s.start_time, place:s.place};
    const upd = {date:val('esD')||s.date, start_time:val('esS')||s.start_time, place:(val('esP')||'').trim()||null};
    const changed = upd.date!==before.date || upd.start_time!==before.start_time || (upd.place||'')!==(before.place||'');
    const avisar = document.getElementById('esN')?.checked;
    sheet(''); if(!changed) return;
    Object.assign(s, upd); render();
    try{
      await q(sb.from('sessions').update({...upd, reminded:false}).eq('id', s.id));
      if(avisar) await notify({type:'session_changed', session_id:s.id, before});
    }catch(e){ scheduleReload(); }
  },
  async cancelSession(el){
    const s = D.sessions.find(x=>x.id===el.dataset.id); if(!s) return;
    if(!confirm(`¿Cancelar y borrar la quedada del ${fmtDate(s.date)} a las ${s.start_time}?`)) return;
    const avisar = document.getElementById('esN')?.checked;
    sheet('');
    try{
      if(avisar) await notify({type:'session_cancelled', session:{id:s.id, date:s.date, start_time:s.start_time, place:s.place}});
      await q(sb.from('sessions').delete().eq('id', s.id)); await loadAll(); render();
    }catch(e){}
  },
  closeAsk(){ closeSheet(); },
  async confirmClose(el){
    const s=openSession(); const end=val('cEnd')||nowHM(); const botin=toCents(val('cBotin')); const gastos=toCents(val('cGastos'));
    if(!botin && !confirm('No has puesto el botín. ¿Cerrar igualmente con 0 €?')) return;
    if(gastos > botin && !confirm('Los gastos son mayores que el botín: no se repartirá nada. ¿Seguir?')) return;
    const r = calc(s, attOf(s.id), end, botin, gastos);
    busy(el,true);
    try{
      const rows = r.rows.map(x=>({session_id:s.id, member_id:x.member_id, status:x.status==='pending'?'absent':x.status, arrive:x.arrive, leave:x.leave,
        late_min:x.late, early_min:x.early, present_min:x.present, weight:Number(x.w.toFixed(6)), amount_cents:x.cents}));
      if(rows.length) await q(sb.from('attendance').upsert(rows));
      await q(sb.from('bote').delete().eq('session_id', s.id));
      if(r.sobrante > 0) await q(sb.from('bote').insert({amount_cents:r.sobrante, note:`Sobrante del redondeo · ${fmtDate(s.date)}`, session_id:s.id}));
      await q(sb.from('sessions').update({closed:true, end_time:end, botin_cents:botin, gastos_cents:gastos, repartido_cents:r.repartido, sobrante_cents:r.sobrante,
        duration_min:r.dur, mode:S().mode, tolerance:S().tolerance, step_cents:S().step}).eq('id', s.id));
      await loadAll(); await backup();
      tab='historial'; render(); viewSession(s.id); toast('Quedada guardada y copia hecha ✅');
      notify({type:'payout', session_id:s.id});
    }catch(e){ busy(el,false); }
  },
  viewSession(el){ viewSession(el.dataset.id); },
  async share(el){
    const s=D.sessions.find(x=>x.id===el.dataset.id); const t=shareText(s);
    if(navigator.share){ try{ await navigator.share({text:t}); return; }catch(e){ if(e.name==='AbortError') return; } }
    try{ await navigator.clipboard.writeText(t); toast('Copiado. Pégalo en WhatsApp'); }catch(e){ location.href='https://wa.me/?text='+encodeURIComponent(t); }
  },
  async reopen(el){
    if(openSession()) return alert('Ya hay una quedada abierta. Ciérrala primero.');
    if(!confirm('¿Reabrir esta quedada para corregirla? Se quitará su reparto hasta que la vuelvas a cerrar.')) return;
    const id = el.dataset.id; sheet('');
    try{
      await q(sb.from('bote').delete().eq('session_id', id));
      await q(sb.from('sessions').update({closed:false, repartido_cents:0, sobrante_cents:0}).eq('id', id));
      await q(sb.from('attendance').update({amount_cents:0, weight:0}).eq('session_id', id));
      await loadAll(); tab='hoy'; render();
    }catch(e){}
  },
  async delSession(el){ if(!confirm('¿Borrar esta quedada del historial? Se borrarán también sus asistencias.')) return; sheet('');
    try{ await q(sb.from('sessions').delete().eq('id', el.dataset.id)); await loadAll(); render(); }catch(e){} },

  boteAsk(el){ const sign = Number(el.dataset.v);
    sheet(`<h2>${sign<0?'Pagar un gasto con el bote':'Añadir dinero al bote'}</h2><label>Cantidad (€)</label><input id="bAm" inputmode="decimal" placeholder="0,00"><label>Concepto (opcional)</label><input id="bNote" placeholder="${sign<0?'Gasto':'Aportación'}">
      <button class="btn" data-act="boteSave" data-v="${sign}">Guardar</button>`); },
  async boteSave(el){ const c = toCents(val('bAm')); if(!c) return toast('Pon una cantidad'); const sign = Number(el.dataset.v); const note = (val('bNote')||'').trim() || (sign<0?'Gasto':'Aportación'); sheet('');
    try{ await q(sb.from('bote').insert({amount_cents: sign*c, note})); await loadAll(); render(); }catch(e){} },
  async boteDel(el){ if(!confirm('¿Borrar este movimiento del bote?')) return; try{ await q(sb.from('bote').delete().eq('id', el.dataset.id)); await loadAll(); render(); }catch(e){} },

  async addMember(){ const i=document.getElementById('newName'); const n=i.value.trim(); if(!n) return;
    if(D.members.some(m=>m.name.toLowerCase()===n.toLowerCase()) && !confirm('Ya hay alguien con ese nombre. ¿Añadir igualmente?')) return;
    try{ const m = await q(sb.from('members').insert({name:n}).select().single()); D.members.push(m);
      const s=openSession(); if(s) await setAtt(s.id, m.id, {status:'pending'});
      render(); const ni=document.getElementById('newName'); if(ni) ni.focus(); }catch(e){} },
  bulkAsk(){ sheet(`<h2>Pegar lista</h2><textarea id="bulk" rows="10" style="width:100%;font-size:16px;padding:10px;border-radius:10px;border:1px solid var(--line)" placeholder="María López&#10;José García&#10;Lucía Pérez"></textarea><button class="btn" data-act="bulkAdd">Añadir todos</button>`); },
  async bulkAdd(){ const names=[...new Set(val('bulk').split(/\n|,/).map(x=>x.trim()).filter(Boolean))].filter(n=>!D.members.some(m=>m.name.toLowerCase()===n.toLowerCase())); sheet('');
    if(!names.length) return toast('No hay nombres nuevos');
    try{ const ms = await q(sb.from('members').insert(names.map(name=>({name}))).select()); const s=openSession();
      if(s) await q(sb.from('attendance').insert(ms.map(m=>({session_id:s.id, member_id:m.id, status:'pending'}))));
      await loadAll(); render(); toast(ms.length+' añadidos'); }catch(e){} },
  async rename(el){ const m=member(el.dataset.id); const n=prompt('Nuevo nombre', m.name); if(!n||!n.trim()) return; m.name=n.trim(); render();
    try{ await q(sb.from('members').update({name:m.name}).eq('id',m.id)); }catch(e){ scheduleReload(); } },
  async toggleMember(el){ const m=member(el.dataset.id); m.active = m.active===false; render();
    try{ await q(sb.from('members').update({active:m.active}).eq('id',m.id)); }catch(e){ scheduleReload(); } },

  userSheet(el){ userSheet(el.dataset.id); },
  async userSave(el){
    const p = D.profiles.find(x=>x.id===el.dataset.id); const st = el.dataset.st;
    let mid = val('uMember') || null; const adm = document.getElementById('uAdmin')?.checked || false;
    if(st==='rejected' && !confirm(`¿Quitar el acceso a ${p.full_name}?`)) return;
    sheet('');
    try{
      if(mid === '__new'){ const m = await q(sb.from('members').insert({name:p.full_name}).select().single()); mid = m.id;
        const s=openSession(); if(s) await q(sb.from('attendance').insert({session_id:s.id, member_id:m.id, status:'pending'})); }
      const upd = st==='approved' ? {status:st, member_id:mid, is_admin: p.id===me.id ? true : adm} : {status:st, is_admin:false};
      await q(sb.from('profiles').update(upd).eq('id', p.id));
      await loadAll(); render(); toast(st==='approved' ? 'Guardado ✅' : 'Acceso retirado');
    }catch(e){}
  },
  async userPass(el){ const p=val('uPass')||''; if(p.length<6) return toast('Mínimo 6 caracteres');
    try{ await q(sb.rpc('admin_set_password', {uid:el.dataset.id, new_password:p})); toast('Contraseña cambiada. Díselo a esa persona.'); document.getElementById('uPass').value=''; }catch(e){} },

  mode(el){ readSettings(); S().mode=el.dataset.v; render(); },
  addTramo(){ readSettings(); S().tramos.push({upto:90,pct:10}); render(); },
  delTramo(el){ readSettings(); const t=[...S().tramos].sort((a,b)=>a.upto-b.upto); t.splice(Number(el.dataset.i),1); S().tramos=t; render(); },
  async saveSettings(el){ readSettings(); busy(el,true);
    try{ await q(sb.from('settings').upsert({id:1, data:S()})); toast('Reglas guardadas'); }catch(e){} finally{ busy(el,false); } },
  async export(el){
    busy(el,true); const data = await backup(); busy(el,false);
    if(!data) return toast('No se pudo hacer la copia');
    const name=`coro-sanpablo-${today()}.json`; const file = new File([JSON.stringify(data,null,1)], name, {type:'application/json'});
    if(navigator.canShare && navigator.canShare({files:[file]})){ navigator.share({files:[file], title:name}).catch(()=>{}); return; }
    const a=document.createElement('a'); a.href=URL.createObjectURL(file); a.download=name; document.body.appendChild(a); a.click(); a.remove();
  }
};

function readSettings(){
  const st=S();
  const sS=document.getElementById('sStart'), sT=document.getElementById('sTol'), sP=document.getElementById('sStep');
  if(sS && sS.value) st.start=sS.value;
  const sPl=document.getElementById('sPlace'); if(sPl) st.place=sPl.value.trim();
  if(sT) st.tolerance=Math.max(0, parseInt(sT.value)||0);
  if(sP) st.step=Number(sP.value)||50;
  const tr=[...st.tramos].sort((a,b)=>a.upto-b.upto);
  document.querySelectorAll('[data-tr]').forEach(inp=>{ const i=Number(inp.dataset.i); if(!tr[i]) return; if(inp.dataset.tr==='upto') tr[i].upto = inp.value===''?9999:Math.max(0,parseInt(inp.value)||0); else tr[i].pct=Math.max(0,Math.min(100,parseInt(inp.value)||0)); });
  st.tramos=tr;
}

/* ---------- avisos al móvil (Web Push) ---------- */
let pushOn = false;
function pushSupport(){
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  if(!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return ios && !standalone ? 'ios' : 'no';
  if(ios && !standalone) return 'ios';
  return 'ok';
}
function b64ToBytes(b64){ const p='='.repeat((4-b64.length%4)%4); const s=atob((b64+p).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from([...s].map(c=>c.charCodeAt(0))); }
async function currentSub(){ try{ if(!('serviceWorker' in navigator)) return null; const reg = await navigator.serviceWorker.getRegistration(); return reg && reg.pushManager ? await reg.pushManager.getSubscription() : null; }catch(e){ return null; } }
async function checkPush(){
  pushOn = false;
  try{ if(pushSupport()==='ok' && Notification.permission==='granted'){ const sub = await currentSub(); if(sub){ pushOn = true;
    const j = sub.toJSON(); sb.from('push_subscriptions').upsert({ endpoint:j.endpoint, user_id:authUser.id, p256dh:j.keys.p256dh, auth:j.keys.auth }).then(()=>{}); } } }catch(e){}
}
function pushCard(){
  const st = pushSupport();
  let inner;
  if(pushOn) inner = `<p class="muted" style="margin-top:0">✅ Activados en este móvil. Te avisaremos de las quedadas, del recordatorio 1 h antes y de lo que ganas.</p>${isAdmin()?'<button class="btn sm sec" data-act="testPush">Enviarme un aviso de prueba</button>':''}`;
  else if(st==='ios') inner = `<p class="muted" style="margin-top:0">Para recibir avisos en iPhone, primero instala la app: botón <b>Compartir</b> → <b>Añadir a pantalla de inicio</b>. Luego ábrela desde el icono y pulsa aquí.</p>`;
  else if(st==='no') inner = `<p class="muted" style="margin-top:0">Este navegador no admite avisos. Prueba con Chrome (Android) o instalando la app (iPhone).</p>`;
  else inner = `<p class="muted" style="margin-top:0">Recibe avisos de nuevas quedadas, cambios de hora o sitio, el recordatorio 1 h antes y lo que te toca en cada reparto.</p><button class="btn" data-act="enablePush">🔔 Activar avisos en este móvil</button>`;
  return `<div class="card"><h2>🔔 Avisos</h2>${inner}</div>`;
}
function upcomingCard(){
  const up = D.sessions.filter(s=>!s.closed).sort((x,y)=>(x.date+x.start_time).localeCompare(y.date+y.start_time));
  if(!up.length) return '';
  return `<div class="card" style="border:2px solid var(--oro)"><h2>📅 Próximas quedadas</h2>${up.map(s=>`<div class="list-item"><span><b>${fmtDate(s.date)} · ${esc(s.start_time)}</b>${s.started!==false?' <span class="tag ok">en curso</span>':''}<br><span class="det">${placeHtml(s)}</span></span></div>`).join('')}</div>`;
}

/* ---------- aviso por correo (EmailJS) ---------- */
function notifyAdmin(full_name, username){
  const url = location.origin + location.pathname;
  const E = CFG.EMAILJS || {};
  if(!E.SERVICE_ID || !E.TEMPLATE_ID || !E.PUBLIC_KEY) return;
  fetch('https://api.emailjs.com/api/v1.0/email/send', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ service_id:E.SERVICE_ID, template_id:E.TEMPLATE_ID, user_id:E.PUBLIC_KEY,
      template_params:{ full_name, username, fecha:new Date().toLocaleString('es-ES'), app_url: location.origin + location.pathname } }) }).catch(()=>{});
}

/* ---------- inicio ---------- */
function init(){
  document.addEventListener('click', e => {
    const n = e.target.closest('nav button'); if(n){ tab=n.dataset.tab; sheet(''); render(); document.getElementById('app').scrollTop=0; return; }
    const el = e.target.closest('[data-act]'); if(!el) return;
    if(el.tagName==='A') e.preventDefault();
    if(el.dataset.act==='closeSheet' && e.target!==el) return;
    const f = A[el.dataset.act]; if(f) f(el);
  });
  document.addEventListener('keydown', e => {
    if(e.key!=='Enter') return;
    if(e.target.id==='newName') A.addMember();
    if(e.target.id==='aPass' && authMode==='login') A.login(document.querySelector('[data-act=login]'));
  });
  document.addEventListener('visibilitychange', () => { if(document.visibilityState==='visible' && me && me.status==='approved') scheduleReload(); });
  setInterval(()=>{ if(isAdmin() && tab==='hoy' && openSession() && !document.getElementById('sheet').innerHTML && !document.activeElement?.matches('input,select,textarea')) render(); }, 30000);
  if('serviceWorker' in navigator && location.protocol==='https:'){ navigator.serviceWorker.register('sw.js', {updateViaCache:'none'}).then(r=>r.update()).catch(()=>{}); }
  if(!CFG.SUPABASE_URL || !CFG.SUPABASE_KEY || !window.supabase){ renderSetup(); return; }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, { auth:{ persistSession:true, autoRefreshToken:true } });
  boot();
}
if(typeof document!=='undefined' && document.getElementById('app')) init();
