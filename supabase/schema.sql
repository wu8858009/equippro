-- EquipPro — Supabase schema
-- Paste this whole file into Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to re-run from scratch on a brand new project.

-- ---------- profiles (app-level user info, linked to Supabase Auth) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'staff' check (role in ('admin','staff')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active = true
  );
$$;

-- Auto-create a profile row whenever someone signs up via Supabase Auth.
-- The very first person to sign up becomes admin; everyone after is staff
-- (an admin can promote others later from the 使用者管理 page).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first boolean;
begin
  select not exists(select 1 from public.profiles) into is_first;
  insert into public.profiles (id, name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when is_first then 'admin' else 'staff' end,
    true
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
create policy "profiles_select_authenticated" on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "profiles_insert_self" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_self_or_admin" on public.profiles
  for update using (auth.uid() = id or public.is_admin());
create policy "profiles_delete_admin" on public.profiles
  for delete using (public.is_admin());

-- ---------- equipment ----------
create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  category text,
  department text,
  location text,
  purchase_date date,
  warranty_months int default 0,
  lifespan_years int default 0,
  status text not null default 'active' check (status in ('active','pending','retired','damaged')),
  supplier text,
  purchase_price numeric default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);
alter table public.equipment enable row level security;
create policy "equipment_select" on public.equipment for select using (auth.role() = 'authenticated');
create policy "equipment_insert" on public.equipment for insert with check (auth.role() = 'authenticated');
create policy "equipment_update" on public.equipment for update using (auth.role() = 'authenticated');
create policy "equipment_delete" on public.equipment for delete using (public.is_admin());

-- ---------- replacements ----------
create table public.replacements (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid references public.equipment(id) on delete cascade,
  replace_date date,
  reason text,
  cost numeric default 0,
  vendor text,
  operator text,
  disposal text,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.replacements enable row level security;
create policy "replacements_select" on public.replacements for select using (auth.role() = 'authenticated');
create policy "replacements_insert" on public.replacements for insert with check (auth.role() = 'authenticated');
create policy "replacements_delete" on public.replacements for delete using (public.is_admin());

-- ---------- quotes ----------
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid references public.equipment(id) on delete cascade,
  item_name text,
  vendor text,
  price numeric default 0,
  quote_date date,
  valid_until date,
  contact text,
  selected boolean default false,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.quotes enable row level security;
create policy "quotes_select" on public.quotes for select using (auth.role() = 'authenticated');
create policy "quotes_insert" on public.quotes for insert with check (auth.role() = 'authenticated');
create policy "quotes_update" on public.quotes for update using (auth.role() = 'authenticated');
create policy "quotes_delete" on public.quotes for delete using (public.is_admin());

-- ---------- activity (audit log) ----------
create table public.activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  user_name text,
  action text,
  target text,
  detail text,
  created_at timestamptz not null default now()
);
alter table public.activity enable row level security;
create policy "activity_select" on public.activity for select using (auth.role() = 'authenticated');
create policy "activity_insert" on public.activity for insert with check (auth.role() = 'authenticated');
