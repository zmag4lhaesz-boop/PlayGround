-- RPG Hub: esquema inicial para Supabase.
-- Execute este arquivo inteiro no SQL Editor do seu projeto.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  avatar text not null default ''
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  gm_id uuid not null references public.profiles(id) on delete cascade,
  invite_code text not null unique check (invite_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  members uuid[] not null default '{}',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint campaigns_gm_is_member check (gm_id = any(members))
);

create index if not exists campaigns_members_gin on public.campaigns using gin (members);
create index if not exists campaigns_created_at_idx on public.campaigns (created_at desc);

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;

drop policy if exists "Signed-in users can read player profiles" on public.profiles;
create policy "Signed-in users can read player profiles"
  on public.profiles for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Players can create their own profile" on public.profiles;
create policy "Players can create their own profile"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "Players can update their own profile" on public.profiles;
create policy "Players can update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "Campaign members can read their campaigns" on public.campaigns;
create policy "Campaign members can read their campaigns"
  on public.campaigns for select to authenticated
  using (auth.uid() = any(members));

drop policy if exists "Players can create campaigns as their own GM" on public.campaigns;
create policy "Players can create campaigns as their own GM"
  on public.campaigns for insert to authenticated
  with check (gm_id = auth.uid() and auth.uid() = any(members));

drop policy if exists "Only the GM can delete a campaign" on public.campaigns;
create policy "Only the GM can delete a campaign"
  on public.campaigns for delete to authenticated
  using (gm_id = auth.uid());

create or replace function public.rpg_join_campaign(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.campaigns%rowtype;
begin
  if auth.uid() is null then
    raise exception 'É necessário entrar para participar de uma campanha.';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Crie seu perfil antes de entrar em uma campanha.';
  end if;

  select * into v_campaign
  from public.campaigns
  where invite_code = upper(trim(p_code))
  for update;

  if not found then
    raise exception 'Código não encontrado.';
  end if;

  if not (auth.uid() = any(v_campaign.members)) then
    update public.campaigns
      set members = array_append(members, auth.uid())
      where id = v_campaign.id
      returning * into v_campaign;
  end if;

  return to_jsonb(v_campaign);
end;
$$;

create or replace function public.rpg_save_character(p_campaign_id uuid, p_character jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.campaigns%rowtype;
  v_character jsonb;
  v_characters jsonb;
  v_exists boolean;
begin
  select * into v_campaign
  from public.campaigns
  where id = p_campaign_id and auth.uid() = any(members)
  for update;
  if not found then
    raise exception 'Campanha não encontrada ou acesso não permitido.';
  end if;
  if jsonb_typeof(p_character->'values') <> 'object'
    or length(trim(coalesce(p_character->'values'->>'Nome', ''))) = 0 then
    raise exception 'A ficha precisa ter um nome de personagem.';
  end if;

  v_character := jsonb_build_object(
    'id', coalesce(p_character->>'id', gen_random_uuid()::text),
    'userId', auth.uid()::text,
    'name', left(trim(p_character->'values'->>'Nome'), 80),
    'values', p_character->'values',
    'portrait', coalesce(p_character->>'portrait', '')
  );
  v_exists := exists (
    select 1 from jsonb_array_elements(coalesce(v_campaign.data->'characters', '[]'::jsonb)) item
    where item->>'userId' = auth.uid()::text
  );
  select coalesce(jsonb_agg(
    case when item->>'userId' = auth.uid()::text then v_character else item end order by ord
  ), '[]'::jsonb)
  into v_characters
  from jsonb_array_elements(coalesce(v_campaign.data->'characters', '[]'::jsonb)) with ordinality as chars(item, ord);
  if not v_exists then
    v_characters := v_characters || jsonb_build_array(v_character);
  end if;

  update public.campaigns
    set data = jsonb_set(coalesce(data, '{}'::jsonb), '{characters}', v_characters, true)
    where id = p_campaign_id
    returning * into v_campaign;
  return to_jsonb(v_campaign);
end;
$$;

create or replace function public.rpg_send_message(p_campaign_id uuid, p_message jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.campaigns%rowtype;
  v_profile public.profiles%rowtype;
  v_character jsonb;
  v_message jsonb;
  v_text text;
  v_role text;
  v_name text;
begin
  select * into v_campaign
  from public.campaigns
  where id = p_campaign_id and auth.uid() = any(members);
  if not found then
    raise exception 'Campanha não encontrada ou acesso não permitido.';
  end if;

  v_text := trim(coalesce(p_message->>'text', ''));
  if length(v_text) = 0 or length(v_text) > 1200 then
    raise exception 'A mensagem deve ter entre 1 e 1200 caracteres.';
  end if;
  select * into v_profile from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Perfil de jogador não encontrado.';
  end if;
  select item into v_character
  from jsonb_array_elements(coalesce(v_campaign.data->'characters', '[]'::jsonb)) item
  where item->>'userId' = auth.uid()::text
  limit 1;

  v_name := coalesce(nullif(v_character->>'name', ''), v_profile.name);
  v_role := case when v_campaign.gm_id = auth.uid() then 'gm' else 'player' end;
  v_message := jsonb_build_object(
    'id', gen_random_uuid(),
    'userId', auth.uid(),
    'name', v_name,
    'portrait', coalesce(v_character->>'portrait', ''),
    'role', v_role,
    'text', v_text,
    'type', case when p_message->>'type' = 'dice' then 'dice' else 'text' end,
    'time', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
  );

  update public.campaigns
    set data = jsonb_set(
      coalesce(data, '{}'::jsonb),
      '{messages}',
      coalesce(data->'messages', '[]'::jsonb) || jsonb_build_array(v_message),
      true
    )
    where id = p_campaign_id;
  return v_message;
end;
$$;

revoke all on function public.rpg_join_campaign(text) from public;
revoke all on function public.rpg_save_character(uuid, jsonb) from public;
revoke all on function public.rpg_send_message(uuid, jsonb) from public;
grant execute on function public.rpg_join_campaign(text) to authenticated;
grant execute on function public.rpg_save_character(uuid, jsonb) to authenticated;
grant execute on function public.rpg_send_message(uuid, jsonb) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaigns'
  ) then
    alter publication supabase_realtime add table public.campaigns;
  end if;
end;
$$;
