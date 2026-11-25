begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  email text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

create function public.rb_sync_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name, email, created_at)
  values (new.id,
    coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'name'), 100), ''), 'Kreator'),
    new.email, new.created_at)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

revoke all on function public.rb_sync_profile() from public, anon, authenticated, service_role;
create trigger rb_sync_profile after insert or update of email on auth.users
for each row execute function public.rb_sync_profile();

insert into public.profiles (id, name, email, created_at)
select id, coalesce(nullif(left(btrim(raw_user_meta_data ->> 'name'), 100), ''), 'Kreator'), email, created_at
from auth.users on conflict (id) do nothing;

create table public.campaigns (
  id uuid not null unique default gen_random_uuid(),
  slug text primary key check (char_length(slug) <= 100 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(btrim(title)) between 1 and 140),
  description text not null default '' check (char_length(description) <= 4000),
  caption text not null default '' check (char_length(caption) <= 4000),
  category text not null check (char_length(btrim(category)) between 1 and 100),
  frames text[] not null check (array_ndims(frames) = 1 and cardinality(frames) between 1 and 12 and array_position(frames, null) is null and octet_length(array_to_string(frames, '')) <= 8388608),
  theme text not null default 'green' check (char_length(theme) <= 32 and theme ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  views bigint not null default 0 check (views >= 0),
  downloads bigint not null default 0 check (downloads >= 0),
  created_at timestamptz not null default now(),
  owner_id uuid references public.profiles(id) on delete set null,
  revision uuid not null default gen_random_uuid()
);
create index campaigns_owner_idx on public.campaigns (owner_id, created_at desc, slug);
create index campaigns_created_idx on public.campaigns (created_at desc, slug);

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
revoke all on public.profiles, public.campaigns from public, anon, authenticated, service_role;
grant select on public.profiles to service_role;
grant select, insert, update, delete on public.campaigns to service_role;

create function public.rb_increment_stat(p_slug text, p_action text)
returns table (slug text, views bigint, downloads bigint)
language sql volatile security invoker set search_path = '' as $$
  update public.campaigns as c
     set views = c.views + case when p_action = 'view' then 1 else 0 end,
         downloads = c.downloads + case when p_action = 'download' then 1 else 0 end
   where c.slug = p_slug and p_action in ('view', 'download')
  returning c.slug, c.views, c.downloads;
$$;
revoke all on function public.rb_increment_stat(text, text) from public, anon, authenticated, service_role;
grant execute on function public.rb_increment_stat(text, text) to service_role;

insert into public.campaigns (slug, title, description, caption, category, frames, views, downloads, theme) values
  ('bumi-lebih-hijau', 'Bumi Lebih Hijau', 'Ajak teman dan keluarga menjaga lingkungan, mulai dari kebiasaan kecil.', 'Langkah kecil hari ini, bumi lebih hijau esok hari. #BumiLebihHijau', 'Lingkungan', array['/frames/bumi.svg','/frames/bumi-alt.svg'], 1280, 364, 'green'),
  ('semangat-merdeka', 'Semangat Merdeka', 'Rayakan kemerdekaan Indonesia bersama orang-orang terdekat.', 'Dirgahayu Indonesia! #SemangatMerdeka', 'Hari Besar Nasional', array['/frames/merdeka.svg'], 945, 281, 'coral'),
  ('generasi-belajar', 'Generasi Belajar', 'Bagikan semangat belajar dan dukung pendidikan untuk semua.', 'Belajar hari ini, berkarya esok hari. #GenerasiBelajar', 'Pendidikan', array['/frames/belajar.svg'], 672, 198, 'blue');

commit;
