-- My Fitness Log: run this once in Supabase → SQL Editor → New query → Run
-- One row per user with all of their app data (workouts, programs, settings).

create table if not exists public.user_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Row Level Security: every user can only see and change their OWN row
alter table public.user_data enable row level security;

drop policy if exists "Users read own data"   on public.user_data;
drop policy if exists "Users insert own data" on public.user_data;
drop policy if exists "Users update own data" on public.user_data;

create policy "Users read own data"   on public.user_data for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own data" on public.user_data for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own data" on public.user_data for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update on public.user_data to authenticated;
