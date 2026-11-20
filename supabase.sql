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
alter table public.attendance add column if not exists notified_cents int;   -- última cantidad avisada (para reajustes)

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

-- ---------- FUNCIONES AUXILIARES ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_admin and status = 'approved');
$$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'approved');
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

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
           and tablename in ('members','profiles','sessions','attendance','settings','bote','backups','push_subscriptions') loop
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

-- Quedadas: súper usuarios todo; cada uno solo las suyas
create policy sessions_admin on public.sessions for all using (public.is_admin()) with check (public.is_admin());
create policy sessions_self  on public.sessions for select using (
  id in (select a.session_id from public.attendance a where a.member_id = public.my_member())
);
-- Las quedadas que aún no se han cerrado (próximas) las ven todos los aceptados
create policy sessions_upcoming on public.sessions for select using (public.is_approved() and not closed);

-- Asistencias: súper usuarios todo; cada uno solo las suyas
create policy attendance_admin on public.attendance for all using (public.is_admin()) with check (public.is_admin());
create policy attendance_self  on public.attendance for select using (member_id = public.my_member());

-- Reglas: todos los aceptados las ven; solo súper usuarios las cambian
create policy settings_read  on public.settings for select using (public.is_approved());
create policy settings_admin on public.settings for all using (public.is_admin()) with check (public.is_admin());

-- Bote: todos los aceptados lo ven; solo súper usuarios lo mueven
create policy bote_read  on public.bote for select using (public.is_approved());
create policy bote_admin on public.bote for all using (public.is_admin()) with check (public.is_admin());

-- Avisos al móvil: cada uno gestiona sus propios dispositivos
create policy push_own on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Copias: solo súper usuarios
create policy backups_admin on public.backups for all using (public.is_admin()) with check (public.is_admin());

-- ---------- TIEMPO REAL (varios móviles pasando lista a la vez) ----------
do $$ begin
  begin alter publication supabase_realtime add table public.attendance; exception when others then null; end;
  begin alter publication supabase_realtime add table public.sessions;   exception when others then null; end;
  begin alter publication supabase_realtime add table public.members;    exception when others then null; end;
  begin alter publication supabase_realtime add table public.profiles;   exception when others then null; end;
end $$;

-- ---------- PERMISOS DE ACCESO A TABLAS Y PERFILES QUE FALTEN ----------
-- Permisos de acceso a las tablas (algunos proyectos nuevos de Supabase no los dan por defecto)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

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
