// =====================================================================
//  CORO SAN PABLO · Función "notify" (Supabase Edge Function)
//  Envía las notificaciones al móvil de cada usuario.
//  Secretos necesarios (Edge Functions → Secrets):
//    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, CRON_SECRET
//  Opcionales: VAPID_SUBJECT, APP_URL, SERVICE_KEY
//  Para mandar también los recordatorios por correo (EmailJS):
//    EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const APP_URL = Deno.env.get('APP_URL') ?? 'https://samulinkinpark11-prog.github.io/coro-san-pablo/';
const db = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } }
);
webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:samuelsan11@hotmail.com',
  Deno.env.get('VAPID_PUBLIC_KEY'),
  Deno.env.get('VAPID_PRIVATE_KEY')
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* ---------- formato ---------- */
const fmtDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const eur = (c) => ((c || 0) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const where = (s) => s && s.place ? ` · 📍 ${s.place}` : '';
const when = (s) => `${fmtDate(s.date)} a las ${s.start_time}`;

// Hora actual en Madrid como "YYYY-MM-DDTHH:MM"
function madridNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const minutesUntil = (from, to) => (Date.parse(to + ':00Z') - Date.parse(from + ':00Z')) / 60000;

/* ---------- destinatarios y envío ---------- */
async function approvedIds(adminsOnly = false) {
  let q = db.from('profiles').select('id').eq('status', 'approved');
  if (adminsOnly) q = q.eq('is_admin', true);
  const { data } = await q;
  return (data || []).map((p) => p.id);
}

async function push(userIds, msg) {
  if (!userIds.length) return 0;
  const { data: subs } = await db.from('push_subscriptions').select('*').in('user_id', userIds);
  let sent = 0;
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ url: APP_URL, ...msg }),
        { TTL: 60 * 60 * 24 }
      );
      sent++;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      else console.error('push error', e && e.statusCode, e && e.body);
    }
  }));
  return sent;
}

// Correo (EmailJS) a los que tienen email apuntado en «Coro» (los que no pueden instalar la app)
const mailReady = () => ['EMAILJS_SERVICE_ID', 'EMAILJS_TEMPLATE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY'].every((k) => Deno.env.get(k));
// Personas con email apuntado: [{member_id, email, name}]
async function contacts() {
  if (!mailReady()) return [];
  const { data: cs } = await db.from('member_contacts').select('member_id, email');
  if (!cs || !cs.length) return [];
  const { data: ms } = await db.from('members').select('id, name, active').in('id', cs.map((c) => c.member_id));
  const byId = Object.fromEntries((ms || []).map((m) => [m.id, m]));
  return cs.filter((c) => c.email && byId[c.member_id] && byId[c.member_id].active !== false).map((c) => ({ ...c, name: byId[c.member_id].name }));
}
async function mailContacts(subject, message) {
  return mailEach((await contacts()).map((c) => ({ ...c, subject, message })));
}
async function mailEach(list) {
  if (!list.length || !mailReady()) return 0;
  const E = { service: Deno.env.get('EMAILJS_SERVICE_ID'), template: Deno.env.get('EMAILJS_TEMPLATE_ID'),
    pub: Deno.env.get('EMAILJS_PUBLIC_KEY'), priv: Deno.env.get('EMAILJS_PRIVATE_KEY') };
  let ok = 0;
  for (const c of list) {
    const m = { name: c.name }, subject = c.subject, message = c.message;
    try {
      const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: E.service, template_id: E.template, user_id: E.pub, accessToken: E.priv,
          template_params: { to_email: c.email, to_name: m.name, subject, message, app_url: APP_URL } }) });
      if (r.ok) ok++; else console.error('emailjs', r.status, await r.text());
    } catch (e) { console.error('emailjs', e); }
  }
  return ok;
}
// Para no mandar dos veces el mismo correo
async function once(key) {
  const { data, error } = await db.from('cron_state').select('key').eq('key', key).maybeSingle();
  if (error || data) return false;
  const { error: e2 } = await db.from('cron_state').insert({ key, value: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() });
  return !e2;   // si otra ejecución lo apuntó a la vez, la clave duplicada falla y no se repite
}

/* ---------- tipos de aviso ---------- */
async function payout(session) {
  const { data: att } = await db.from('attendance').select('*').eq('session_id', session.id);
  const { data: profs } = await db.from('profiles').select('id, member_id').eq('status', 'approved').not('member_id', 'is', null);
  const byMember = {};
  (profs || []).forEach((p) => { (byMember[p.member_id] = byMember[p.member_id] || []).push(p.id); });
  let sent = 0;
  for (const a of att || []) {
    const users = byMember[a.member_id] || [];
    const prev = a.notified_cents, now = a.amount_cents || 0;
    let msg = null;
    if (prev === null || prev === undefined) {
      if (now > 0) msg = { title: '💰 Ya tienes tu parte', body: `Quedada del ${fmtDate(session.date)}: tienes disponibles ${eur(now)}.`, tag: 'pago-' + session.id };
    } else if (prev !== now) {
      msg = { title: '🔁 Reajuste del reparto', body: `Quedada del ${fmtDate(session.date)}: tu cantidad cambia de ${eur(prev)} a ${eur(now)}.`, tag: 'pago-' + session.id };
    }
    if (msg && users.length) sent += await push(users, msg);
    if (prev !== now) await db.from('attendance').update({ notified_cents: now }).eq('session_id', a.session_id).eq('member_id', a.member_id);
  }
  return sent;
}

const toMin = (x) => { const [h, m] = String(x).split(':').map(Number); return h * 60 + m; };
const hhmm = (t) => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');

// Aviso de la mañana para quien lo pidió en el calendario
async function morningAlarms(now) {
  const day = now.slice(0, 10), nowMin = toMin(now.slice(11));
  const { data: st } = await db.from('settings').select('data').eq('id', 1).maybeSingle();
  const morning = (st && st.data && st.data.morning) || '09:00';
  const { data: ss } = await db.from('sessions').select('*').eq('date', day).eq('closed', false);
  let sent = 0;
  for (const s of ss || []) {
    let at = toMin(morning);
    if (toMin(s.start_time) - at < 60) at = Math.max(0, toMin(s.start_time) - 90);   // quedada muy temprano
    if (nowMin < at || nowMin >= toMin(s.start_time)) continue;
    if (await once('mail-manana-' + s.id)) sent += await mailContacts('🔔 Hoy hay quedada del coro', `Hoy a las ${s.start_time}${s.place ? ' en ' + s.place : ''}. ¡Te esperamos!`);
    const { data: al } = await db.from('session_alarms').select('user_id').eq('session_id', s.id).eq('sent', false);
    const users = (al || []).map((x) => x.user_id);
    if (!users.length) continue;
    sent += await push(users, {
      title: '🔔 Hoy hay quedada del coro',
      body: `A las ${s.start_time}${s.place ? ' en ' + s.place : ''}.`,
      tag: 'alarma-' + s.id
    });
    await db.from('session_alarms').update({ sent: true }).eq('session_id', s.id).in('user_id', users);
  }
  return sent;
}

// Recordatorio a quien no ha dicho si va (Voy / No puedo) a las próximas quedadas.
// Por defecto cada 2 días a las 17:00 (se cambia en Ajustes). force = enviarlo ya desde la app.
async function rsvpNudge(now, force = false) {
  const day = now.slice(0, 10), nowMin = toMin(now.slice(11));
  const { data: st } = await db.from('settings').select('data').eq('id', 1).maybeSingle();
  const cfg = Object.assign({ every: 2, at: '17:00' }, (st && st.data && st.data.nudge) || {});
  if (!force) {
    if (!Number(cfg.every)) return 0;                                   // desactivado
    const at = toMin(cfg.at || '17:00');
    if (nowMin < at || nowMin >= at + 30) return 0;                    // solo en la media hora de las 17:00
    const { data: last } = await db.from('cron_state').select('value').eq('key', 'rsvp_nudge').maybeSingle();
    if (last && last.value) {
      const days = Math.round((Date.parse(day + 'T12:00:00Z') - Date.parse(last.value + 'T12:00:00Z')) / 86400000);
      if (days < Number(cfg.every)) return 0;
    }
  }
  const limit = new Date(Date.parse(day + 'T12:00:00Z') + 14 * 86400000).toISOString().slice(0, 10);
  const { data: ss0 } = await db.from('sessions').select('*').eq('closed', false).gte('date', day).lte('date', limit).order('date').order('start_time');
  const ss = (ss0 || []).filter((s) => !s.started && !s.end_time && (s.date > day || toMin(s.start_time) > nowMin));
  if (!ss.length) return 0;                                            // sin quedadas próximas: no se gasta el turno
  const { data: profs } = await db.from('profiles').select('id, is_supervisor, member_id').eq('status', 'approved').not('member_id', 'is', null);
  const users = (profs || []).filter((p) => !p.is_supervisor).map((p) => p.id);
  const { data: rs } = await db.from('session_rsvp').select('session_id, user_id').in('session_id', ss.map((s) => s.id));
  const answered = new Set((rs || []).map((r) => r.session_id + '|' + r.user_id));
  let sent = 0;
  for (const u of users) {
    const pend = ss.filter((s) => !answered.has(s.id + '|' + u));
    if (!pend.length) continue;
    const msg = pend.length === 1
      ? { title: '🙋 ¿Vienes a la quedada?', body: `Aún no has dicho si vas el ${when(pend[0])}${where(pend[0])}. Entra y pulsa «Voy» o «No puedo».`, tag: 'quedada-' + pend[0].id }
      : { title: `🙋 Tienes ${pend.length} quedadas sin contestar`, body: pend.slice(0, 4).map((s) => `• ${fmtDate(s.date)} a las ${s.start_time}`).join('\n') + '\nEntra y pulsa «Voy» o «No puedo» en cada una.', tag: 'quedada-' + pend[0].id };
    sent += await push([u], msg);
  }
  // También por correo a quien tiene email apuntado (y no ha contestado con ninguno de sus usuarios)
  const cs = await contacts();
  const mails = [];
  for (const c of cs) {
    const us = (profs || []).filter((p) => !p.is_supervisor && p.member_id === c.member_id).map((p) => p.id);
    if (!us.length) continue;
    const pend = ss.filter((s) => !us.some((u) => answered.has(s.id + '|' + u)));
    if (!pend.length) continue;
    mails.push({ ...c,
      subject: pend.length === 1 ? '🙋 ¿Vienes a la quedada del coro?' : `🙋 Tienes ${pend.length} quedadas del coro sin contestar`,
      message: (pend.length === 1 ? `Aún no has dicho si vas el ${when(pend[0])}${where(pend[0])}.` : 'Aún no has dicho si vas a estas quedadas:\n' + pend.slice(0, 6).map((s) => `• ${fmtDate(s.date)} a las ${s.start_time}${s.place ? ' (' + s.place + ')' : ''}`).join('\n'))
        + `\n\nEntra en la app (${APP_URL}#cal=${pend[0].id}) y pulsa «Voy» o «No puedo» en el Calendario.` });
  }
  sent += await mailEach(mails);
  if (!force) await db.from('cron_state').upsert({ key: 'rsvp_nudge', value: day, updated_at: new Date().toISOString() });
  return sent;
}

async function reminders() {
  const now = madridNow();
  const { data: ss } = await db.from('sessions').select('*').eq('closed', false).eq('reminded', false);
  let sent = 0;
  for (const s of ss || []) {
    const mins = minutesUntil(now, `${s.date}T${s.start_time}`);
    if (mins > 0 && mins <= 65) {
      sent += await push(await approvedIds(), {
        title: '⏰ En 1 hora: quedada del coro',
        body: `Hoy a las ${s.start_time}${s.place ? ' en ' + s.place : ''}. ¡No llegues tarde!`,
        tag: 'recordatorio-' + s.id
      });
      await db.from('sessions').update({ reminded: true }).eq('id', s.id);
      sent += await mailContacts('⏰ En 1 hora: quedada del coro', `Hoy a las ${s.start_time}${s.place ? ' en ' + s.place : ''}. ¡No llegues tarde!`);
    }
  }
  sent += await morningAlarms(now);
  sent += await rsvpNudge(now);
  return sent;
}

/* ---------- entrada ---------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const type = body.type;

    // Llamada programada (recordatorios)
    const cronSecret = Deno.env.get('CRON_SECRET');
    if (type === 'reminders') {
      if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) return json({ error: 'no autorizado' }, 401);
      return json({ ok: true, sent: await reminders() });
    }

    // Llamadas desde la app: comprobar quién llama
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await db.auth.getUser(token);
    if (!u || !u.user) return json({ error: 'no autorizado' }, 401);
    const { data: me } = await db.from('profiles').select('*').eq('id', u.user.id).single();
    if (!me) return json({ error: 'sin perfil' }, 403);

    if (type === 'new_user') {
      if (me.status !== 'pending') return json({ ok: true, sent: 0 });
      return json({ ok: true, sent: await push(await approvedIds(true), {
        title: '🔔 Nueva solicitud en el coro', body: `${me.full_name} (@${me.username}) espera que le aceptes.`, tag: 'solicitud-' + me.id
      }) });
    }

    if (type === 'test') {
      if (me.status !== 'approved') return json({ error: 'no autorizado' }, 403);
      return json({ ok: true, sent: await push([me.id], { title: '✅ Avisos funcionando', body: 'Así te llegarán las notificaciones del coro.', tag: 'prueba' }) });
    }

    if (!(me.is_admin && me.status === 'approved')) return json({ error: 'solo súper usuarios' }, 403);


    if (type === 'announcement') {
      const { data: an } = await db.from('announcements').select('*').eq('id', body.announcement_id).single();
      if (!an) return json({ error: 'aviso no encontrado' }, 404);
      return json({ ok: true, sent: await push(await approvedIds(an.audience === 'admins'), {
        title: '📣 ' + (an.title || 'Aviso del coro'), body: an.body, tag: 'aviso-' + an.id
      }) });
    }

    if (type === 'rsvp_nudge') {
      if (!me.is_admin || me.status !== 'approved') return json({ error: 'solo súper usuarios' }, 403);
      return json({ ok: true, sent: await rsvpNudge(madridNow(), true) });
    }

    if (type === 'session_cancelled') {
      const s = body.session || {};
      return json({ ok: true, sent: await push(await approvedIds(), {
        title: '❌ Quedada cancelada', body: `Se cancela la quedada del ${when(s)}${where(s)}.`, tag: 'quedada-' + s.id
      }) });
    }

    const { data: s } = await db.from('sessions').select('*').eq('id', body.session_id).single();
    if (!s) return json({ error: 'quedada no encontrada' }, 404);

    if (type === 'session_new') {
      return json({ ok: true, sent: await push(await approvedIds(), {
        title: '📅 Nueva quedada del coro', body: `${when(s)}${where(s)}`, tag: 'quedada-' + s.id
      }) });
    }
    if (type === 'session_changed') {
      const b = body.before;
      return json({ ok: true, sent: await push(await approvedIds(), {
        title: '✏️ Cambio en la quedada', body: `Ahora: ${when(s)}${where(s)}` + (b ? `\nAntes: ${when(b)}${where(b)}` : ''), tag: 'quedada-' + s.id
      }) });
    }
    if (type === 'payout') {
      return json({ ok: true, sent: await payout(s) });
    }
    return json({ error: 'tipo desconocido' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e && e.message || e) }, 500);
  }
});
