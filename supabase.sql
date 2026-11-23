-- =====================================================================
--  CORO SAN PABLO · Estructura de la base de datos (Supabase)
--  Cómo usarlo: Supabase → SQL Editor → New query → pega TODO → Run
--  Se puede ejecutar más de una vez sin romper nada.
-- =====================================================================

-- ---------- TABLAS ----------
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  username text not null unique,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  is_admin boolean not null default false,
  member_id uuid references public.members(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  start_time text not null,
  end_time text,
  closed boolean not null default false,
  botin_cents int not null default 0,
  gastos_cents int not null default 0,
  repartido_cents int not null default 0,
  sobrante_cents int not null default 0,
  duration_min int,
  mode text,
  tolerance int,
  step_cents int,
  created_at timestamptz default now()
);

create table if not exists public.attendance (
  session_id uuid not null references public.sessions(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','present','absent')),
  arrive text,
  "leave" text,
  late_min int not null default 0,
  early_min int not null default 0,
  present_min int not null default 0,
  weight numeric not null default 0,
  amount_cents int not null default 0,
  primary key (session_id, member_id)
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb
);
insert into public.settings (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;

-- Bote común: sobrantes del redondeo (+), aportaciones (+) y gastos pagados del bote (-)
create table if not exists public.bote (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  amount_cents int not null,
  note text,
  session_id uuid references public.sessions(id) on delete cascade
);

-- Copias automáticas (se guarda una cada vez que se cierra una quedada)
create table if not exists public.backups (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  data jsonb not null
);

-- ---------- v3: sitio, quedadas programadas y notificaciones ----------
alter table public.sessions add column if not exists place text;
alter table public.sessions add column if not exists started boolean;          -- false = programada, true = pasando lista
update public.sessions set started = true where started is null;              -- las que ya existían se empezaron
alter table public.sessions alter column started set default false;
alter table public.sessions alter column started set not null;
alter table public.sessions add column if not exists reminded boolean not null default false;  -- recordatorio de 1 h enviado
alter table public.sessions add column if not exists cash jsonb;            -- recuento de billetes y monedas (céntimos → cantidad)
alter table public.attendance add column if not exists notified_cents int;   -- última cantidad avisada (para reajustes)

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

-- ---------- v4: aviso de la mañana elegido por cada uno ----------
create table if not exists public.session_alarms (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  sent boolean not null default false,
  created_at timestamptz default now(),
  primary key (user_id, session_id)
);

-- ---------- v4.4: «Voy / No puedo» en cada quedada ----------
create table if not exists public.session_rsvp (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('yes','no')),
  updated_at timestamptz default now(),
  primary key (session_id, user_id)
);

-- ---------- v4.5: responsables de la parroquia (solo supervisión, sin modificar nada) ----------
alter table public.profiles add column if not exists is_supervisor boolean not null default false;

-- ---------- v4.9: avisos libres de los súper usuarios ----------
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  author uuid default auth.uid() references auth.users(id) on delete set null,
  title text,
  body text not null,
  audience text not null default 'all' check (audience in ('all','admins'))
);

-- ---------- v4.13: correo para avisos de quien no puede instalar la app (solo súper usuarios) ----------
create table if not exists public.member_contacts (
  member_id uuid primary key references public.members(id) on delete cascade,
  email text not null
);

-- ---------- v4.15: llegada con código QR (el código cambia cada pocos segundos) ----------
create table if not exists public.session_checkin (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  code text not null,
  prev text,
  updated_at timestamptz default now()
);

-- v4.17: un código para la llegada ('in') y otro para la salida ('out')
alter table public.session_checkin add column if not exists kind text not null default 'in';
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'session_checkin_pkey' and array_length(conkey, 1) = 1) then
    alter table public.session_checkin drop constraint session_checkin_pkey;
    alter table public.session_checkin add primary key (session_id, kind);
  end if;
end $$;


-- v4.19: REPERTORIO (canciones con acordes + PDF en una carpeta privada)
create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  title text not null,
  tono text,
  notes text,
  body text,
  file_path text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
do $seed$ begin
  if not exists (select 1 from public.songs) then
    insert into public.songs (position, title, tono, notes, body) values
      (10, $s$Popurrí 1$s$, $s$LA$s$, $s$Cejilla en el 4º traste · Tutti · para instrumentos$s$, $s$#! Campana sobre campana (1)
[LA]Campana sobre [MI7]campana,
y sobre campana [LA]una,
asómate a la ven[MI7]tana,
verás al Niño en la [LAm]cuna.

# Estribillo
[LAm]Pero mira cómo beben los [MI7]peces en el río
Pero mira cómo beben por ver al Dios [LAm]nacido.
Beben y beben y vuelven a be[MI7]ber
los peces en el río por ver a Dios na[LA]cer.

#! Campanas de Belén
[LA]Belén, cam[RE]panas de Be[LA]lén,
que los [RE]ángeles [LA]tocan,
¿qué [MI7]nueva me tra[LAm]éis?

[LAm]La Virgen se está pei[MI7]nando
entre cortina y cor[LAm]tina;
los cabellos son de [MI7]oro
y el peine de plata [LA]fina.

#! Pastorcillo
[LA]Recogido tu rebaño,
¿a [SI7]dónde vas, [MI7]pastor[LA]cillo?
Voy a llevar al portal
re[SI7]quesón, man[MI7]teca y [LAm]vino.

# Estribillo
[LAm]Pero mira cómo beben los [MI7]peces en el río
Pero mira cómo beben por ver al Dios [LAm]nacido.
Beben y beben y vuelven a be[MI7]ber
los peces en el río por ver a Dios na[LA]cer.

#! Campana sobre campana (2)
[LA]Campana sobre [MI7]campana,
y sobre campana [LA]dos,
asómate a esa ven[MI7]tana,
porque ha nacido [LAm]Dios.

[LAm]La Virgen está la[MI7]vando
y tendiendo en el ro[LAm]mero;
los pajaritos can[MI7]tando
y el romero flore[LAm]ciendo.

# Estribillo · todos
[LAm]Pero mira cómo beben los [MI7]peces en el río
Pero mira cómo beben por ver al Dios [LAm]nacido.
Beben y beben y vuelven a be[MI7]ber
los peces en el río por ver a Dios na[LA]cer.

#! La Marimorena (bis)
[LA]Ande, ande, ande la [FA#m]Mari[SIm]morena,
[RE]¡Ande, [MI7]ande, ande que es la Noche[LA]buena!

#!
[LA]A esta puerta hemos lle[RE]gado
cua[MI7]trocientos en cua[LA]drilla;
si quieres que nos sen[MI7]temos,
saca cuatrocientas [LA]sillas.

# Arre borriquito
[LA]Arre borriquito, arre burro [MI7]arre,
[RE]anda más de[MI7]prisa que llegamos [LA]tarde.
Arre borriquito, vamos a Be[MI7]lén,
[RE]que mañana es [MI7]fiesta
y al otro tam[LA]bién.

#! La Marimorena (bis)
[LA]Ande, ande, ande la [FA#m]Mari[SIm]morena,
[RE]¡Ande, [MI7]ande, ande que es la Noche[LA]buena!

#!
[LA]En el portal de Belén [RE]han entrado los [MI7]ra[LA]tones,
y al pobre de San José [MI7]le han roído los cal[LA]zones.

[LA]Arre borriquito, arre burro [MI7]arre,
[RE]anda más de[MI7]prisa que llegamos [LA]tarde.
Arre borriquito, vamos a Be[MI7]lén,
[RE]que mañana es [MI7]fiesta
y al otro tam[LA]bién.

[LA]En la puerta de mi casa
voy a [MI7]poner un pe[LA]tardo,
«pa» reírme del que venga
a [MI7]pedir el agui[LA]naldo.

Pues [RE]sí voy a dar a [LA]todo
el que [MI7]pide en Noche[LA]buena,
yo [RE]sí que voy a [LA]tener
que [MI7]pedir de puerta en [LA]puerta.

#! La Marimorena · sin bis
[LA]Ande, ande, ande la [FA#m]Mari[SIm]morena,
[RE]¡Ande, [MI7]ande, ande que es la Noche[FA]bue[SOL]na[LA]!
> Cadencia final: FA · SOL · LA — rasgueo ↑↑↑ (rojo) / ↑↓↑ (negro)

# Campanilleros
[LAm]En los campos de mi Anda[MI7]lucía
los campa[FA]nilleros en la madru[LAm]gá
me des[LAm]pier[LA7]tan con sus campa[REm]nillas
y con sus gui[MI7]tarras me hacen llo[LAm]rar…
…me [SOL]hacen llo[DO]rar.
Me des[LAm]pier[LA7]tan con sus campa[REm]nillas
y con sus gui[MI7]tarras me hacen llo[LA]rar.
[LA]Tin, tintín, tintín, tintín, tin.

#! Chiquirritín
¡Ay del chiquirritín, chiquirriquitín, metidito entre [MI7]paja!
¡Ay del chiqui[RE]rritín, chiquirri[MI7]quitín,
queridín, queridito del [LA]alma!

Entre el buey y la mula Dios ha na[MI7]cido
y en un pobre pesebre lo han reco[LA]gido.

#! Chiquirritín
¡Ay del chiquirritín, chiquirriquitín, metidito entre [MI7]paja!
¡Ay del chiqui[RE]rritín, chiquirri[MI7]quitín,
queridín, queridito del [LA]alma!

# Dime, Niño
[LA]Dime, Niño, ¿de quién eres,
todo ves[MI7]tidito de [LA]blanco? (bis)
[LA7]Soy de la [RE]Virgen [MI7]Ma[LA]ría
y del Es[MI7]píritu [LA]Santo. (bis)

#!
[LA]Resuenen con alegría
[RE]los cánticos de mi [LA]tierra,
y [FA#m]viva el Niño de [SIm]Dios
que na[MI7]ció en la Noche[LA]buena.

#!
[LA]Por debajo del arco del por[MI7]talito
[RE]se descubre a María [MI7]José y al [LA]Niño.

#! Chiquirritín
¡Ay del chiquirritín, chiquirriquitín, metidito entre [MI7]paja!
¡Ay del chiqui[RE]rritín, chiquirri[MI7]quitín,
queridín, queridito del [FA]al[SOL]ma[LA]!
> Cadencia final: FA · SOL · LA — rasgueo ↑↑↑ (rojo) / ↑↓↑ (negro)

# El rico avariento
[LAm]En la puerta de un rico ava[MI7]riento
lle[FA]gó Jesucristo y limosna pi[LAm]dió.
Pero en [LAm]vez [LA7]de darle la li[REm]mosna,
los perros que [MI7]había se los achu[LAm]chó.
[SOL]Pero quiso [DO]Dios
que los [LAm]pe[LA7]rros de rabia mu[REm]rieran
y el rico ava[MI7]riento pobre se que[LA]dó.

# Envidia · todos
> Letra completa en el PDF del cancionero.
> Estribillo: LA · LA# · DO · LA# · LA · LA# · DO · FA · LA# · DO · LA# · LA
> Coplas «Pastores de la laguna» y «La noche de Nochebuena» (cada par de versos, bis): LA · SOLm · LA  —  REm · DO · LA# · LA
> Tras cada copla: LA → vuelta a «Envidia…»$s$),
      (20, $s$Popurrí 2$s$, $s$DO$s$, $s$Sin cejilla (al aire)$s$, $s$# En Navidad (estrofas)
> Letra completa en el PDF del cancionero. Todos los versos acaban con «…en navidad».
> Cada estrofa: DO · FA · SOL

# Arre borriquito (…en navidad)
[DO]Arre borriquito, arre burro arre… en navidad
[FA]anda más de[SOL]prisa que llegamos [DO]tarde… en navidad
arre borriquito, vamos a Belén… en navidad
[FA]que mañana es [SOL]fiesta y al otro tam[DO]bién… en navidad

# En Navidad (estrofa)
> DO · FA · SOL

# Campana sobre campana (…en navidad)
[DO]Campana sobre cam[SOL]pana… en navidad
y sobre campana [DO]una… en navidad
asómate a la ven[SOL]tana… en navidad
verás al Niño en la [DO]cuna… en navidad

# En Navidad (estrofa)
> DO · FA · SOL

# Dime, Niño (…en navidad)
[DO]Dime, Niño, ¿de quién [SOL]eres?… en navidad
todo vestidito de [DO]blanco… en navidad
[DO]Dime, Niño, ¿de quién [SOL]eres?… en navidad
todo vestidito de [DO]blanco… en navidad

# Todos
[DO]En navidad, [FA]en navidad, [SOL]en navidad…

# En Navidad (estrofa final) y «Navidad, navidad, dulce navidad» (×4)
> Letra completa en el PDF del cancionero.
> Estrofa: DO · FA · SOL
> Navidad, navidad… (×4): DO · DO  —  FA · DO · SOL$s$),
      (30, $s$El tamborilero$s$, $s$RE$s$, $s$nº 8 en la hoja$s$, $s$> Letra completa en el PDF del cancionero.
> Estrofa: RE · SOL · RE  —  SOL · RE  —  LA  —  RE · RE7 · SOL
> Ropopompom: RE · LA
> Final de estrofa: RE · SOL · RE  —  LA · RE · SOL-RE-LA-RE · SOL-RE-LA-RE$s$),
      (40, $s$Oh, blanca Navidad$s$, $s$DO$s$, $s$$s$, $s$> Letra completa en el PDF del cancionero.
> 1ª parte: DO · REm · SOL  —  FA · SOL · DO · SOL  —  DO · DO7  —  FA · FAm · DO · REm · SOL
> 2ª parte: DO · REm · SOL  —  FA · SOL · DO · SOL  —  DO · DO7 · FA (FAm)  —  DO · SOL · DO$s$),
      (50, $s$La Virgen como es gitana$s$, $s$LA$s$, $s$$s$, $s$# Copla 1
[LA]La Virgen, como es gitana, a los [MI7]gitanos ca[LA]mela;
San José, como es [MI7]gacho, se re[LA]vela, se revela.

# Estribillo
[LAm]La Virgen la[MI]vaba, San José ten[LAm]día,
la Virgen la[MI]vaba, San José ten[LAm]día.
¡Ay, cu[MI]rricuti!, agua le tra[LAm]ía,
a[MI]gua le traía, agua le tra[LAm]í[LA]a.
Madroños al Niño no le [FA#]demos [SIm]más,
que con los ma[MI7]droños se pue embo[LA]rrachar.
Que sí, que [LAm]no, María se [FA]llama la [MI]Madre de [LA]Dios.

# Copla 2
[LA]La Virgen vendió la mula porque le [MI7]daba co[LA]raje;
San José, como es [MI7]gacho, arbitró su corre[LA]aje.

# Estribillo
(igual que arriba)$s$),
      (60, $s$Ya vienen los Reyes Magos$s$, $s$LA$s$, $s$$s$, $s$[LA]Ya vienen los Reyes Magos,
ya vienen los Reyes Magos
caminito de Be[MI7]lén.
Olé, olé, [SIm]Holanda, y [MI7]olé,
Holanda ya se [LA]ve, ya se [MI7]ve, ya se [LA]ve.

[LA]Cargaditos de juguetes,
cargaditos de juguetes
para el Niño de Be[MI7]lén.
Olé, olé, [SIm]Holanda, y [MI7]olé…

[LA]La Virgen va caminando,
la Virgen va caminando
caminito de Be[MI7]lén.
Olé, olé, [SIm]Holanda, y [MI7]olé…

[LA]Como el camino es tan largo,
como el camino es tan largo
pide el Niño de be[MI7]ber.
Olé, olé, [SIm]Holanda, y [MI7]olé…

[LA]No pidas agua, mi vida,
no pidas agua, mi vida,
no pidas agua, mi [MI7]bien.
Olé, olé, [SIm]Holanda, y [MI7]olé,
Holanda ya se [LA]ve, ya se [MI7]ve, ya se [LA]ve.$s$),
      (70, $s$Tiene que tiene María$s$, $s$$s$, $s$$s$, $s$> Pega aquí la letra (Editar).$s$),
      (80, $s$En un canasto$s$, $s$$s$, $s$$s$, $s$> Pega aquí la letra (Editar).$s$);
  end if;
end $seed$;

-- ---------- FUNCIONES AUXILIARES ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_admin and status = 'approved');
$$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'approved');
$$;

create or replace function public.is_supervisor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_supervisor and status = 'approved');
$$;

create or replace function public.my_member() returns uuid
language sql stable security definer set search_path = public as $$
  select member_id from profiles where id = auth.uid() and status = 'approved';
$$;

create or replace function public.username_available(u text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where lower(username) = lower(u));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- Fichar la llegada escaneando el QR del súper usuario
create or replace function public.checkin(p_session uuid, p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare mid uuid; s record; c record; a record; hm text;
begin
  mid := public.my_member();
  if mid is null then raise exception 'Tu usuario no está asociado a ningún nombre de la lista'; end if;
  select * into s from sessions where id = p_session;
  if s is null or s.closed or not s.started or s.end_time is not null then raise exception 'Esta quedada no está en curso'; end if;
  select * into c from session_checkin where session_id = p_session and kind = 'in';
  if c is null or (p_code is distinct from c.code and p_code is distinct from c.prev) or c.updated_at < now() - interval '20 seconds' then
    raise exception 'Código caducado. Escanea el QR otra vez';
  end if;
  select * into a from attendance where session_id = p_session and member_id = mid;
  if a is not null and a.status = 'present' then return coalesce(a.arrive, s.start_time); end if;
  hm := to_char(now() at time zone 'Europe/Madrid', 'HH24:MI');
  insert into attendance (session_id, member_id, status, arrive, "leave") values (p_session, mid, 'present', hm, null)
  on conflict (session_id, member_id) do update set status = 'present', arrive = excluded.arrive, "leave" = null;
  return hm;
end $$;
grant execute on function public.checkin(uuid, text) to authenticated;

-- Fichar la salida (irse antes) escaneando el QR de salida
create or replace function public.checkout(p_session uuid, p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare mid uuid; s record; c record; a record; hm text;
begin
  mid := public.my_member();
  if mid is null then raise exception 'Tu usuario no está asociado a ningún nombre de la lista'; end if;
  select * into s from sessions where id = p_session;
  if s is null or s.closed or not s.started or s.end_time is not null then raise exception 'Esta quedada no está en curso'; end if;
  select * into c from session_checkin where session_id = p_session and kind = 'out';
  if c is null or (p_code is distinct from c.code and p_code is distinct from c.prev) or c.updated_at < now() - interval '20 seconds' then
    raise exception 'Código caducado. Escanea el QR otra vez';
  end if;
  select * into a from attendance where session_id = p_session and member_id = mid;
  if a is null or a.status <> 'present' then raise exception 'No constas como llegado: pide que te marquen primero'; end if;
  if a."leave" is not null then return a."leave"; end if;
  hm := to_char(now() at time zone 'Europe/Madrid', 'HH24:MI');
  update attendance set "leave" = hm where session_id = p_session and member_id = mid;
  return hm;
end $$;
grant execute on function public.checkout(uuid, text) to authenticated;

-- Recuento de «Voy / No puedo» por quedada (todos los aceptados lo ven, sin nombres)
create or replace function public.rsvp_counts() returns table(session_id uuid, yes_count bigint, no_count bigint)
language sql stable security definer set search_path = public as $$
  select r.session_id, count(*) filter (where r.status = 'yes'), count(*) filter (where r.status = 'no')
  from session_rsvp r where public.is_approved() group by r.session_id;
$$;
grant execute on function public.rsvp_counts() to authenticated;

-- Registrar este móvil para avisos (si antes estaba a nombre de otro usuario, pasa a este)
create or replace function public.claim_push(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_approved() then raise exception 'No autorizado'; end if;
  delete from push_subscriptions where endpoint = p_endpoint and user_id <> auth.uid();
  insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id;
end $$;
grant execute on function public.claim_push(text, text, text) to authenticated;

-- Cuántos móviles con avisos tiene cada usuario (solo para súper usuarios)
create or replace function public.push_counts() returns table(user_id uuid, n bigint)
language sql stable security definer set search_path = public as $$
  select s.user_id, count(*) from push_subscriptions s where public.is_admin() group by s.user_id;
$$;
grant execute on function public.push_counts() to authenticated;

-- Un súper usuario puede poner contraseña nueva a quien la olvide
create or replace function public.admin_set_password(uid uuid, new_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'Solo súper usuarios'; end if;
  if length(new_password) < 6 then raise exception 'La contraseña debe tener al menos 6 caracteres'; end if;
  update auth.users set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')), updated_at = now() where id = uid;
end $$;
grant execute on function public.admin_set_password(uuid, text) to authenticated;

-- Al registrarse se crea su perfil "pendiente". El PRIMERO que se registra es súper usuario.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select not exists (select 1 from profiles where is_admin) into first_user;
  insert into profiles (id, full_name, username, status, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))),
    case when first_user then 'approved' else 'pending' end,
    first_user
  );
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- PERMISOS (Row Level Security) ----------
alter table public.members    enable row level security;
alter table public.profiles   enable row level security;
alter table public.sessions   enable row level security;
alter table public.attendance enable row level security;
alter table public.settings   enable row level security;
alter table public.bote       enable row level security;
alter table public.backups    enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.session_alarms enable row level security;
alter table public.session_rsvp enable row level security;
alter table public.announcements enable row level security;
alter table public.member_contacts enable row level security;
alter table public.session_checkin enable row level security;
alter table public.songs enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
           and tablename in ('members','profiles','sessions','attendance','settings','bote','backups','push_subscriptions','session_alarms','session_rsvp','announcements','member_contacts','session_checkin','songs') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Perfiles: cada uno ve el suyo; los súper usuarios ven y gestionan todos
create policy profiles_select on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update using (public.is_admin()) with check (public.is_admin());
create policy profiles_delete on public.profiles for delete using (public.is_admin());

-- Lista del coro
create policy members_admin on public.members for all using (public.is_admin()) with check (public.is_admin());
create policy members_self  on public.members for select using (id = public.my_member());
create policy members_sup   on public.members for select using (public.is_supervisor());

-- Quedadas: súper usuarios todo; cada uno solo las suyas
create policy sessions_admin on public.sessions for all using (public.is_admin()) with check (public.is_admin());
create policy sessions_self  on public.sessions for select using (
  id in (select a.session_id from public.attendance a where a.member_id = public.my_member())
);
-- Las quedadas que aún no se han cerrado (próximas) las ven todos los aceptados
create policy sessions_sup on public.sessions for select using (public.is_supervisor());
create policy sessions_upcoming on public.sessions for select using (public.is_approved() and not closed);

-- Asistencias: súper usuarios todo; cada uno solo las suyas
create policy attendance_admin on public.attendance for all using (public.is_admin()) with check (public.is_admin());
create policy attendance_self  on public.attendance for select using (member_id = public.my_member());
create policy attendance_sup   on public.attendance for select using (public.is_supervisor());

-- Reglas: todos los aceptados las ven; solo súper usuarios las cambian
create policy settings_read  on public.settings for select using (public.is_approved());
create policy settings_admin on public.settings for all using (public.is_admin()) with check (public.is_admin());

-- Bote: todos los aceptados lo ven; solo súper usuarios lo mueven
create policy bote_read  on public.bote for select using (public.is_approved());
create policy bote_admin on public.bote for all using (public.is_admin()) with check (public.is_admin());

-- Avisos al móvil: cada uno gestiona sus propios dispositivos
create policy checkin_admin on public.session_checkin for all using (public.is_admin()) with check (public.is_admin());
create policy contacts_admin on public.member_contacts for all using (public.is_admin()) with check (public.is_admin());
create policy ann_admin on public.announcements for all using (public.is_admin()) with check (public.is_admin());
create policy ann_read  on public.announcements for select using (public.is_approved() and (audience = 'all' or public.is_admin()));
create policy rsvp_own on public.session_rsvp for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_approved());
create policy rsvp_admin on public.session_rsvp for select using (public.is_admin());
create policy alarms_own on public.session_alarms for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_own on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Repertorio: lo ve todo el coro; solo los súper usuarios lo cambian
create policy songs_read  on public.songs for select using (public.is_approved());
create policy songs_admin on public.songs for all using (public.is_admin()) with check (public.is_admin());

-- Carpeta privada «repertorio» para los PDF del cancionero (solo la ve quien entra en la app)
do $st$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('repertorio', 'repertorio', false) on conflict (id) do nothing;
    begin
      execute 'drop policy if exists repertorio_read on storage.objects';
      execute 'drop policy if exists repertorio_write on storage.objects';
      execute 'drop policy if exists repertorio_update on storage.objects';
      execute 'drop policy if exists repertorio_delete on storage.objects';
      execute $p$create policy repertorio_read on storage.objects for select to authenticated using (bucket_id = 'repertorio' and public.is_approved())$p$;
      execute $p$create policy repertorio_write on storage.objects for insert to authenticated with check (bucket_id = 'repertorio' and public.is_admin())$p$;
      execute $p$create policy repertorio_update on storage.objects for update to authenticated using (bucket_id = 'repertorio' and public.is_admin())$p$;
      execute $p$create policy repertorio_delete on storage.objects for delete to authenticated using (bucket_id = 'repertorio' and public.is_admin())$p$;
    exception when others then raise notice 'No se pudieron crear los permisos de la carpeta repertorio: %', sqlerrm;
    end;
  end if;
end $st$;

-- Copias: solo súper usuarios
create policy backups_admin on public.backups for all using (public.is_admin()) with check (public.is_admin());

-- ---------- TIEMPO REAL (varios móviles pasando lista a la vez) ----------
do $$ begin
  begin alter publication supabase_realtime add table public.attendance; exception when others then null; end;
  begin alter publication supabase_realtime add table public.sessions;   exception when others then null; end;
  begin alter publication supabase_realtime add table public.members;    exception when others then null; end;
  begin alter publication supabase_realtime add table public.profiles;   exception when others then null; end;
  begin alter publication supabase_realtime add table public.session_rsvp; exception when others then null; end;
  begin alter publication supabase_realtime add table public.announcements; exception when others then null; end;
end $$;

-- ---------- PERMISOS DE ACCESO A TABLAS Y PERFILES QUE FALTEN ----------
-- Permisos de acceso a las tablas (algunos proyectos nuevos de Supabase no los dan por defecto)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
-- La función de avisos (service_role) también necesita acceso
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- Crear el perfil a los usuarios que se registraron sin él (el más antiguo será súper usuario)
insert into public.profiles (id, full_name, username, status, is_admin)
select u.id,
       coalesce(u.raw_user_meta_data->>'full_name', ''),
       lower(coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1))),
       'pending', false
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict do nothing;

update public.profiles set status = 'approved', is_admin = true
where id = (select id from public.profiles order by created_at limit 1)
  and not exists (select 1 from public.profiles where is_admin);


select 'Listo ✅' as resultado;
