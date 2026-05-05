create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name in ('Shreya', 'Aditi', 'Thaanvi')),
  weekly_goal integer not null default 4 check (weekly_goal between 1 and 7),
  avatar_emoji text not null default '🌸',
  theme_color text not null default 'strawberry',
  vacation_mode boolean not null default false,
  vacation_note text,
  vacation_until date,
  created_at timestamptz not null default now()
);

create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  check_in_date date not null,
  note_text text,
  created_at timestamptz not null default now(),
  unique (profile_id, check_in_date)
);

alter table public.profiles
  add column if not exists avatar_emoji text not null default '🌸',
  add column if not exists theme_color text not null default 'strawberry',
  add column if not exists vacation_mode boolean not null default false,
  add column if not exists vacation_note text,
  add column if not exists vacation_until date;

alter table public.check_ins
  add column if not exists note_text text;

alter table public.profiles enable row level security;
alter table public.check_ins enable row level security;

drop policy if exists "Anyone can read profiles" on public.profiles;
create policy "Anyone can read profiles"
  on public.profiles
  for select
  to anon
  using (true);

drop policy if exists "Anyone can update weekly goals" on public.profiles;
create policy "Anyone can update weekly goals"
  on public.profiles
  for update
  to anon
  using (true)
  with check (
    weekly_goal between 1 and 7
    and theme_color in ('strawberry', 'peach', 'lavender', 'mint', 'sky', 'lemon')
    and (vacation_note is null or char_length(vacation_note) <= 100)
  );

drop policy if exists "Anyone can read check ins" on public.check_ins;
create policy "Anyone can read check ins"
  on public.check_ins
  for select
  to anon
  using (true);

drop policy if exists "Anyone can add check ins" on public.check_ins;
create policy "Anyone can add check ins"
  on public.check_ins
  for insert
  to anon
  with check (note_text is null or char_length(note_text) <= 120);

drop policy if exists "Anyone can undo check ins from today" on public.check_ins;
create policy "Anyone can undo check ins from today"
  on public.check_ins
  for delete
  to anon
  using (check_in_date = current_date);

insert into public.profiles (id, name, weekly_goal, avatar_emoji, theme_color)
values
  ('11111111-1111-4111-8111-111111111111', 'Shreya', 4, '🌸', 'strawberry'),
  ('22222222-2222-4222-8222-222222222222', 'Aditi', 4, '⭐', 'lavender'),
  ('33333333-3333-4333-8333-333333333333', 'Thaanvi', 4, '🦋', 'sky')
on conflict (name) do update
set
  weekly_goal = excluded.weekly_goal,
  avatar_emoji = excluded.avatar_emoji,
  theme_color = excluded.theme_color;
