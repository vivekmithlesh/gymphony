-- =============================================================================
-- WhatsApp Receptionist — production messaging schema.
-- -----------------------------------------------------------------------------
-- Refactors the ad-hoc `messages` table (one row = member text + AI response)
-- into a robust model:
--   * conversations : one thread per member per gym, carrying ai_paused.
--   * messages      : ONE row per message, tagged sender = member|ai|owner.
--
-- Backwards compatible: legacy writers (e.g. n8n) that still insert
-- {member_name, message, response} keep working via BEFORE/AFTER triggers that
-- normalise the row, attach it to a conversation, and split the AI response into
-- its own 'ai' row. The canonical gym entity is gym_settings (no `gyms` table).
-- Safe to run more than once.
-- =============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. conversations
-- ----------------------------------------------------------------------------
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid references public.gym_settings(id) on delete cascade,
  gym_owner_id    uuid,
  member_name     text,
  member_phone    text,
  ai_paused       boolean not null default false,   -- #2: human-takeover flag
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists conversations_gym_id_idx
  on public.conversations (gym_id, last_message_at desc);

-- One thread per (gym, member identity). Identity = phone if present else name.
create unique index if not exists conversations_identity_uniq
  on public.conversations (gym_id, (coalesce(member_phone, member_name)));

-- ----------------------------------------------------------------------------
-- 2. messages
-- ----------------------------------------------------------------------------
-- Create the table if it doesn't exist yet (fresh DB). One row per message.
-- The conversation_id FK and the sender CHECK are added in the DO block below
-- (so they're applied to pre-existing tables too). Legacy columns are kept so
-- any n8n {message,response} inserts keep working via the triggers in §4.
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid,
  gym_id          uuid,
  gym_owner_id    uuid,
  sender          text not null default 'member',
  content         text not null default '',
  message         text,   -- legacy-compat
  response        text,   -- legacy-compat
  member_name     text,
  member_phone    text,
  created_at      timestamptz not null default now()
);

-- Defensive: ensure the new-model + legacy columns exist whatever the current
-- ad-hoc shape is. No-ops on the freshly-created table above.
alter table public.messages add column if not exists conversation_id uuid;
alter table public.messages add column if not exists sender          text;
alter table public.messages add column if not exists content         text;
-- Ensure every column referenced by backfill/triggers exists, whatever the
-- current ad-hoc shape is. No-ops if they already exist.
alter table public.messages add column if not exists message       text;
alter table public.messages add column if not exists response      text;
alter table public.messages add column if not exists member_name   text;
alter table public.messages add column if not exists member_phone  text;
alter table public.messages add column if not exists gym_id        uuid;
alter table public.messages add column if not exists gym_owner_id  uuid;
alter table public.messages add column if not exists created_at    timestamptz default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_conversation_id_fkey') then
    alter table public.messages
      add constraint messages_conversation_id_fkey
      foreign key (conversation_id) references public.conversations(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'messages_sender_check') then
    alter table public.messages
      add constraint messages_sender_check
      check (sender is null or sender in ('member', 'ai', 'owner'));
  end if;
end$$;

create index if not exists messages_conversation_id_created_idx
  on public.messages (conversation_id, created_at);
create index if not exists messages_gym_id_created_idx
  on public.messages (gym_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 3. BACKFILL (runs before triggers are created, so it isn't re-processed).
-- ----------------------------------------------------------------------------

-- 3a. Create a conversation per (gym, member identity) from existing rows.
insert into public.conversations (gym_id, gym_owner_id, member_name, member_phone, last_message_at, created_at)
select
  t.gym_id,
  t.owner_id,
  coalesce(t.member_name, 'Member'),
  t.member_phone,
  t.last_at,
  t.first_at
from (
  select
    m.gym_id,
    coalesce(nullif(m.member_phone, ''), nullif(m.member_name, ''), 'Member') as identity,
    (array_agg(nullif(m.member_name, '')  order by m.created_at desc))[1] as member_name,
    (array_agg(nullif(m.member_phone, '') order by m.created_at desc))[1] as member_phone,
    (array_agg(m.gym_owner_id             order by m.created_at desc))[1] as owner_id,
    max(m.created_at) as last_at,
    min(m.created_at) as first_at
  from public.messages m
  where m.gym_id is not null
    and m.conversation_id is null
  group by m.gym_id, coalesce(nullif(m.member_phone, ''), nullif(m.member_name, ''), 'Member')
) t
on conflict (gym_id, (coalesce(member_phone, member_name))) do nothing;

-- 3b. Link existing messages to their conversation.
update public.messages m
set conversation_id = c.id
from public.conversations c
where m.conversation_id is null
  and m.gym_id = c.gym_id
  and coalesce(nullif(m.member_phone, ''), nullif(m.member_name, ''), 'Member')
      = coalesce(c.member_phone, c.member_name);

-- 3c. Existing rows represent the member's inbound message.
update public.messages
set sender = 'member',
    content = coalesce(content, message, '')
where sender is null;

-- 3d. Split any stored AI response into its own 'ai' row.
insert into public.messages (conversation_id, gym_id, gym_owner_id, sender, content, created_at)
select m.conversation_id, m.gym_id, m.gym_owner_id, 'ai', m.response, m.created_at + interval '1 millisecond'
from public.messages m
where m.sender = 'member'
  and m.response is not null
  and length(trim(m.response)) > 0;

-- 3e. Clear the legacy response so a re-run of this migration won't duplicate.
update public.messages set response = null
where sender = 'member' and response is not null;

-- ----------------------------------------------------------------------------
-- 4. TRIGGERS — ongoing normalisation + last_message_at bookkeeping.
-- ----------------------------------------------------------------------------

-- 4a. Normalise inbound rows + attach/create a conversation (legacy compat).
create or replace function public.messages_before_insert()
returns trigger
language plpgsql
as $$
declare
  conv_id  uuid;
  identity text;
begin
  if new.sender is null then new.sender := 'member'; end if;
  if new.content is null then new.content := coalesce(new.message, ''); end if;
  if new.created_at is null then new.created_at := now(); end if;

  if new.conversation_id is null and new.gym_id is not null then
    identity := coalesce(nullif(new.member_phone, ''), nullif(new.member_name, ''), 'Member');

    select id into conv_id
    from public.conversations
    where gym_id = new.gym_id
      and coalesce(member_phone, member_name) = identity
    limit 1;

    if conv_id is null then
      insert into public.conversations (gym_id, gym_owner_id, member_name, member_phone, last_message_at)
      values (new.gym_id, new.gym_owner_id, coalesce(nullif(new.member_name, ''), 'Member'),
              nullif(new.member_phone, ''), new.created_at)
      returning id into conv_id;
    end if;

    new.conversation_id := conv_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_messages_before_insert on public.messages;
create trigger trg_messages_before_insert
  before insert on public.messages
  for each row execute function public.messages_before_insert();

-- 4b. Split a legacy combined row (member + response) into a separate 'ai' row.
create or replace function public.messages_after_insert_split()
returns trigger
language plpgsql
as $$
begin
  if new.sender = 'member' and new.response is not null and length(trim(new.response)) > 0 then
    insert into public.messages (conversation_id, gym_id, gym_owner_id, sender, content, created_at)
    values (new.conversation_id, new.gym_id, new.gym_owner_id, 'ai', new.response,
            new.created_at + interval '1 millisecond');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_messages_split on public.messages;
create trigger trg_messages_split
  after insert on public.messages
  for each row execute function public.messages_after_insert_split();

-- 4c. Keep conversations.last_message_at fresh for inbox ordering.
create or replace function public.touch_conversation_last_message()
returns trigger
language plpgsql
as $$
begin
  if new.conversation_id is not null then
    update public.conversations
    set last_message_at = greatest(last_message_at, new.created_at)
    where id = new.conversation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_touch_conversation on public.messages;
create trigger trg_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_last_message();

-- ----------------------------------------------------------------------------
-- 5. RLS — owner-scoped access for both tables.
-- ----------------------------------------------------------------------------
alter table public.conversations enable row level security;

drop policy if exists "Owners manage their conversations" on public.conversations;
create policy "Owners manage their conversations"
  on public.conversations
  for all
  to authenticated
  using (
    gym_owner_id = auth.uid()
    or exists (select 1 from public.gym_settings g where g.id = conversations.gym_id and g.gym_owner_id = auth.uid())
  )
  with check (
    gym_owner_id = auth.uid()
    or exists (select 1 from public.gym_settings g where g.id = conversations.gym_id and g.gym_owner_id = auth.uid())
  );

alter table public.messages enable row level security;

drop policy if exists "Owners manage their gym messages" on public.messages;
create policy "Owners manage their gym messages"
  on public.messages
  for all
  to authenticated
  using (
    gym_owner_id = auth.uid()
    or exists (select 1 from public.gym_settings g where g.id = messages.gym_id and g.gym_owner_id = auth.uid())
    or exists (
      select 1 from public.conversations c
      join public.gym_settings g on g.id = c.gym_id
      where c.id = messages.conversation_id and g.gym_owner_id = auth.uid()
    )
  )
  with check (
    gym_owner_id = auth.uid()
    or exists (select 1 from public.gym_settings g where g.id = messages.gym_id and g.gym_owner_id = auth.uid())
    or exists (
      select 1 from public.conversations c
      join public.gym_settings g on g.id = c.gym_id
      where c.id = messages.conversation_id and g.gym_owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 6. Realtime — publish both tables; FULL identity on conversations so the
--    ai_paused UPDATE events carry the full row for client-side filtering.
-- ----------------------------------------------------------------------------
alter table public.conversations replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end$$;
