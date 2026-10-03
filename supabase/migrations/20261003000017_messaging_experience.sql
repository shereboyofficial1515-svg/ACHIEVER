-- =====================================================================
-- ACHIEVER — messaging experience: replies, edits, delete for everyone /
-- for me, reactions, pinned messages, announcements, delivery receipts,
-- mute, clear chat, blocking, group chat permissions and abuse reports.
--
-- Rules that protect members are enforced here (post_message and the
-- services that call these tables), never only in the app.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Messages
-- ---------------------------------------------------------------------
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('text','attachment','system','call','announcement'));
alter table public.messages
  add column reply_to_id uuid references public.messages(id) on delete set null,
  add column edited_at   timestamptz,
  add column deleted_by  uuid references public.profiles(id);
create index messages_reply_idx on public.messages (reply_to_id) where reply_to_id is not null;
create index messages_body_search_idx on public.messages using gin (to_tsvector('simple', coalesce(body, '')));

-- One reaction per member per message (changing it replaces it).
create table public.message_reactions (
  message_id      uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  emoji           text not null check (char_length(emoji) between 1 and 16),
  created_at      timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index message_reactions_conversation_idx on public.message_reactions (conversation_id);

-- "Delete for me": hidden only for that member.
create table public.message_hidden (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table public.conversation_pins (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id      uuid not null references public.messages(id) on delete cascade,
  pinned_by       uuid references public.profiles(id),
  pinned_at       timestamptz not null default now(),
  primary key (conversation_id, message_id)
);

-- ---------------------------------------------------------------------
-- 2. Per-member state: delivery, mute, clear chat, selected permissions
-- ---------------------------------------------------------------------
alter table public.conversation_members
  add column last_delivered_at  timestamptz,
  add column muted_until        timestamptz,
  add column cleared_at         timestamptz,
  add column can_pin            boolean not null default false,
  add column can_change_picture boolean not null default false;

-- ---------------------------------------------------------------------
-- 3. Group chat permissions (configured by the group administrator)
-- ---------------------------------------------------------------------
alter table public.conversations
  add column description text check (char_length(description) <= 500),
  add column settings jsonb not null default '{
    "send": "all", "announce": "admins", "pin": "admins", "change_picture": "admins", "edit_info": "admins",
    "add_members": "admins", "invite": "admins", "remove_members": "admins", "member_list": "all", "show_online": "all"
  }'::jsonb,
  add constraint conversations_settings_object check (jsonb_typeof(settings) = 'object');

create or replace function public.chat_setting(c conversations, p_key text) returns text
language sql immutable as $$
  select coalesce(c.settings ->> p_key, case p_key when 'send' then 'all' when 'member_list' then 'all' when 'show_online' then 'all' else 'admins' end)
$$;

-- OSUSU group rules written by the group administrator (shown on Group Info).
-- (already added by 20260924000007; kept here so a fresh database gets it either way)
alter table public.osusu_groups add column if not exists rules text check (char_length(rules) <= 4000);

-- ---------------------------------------------------------------------
-- 4. Blocking (direct chats)
-- ---------------------------------------------------------------------
create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

-- ---------------------------------------------------------------------
-- 5. Sending: membership, blocks, group send / announcement permissions, replies
-- ---------------------------------------------------------------------
drop function if exists public.post_message(uuid, uuid, text, text, jsonb, jsonb);
create or replace function public.post_message(
  p_conversation_id uuid, p_sender_id uuid, p_kind text, p_body text,
  p_metadata jsonb default '{}'::jsonb, p_attachments jsonb default '[]'::jsonb, p_reply_to uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  c      conversations%rowtype;
  me     conversation_members%rowtype;
  v_other uuid;
begin
  select * into c from conversations where id = p_conversation_id;
  if not found then perform app_error(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found'); end if;
  if p_sender_id is not null then
    select * into me from conversation_members where conversation_id = p_conversation_id and user_id = p_sender_id and left_at is null;
    if not found then perform app_error(403, 'NOT_A_MEMBER', 'You are not a member of this conversation'); end if;
    if c.type = 'group' then
      if chat_setting(c, 'send') = 'admins' and me.role <> 'admin' then
        perform app_error(403, 'ADMINS_ONLY', 'Only group admins can send messages in this group');
      end if;
      if p_kind = 'announcement' and me.role <> 'admin' then
        perform app_error(403, 'ADMINS_ONLY', 'Only group admins can post announcements');
      end if;
    elsif p_kind = 'announcement' then
      perform app_error(400, 'NOT_A_GROUP', 'Announcements are for group chats');
    end if;
    if c.type <> 'group' then
      select user_id into v_other from conversation_members where conversation_id = p_conversation_id and user_id <> p_sender_id limit 1;
      if exists (select 1 from user_blocks where (blocker_id = p_sender_id and blocked_id = v_other) or (blocker_id = v_other and blocked_id = p_sender_id)) then
        perform app_error(403, 'BLOCKED', 'You cannot send messages in this chat');
      end if;
    end if;
  end if;
  if p_reply_to is not null and not exists (select 1 from messages where id = p_reply_to and conversation_id = p_conversation_id) then
    perform app_error(400, 'INVALID_REPLY', 'You can only reply to a message in this chat');
  end if;

  insert into messages (conversation_id, sender_id, kind, body, metadata, reply_to_id)
  values (p_conversation_id, p_sender_id, p_kind, p_body, coalesce(p_metadata, '{}'::jsonb), p_reply_to)
  returning id into v_id;
  insert into message_attachments (message_id, conversation_id, storage_path, file_name, mime_type, size_bytes)
  select v_id, p_conversation_id, x ->> 'storage_path', x ->> 'file_name', x ->> 'mime_type', (x ->> 'size_bytes')::int
    from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) x;
  update conversations set last_message_at = now() where id = p_conversation_id;
  if p_sender_id is not null then
    update conversation_members set last_read_at = now(), last_delivered_at = now()
     where conversation_id = p_conversation_id and user_id = p_sender_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. Conversation list: mute state, cleared chats, deleted messages
-- ---------------------------------------------------------------------
drop function if exists public.conversation_summaries(uuid);
create or replace function public.conversation_summaries(p_user_id uuid)
returns table (
  conversation_id uuid, type text, title text, osusu_group_id uuid, collector_saver_id uuid,
  last_message_at timestamptz, last_message_body text, last_message_kind text, last_sender_id uuid,
  unread_count bigint, member_count bigint, other_user_id uuid, other_user_name text,
  other_user_avatar text, other_user_last_seen timestamptz, muted_until timestamptz, group_image text, last_message_deleted boolean
)
language sql stable security definer set search_path = public as $$
  select c.id, c.type, coalesce(c.title, g.name, other.full_name), c.osusu_group_id, c.collector_saver_id,
         coalesce(c.last_message_at, c.created_at), lm.body, lm.kind, lm.sender_id,
         coalesce(u.unread, 0), coalesce(mc.n, 0), other.id, other.full_name, other.avatar_path, other.last_seen_at,
         cm.muted_until, g.image_path, lm.deleted_at is not null
    from conversation_members cm
    join conversations c on c.id = cm.conversation_id
    left join osusu_groups g on g.id = c.osusu_group_id
    left join lateral (
      select m.body, m.kind, m.sender_id, m.deleted_at from messages m
       where m.conversation_id = c.id
         and m.created_at > coalesce(cm.cleared_at, '-infinity'::timestamptz)
         and not exists (select 1 from message_hidden h where h.message_id = m.id and h.user_id = p_user_id)
       order by m.created_at desc limit 1) lm on true
    left join lateral (
      select p.id, p.full_name, p.avatar_path, p.last_seen_at from conversation_members o
        join profiles p on p.id = o.user_id
       where o.conversation_id = c.id and o.user_id <> p_user_id and c.type <> 'group' limit 1) other on true
    left join lateral (
      select count(*) as unread from messages m
       where m.conversation_id = c.id and m.deleted_at is null
         and m.created_at > greatest(coalesce(cm.last_read_at, 'epoch'::timestamptz), coalesce(cm.cleared_at, 'epoch'::timestamptz))
         and m.sender_id is distinct from p_user_id) u on true
    left join lateral (
      select count(*) as n from conversation_members x where x.conversation_id = c.id and x.left_at is null) mc on true
   where cm.user_id = p_user_id and cm.left_at is null
   order by coalesce(c.last_message_at, c.created_at) desc
$$;

-- ---------------------------------------------------------------------
-- 7. Reports go to the support queue
-- ---------------------------------------------------------------------
alter table public.support_tickets drop constraint if exists support_tickets_category_check;
alter table public.support_tickets add constraint support_tickets_category_check check (category in (
  'incorrect_payment','missing_contribution','incorrect_balance','payout_issue','collector_issue','bill_payment_issue',
  'unauthorized_activity','missing_payout','incorrect_contribution','fake_payment','failed_withdrawal',
  'collector_settlement','account_takeover','suspected_fraud','abuse_report','other'));

-- Voice notes, short videos and office documents in chats (still private, 10 MB, type checked by content).
update storage.buckets set allowed_mime_types = array[
  'image/jpeg','image/png','image/webp','application/pdf',
  'audio/webm','audio/ogg','audio/mp4','audio/mpeg','video/mp4','video/webm',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
 where id = 'message-attachments';

-- ---------------------------------------------------------------------
-- 8. Access: members read; only the API (service role) writes
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['message_reactions','message_hidden','conversation_pins','user_blocks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
create policy message_reactions_member_read on public.message_reactions for select to authenticated using (public.is_conversation_member(conversation_id));
create policy message_hidden_own on public.message_hidden for select to authenticated using (user_id = auth.uid());
create policy conversation_pins_member_read on public.conversation_pins for select to authenticated using (public.is_conversation_member(conversation_id));
create policy user_blocks_own on public.user_blocks for select to authenticated using (blocker_id = auth.uid());

revoke execute on function public.post_message(uuid, uuid, text, text, jsonb, jsonb, uuid), public.conversation_summaries(uuid), public.chat_setting(conversations, text)
  from public, anon, authenticated;
grant execute on function public.post_message(uuid, uuid, text, text, jsonb, jsonb, uuid), public.conversation_summaries(uuid), public.chat_setting(conversations, text)
  to service_role;
