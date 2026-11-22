/* =====================================================
   CORO SAN PABLO · v2 (Supabase: usuarios, roles y nube)
   ===================================================== */
const CFG = window.CORO_CONFIG || {};
const VERSION = 'v4.17';
const DEF_SETTINGS = {
  tolerance: 5, mode: 'proporcional', start: '18:00', step: 50,
  tramos: [ {upto:10,pct:100}, {upto:30,pct:75}, {upto:60,pct:50}, {upto:9999,pct:25} ]
};

let sb = null, authUser = null, me = null;           // me = perfil
let D = { members:[], sessions:[], att:[], profiles:[], bote:[], settings:{...DEF_SETTINGS}, lastBackup:null };
let tab = 'hoy', loading = true, booting = false;
let pendingLink = location.hash || '';   // enlace desde una notificación (#cal=<id>, #yo, #coro)

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
let focusId = null;   // quedada terminada que se está revisando o repartiendo
const activeSession = () => D.sessions.find(s => !s.closed && s.started !== false && !s.end_time);
const pendingSessions = () => D.sessions.filter(s => !s.closed && s.started !== false && s.end_time).sort((x,y)=>(x.date+x.start_time).localeCompare(y.date+y.start_time));
const openSession = () => (focusId && D.sessions.find(s => s.id === focusId && !s.closed)) || activeSession();
const isEnded = s => !!(s && !s.closed && s.started !== false && s.end_time);   // terminada, pendiente de repartir
const plannedSessions = () => D.sessions.filter(s => !s.closed && s.started === false).sort((x,y)=>(x.date+x.start_time).localeCompare(y.date+y.start_time));
const mapUrl = p => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p + ', Sevilla');
const placeHtml = s => s && s.place ? `📍 <a href="${mapUrl(s.place)}" target="_blank" rel="noopener">${esc(s.place)}</a>` : '<span class="muted">Sitio sin indicar</span>';
async function notify(body, quiet){
  mailNotify(body);
  try{
    const { data, error } = await sb.functions.invoke('notify', { body });
    if(error) throw error;
    if(!quiet && data && typeof data.sent === 'number') toast(data.sent ? `📣 Aviso enviado a ${data.sent} móvil${data.sent>1?'es':''}` : '📣 Nadie tiene los avisos activados todavía');
    return data;
  }catch(e){
    console.warn('notify', e);
    if(isNetErr(e)){ if(!quiet) toast('📴 Sin cobertura: el aviso no se ha enviado'); return null; }
    let det = e && e.message || String(e);
    try{ const r = e && e.context; if(r && typeof r.status==='number'){ let t=''; try{ t = await r.clone().text(); }catch(_){} det = `HTTP ${r.status}` + (t ? ` · ${t.slice(0,160)}` : ''); } }catch(_){}
    if(!quiet){ sheet(`<h2>⚠️ No se pudo enviar el aviso</h2><p class="muted">Manda una captura de esto a quien configuró la app:</p><pre style="white-space:pre-wrap;background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px;font-size:13px">${esc(det)}</pre><button class="btn sec" data-act="closeSheet">Cerrar</button>`); }
    return null;
  }
}
const attOf = sid => D.att.filter(a => a.session_id === sid);
const attGet = (sid, mid) => D.att.find(a => a.session_id === sid && a.member_id === mid);
const isAdmin = () => !!(me && me.is_admin && me.status === 'approved');
const isSup = () => !!(me && me.is_supervisor && !me.is_admin && me.status === 'approved');   // responsables: solo ver
const canSee = () => isAdmin() || isSup();
const sortName = (a,b) => (a.name||'').localeCompare(b.name||'', 'es');
const userEmail = u => `${u.toLowerCase()}@${CFG.EMAIL_DOMAIN || 'corosanpablo.app'}`;
const S = () => D.settings;
const IC = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  hoy: IC('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>'),
  cal: IC('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>'),
  coins: IC('<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>'),
  sup: IC('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'),
  bellNav: IC('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  bell: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  coro: IC('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'),
  historial: IC('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'),
  cuenta: IC('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.7a7 7 0 0 1 10 0"/>'),
  yoOld: IC('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>'),
  ajustes: IC('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  pin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:1px"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>'
};
function whenLabel(s){
  const [y,mo,d] = s.date.split('-').map(Number); const [h,mi] = s.start_time.split(':').map(Number);
  const diff = (new Date(y,mo-1,d,h,mi) - new Date())/60000;
  const t = today(); const tm = new Date(); tm.setDate(tm.getDate()+1);
  const man = tm.getFullYear()+'-'+pad(tm.getMonth()+1)+'-'+pad(tm.getDate());
  if(isEnded(s)) return 'Terminada';
  if(s.started!==false && !s.closed) return 'En curso';
  if(s.date===t) return diff>0 && diff<120 ? `En ${Math.max(1,Math.round(diff))} min` : 'Hoy';
  if(s.date===man) return 'Mañana';
  const dd = Math.round((new Date(y,mo-1,d) - new Date(new Date().toDateString()))/86400000);
  return dd>0 ? `En ${dd} días` : '';
}
function heroCard(s, actions){
  const dia = new Date(s.date+'T12:00:00').toLocaleDateString('es-ES',{weekday:'long', day:'numeric', month:'long'});
  const pill = whenLabel(s);
  const enCurso = s.started!==false && !s.closed;
  return `<section class="hero"><div class="k"><span>${enCurso?'Quedada en curso':'Próxima quedada'}</span>${pill?`<span class="pill">${pill}</span>`:''}</div>
    <div class="hora">${esc(s.start_time)}</div><div class="dia">${dia}</div>
    <div class="sitio">${ICONS.pin}<span>${s.place?esc(s.place):'Sitio sin indicar'}</span></div>
    ${rsvpLine(s)?`<div style="margin-top:8px;font-size:14px;font-weight:600">${rsvpLine(s)}</div>`:''}
    <div class="acts">${actions||''}${s.place?`<a class="alt" href="${mapUrl(s.place)}" target="_blank" rel="noopener">Cómo llegar</a>`:''}</div></section>`;
}
const val = id => (document.getElementById(id)||{}).value;

function toast(t){ const el=document.getElementById('toast'); el.textContent=t; el.classList.add('on'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('on'),2400); }
function sheet(html){ if(!html){ stopScan(); stopQr(); } document.getElementById('sheet').innerHTML = html ? `<div class="sheet-bg" data-act="closeSheet"><div class="sheet">${html}</div></div>` : ''; }
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

/* ---------- SIN COBERTURA: cola de cambios y copia local ---------- */
const OBX_KEY = () => 'coro-outbox-' + (authUser ? authUser.id : '');
const CACHE_KEY = () => 'coro-cache-' + (authUser ? authUser.id : '');
let outbox = [], offline = false, flushing = false;
const newId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x' ? r : (r&0x3|0x8)).toString(16); });
const isNetErr = e => !navigator.onLine || /fetch|network|load failed|timeout|offline|conexi/i.test(String(e && (e.message || e)));
function loadOutbox(){ try{ outbox = JSON.parse(localStorage.getItem(OBX_KEY()) || '[]'); }catch(e){ outbox = []; } }
function saveOutbox(){ try{ localStorage.setItem(OBX_KEY(), JSON.stringify(outbox)); }catch(e){} updateNetBanner(); }
function saveCache(){ try{ if(me && me.status==='approved') localStorage.setItem(CACHE_KEY(), JSON.stringify({me, D:{...D, alarms:[...(D.alarms||[])]}, at:Date.now()})); }catch(e){} }
function readCache(){ try{ const c = JSON.parse(localStorage.getItem(CACHE_KEY()) || 'null'); if(c && c.D){ c.D.alarms = new Set(c.D.alarms || []); } return c; }catch(e){ return null; } }
function updateNetBanner(){
  const el = document.getElementById('net'); if(!el) return;
  const n = outbox.length;
  if(n || offline){ el.hidden = false; el.innerHTML = `📴 Sin cobertura${n ? ` · <b>${n}</b> cambio${n>1?'s':''} pendiente${n>1?'s':''} de subir` : ' · viendo los datos guardados en el móvil'}`; }
  else el.hidden = true;
}
function runOp(op){
  const t = sb.from(op.table);
  if(op.kind==='upsert') return t.upsert(op.rows);
  if(op.kind==='insert') return t.insert(op.rows);
  let x = op.kind==='update' ? t.update(op.patch) : t.delete();
  Object.entries(op.match||{}).forEach(([k,v]) => { x = x.eq(k, v); });
  return x;
}
// Escribe ya; si no hay cobertura lo guarda en la cola y lo sube después, en el mismo orden
async function write(op){
  if(outbox.length){ outbox.push(op); saveOutbox(); saveCache(); flush(); return; }
  try{ const { error } = await runOp(op); if(error) throw error; if(offline){ offline = false; updateNetBanner(); } }
  catch(e){
    if(isNetErr(e)){ outbox.push(op); offline = true; saveOutbox(); toast('📴 Sin cobertura: se guardará al volver la conexión'); }
    else { toast('⚠️ ' + traducir(e.message)); scheduleReload(); }
  }
  saveCache();
}
async function flush(){
  if(flushing || !outbox.length || !navigator.onLine) return;
  flushing = true; let done = 0;
  try{
    while(outbox.length){
      const op = outbox[0];
      try{ const { error } = await runOp(op); if(error) throw error; done++; }
      catch(e){ if(isNetErr(e)) break; console.warn('Cambio descartado', op, e); }
      outbox.shift(); saveOutbox();
    }
    if(!outbox.length){ offline = false; updateNetBanner(); if(done) toast(`✅ ${done} cambio${done>1?'s':''} guardado${done>1?'s':''} al volver la cobertura`); try{ await loadAll(); render(); }catch(e){} }
  } finally { flushing = false; }
}

/* ---------- carga de datos ---------- */
async function loadAll(){
  const st = await q(sb.from('settings').select('data').eq('id',1).maybeSingle(), true).catch(()=>null);
  if(st || !D.settings || !D.settings.tramos) D.settings = Object.assign({...DEF_SETTINGS}, (st && st.data) || {});
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
    D.contacts = {}; try{ const { data } = await sb.from('member_contacts').select('*'); (data||[]).forEach(r => D.contacts[r.member_id] = r.email); }catch(e){}
    D.pushN = {}; try{ const { data } = await sb.rpc('push_counts'); (data||[]).forEach(r => D.pushN[r.user_id] = Number(r.n)); }catch(e){}
    await Promise.all([loadAlarms(), loadRsvp(), loadAnn()]);
    D.lastBackup = bk && bk[0] ? bk[0].created_at : null;
  } else {
    const [members, sessions, att, bote] = await Promise.all([
      q(sb.from('members').select('*')),
      q(sb.from('sessions').select('*')),
      q(sb.from('attendance').select('*')),
      q(isSup() ? sb.from('bote').select('*').order('created_at',{ascending:false}) : sb.from('bote').select('amount_cents'))
    ]);
    Object.assign(D, {members, sessions, att, bote, profiles:[]});
    await Promise.all([loadAlarms(), loadRsvp(), loadAnn()]);
  }
  offline = false; updateNetBanner(); saveCache();
}
async function loadAnn(){
  D.ann = [];
  try{ const { data } = await sb.from('announcements').select('*').order('created_at',{ascending:false}).limit(30); if(data) D.ann = data; }catch(e){}
}
async function loadRsvp(){
  D.rsvp = []; D.rsvpCount = {};
  try{ const { data } = await sb.from('session_rsvp').select('*'); if(data) D.rsvp = data; }catch(e){}
  try{ const { data } = await sb.rpc('rsvp_counts'); (data||[]).forEach(r => D.rsvpCount[r.session_id] = {yes:Number(r.yes_count)||0, no:Number(r.no_count)||0}); }catch(e){}
}
const myRsvp = sid => (D.rsvp||[]).find(r => r.session_id===sid && r.user_id===authUser.id);
function rsvpLine(s){
  const c = (D.rsvpCount||{})[s.id]; if(!c || (!c.yes && !c.no)) return '';
  return `${c.yes} va${c.yes===1?'':'n'} · ${c.no} no puede${c.no===1?'':'n'}`;
}
async function loadAlarms(){
  D.alarms = new Set();
  try{ const { data, error } = await sb.from('session_alarms').select('session_id').eq('user_id', authUser.id); if(!error && data) D.alarms = new Set(data.map(x=>x.session_id)); }catch(e){}
}
let reloadT = null;
function scheduleReload(){ clearTimeout(reloadT); reloadT = setTimeout(async ()=>{
  if(!navigator.onLine) return;
  if(outbox.length){ await flush(); if(outbox.length) return; }
  try{ const wasAdmin = isAdmin(), wasSt = me && me.status; await refreshMe();
       if(!me || me.status !== wasSt || isAdmin() !== wasAdmin) return boot();
       await loadAll(); render(); }catch(e){} }, 700); }
let meErr = '';
async function refreshMe(){ if(!authUser) return; meErr = ''; me = await q(sb.from('profiles').select('*').eq('id', authUser.id).maybeSingle(), true).catch(e=>{ meErr = e.message || String(e); return me; }); }

let channel = null;
function subscribe(){
  if(channel) return;
  channel = sb.channel('coro-cambios');
  ['attendance','sessions','members','profiles','session_rsvp','announcements'].forEach(t => channel.on('postgres_changes', {event:'*', schema:'public', table:t}, scheduleReload));
  channel.subscribe();
}

/* ---------- arranque / sesión ---------- */
async function boot(){
  if(booting) return; booting = true;
  try{
    const { data:{ session } } = await sb.auth.getSession();
    authUser = session ? session.user : null;
    if(!authUser){ me = null; renderAuth(); return; }
    loadOutbox();
    await refreshMe();
    if(!me){ const c = readCache(); if(c && c.me){ me = c.me; offline = true; } }
    if(!me){ renderMsg('No se encontró tu perfil', 'Vuelve a intentarlo en un momento.' + (meErr ? `<br><small>Detalle: ${esc(meErr)}</small>` : '')); return; }
    if(me.status === 'pending'){ renderMsg('⏳ Solicitud pendiente', `Hola ${esc(me.full_name)}. Un responsable del coro tiene que aceptar tu registro. Vuelve a entrar más tarde.`); return; }
    if(me.status === 'rejected'){ renderMsg('Acceso no autorizado', 'Tu solicitud no ha sido aceptada. Habla con un responsable del coro.'); return; }
    tab = isAdmin() ? (['hoy','cal','coro','historial','sup','avisos','yo','cuenta','ajustes'].includes(tab)?tab:'hoy') : isSup() ? (['cal','sup','avisos','cuenta'].includes(tab)?tab:'sup') : (['cal','avisos','yo','cuenta'].includes(tab)?tab:'yo');
    loading = true; render();
    if(outbox.length && navigator.onLine) await flush();
    try{ await loadAll(); }
    catch(err){ const c = readCache(); if(!c) throw err; Object.assign(D, c.D); offline = true; updateNetBanner(); toast('📴 Sin cobertura: viendo los datos guardados'); }
    await checkPush(); loading = false;
    subscribe(); render(); applyDeepLink();
    const np = D.profiles.filter(p=>p.status==='pending').length;
    if(isAdmin() && np) toast(`🔔 Tienes ${np} solicitud${np>1?'es':''} de acceso pendiente${np>1?'s':''} (pestaña Coro)`);
  } catch(e){ renderMsg('Sin conexión', 'No se ha podido conectar. Comprueba la cobertura y vuelve a intentarlo.'); }
  finally{ booting = false; }
}

/* ---------- pantallas de acceso ---------- */
let authMode = 'login';
function chrome(showNav){
  document.querySelector('nav').style.display = showNav ? 'flex' : 'none';
  document.getElementById('sub').textContent = me && me.status==='approved' ? `Hola, ${(me.full_name||'').split(' ')[0]}${isAdmin()?' · súper usuario':isSup()?' · supervisión':''}` : 'Lista y reparto';
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
  if(tab==='avisos') markAnnRead();
  const unread = unreadAnn();
  const avBtn = `<button data-tab="avisos"><span>${ICONS.bellNav}${unread?`<i class="badge">${unread}</i>`:''}</span>Avisos</button>`;
  nav.innerHTML = isAdmin() ? `
    <button data-tab="hoy"><span>${ICONS.hoy}</span>Hoy</button>
    <button data-tab="cal"><span>${ICONS.cal}</span>Calendario</button>
    <button data-tab="coro"><span>${ICONS.coro}${pend?`<i class="badge">${pend}</i>`:''}</span>Coro</button>
    <button data-tab="historial"><span>${ICONS.historial}</span>Historial</button>
    ${avBtn}
    <button data-tab="yo"><span>${ICONS.coins}</span>Lo mío</button>`
    : isSup() ? `<button data-tab="cal"><span>${ICONS.cal}</span>Calendario</button>${avBtn}<button data-tab="cuenta"><span>${ICONS.cuenta}</span>Cuenta</button>`
    : `<button data-tab="cal"><span>${ICONS.cal}</span>Calendario</button>${avBtn}<button data-tab="yo"><span>${ICONS.coins}</span>Mis asistencias</button><button data-tab="cuenta"><span>${ICONS.cuenta}</span>Cuenta</button>`;
  nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab===tab));
  const os = activeSession();
  if(isAdmin() && os) document.getElementById('sub').textContent = `Quedada en curso · ${fmtDate(os.date)} · ${os.start_time}${os.place?' · '+os.place:''}`;
  if(loading){ document.getElementById('app').innerHTML = '<div class="empty">Cargando…</div>'; return; }
  const views = {hoy:renderHoy, cal:renderCal, coro:renderCoro, historial:renderHistorial, sup:renderSup, avisos:renderAvisos, yo:renderYo, cuenta:renderCuenta, ajustes:renderAjustes};
  document.getElementById('userBtn').style.display = isAdmin() ? 'flex' : 'none';
  document.getElementById('userBtn').classList.toggle('on', tab==='cuenta');
  document.getElementById('gear').style.display = isAdmin() ? 'flex' : 'none';
  document.getElementById('gear').classList.toggle('on', tab==='ajustes');
  document.getElementById('supBtn').style.display = canSee() ? 'flex' : 'none';
  document.getElementById('supBtn').classList.toggle('on', tab==='sup');
  if(isAdmin()) (views[tab]||renderHoy)();
  else if(isSup()) ({cal:renderCal, sup:renderSup, avisos:renderAvisos, cuenta:renderCuenta}[tab]||renderSup)();
  else ({cal:renderCal, avisos:renderAvisos, yo:renderYo, cuenta:renderCuenta}[tab]||renderYo)();
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
function pendingCard(){
  const pend = pendingSessions(); if(!pend.length) return '';
  return `<div class="card" style="border-color:var(--oro)"><h2>Pendientes de reparto (${pend.length})</h2>
    <p class="hint" style="margin-top:-4px">Quedadas terminadas a la espera de contar su bolsa.</p>
    ${pend.map(p=>{ const n = attOf(p.id).filter(a=>a.status==='present').length;
      return `<div class="list-item"><span><b>${fmtDate(p.date)} · ${esc(p.start_time)}–${esc(p.end_time)}</b><br><span class="det">${n} presente${n===1?'':'s'}${p.place?' · '+esc(p.place):''}</span></span>
      <span class="row" style="flex:0;gap:6px"><button class="ic" data-act="focusSession" data-id="${p.id}">Ver</button><button class="ic g" data-act="repartir" data-id="${p.id}">Repartir</button></span></div>`; }).join('')}
  </div>`;
}
function renderHoy(){
  const $ = document.getElementById('app');
  const s = openSession();
  if(!s){
    const n = D.members.filter(m=>m.active!==false).length;
    const pl = plannedSessions();
    $.innerHTML = pendingCard() + `
      ${pl.length?heroCard(pl[0], `<button data-act="startPlanned" data-id="${pl[0].id}" ${n?'':'disabled'}>Pasar lista</button><button class="alt" data-act="editPlanned" data-id="${pl[0].id}">Editar</button>`):''}
      ${pl.length>1?`<div class="card"><h2>Más adelante</h2>
        ${pl.slice(1).map(p=>`<div class="list-item" style="align-items:flex-start"><span><b>${fmtDate(p.date)} · ${esc(p.start_time)}</b><br><span class="det">${placeHtml(p)}</span></span>
          <span class="row" style="flex:0;gap:6px"><button class="ic" data-act="editPlanned" data-id="${p.id}" aria-label="Editar">✎</button><button class="ic g" data-act="startPlanned" data-id="${p.id}" ${n?'':'disabled'}>Pasar lista</button></span></div>`).join('')}
      </div>`:''}
      <div class="card"><h2>Nueva quedada</h2>
        <label>Fecha</label><input type="date" id="nsDate" value="${today()}">
        <label>Hora de quedada</label><input type="time" id="nsStart" value="${esc(S().start)}">
        <label>Sitio (punto exacto de encuentro)</label><input id="nsPlace" placeholder="p. ej. Puerta de la parroquia de San Pablo" autocomplete="off" value="${esc(S().place||'')}">
        <button class="btn" data-act="planSession">Programar y avisar a todos</button>
        <button class="btn sec" data-act="startSession" ${n?'':'disabled style="opacity:.5"'}>Empezar ya a pasar lista (sin avisar)</button>
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
    else if(a.status==='present' && !a.leave && !isEnded(s)) acts = `<button class="ic v" data-act="leave" data-id="${id}">Se va</button><button class="ic" data-act="edit" data-id="${id}">✎</button>`;
    else acts = `<button class="ic" data-act="edit" data-id="${id}">✎</button>`;
    return `<div class="p"><div class="dot ${info.dot}"></div><div class="info"><div class="name">${esc(m?m.name:'?')}</div><div class="det">${info.txt}</div></div><div class="acts">${acts}</div></div>`;
  };
  const byName = (x,y) => sortName(member(x.member_id)||{}, member(y.member_id)||{});
  const pend = rows.filter(a=>a.status==='pending').sort(byName), done = rows.filter(a=>a.status!=='pending').sort(byName);
  const items = (pend.length ? `<h3 style="margin-top:0">⏳ Faltan por llegar (${pend.length})</h3>${pend.map(rowHtml).join('')}` : '')
    + (done.length ? `<h3 ${pend.length?'':'style="margin-top:0"'}>✅ Ya marcados (${done.length})</h3>${done.map(rowHtml).join('')}` : '');
  $.innerHTML = `
    <div class="card">
      ${focusId?`<button class="btn sec sm" data-act="unfocus" style="margin-bottom:12px">← Volver</button>`:''}
      ${isEnded(s)?`<div style="background:rgba(242,193,78,.14);color:var(--oro);border-radius:12px;padding:10px 12px;margin-bottom:12px;font-weight:600">Quedada terminada a las ${esc(s.end_time)} · pendiente de contar el botín y repartir</div>`:''}
      <div class="row" style="align-items:flex-start"><div><h2 style="margin:0">${fmtDate(s.date)}</h2><div class="muted">Quedada a las <b>${esc(s.start_time)}</b> · ${isEnded(s)?`terminó a las <b>${esc(s.end_time)}</b>`:`ahora ${nowHM()}`}</div><div class="det" style="margin-top:4px">${placeHtml(s)}</div></div>
      <button class="ic" style="flex:0" data-act="editSession">✎</button></div>
      <div class="stats">
        <div class="stat"><b>${c.present}</b><small>presentes</small></div>
        <div class="stat"><b>${c.late}</b><small>tarde</small></div>
        <div class="stat"><b>${c.left}</b><small>se fueron</small></div>
        <div class="stat"><b>${c.absent}</b><small>no vienen</small></div>
      </div>
      ${!isEnded(s)?`<button class="btn" data-act="showQr">${IC('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>').replace('<svg','<svg width="20" height="20"')} Mostrar QR (llegada / salida)</button>`:''}
      ${pend.length?`<button class="btn sec" data-act="allOnTime">✓ Marcar los ${pend.length} sin marcar como llegados a las ${esc(s.start_time)}</button>`:''}
    </div>
    <div class="card">${items || '<div class="empty">No hay nadie en la lista.</div>'}
      <button class="btn sec" data-act="addInSession">＋ Añadir a alguien a la lista de hoy</button>
    </div>
    ${isEnded(s)
      ? `<button class="btn oro" data-act="closeAsk">Introducir botín y repartir</button><button class="btn sec" data-act="resumeSession">Reanudar la quedada (no ha terminado)</button>`
      : `<button class="btn oro" data-act="endAsk">Terminar quedada</button><p class="hint" style="text-align:center">El botín se introduce después, cuando esté contado.</p>`}`;
}

/* ----- ENLACES DESDE NOTIFICACIONES ----- */
function applyDeepLink(){
  const h = pendingLink; if(!h || !me || me.status!=='approved') return;
  pendingLink = '';
  try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){}
  sheet(''); focusId = null;
  if(h.startsWith('#llegada=')){ const [sid, code] = h.slice(9).split('.'); if(sid && code) doCheckin(sid, code); return; }
  if(h.startsWith('#salida=')){ const [sid, code] = h.slice(8).split('.'); if(sid && code) doCheckout(sid, code); return; }
  if(h.startsWith('#cal')){
    const id = h.split('=')[1]; const s = id && D.sessions.find(x => x.id === id);
    tab = 'cal';
    if(s){ calSel = s.date; calMonth = s.date.slice(0,7); }
  } else if(h === '#avisos') tab = 'avisos';
  else if(h === '#yo') tab = isSup() ? 'cuenta' : 'yo';
  else if(h === '#coro' && isAdmin()) tab = 'coro';
  render(); const app = document.getElementById('app'); if(app) app.scrollTop = 0;
}

/* ----- CALENDARIO ----- */
function annSeenKey(){ return 'coro-ann-seen-' + (authUser ? authUser.id : ''); }
function unreadAnn(){
  let seen = 0; try{ seen = Number(localStorage.getItem(annSeenKey())) || 0; }catch(e){}
  return (D.ann||[]).filter(x => new Date(x.created_at).getTime() > seen && x.author !== authUser.id).length;
}
function markAnnRead(){ try{ const last = Math.max(0, ...(D.ann||[]).map(x=>new Date(x.created_at).getTime())); if(last) localStorage.setItem(annSeenKey(), String(last)); }catch(e){} }
function renderAvisos(){
  const list = D.ann || [];
  const item = x => `<div class="list-item" style="align-items:flex-start"><span style="min-width:0"><b>${esc(x.title||'Aviso del coro')}</b>${x.audience==='admins'?' <span class="tag late">solo súper</span>':''}<div style="white-space:pre-line;margin-top:4px;line-height:1.4">${esc(x.body)}</div><div class="muted" style="font-size:12px;margin-top:4px">${new Date(x.created_at).toLocaleString('es-ES',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div></span>${isAdmin()?`<button class="ic r" style="flex:0" data-act="annDel" data-id="${x.id}" aria-label="Borrar aviso">✕</button>`:''}</div>`;
  document.getElementById('app').innerHTML = `
    ${isAdmin()?`<button class="btn" data-act="annAsk" style="margin:0 0 12px">${ICONS.bell} Escribir un aviso</button>`:''}
    <div class="card"><h2>Avisos del coro</h2>
      ${list.length ? list.map(item).join('') : '<div class="empty">Todavía no hay avisos.</div>'}
    </div>
    <p class="hint" style="text-align:center">Las notificaciones de este móvil se gestionan en <a href="#" data-act="goCuenta">Cuenta</a>.</p>`;
}
function annCard(){
  const lim = Date.now() - 14*86400000;
  const list = (D.ann||[]).filter(x => new Date(x.created_at).getTime() > lim).slice(0,3);
  if(!list.length) return '';
  return `<div class="card" style="border-color:var(--oro)"><h2 style="display:flex;align-items:center;gap:8px">${ICONS.bell} Avisos</h2>
    ${list.map(x=>`<div class="list-item" style="align-items:flex-start"><span><b>${esc(x.title||'Aviso del coro')}</b>${x.audience==='admins'?' <span class="tag late">solo súper</span>':''}<div style="white-space:pre-line;margin-top:4px;line-height:1.4">${esc(x.body)}</div><div class="muted" style="font-size:12px;margin-top:4px">${new Date(x.created_at).toLocaleString('es-ES',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div></span></div>`).join('')}
  </div>`;
}
function jmjBanner(){
  const start = new Date(2027, 7, 3), end = new Date(2027, 7, 8, 23, 59);
  const now = new Date(); const dias = Math.ceil((start - new Date(now.toDateString()))/86400000);
  const falta = now > end ? '¡Ya hemos estado!' : dias > 0 ? `Faltan <b>${dias}</b> día${dias===1?'':'s'}` : '¡Ya estamos en Seúl!';
  return `<section class="jmj">
    <img class="jmj-logo" src="jmj-seul-2027.png" alt="Logo de la JMJ Seúl 2027" onerror="this.remove()">
    <div class="jmj-txt">
      <div class="jmj-k">JMJ Seúl 2027</div>
      <div class="jmj-t">Vamos camino a Seúl</div>
      <div class="jmj-d">3 – 8 de agosto de 2027 · ${falta}</div>
    </div>
  </section>`;
}
let calMonth = null, calSel = null;
function sessionState(s){
  if(s.closed) return {t:'Hecha', c:''};
  if(s.started===false) return {t:'Programada', c:'ok'};
  if(s.end_time) return {t:'Pendiente de reparto', c:'late'};
  return {t:'En curso', c:'left'};
}
function rsvpBlock(s){
  const mine = myRsvp(s.id), c = (D.rsvpCount||{})[s.id] || {yes:0,no:0};
  let who = '';
  if(isAdmin()){
    const name = uid => { const p = D.profiles.find(x=>x.id===uid); const m = p && member(p.member_id); return m ? m.name : (p ? p.full_name : '?'); };
    const yes = D.rsvp.filter(r=>r.session_id===s.id && r.status==='yes').map(r=>name(r.user_id)).sort((x,y)=>x.localeCompare(y,'es'));
    const no = D.rsvp.filter(r=>r.session_id===s.id && r.status==='no').map(r=>name(r.user_id)).sort((x,y)=>x.localeCompare(y,'es'));
    const answered = new Set(D.rsvp.filter(r=>r.session_id===s.id).map(r=>r.user_id));
    const sin = D.profiles.filter(p=>p.status==='approved' && !(p.is_supervisor && !p.is_admin) && !answered.has(p.id)).map(p=>name(p.id)).sort((x,y)=>x.localeCompare(y,'es'));
    const sinApp = D.members.filter(m=>m.active!==false && !D.profiles.some(p=>p.status==='approved' && p.member_id===m.id)).length;
    who = `<details style="margin-top:8px"><summary>Ver quién</summary>
      <p class="muted" style="margin:8px 0 4px"><b style="color:var(--ok)">Van (${yes.length}):</b> ${yes.length?esc(yes.join(', ')):'nadie aún'}</p>
      <p class="muted" style="margin:4px 0"><b style="color:var(--bad)">No pueden (${no.length}):</b> ${no.length?esc(no.join(', ')):'nadie'}</p>
      <p class="muted" style="margin:4px 0"><b>Sin responder (${sin.length}):</b> ${sin.length?esc(sin.join(', ')):'nadie'}</p>
      ${sinApp?`<p class="hint">${sinApp} persona${sinApp>1?'s':''} de la lista aún no usa${sinApp>1?'n':''} la app.</p>`:''}
    </details>`;
  }
  return `<div style="margin-top:14px">
    <div class="muted" style="font-size:13px;margin-bottom:6px">¿Vas a venir?${c.yes||c.no?` · <b style="color:var(--txt)">${c.yes}</b> van, <b style="color:var(--txt)">${c.no}</b> no pueden`:''}</div>
    <div class="seg"><button class="${mine&&mine.status==='yes'?'on':''}" data-act="rsvp" data-id="${s.id}" data-v="yes">Voy</button><button class="${mine&&mine.status==='no'?'on':''}" data-act="rsvp" data-id="${s.id}" data-v="no">No puedo</button></div>
    ${who}</div>`;
}
function renderCal(){
  const byDay = {};
  D.sessions.forEach(s => { (byDay[s.date] = byDay[s.date] || []).push(s); });
  if(!calSel){
    const next = D.sessions.filter(s=>!s.closed && s.date>=today()).sort((x,y)=>(x.date+x.start_time).localeCompare(y.date+y.start_time))[0];
    calSel = next ? next.date : today();
  }
  if(!calMonth) calMonth = calSel.slice(0,7);
  const [y,m] = calMonth.split('-').map(Number);
  const first = new Date(y, m-1, 1), startDow = (first.getDay()+6)%7, nDays = new Date(y, m, 0).getDate();
  const monthName = first.toLocaleDateString('es-ES',{month:'long', year:'numeric'});
  const t = today();
  let cells = '';
  for(let i=0;i<startDow;i++) cells += '<span></span>';
  for(let d=1; d<=nDays; d++){
    const ds = `${y}-${pad(m)}-${pad(d)}`, has = byDay[ds];
    const cls = ['cal-d', has?'has':'', ds===t?'today':'', ds===calSel?'sel':'', ds<t?'past':''].join(' ');
    const lbl = new Date(y,m-1,d).toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'}) + (has ? `, ${has.length} quedada${has.length>1?'s':''}` : '');
    cells += `<button class="${cls}" data-act="calDay" data-d="${ds}" aria-label="${lbl}" ${ds===calSel?'aria-pressed="true"':''}><span>${d}</span>${has?'<i class="dt"></i>':'<i class="dt0"></i>'}</button>`;
  }
  const inMonth = D.sessions.filter(s=>s.date.startsWith(calMonth));
  const futureInMonth = inMonth.filter(s=>!s.closed && s.date>=t).length;
  const sel = (byDay[calSel]||[]).sort((a,b)=>a.start_time.localeCompare(b.start_time));
  const selTitle = new Date(calSel+'T12:00:00').toLocaleDateString('es-ES',{weekday:'long', day:'numeric', month:'long'});
  const detail = sel.length ? sel.map(s => {
    const st = sessionState(s), future = !s.closed && s.date >= t, on = D.alarms && D.alarms.has(s.id);
    const mine = me.member_id && attGet(s.id, me.member_id);
    return `<div class="card">
      <div class="row" style="align-items:center"><div class="big" style="font-size:34px;flex:0 0 auto">${esc(s.start_time)}</div><span style="text-align:right"><span class="tag ${st.c}">${st.t}</span></span></div>
      <div class="sitio" style="display:flex;gap:8px;align-items:flex-start;margin-top:8px;line-height:1.35">${ICONS.pin}<span>${s.place?esc(s.place):'<span class="muted">Sitio sin indicar</span>'}</span></div>
      ${s.closed && mine ? `<p class="muted" style="margin:10px 0 0">Tu parte: <b style="color:var(--oro)">${eur(mine.amount_cents)}</b></p>` : ''}
      ${future && !isSup() ? rsvpBlock(s) : ''}
      ${future ? `<button class="btn ${on?'sec':''}" data-act="toggleAlarm" data-id="${s.id}">${ICONS.bell} ${on?'Te avisaremos por la mañana · quitar':'Recordármelo por la mañana'}</button>` : ''}
      <div class="row" style="margin-top:10px;gap:8px">
        ${s.place?`<a class="btn sec sm" style="flex:1" href="${mapUrl(s.place)}" target="_blank" rel="noopener">Cómo llegar</a>`:''}
        ${isAdmin() && !s.closed ? `<button class="btn sec sm" style="flex:1" data-act="calEdit" data-id="${s.id}">Editar</button>` : ''}
      </div>
    </div>`; }).join('')
    : `<div class="card"><p class="muted" style="margin:0">No hay quedada este día.</p>${isAdmin() && calSel>=t ? `<button class="btn sec" data-act="calPlan" data-d="${calSel}">Programar una quedada este día</button>` : ''}</div>`;
  document.getElementById('app').innerHTML = jmjBanner() + `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <button class="ic" style="flex:0" data-act="calMove" data-v="-1" aria-label="Mes anterior">‹</button>
        <div style="text-align:center"><div style="font-size:19px;font-weight:700">${monthName.charAt(0).toUpperCase()+monthName.slice(1)}</div><div class="muted" style="font-size:13px">${futureInMonth ? `${futureInMonth} quedada${futureInMonth>1?'s':''} por delante` : 'Sin quedadas por delante este mes'}</div></div>
        <button class="ic" style="flex:0" data-act="calMove" data-v="1" aria-label="Mes siguiente">›</button>
      </div>
      <div class="cal-grid" style="margin-top:14px">${['L','M','X','J','V','S','D'].map(w=>`<span class="cal-w">${w}</span>`).join('')}${cells}</div>
    </div>
    <h3 style="margin:6px 4px 8px;text-transform:none;letter-spacing:0;font-size:16px;color:var(--txt)">${selTitle.charAt(0).toUpperCase()+selTitle.slice(1)}</h3>
    ${detail}`;
}

/* ----- SUPERVISIÓN ----- */
function reasonOf(a){
  if(!a) return {t:'No estaba en la lista', c:'abs'};
  if(a.status==='absent' || a.status==='pending' || !(a.present_min>0)) return {t:'No vino', c:'abs'};
  const p = []; if(a.late_min) p.push(`Llegó ${a.late_min} min tarde`); if(a.early_min) p.push(`se fue ${a.early_min} min antes`);
  return p.length ? {t: p.join(' y ').replace(/^se/,'Se'), c:'late'} : {t:'Toda la quedada', c:'ok'};
}
function memberStats(mid){
  const closed = D.sessions.filter(s=>s.closed).sort((x,y)=>(y.date+y.start_time).localeCompare(x.date+x.start_time));
  const rows = closed.map(s => ({s, a: attGet(s.id, mid)}));
  const att = rows.filter(r=>r.a && r.a.present_min>0);
  return { rows, total: rows.reduce((t,r)=>t+(r.a?r.a.amount_cents:0),0), dias: att.length, quedadas: closed.length,
    mins: att.reduce((t,r)=>t+r.a.present_min,0), tarde: att.filter(r=>r.a.late_min>0).length, minTarde: att.reduce((t,r)=>t+(r.a.late_min||0),0),
    antes: att.filter(r=>r.a.early_min>0).length, faltas: rows.length - att.length };
}
function renderSup(){
  const closed = D.sessions.filter(s=>s.closed).sort((x,y)=>(y.date+y.start_time).localeCompare(x.date+x.start_time));
  const sum = f => closed.reduce((t,s)=>t+(s[f]||0),0);
  const bote = D.bote.reduce((t,b)=>t+b.amount_cents,0);
  const people = D.members.map(m => ({m, st: memberStats(m.id)})).filter(x => x.m.active!==false || x.st.total>0)
    .sort((x,y)=> y.st.total-x.st.total || x.m.name.localeCompare(y.m.name,'es'));
  document.getElementById('app').innerHTML = `
    <button class="btn" data-act="exportExcel" style="margin:0 0 12px">${IC('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13l4 5M12 13l-4 5"/>').replace('<svg','<svg width="20" height="20"')} Exportar a Excel</button>
    <div class="tiles">
      <div class="tile"><div class="l">Recaudado</div><div class="v g">${eur(sum('botin_cents'))}</div></div>
      <div class="tile"><div class="l">Repartido</div><div class="v">${eur(sum('repartido_cents'))}</div></div>
      <div class="tile"><div class="l">Gastos</div><div class="v">${eur(sum('gastos_cents'))}</div></div>
      <div class="tile"><div class="l">Bote común</div><div class="v">${eur(bote)}</div></div>
    </div>
    <div class="card"><h2>Por persona</h2>
      <p class="hint" style="margin-top:-4px">${closed.length} quedada${closed.length===1?'':'s'} repartida${closed.length===1?'':'s'}. Toca un nombre para ver el detalle.</p>
      ${people.length ? people.map(({m,st}) => `<div class="list-item" data-act="memberSheet" data-id="${m.id}" style="cursor:pointer"><span><b>${esc(m.name)}</b>${m.active===false?' <span class="tag">ya no viene</span>':''}<br><span class="det" style="font-size:13px">${st.dias}/${st.quedadas} días${st.tarde?` · ${st.tarde} tarde`:''}${st.antes?` · ${st.antes} se fue antes`:''}</span></span><span style="display:flex;align-items:center;gap:8px"><b style="color:var(--oro)">${eur(st.total)}</b><span class="muted">›</span></span></div>`).join('') : '<div class="empty">Aún no hay nadie en la lista.</div>'}
    </div>
    <div class="card"><h2>Por día</h2>
      ${closed.length ? closed.map(s => `<div class="list-item" data-act="supSession" data-id="${s.id}" style="cursor:pointer"><span><b>${fmtDate(s.date)} · ${esc(s.start_time)}–${esc(s.end_time)}</b><br><span class="det" style="font-size:13px">${attOf(s.id).filter(a=>a.present_min>0).length} presentes${s.gastos_cents?` · gastos ${eur(s.gastos_cents)}`:''}</span></span><span style="display:flex;align-items:center;gap:8px"><b>${eur(s.botin_cents)}</b><span class="muted">›</span></span></div>`).join('') : '<div class="empty">Aún no hay quedadas repartidas.</div>'}
    </div>`;
}
function memberSheet(mid){
  const m = member(mid); if(!m) return; const st = memberStats(mid);
  const pct = st.quedadas ? Math.round(st.dias*100/st.quedadas) : 0;
  sheet(`<h2>${esc(m.name)}</h2>
    <div class="tiles">
      <div class="tile"><div class="l">Total ganado</div><div class="v g">${eur(st.total)}</div></div>
      <div class="tile"><div class="l">Asistencia</div><div class="v">${st.dias}/${st.quedadas} · ${pct}%</div></div>
    </div>
    <div class="sumbox">
      <div><span>Horas cantando</span><b>${String(Math.round(st.mins/6)/10).replace('.',',')} h</b></div>
      <div><span>Media por día</span><b>${st.dias?eur(Math.round(st.total/st.dias)):'–'}</b></div>
      <div><span>Veces tarde</span><b>${st.tarde}${st.minTarde?` (${st.minTarde} min)`:''}</b></div>
      <div><span>Se fue antes / faltas</span><b>${st.antes} / ${st.faltas}</b></div>
    </div>
    <h3>Día a día</h3>
    ${st.rows.length ? `<table><tr><th>Día</th><th>Motivo</th><th class="n">%</th><th class="n">Cobra</th></tr>${st.rows.map(({s,a}) => { const r = reasonOf(a);
      return `<tr><td><b>${fmtDate(s.date)}</b><br><span class="muted" style="font-size:12px">${esc(s.start_time)}–${esc(s.end_time)}</span></td><td><span class="tag ${r.c}" style="margin-left:0">${r.t}</span>${a&&a.present_min>0?`<br><span class="muted" style="font-size:12px">${minTxt(a.present_min)} cantando</span>`:''}</td><td class="n">${a?Math.round(Number(a.weight)*100):0}%</td><td class="n"><b>${eur(a?a.amount_cents:0)}</b></td></tr>`; }).join('')}</table>` : '<div class="empty">Aún no hay quedadas repartidas.</div>'}
    <button class="btn sec" data-act="closeSheet">Cerrar</button>`);
}

/* ----- AVISOS POR CORREO (para quien no puede instalar la app) ----- */
async function mailNotify(body){
  const E = CFG.EMAILJS || {};
  if(!isAdmin() || !E.SERVICE_ID || !E.TEMPLATE_AVISO || !E.PUBLIC_KEY) return;
  const contacts = Object.entries(D.contacts||{}).filter(([mid,mail]) => mail && (member(mid)||{}).active !== false);
  if(!contacts.length) return;
  const longDate = d => new Date(d+'T12:00:00').toLocaleDateString('es-ES',{weekday:'long', day:'numeric', month:'long'});
  const when = s => `${longDate(s.date)} a las ${s.start_time}${s.place ? ' en ' + s.place : ''}`;
  const sess = id => D.sessions.find(x => x.id === id);
  let msgs = [];   // [member_id, subject, message]
  const all = (subject, message) => contacts.forEach(([mid]) => msgs.push([mid, subject, message]));
  if(body.type === 'session_new'){ const s = sess(body.session_id); if(s) all('📅 Nueva quedada del coro', `Nueva quedada: ${when(s)}.`); }
  else if(body.type === 'session_changed'){ const s = sess(body.session_id); if(s) all('✏️ Cambio en la quedada del coro', `Ahora: ${when(s)}.` + (body.before ? `\nAntes: ${when(body.before)}.` : '')); }
  else if(body.type === 'session_cancelled'){ const s = body.session; if(s) all('❌ Quedada cancelada', `Se cancela la quedada del ${when(s)}.`); }
  else if(body.type === 'announcement'){ const an = (D.ann||[]).find(x => x.id === body.announcement_id); if(an && an.audience === 'all') all('📣 ' + (an.title || 'Aviso del coro'), an.body); }
  else if(body.type === 'payout'){ const s = sess(body.session_id); if(s) contacts.forEach(([mid]) => { const a = attGet(s.id, mid); if(a && a.amount_cents > 0) msgs.push([mid, '💰 Tu parte del reparto', `Quedada del ${longDate(s.date)}: te corresponden ${eur(a.amount_cents)}.`]); }); }
  let ok = 0;
  for(const [mid, subject, message] of msgs){
    try{
      const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ service_id:E.SERVICE_ID, template_id:E.TEMPLATE_AVISO, user_id:E.PUBLIC_KEY,
          template_params:{ to_email: D.contacts[mid], to_name: (member(mid)||{}).name || '', subject, message, app_url: location.origin + location.pathname } }) });
      if(r.ok) ok++;
    }catch(e){}
  }
  if(ok) setTimeout(() => toast(`✉️ Enviado también por correo a ${ok} persona${ok>1?'s':''}`), 2600);
}

/* ----- LLEGADA CON CÓDIGO QR ----- */
const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
const JSQR_LIB = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
let qrTimer = null, qrCode = null, qrSession = null, qrKind = 'in';
function stopQr(){ if(qrTimer){ clearInterval(qrTimer); qrTimer = null; } }
const randCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
async function showQr(kind){
  const s = activeSession(); if(!s) return;
  try{ await loadScript(QR_LIB, 'qrcode'); }catch(e){ return toast('📴 Sin cobertura: no se puede mostrar el QR'); }
  stopQr(); kind = kind === 'out' ? 'out' : 'in'; qrKind = kind;
  qrSession = s.id; qrCode = null;
  const sal = kind === 'out';
  sheet(`<div class="seg" style="margin-bottom:12px"><button class="${sal?'':'on'}" data-act="showQr" data-v="in">Llegada</button><button class="${sal?'on':''}" data-act="showQr" data-v="out">Salida</button></div>
    <h2>QR de ${sal?'salida':'llegada'}</h2><p class="muted" style="margin-top:-6px">${fmtDate(s.date)} · ${esc(s.start_time)}${s.place?' · '+esc(s.place):''}</p>
    <div id="qrBox" style="background:#fff;border-radius:18px;padding:14px;margin:8px auto;max-width:300px;aspect-ratio:1;display:flex;align-items:center;justify-content:center;color:#13213F">Generando…</div>
    <div style="height:6px;border-radius:3px;background:var(--card2);overflow:hidden;max-width:300px;margin:0 auto"><div id="qrBar" style="height:100%;width:100%;background:var(--oro)"></div></div>
    <p id="qrInfo" class="hint" style="text-align:center">El código cambia cada 5 segundos.</p>
    <p class="hint">${sal ? 'Para quien <b>se va antes</b>: lo escanea desde <b>Mis asistencias → Escanear QR de salida</b> y se le apunta la hora de salida exacta. Al terminar la quedada no hace falta: el resto se cierra solo.' : 'Cada uno lo escanea <b>desde la app</b>: <b>Mis asistencias → Escanear QR de llegada</b>. Se le marcará la llegada con la hora exacta.'} A quien no tenga la app, márcalo tú a mano en la lista.</p>
    <button class="btn sec" data-act="closeSheet">Cerrar</button>`);
  let busyTick = false;
  const tick = async () => {
    const box = document.getElementById('qrBox'); if(!box || qrKind !== kind){ return; }
    if(busyTick) return; busyTick = true;
    const prev = qrCode, code = randCode();
    const { error } = await sb.from('session_checkin').upsert({session_id: s.id, kind, code, prev, updated_at: new Date().toISOString()}, {onConflict: 'session_id,kind'});
    if(error){ busyTick = false; document.getElementById('qrInfo').innerHTML = isNetErr(error) ? '📴 Sin cobertura: el QR no funcionará hasta que vuelva la conexión.' : '⚠️ ' + esc(traducir(error.message)); if(qrCode) return; }
    else { qrCode = code; document.getElementById('qrInfo').textContent = 'El código cambia cada 5 segundos.'; }
    busyTick = false;
    const bar = document.getElementById('qrBar'); if(bar){ bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth; bar.style.transition = 'width 5s linear'; bar.style.width = '0%'; }
    const url = location.origin + location.pathname + (sal ? '#salida=' : '#llegada=') + s.id + '.' + (qrCode || code);
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    box.innerHTML = qr.createSvgTag({cellSize: 6, margin: 0, scalable: true}).replace('<svg ', '<svg style="width:100%;height:100%" ');
  };
  await tick(); stopQr(); if(qrKind === kind && document.getElementById('qrBox')) qrTimer = setInterval(tick, 5000);
}

let scanStream = null, scanRaf = null;
function stopScan(){ if(scanRaf){ cancelAnimationFrame(scanRaf); scanRaf = null; } if(scanStream){ scanStream.getTracks().forEach(t => t.stop()); scanStream = null; } }
async function startScan(kind){
  const sal = kind === 'out';
  if(!navigator.onLine) return toast('📴 Necesitas cobertura para fichar la ' + (sal ? 'salida' : 'llegada'));
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast('Este móvil no deja usar la cámara desde la app. Pide que te marquen a mano.');
  try{ await loadScript(JSQR_LIB, 'jsQR'); }catch(e){ return toast('📴 Sin cobertura: no se puede abrir el escáner'); }
  sheet(`<h2>Escanear QR de ${sal ? 'salida' : 'llegada'}</h2>
    <div style="position:relative;border-radius:18px;overflow:hidden;background:#000;aspect-ratio:1;max-width:340px;margin:0 auto">
      <video id="scanV" playsinline muted style="width:100%;height:100%;object-fit:cover"></video>
      <div style="position:absolute;inset:18%;border:3px solid var(--oro);border-radius:16px"></div>
    </div>
    <p id="scanInfo" class="hint" style="text-align:center">Apunta al QR de ${sal ? 'salida' : 'llegada'} que enseña el responsable.</p>
    <canvas id="scanC" hidden></canvas>
    <button class="btn sec" data-act="closeSheet">Cancelar</button>`);
  try{
    scanStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}, audio:false});
  }catch(e){ document.getElementById('scanInfo').textContent = 'No se ha podido abrir la cámara. Revisa en Ajustes del móvil que la app tenga permiso de cámara.'; return; }
  const v = document.getElementById('scanV'), c = document.getElementById('scanC'), ctx = c.getContext('2d', {willReadFrequently:true});
  v.srcObject = scanStream; await v.play().catch(()=>{});
  const loop = () => {
    if(!scanStream) return;
    if(v.readyState >= 2 && v.videoWidth){
      const w = 480, h = Math.round(v.videoHeight * w / v.videoWidth); c.width = w; c.height = h;
      ctx.drawImage(v, 0, 0, w, h);
      const res = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, {inversionAttempts:'dontInvert'});
      const m = res && res.data && res.data.match(/#(llegada|salida)=([0-9a-f-]{36})\.([A-Z0-9]{4,12})/i);
      if(m){
        const esSal = m[1].toLowerCase() === 'salida';
        if(esSal === sal){ stopScan(); (sal ? doCheckout : doCheckin)(m[2], m[3]); return; }
        const inf = document.getElementById('scanInfo'); if(inf) inf.innerHTML = `⚠️ Ese es el QR de <b>${esSal ? 'salida' : 'llegada'}</b>. Pide el de ${sal ? 'salida' : 'llegada'}.`;
      }
    }
    scanRaf = requestAnimationFrame(loop);
  };
  loop();
}
async function doCheckin(sid, code){
  sheet(`<h2>Fichando…</h2><p class="muted">Un momento.</p>`);
  try{
    const { data, error } = await sb.rpc('checkin', {p_session: sid, p_code: code});
    if(error) throw error;
    const a = me.member_id && attGet(sid, me.member_id);
    if(a){ a.status = 'present'; a.arrive = data; a.leave = null; }
    sheet(`<div style="text-align:center;padding:10px 0"><div style="font-size:54px">✅</div><h2>Llegada registrada</h2><p class="muted">A las <b style="color:var(--oro)">${esc(data)}</b>. ¡A cantar!</p><button class="btn" data-act="closeSheet">Hecho</button></div>`);
    render(); scheduleReload();
  }catch(e){
    sheet(`<h2>No se pudo fichar</h2><p class="muted">${esc(isNetErr(e) ? 'Sin cobertura. Inténtalo de nuevo en un momento.' : traducir(e.message))}</p><button class="btn" data-act="scanQr">Volver a escanear</button><button class="btn sec" data-act="closeSheet">Cerrar</button>`);
  }
}

async function doCheckout(sid, code){
  sheet(`<h2>Fichando la salida…</h2><p class="muted">Un momento.</p>`);
  try{
    const { data, error } = await sb.rpc('checkout', {p_session: sid, p_code: code});
    if(error) throw error;
    const a = me.member_id && attGet(sid, me.member_id);
    if(a) a.leave = data;
    sheet(`<div style="text-align:center;padding:10px 0"><div style="font-size:54px">👋</div><h2>Salida registrada</h2><p class="muted">A las <b style="color:var(--oro)">${esc(data)}</b>. ¡Gracias por venir!</p><button class="btn" data-act="closeSheet">Hecho</button></div>`);
    render(); scheduleReload();
  }catch(e){
    sheet(`<h2>No se pudo fichar la salida</h2><p class="muted">${esc(isNetErr(e) ? 'Sin cobertura. Inténtalo de nuevo en un momento.' : traducir(e.message))}</p><button class="btn" data-act="scanQr" data-v="out">Volver a escanear</button><button class="btn sec" data-act="closeSheet">Cerrar</button>`);
  }
}

/* ----- EMOTICONOS PARA LOS AVISOS ----- */
const EMOJIS = [
  ['Avisos', ['🔔','📣','📢','⚠️','❗','❓','✅','❌','⏰','🕐','📅','📍','🗓️','🔁','🚨','ℹ️']],
  ['Navidad', ['🎄','⭐','🌟','✨','🎅','🤶','👼','🕯️','❄️','☃️','🎁','🎶','🎵','🥁','⛪','🙏','✝️','🐑','🐫','👑']],
  ['Otros', ['😊','😂','🙌','👏','💪','❤️','🎉','☀️','🌧️','☔','🧥','💧','☕','🍪','🍫','💰','🚌','🚶','📸','👍']]
];
let emoTarget = 'anB', emoPos = null;
document.addEventListener('focusin', e => { if(e.target && (e.target.id==='anB' || e.target.id==='anT')){ emoTarget = e.target.id; } });
['keyup','click','select','input'].forEach(ev => document.addEventListener(ev, e => { if(e.target && (e.target.id==='anB' || e.target.id==='anT')){ emoTarget = e.target.id; emoPos = e.target.selectionStart; } }));
function insertEmoji(em){
  const el = document.getElementById(emoTarget) || document.getElementById('anB'); if(!el) return;
  const v = el.value, p = (emoPos==null || emoPos > v.length) ? v.length : emoPos;
  if(el.maxLength > 0 && (v.length + em.length) > el.maxLength) return toast('Has llegado al máximo de caracteres');
  el.value = v.slice(0,p) + em + v.slice(p); emoPos = p + em.length;
  try{ el.setSelectionRange(emoPos, emoPos); }catch(e){}
}

/* ----- EXPORTAR A EXCEL ----- */
function loadScript(src, globalName){ return new Promise((ok, ko) => { if(window[globalName || 'XLSX']) return ok(); const s=document.createElement('script'); s.src=src; s.onload=ok; s.onerror=()=>ko(new Error('No se pudo cargar (¿sin cobertura?)')); document.head.appendChild(s); }); }
async function exportExcel(el){
  busy(el,true);
  try{
    await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    const X = window.XLSX, E = '#,##0.00 "€"';
    const d = s => { const [y,m,dd] = s.split("-").map(Number); return new Date(y,m-1,dd); };
    const e = c => Math.round(c||0)/100;
    const closed = D.sessions.filter(s=>s.closed).sort((x,y)=>(x.date+x.start_time).localeCompare(y.date+y.start_time));
    const sum = f => closed.reduce((t,s)=>t+(s[f]||0),0);
    const bote = D.bote.reduce((t,b)=>t+b.amount_cents,0);
    const people = D.members.map(m => ({m, st: memberStats(m.id)})).filter(x => x.m.active!==false || x.st.total>0)
      .sort((x,y)=> y.st.total-x.st.total || x.m.name.localeCompare(y.m.name,'es'));
    const wb = X.utils.book_new();
    function sheet(name, header, rows, fmt, widths){
      const ws = X.utils.aoa_to_sheet([header, ...rows], {cellDates:true});
      const range = X.utils.decode_range(ws['!ref']);
      for(let R=1; R<=range.e.r; R++) for(const [c,z] of Object.entries(fmt||{})){ const cell = ws[X.utils.encode_cell({r:R, c:Number(c)})]; if(cell) cell.z = z; }
      ws['!cols'] = (widths||header.map(h=>Math.max(10, String(h).length+2))).map(w=>({wch:w}));
      ws['!autofilter'] = {ref: X.utils.encode_range({s:{r:0,c:0}, e:{r:Math.max(range.e.r,0), c:range.e.c}})};
      X.utils.book_append_sheet(wb, ws, name);
    }
    // 1. Resumen
    const ws0 = X.utils.aoa_to_sheet([
      ['Coro San Pablo · Supervisión'], ['Exportado el', new Date().toLocaleString('es-ES')], [],
      ['Quedadas repartidas', closed.length], ['Recaudado', e(sum('botin_cents'))], ['Gastos', e(sum('gastos_cents'))],
      ['Repartido', e(sum('repartido_cents'))], ['Bote común (saldo)', e(bote)], ['Personas en la lista', people.length]]);
    ['B5','B6','B7','B8'].forEach(k => { if(ws0[k]) ws0[k].z = E; });
    ws0['!cols'] = [{wch:26},{wch:22}];
    X.utils.book_append_sheet(wb, ws0, 'Resumen');
    // 2. Por persona
    sheet('Por persona',
      ['Nombre','Sigue en el coro','Días asistidos','Quedadas','% asistencia','Horas cantando','Veces tarde','Minutos tarde (total)','Veces se fue antes','Faltas','Total ganado','Media por día asistido'],
      people.map(({m,st}) => [m.name, m.active===false?'No':'Sí', st.dias, st.quedadas, st.quedadas?st.dias/st.quedadas:0, Math.round(st.mins/6)/10, st.tarde, st.minTarde, st.antes, st.faltas, e(st.total), st.dias?e(st.total/st.dias):0]),
      {4:'0%', 10:E, 11:E}, [26,14,13,10,12,14,11,18,17,8,14,20]);
    // 3. Por día
    sheet('Por día',
      ['Fecha','Inicio','Fin','Sitio','Duración (min)','Presentes','Botín','Gastos','Repartido','Al bote (redondeo)','Reparto','Margen cortesía (min)'],
      closed.map(s => [d(s.date), s.start_time, s.end_time, s.place||'', s.duration_min||null, attOf(s.id).filter(a=>a.present_min>0).length, e(s.botin_cents), e(s.gastos_cents), e(s.repartido_cents), e(s.sobrante_cents), s.mode==='tramos'?'Por tramos':'Proporcional', s.tolerance??null]),
      {0:'dd/mm/yyyy', 6:E, 7:E, 8:E, 9:E}, [12,8,8,34,14,10,12,10,12,18,13,20]);
    // 4. Detalle (cada persona en cada quedada)
    const det = [];
    closed.forEach(s => people.forEach(({m}) => { const a = attGet(s.id, m.id), r = reasonOf(a);
      det.push([d(s.date), s.start_time, s.end_time, m.name, r.t, a&&a.present_min>0?(a.arrive||s.start_time):'', a&&a.present_min>0?(a.leave||s.end_time):'', a?a.late_min||0:0, a?a.early_min||0:0, a?a.present_min||0:0, a?Number(a.weight)||0:0, e(a?a.amount_cents:0)]); }));
    sheet('Detalle', ['Fecha','Inicio','Fin','Persona','Motivo','Llegó','Se fue','Min tarde','Min antes','Min cantando','% de parte','Cobra'],
      det, {0:'dd/mm/yyyy', 10:'0%', 11:E}, [12,8,8,26,34,8,8,10,10,13,11,12]);
    // 5. Una hoja por persona
    const used = new Set(['Resumen','Por persona','Por día','Detalle']);
    people.forEach(({m,st}) => {
      let n = m.name.replace(/[\\/?*\[\]:]/g,' ').slice(0,31).trim() || 'Persona'; let k = 2; while(used.has(n)) n = n.slice(0,28)+' '+(k++); used.add(n);
      const rows = st.rows.slice().reverse().map(({s,a}) => { const r = reasonOf(a); return [d(s.date), s.start_time+'–'+s.end_time, r.t, a?a.present_min||0:0, a?Number(a.weight)||0:0, e(a?a.amount_cents:0)]; });
      rows.push([], ['Total', '', `${st.dias}/${st.quedadas} días`, st.mins, '', e(st.total)]);
      sheet(n, ['Fecha','Horario','Motivo','Min cantando','% de parte','Cobra'], rows, {0:'dd/mm/yyyy', 4:'0%', 5:E}, [12,13,34,13,11,12]);
    });
    const out = X.write(wb, {bookType:'xlsx', type:'array', cellDates:true});
    const name = `coro-san-pablo-supervision-${today()}.xlsx`;
    const file = new File([out], name, {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    if(navigator.canShare && navigator.canShare({files:[file]})){ try{ await navigator.share({files:[file], title:name}); }catch(err){} }
    else { const link=document.createElement('a'); link.href=URL.createObjectURL(file); link.download=name; document.body.appendChild(link); link.click(); link.remove(); }
    toast('Excel listo ✅');
  }catch(err){ console.warn(err); toast('⚠️ No se pudo generar el Excel. Comprueba la conexión.'); }
  finally{ busy(el,false); }
}

/* ----- CORO (gente + usuarios) ----- */
function renderCoro(){
  const act = D.members.filter(m=>m.active!==false).sort(sortName), ina = D.members.filter(m=>m.active===false).sort(sortName);
  const linked = id => D.profiles.find(p => p.member_id === id && p.status==='approved');
  const li = m => { const u = linked(m.id); return `<div class="list-item"><span>${esc(m.name)}${u?` <span class="tag ok">@${esc(u.username)}</span>`:''}</span><span class="row" style="flex:0;gap:6px">
     <button class="ic" data-act="mailAsk" data-id="${m.id}" aria-label="Correo para avisos" style="${(D.contacts||{})[m.id]?'color:var(--ok)':''}">✉</button>
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
      ${appr.map(p=>{ const m = member(p.member_id); return `<div class="list-item" data-act="userSheet" data-id="${p.id}"><span><b>${esc(p.full_name)}</b> ${p.is_admin?'<span class="tag late">⭐ súper</span>':''}${p.is_supervisor&&!p.is_admin?'<span class="tag left">supervisión</span>':''}${D.pushN?(D.pushN[p.id]?' <span class="tag ok">🔔 avisos</span>':' <span class="tag abs">sin avisos</span>'):''}<br><span class="muted">@${esc(p.username)} · ${p.is_supervisor&&!p.is_admin?'solo consulta':m?'🔗 '+esc(m.name):'<span style="color:var(--bad)">sin asociar</span>'}</span></span><span class="muted">›</span></div>`; }).join('') || '<div class="empty">Nadie todavía.</div>'}
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
    <label class="check"><input type="checkbox" id="uAdmin" ${p.is_admin?'checked':''} ${self?'disabled':''} onchange="if(this.checked){var o=document.getElementById('uSup');if(o)o.checked=false}"> <span>⭐ Súper usuario<br><small class="muted">Puede pasar lista y gestionarlo todo</small></span></label>
    <label class="check"><input type="checkbox" id="uSup" ${p.is_supervisor&&!p.is_admin?'checked':''} ${self?'disabled':''} onchange="if(this.checked){var o=document.getElementById('uAdmin');if(o)o.checked=false}"> <span>Solo supervisión<br><small class="muted">Responsables de la parroquia: ven la agenda y los números, sin poder modificar nada. No necesitan nombre en la lista.</small></span></label>
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
  document.getElementById('app').innerHTML = pendingCard() + `
    <div class="card"><h2>Bote común</h2><div class="big">${eur(boteSaldo)}</div>
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
  if(isSup()){
    body = `<div class="card"><h2>Mi cuenta de supervisión</h2><p class="muted" style="margin:0">Puedes consultar el calendario y la página de Supervisión. No puedes modificar nada.</p></div>`;
  } else if(!mid){
    body = `<div class="card"><h2>Mis asistencias</h2><p class="muted">Tu usuario todavía no está asociado a tu nombre de la lista del coro. Cuando un responsable lo asocie, aquí verás tus asistencias y lo que llevas ganado.</p></div>`;
  } else {
    const mine = D.att.filter(a => a.member_id === mid).map(a => ({a, s: D.sessions.find(x=>x.id===a.session_id)})).filter(x=>x.s && x.s.closed)
      .sort((x,y)=>(y.s.date+y.s.start_time).localeCompare(x.s.date+x.s.start_time));
    const total = mine.reduce((acc,x)=>acc+x.a.amount_cents,0);
    const dias = mine.filter(x=>x.a.present_min>0).length;
    const mins = mine.reduce((acc,x)=>acc+x.a.present_min,0);
    const open = D.sessions.find(s=>!s.closed && s.started!==false && attGet(s.id, mid));
    let hoy = '';
    if(open){ const a = attGet(open.id, mid); const yaEsta = a && a.status==='present';
      hoy = `<div class="card" style="border:2px solid var(--oro)"><b>Quedada en curso · ${fmtDate(open.date)} ${esc(open.start_time)}</b><div class="det" style="margin-top:6px">${statusInfo(open,a).txt}</div>
        ${!yaEsta && !open.end_time ? `<button class="btn" data-act="scanQr">📷 Escanear QR de llegada</button><p class="hint">Pide al responsable que te enseñe el QR.</p>` : ''}
        ${yaEsta && !a.leave && !open.end_time ? `<button class="btn sec" data-act="scanQr" data-v="out">📷 Me voy: escanear QR de salida</button>` : ''}</div>`; }
    body = `${hoy}
      <div class="tiles">
        <div class="tile"><div class="l">Llevas ganado</div><div class="v g">${eur(total)}</div></div>
        <div class="tile"><div class="l">Asistencia</div><div class="v">${dias} día${dias===1?'':'s'} · ${String(Math.round(mins/6)/10).replace('.',',')} h</div></div>
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
  document.getElementById('app').innerHTML = upcomingCard() + body + `
    <div class="card"><div class="row"><span class="muted">Bote común del coro</span><b style="text-align:right;color:var(--oro)">${eur(bote)}</b></div></div>`;
}

/* ----- CUENTA ----- */
function renderCuenta(){
  const rol = isAdmin() ? 'Súper usuario' : isSup() ? 'Solo supervisión (consulta)' : 'Miembro del coro';
  document.getElementById('app').innerHTML = `
    <div class="card"><h2>Mi cuenta</h2>
      <div style="display:flex;align-items:center;gap:14px">
        <div style="width:52px;height:52px;border-radius:50%;background:var(--card2);color:var(--oro);display:flex;align-items:center;justify-content:center;flex:0 0 52px">${ICONS.cuenta.replace('<svg','<svg width="28" height="28"')}</div>
        <div style="min-width:0"><div style="font-weight:700;font-size:17px">${esc(me.full_name)}</div><div class="muted">@${esc(me.username)} · ${rol}</div></div>
      </div>
      <label>Cambiar mi contraseña</label><div class="row"><input id="myPass" type="password" autocomplete="new-password" placeholder="nueva contraseña"><button class="btn sm sec" style="flex:0" data-act="myPass">Cambiar</button></div>
      <button class="btn danger" data-act="logout">Cerrar sesión</button>
    </div>
    ${pushCard()}
    <p class="muted" style="text-align:center">Coro San Pablo · ${VERSION}</p>`;
}

/* ----- AJUSTES ----- */
function renderAjustes(){
  const st = S();
  document.getElementById('app').innerHTML = `
    <div class="card"><h2>Reglas del reparto</h2>
      <label>Hora de quedada habitual</label><input type="time" id="sStart" value="${esc(st.start)}">
      <label>Hora del aviso de la mañana</label><input type="time" id="sMorning" value="${esc(st.morning||'09:00')}">
      <p class="hint">A quien pulse «Recordármelo por la mañana» en el calendario le llega un aviso a esta hora el día de la quedada (si la quedada es muy temprano, hora y media antes).</p>
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
  sheet(`<h2>Introducir botín y repartir</h2>
    <label>Hora de fin</label><input type="time" id="cEnd" value="${esc(s.end_time||nowHM())}">
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
  rows.forEach(r => D.att.push({...r, arrive:null, leave:null, late_min:0, early_min:0, present_min:0, weight:0, amount_cents:0}));
  if(rows.length) await write({table:'attendance', kind:'upsert', rows});
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
  await write({table:'attendance', kind:'upsert', rows:[{session_id:sid, member_id:mid, status:a.status, arrive:a.arrive||null, leave:a.leave||null}]});
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
  emoji(el){ insertEmoji(el.dataset.e); },
  showQr(el){ showQr(el && el.dataset.v); },
  scanQr(el){ startScan(el && el.dataset.v); },
  goCuenta(){ tab='cuenta'; render(); document.getElementById('app').scrollTop=0; },
  mailAsk(el){ const m = member(el.dataset.id); const cur = (D.contacts||{})[m.id] || '';
    sheet(`<h2>Avisos por correo</h2><p class="muted" style="margin-top:-6px">${esc(m.name)}</p>
      <p class="hint">Para quien no puede instalar la app. Le llegarán por correo las quedadas nuevas, cambios y cancelaciones, los avisos para todo el coro y lo que le toca en cada reparto. Los recordatorios automáticos (1 h antes y por la mañana) no se envían por correo.</p>
      <label>Correo electrónico</label><input id="mcE" type="email" inputmode="email" autocapitalize="none" autocomplete="off" value="${esc(cur)}" placeholder="nombre@ejemplo.com">
      <button class="btn" data-act="mailSave" data-id="${m.id}">Guardar</button>
      ${cur?`<button class="btn danger" data-act="mailDel" data-id="${m.id}">Quitar correo</button>`:''}
      ${(CFG.EMAILJS||{}).TEMPLATE_AVISO?'':'<p class="hint" style="color:var(--warn)">Falta configurar la plantilla de correo en EmailJS: los correos no se enviarán hasta entonces.</p>'}`); },
  async mailSave(el){ const mail = (val('mcE')||'').trim().toLowerCase();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return toast('Escribe un correo válido');
    try{ await q(sb.from('member_contacts').upsert({member_id: el.dataset.id, email: mail})); D.contacts[el.dataset.id] = mail; sheet(''); render(); toast('Correo guardado ✉️'); }catch(e){} },
  async mailDel(el){ try{ await q(sb.from('member_contacts').delete().eq('member_id', el.dataset.id)); delete D.contacts[el.dataset.id]; sheet(''); render(); }catch(e){} },
  annAsk(){ emoTarget='anB'; emoPos=null;
    sheet(`<h2>Enviar un aviso</h2>
      <label>Título (opcional)</label><input id="anT" maxlength="60" placeholder="Aviso del coro" autocomplete="off">
      <label>Mensaje</label><textarea id="anB" rows="5" maxlength="500" placeholder="Ej.: Hoy cambiamos el ensayo a las 19:00 en la parroquia" style="resize:vertical"></textarea>
      <div class="emo">${EMOJIS.map(([g,list])=>`<div class="emo-g">${g}</div><div class="emo-row">${[...list].filter(c=>c.trim()).map(e=>`<button type="button" data-act="emoji" data-e="${e}" aria-label="Añadir ${e}">${e}</button>`).join('')}</div>`).join('')}</div>
      <p class="hint" style="margin-top:4px">Toca un emoticono para añadirlo donde esté el cursor (en el título o en el mensaje).</p>
      <label>¿A quién?</label><select id="anA"><option value="all">A todo el coro</option><option value="admins">Solo a súper usuarios (para probar)</option></select>
      <button class="btn" data-act="annSend">Enviar aviso</button>
      <button class="btn sec" data-act="closeSheet">Cancelar</button>`);
  },
  async annSend(el){
    const body = (val('anB')||'').trim(), title = (val('anT')||'').trim(), audience = val('anA')||'all';
    if(!body) return toast('Escribe el mensaje');
    if(audience==='all' && !confirm('¿Enviar este aviso a todo el coro?')) return;
    busy(el,true);
    try{
      const an = await q(sb.from('announcements').insert({title:title||null, body, audience}).select().single());
      sheet(''); await loadAnn(); render();
      await notify({type:'announcement', announcement_id: an.id});
    }catch(e){ busy(el,false); }
  },
  async annDel(el){ if(!confirm('¿Borrar este aviso? Dejará de verse en la app (las notificaciones ya enviadas no se pueden retirar).')) return;
    try{ await q(sb.from('announcements').delete().eq('id', el.dataset.id)); await loadAnn(); render(); }catch(e){} },
  memberSheet(el){ memberSheet(el.dataset.id); },
  exportExcel(el){ exportExcel(el); },
  supSession(el){ const s = D.sessions.find(x=>x.id===el.dataset.id); if(!s) return;
    sheet(`<h2>${fmtDate(s.date)} · ${esc(s.start_time)}–${esc(s.end_time)}</h2>${s.place?`<p class="muted" style="margin-top:-6px">${esc(s.place)}</p>`:''}${resultTable(storedResult(s))}<button class="btn sec" data-act="closeSheet">Cerrar</button>`); },
  calDay(el){ calSel = el.dataset.d; render(); },
  async rsvp(el){
    const sid = el.dataset.id, v = el.dataset.v, prev = myRsvp(sid);
    const c = D.rsvpCount[sid] = D.rsvpCount[sid] || {yes:0,no:0};
    try{
      if(prev && prev.status===v){
        await q(sb.from('session_rsvp').delete().eq('session_id',sid).eq('user_id',authUser.id));
        D.rsvp = D.rsvp.filter(r=>r!==prev); c[v]--;
      } else {
        await q(sb.from('session_rsvp').upsert({session_id:sid, user_id:authUser.id, status:v, updated_at:new Date().toISOString()}));
        if(prev){ c[prev.status]--; prev.status=v; } else D.rsvp.push({session_id:sid, user_id:authUser.id, status:v});
        c[v]++; toast(v==='yes' ? '¡Apuntado! Gracias' : 'Anotado que no puedes');
      }
      render();
    }catch(e){}
  },
  calMove(el){ const [y,m] = calMonth.split('-').map(Number); const d = new Date(y, m-1+Number(el.dataset.v), 1); calMonth = d.getFullYear()+'-'+pad(d.getMonth()+1); render(); },
  calEdit(el){ sessionSheet(D.sessions.find(x=>x.id===el.dataset.id)); },
  calPlan(el){ tab='hoy'; focusId=null; render(); const i=document.getElementById('nsDate'); if(i){ i.value = el.dataset.d; document.getElementById('nsPlace')?.focus(); } },
  async toggleAlarm(el){
    const id = el.dataset.id, on = D.alarms.has(id);
    if(!on && !pushOn) return toast(pushSupport()==='ios' ? 'Primero instala la app y activa los avisos en Cuenta' : 'Primero activa los avisos en Cuenta');
    busy(el,true);
    try{
      if(on){ await q(sb.from('session_alarms').delete().eq('session_id', id).eq('user_id', authUser.id)); D.alarms.delete(id); toast('Aviso de la mañana quitado'); }
      else { await q(sb.from('session_alarms').upsert({session_id:id, user_id:authUser.id, sent:false})); D.alarms.add(id); toast(`Te avisaremos ese día a las ${S().morning||'09:00'}`); }
      render();
    }catch(e){ busy(el,false); }
  },
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
      if(sub && el.dataset.fresh){ try{ const old = sub.toJSON().endpoint; await sub.unsubscribe(); await sb.from('push_subscriptions').delete().eq('endpoint', old); }catch(e){} sub = null; }
      if(!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: b64ToBytes(CFG.VAPID_PUBLIC_KEY) });
      await savePush(sub);
      pushOn = true; pushErr = ''; render(); toast('🔔 Avisos activados en este móvil');
      if(el.dataset.fresh) setTimeout(()=>notify({type:'test'}), 800);
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
  async logout(){ try{ const sub = await currentSub(); if(sub) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); }catch(e){} try{ await sb.auth.signOut(); }catch(e){} if(channel){ try{ sb.removeChannel(channel); }catch(e){} channel=null; } me=null; authUser=null; authMode='login'; tab='hoy'; focusId=null; renderAuth(); },
  async myPass(){ const p = val('myPass')||''; if(p.length<6) return toast('Mínimo 6 caracteres'); try{ await q(sb.auth.updateUser({password:p})); toast('Contraseña cambiada'); document.getElementById('myPass').value=''; }catch(e){} },

  async startSession(el){
    if(activeSession()) return;
    const s = {id:newId(), date:val('nsDate')||today(), start_time:val('nsStart')||S().start, place:(val('nsPlace')||'').trim()||null, started:true,
      closed:false, end_time:null, botin_cents:0, gastos_cents:0, repartido_cents:0, sobrante_cents:0, reminded:false, created_at:new Date().toISOString()};
    D.sessions.push(s); focusId = null; render();
    await write({table:'sessions', kind:'insert', rows:[{id:s.id, date:s.date, start_time:s.start_time, place:s.place, started:true}]});
    await fillAttendance(s.id); render();
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
    if(activeSession()) return toast('Ya hay una quedada en curso');
    const s = D.sessions.find(x=>x.id===el.dataset.id); if(!s) return;
    s.started = true; focusId = null; render();
    await write({table:'sessions', kind:'update', patch:{started:true}, match:{id:s.id}});
    await fillAttendance(s.id); render();
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
    await write({table:'attendance', kind:'delete', match:{session_id:s.id, member_id:el.dataset.id}}); },
  async allOnTime(){
    const s=openSession(); const pend = attOf(s.id).filter(a=>a.status==='pending');
    if(!confirm(`¿Seguro que han llegado TODOS a su hora (${s.start_time})?\n\n${pend.map(a=>member(a.member_id)?.name).join(', ')}\n\nSi falta alguien, márcalo uno a uno.`)) return;
    pend.forEach(a=>{ a.status='present'; a.arrive=s.start_time; a.leave=null; }); render();
    await write({table:'attendance', kind:'upsert', rows: pend.map(a=>({session_id:s.id, member_id:a.member_id, status:'present', arrive:s.start_time, leave:null}))});
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
  focusSession(el){ focusId = el.dataset.id; tab='hoy'; sheet(''); render(); document.getElementById('app').scrollTop=0; },
  repartir(el){ focusId = el.dataset.id; tab='hoy'; sheet(''); render(); closeSheet(); },
  unfocus(){ focusId = null; render(); },
  endAsk(){
    const s=openSession(); const pend = attOf(s.id).filter(a=>a.status==='pending').length;
    sheet(`<h2>Terminar quedada</h2>
      <label>Hora de fin</label><input type="time" id="eEnd" value="${nowHM()}">
      ${pend?`<p class="hint" style="color:var(--warn)">Hay ${pend} persona${pend>1?'s':''} sin marcar: contarán como que no han venido. Puedes corregirlo antes de repartir.</p>`:''}
      <p class="hint">Se guarda la hora de fin. Cuando tengáis el botín contado, pulsa «Introducir botín y repartir».</p>
      <button class="btn" data-act="endSession">Terminar quedada</button>
      <button class="btn sec" data-act="closeSheet">Seguir pasando lista</button>`);
  },
  async endSession(el){
    const s=openSession(); const end = val('eEnd') || nowHM();
    s.end_time = end; focusId = null; sheet(''); render(); toast('Quedada terminada a las '+end+'. Queda pendiente de reparto.');
    await write({table:'sessions', kind:'update', patch:{end_time:end}, match:{id:s.id}});
  },
  async resumeSession(){
    const s=openSession(); const act=activeSession(); if(act && act.id!==s.id) return toast('Ya hay otra quedada en curso');
    if(!confirm('¿Reanudar la quedada? Se borrará la hora de fin.')) return;
    try{ await q(sb.from('sessions').update({end_time:null}).eq('id', s.id)); s.end_time = null; focusId = null; render(); }catch(e){}
  },
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
      focusId = null; tab='historial'; render(); viewSession(s.id); toast('Quedada guardada y copia hecha ✅');
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
    if(!confirm('¿Reabrir esta quedada para corregirla? Se quitará su reparto hasta que la vuelvas a cerrar.')) return;
    const id = el.dataset.id; sheet('');
    try{
      await q(sb.from('bote').delete().eq('session_id', id));
      await q(sb.from('sessions').update({closed:false, repartido_cents:0, sobrante_cents:0}).eq('id', id));
      await q(sb.from('attendance').update({amount_cents:0, weight:0}).eq('session_id', id));
      focusId = id; await loadAll(); tab='hoy'; render();
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
      const s=activeSession(); if(s) await setAtt(s.id, m.id, {status:'pending'});
      render(); const ni=document.getElementById('newName'); if(ni) ni.focus(); }catch(e){} },
  bulkAsk(){ sheet(`<h2>Pegar lista</h2><textarea id="bulk" rows="10" style="width:100%;font-size:16px;padding:10px;border-radius:10px;border:1px solid var(--line)" placeholder="María López&#10;José García&#10;Lucía Pérez"></textarea><button class="btn" data-act="bulkAdd">Añadir todos</button>`); },
  async bulkAdd(){ const names=[...new Set(val('bulk').split(/\n|,/).map(x=>x.trim()).filter(Boolean))].filter(n=>!D.members.some(m=>m.name.toLowerCase()===n.toLowerCase())); sheet('');
    if(!names.length) return toast('No hay nombres nuevos');
    try{ const ms = await q(sb.from('members').insert(names.map(name=>({name}))).select()); const s=activeSession();
      if(s) await q(sb.from('attendance').insert(ms.map(m=>({session_id:s.id, member_id:m.id, status:'pending'}))));
      await loadAll(); render(); toast(ms.length+' añadidos'); }catch(e){} },
  async rename(el){ const m=member(el.dataset.id); const n=prompt('Nuevo nombre', m.name); if(!n||!n.trim()) return; m.name=n.trim(); render();
    try{ await q(sb.from('members').update({name:m.name}).eq('id',m.id)); }catch(e){ scheduleReload(); } },
  async toggleMember(el){ const m=member(el.dataset.id); m.active = m.active===false; render();
    try{ await q(sb.from('members').update({active:m.active}).eq('id',m.id)); }catch(e){ scheduleReload(); } },

  userSheet(el){ userSheet(el.dataset.id); },
  async userSave(el){
    const p = D.profiles.find(x=>x.id===el.dataset.id); const st = el.dataset.st;
    let mid = val('uMember') || null; const adm = document.getElementById('uAdmin')?.checked || false; const sup = !adm && (document.getElementById('uSup')?.checked || false);
    if(st==='rejected' && !confirm(`¿Quitar el acceso a ${p.full_name}?`)) return;
    sheet('');
    try{
      if(mid === '__new'){ const m = await q(sb.from('members').insert({name:p.full_name}).select().single()); mid = m.id;
        const s=activeSession(); if(s) await q(sb.from('attendance').insert({session_id:s.id, member_id:m.id, status:'pending'})); }
      const upd = st==='approved' ? {status:st, member_id: sup ? null : mid, is_admin: p.id===me.id ? true : adm, is_supervisor: p.id===me.id ? false : sup} : {status:st, is_admin:false, is_supervisor:false};
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
  const sMo=document.getElementById('sMorning'); if(sMo && sMo.value) st.morning=sMo.value;
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
let pushErr = '';
async function savePush(sub){
  const j = sub.toJSON();
  const r = await sb.rpc('claim_push', { p_endpoint:j.endpoint, p_p256dh:j.keys.p256dh, p_auth:j.keys.auth });
  if(r.error){   // por si aún no se ha ejecutado el SQL nuevo
    const r2 = await sb.from('push_subscriptions').upsert({ endpoint:j.endpoint, user_id:authUser.id, p256dh:j.keys.p256dh, auth:j.keys.auth });
    if(r2.error) throw r2.error;
  }
}
async function checkPush(){
  pushOn = false; pushErr = '';
  try{
    if(pushSupport()!=='ok' || Notification.permission!=='granted') return;
    const sub = await currentSub(); if(!sub) return;
    pushOn = true;
    try{ await savePush(sub); }catch(e){ pushErr = 'Este móvil no está bien registrado en el servidor. Pulsa «Reactivar avisos».'; }
  }catch(e){}
}
function pushCard(){
  const st = pushSupport();
  let inner;
  if(pushOn) inner = `${pushErr?`<p style="margin-top:0;color:var(--warn)">⚠️ ${pushErr}</p>`:`<p class="muted" style="margin-top:0">✅ Activados en este móvil. Te avisaremos de las quedadas, del recordatorio 1 h antes y de lo que ganas.</p>`}
    <div class="row" style="gap:8px"><button class="btn sm sec" data-act="testPush">Probar en este móvil</button><button class="btn sm sec" data-act="enablePush" data-fresh="1">Reactivar avisos</button></div>
    <p class="hint">¿No te llega la prueba? Pulsa «Reactivar avisos». Si sigue sin llegar, revisa en el móvil Ajustes → Notificaciones → Coro, y que no tengas activado «No molestar» o un modo Concentración.</p>`;
  else if(st==='ios') inner = `<p class="muted" style="margin-top:0">Para recibir avisos en iPhone, primero instala la app: botón <b>Compartir</b> → <b>Añadir a pantalla de inicio</b>. Luego ábrela desde el icono y pulsa aquí.</p>`;
  else if(st==='no') inner = `<p class="muted" style="margin-top:0">Este navegador no admite avisos. Prueba con Chrome (Android) o instalando la app (iPhone).</p>`;
  else inner = `<p class="muted" style="margin-top:0">Recibe avisos de nuevas quedadas, cambios de hora o sitio, el recordatorio 1 h antes y lo que te toca en cada reparto.</p><button class="btn" data-act="enablePush">Activar avisos en este móvil</button>`;
  return `<div class="card"><h2>Notificaciones en este móvil</h2>${inner}</div>`;
}
function upcomingCard(){
  const up = D.sessions.filter(s=>!s.closed && !isEnded(s) && !(s.started!==false && me.member_id && attGet(s.id, me.member_id))).sort((x,y)=>(x.date+x.start_time).localeCompare(y.date+y.start_time));
  const ended = D.sessions.filter(isEnded);
  const pendCard = ended.length ? `<div class="card"><b>${ended.length===1?'1 quedada pendiente de reparto':ended.length+' quedadas pendientes de reparto'}</b>
    <div class="muted" style="margin-top:4px">${ended.map(s=>`${fmtDate(s.date)} ${esc(s.start_time)}`).join(' · ')}</div>
    <div class="hint">Cuando se cuente cada bolsa te llegará un aviso con lo tuyo.</div></div>` : '';
  if(!up.length) return pendCard;
  return pendCard + heroCard(up[0]) + (up.length>1 ? `<div class="card"><h2>Más adelante</h2>${up.slice(1).map(s=>`<div class="list-item"><span><b>${fmtDate(s.date)} · ${esc(s.start_time)}</b><br><span class="det">${placeHtml(s)}</span></span></div>`).join('')}</div>` : '');
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
    if(e.target.closest('#userBtn')){ tab='cuenta'; focusId=null; sheet(''); render(); document.getElementById('app').scrollTop=0; return; }
    if(e.target.closest('#supBtn')){ tab='sup'; focusId=null; sheet(''); render(); document.getElementById('app').scrollTop=0; return; }
    if(e.target.closest('#gear')){ tab='ajustes'; focusId=null; sheet(''); render(); document.getElementById('app').scrollTop=0; return; }
    const n = e.target.closest('nav button'); if(n){ tab=n.dataset.tab; focusId=null; sheet(''); render(); document.getElementById('app').scrollTop=0; return; }
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
  window.addEventListener('online', () => { flush().then(()=>{ if(!outbox.length) scheduleReload(); }); });
  window.addEventListener('offline', () => { offline = true; updateNetBanner(); });
  setInterval(() => { if(outbox.length) flush(); }, 20000);
  if('serviceWorker' in navigator){ navigator.serviceWorker.addEventListener('message', ev => { if(ev.data && ev.data.deepLink!==undefined){ pendingLink = ev.data.deepLink || '#cal'; if(!loading) applyDeepLink(); } }); }
  window.addEventListener('hashchange', () => { if(location.hash){ pendingLink = location.hash; if(!loading) applyDeepLink(); } });
  if('serviceWorker' in navigator && location.protocol==='https:'){ navigator.serviceWorker.register('sw.js', {updateViaCache:'none'}).then(r=>r.update()).catch(()=>{}); }
  if(!CFG.SUPABASE_URL || !CFG.SUPABASE_KEY || !window.supabase){ renderSetup(); return; }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, { auth:{ persistSession:true, autoRefreshToken:true } });
  boot();
}
if(typeof document!=='undefined' && document.getElementById('app')) init();
