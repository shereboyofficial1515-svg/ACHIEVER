-- =====================================================================
-- ACHIEVER database tests: messaging rules enforced by the database.
-- Run with:  supabase test db   (everything is rolled back)
-- =====================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('70000000-0000-0000-0000-0000000000a1', 'chat.admin@test.ng'),
  ('70000000-0000-0000-0000-0000000000a2', 'chat.member@test.ng'),
  ('70000000-0000-0000-0000-0000000000a3', 'chat.outsider@test.ng');
select create_profile_with_roles('70000000-0000-0000-0000-0000000000a1', 'Chat Admin', 'chat.admin@test.ng', '+2348010000701', 'osusu', array['OSUSU_ADMIN','OSUSU_MEMBER']);
select create_profile_with_roles('70000000-0000-0000-0000-0000000000a2', 'Chat Member', 'chat.member@test.ng', '+2348010000702', 'osusu', array['OSUSU_MEMBER']);
select create_profile_with_roles('70000000-0000-0000-0000-0000000000a3', 'Chat Outsider', 'chat.outsider@test.ng', '+2348010000703', 'osusu', array['OSUSU_MEMBER']);

insert into osusu_groups (id, name, admin_id, contribution_amount, frequency, max_members, start_date, join_code)
values ('71000000-0000-0000-0000-000000000001', 'Chat Circle', '70000000-0000-0000-0000-0000000000a1', 1000000, 'weekly', 5, current_date, 'CHATCIRC');
insert into conversations (id, type, osusu_group_id, title, created_by, direct_key)
values ('72000000-0000-0000-0000-000000000001', 'group', '71000000-0000-0000-0000-000000000001', 'Chat Circle', '70000000-0000-0000-0000-0000000000a1', null),
       ('72000000-0000-0000-0000-000000000002', 'direct', null, null, '70000000-0000-0000-0000-0000000000a1', 'a1:a2');
insert into conversation_members (conversation_id, user_id, role) values
  ('72000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000a1', 'admin'),
  ('72000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000a2', 'member'),
  ('72000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-0000000000a1', 'member'),
  ('72000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-0000000000a2', 'member');

select ok(post_message('72000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000a2', 'text', 'Hello all') is not null, 'members can send when the group allows everyone');
select throws_like($$ select post_message('72000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000a3', 'text', 'let me in') $$, '%NOT_A_MEMBER%', 'non-members cannot send');
select throws_like($$ select post_message('72000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000a2', 'announcement', 'Pay now') $$, '%ADMINS_ONLY%', 'only admins post announcements');
select ok(post_message('72000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000a1', 'announcement', 'Contribution due Friday') is not null, 'admin posts an announcement');

update conversations set settings = settings || '{"send":"admins"}' where id = '72000000-0000-0000-0000-000000000001';
select throws_like($$ select post_message('72000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000a2', 'text', 'can I talk?') $$, '%ADMINS_ONLY%', 'admins-only groups refuse member messages');
select ok(post_message('72000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000a1', 'text', 'Admins only for now') is not null, 'admins can still send');
update conversations set settings = settings || '{"send":"all"}' where id = '72000000-0000-0000-0000-000000000001';

create temp table firstmsg as select id from messages where conversation_id = '72000000-0000-0000-0000-000000000001' and body = 'Hello all';
select ok(post_message('72000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000a1', 'text', 'Hi!', '{}', '[]', (select id from firstmsg)) is not null, 'replies to a message in the same chat');
select throws_like($$ select post_message('72000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-0000000000a1', 'text', 'x', '{}', '[]', (select id from firstmsg)) $$,
  '%INVALID_REPLY%', 'cannot reply to a message from another chat');

select ok(post_message('72000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-0000000000a1', 'text', 'Private hello') is not null, 'direct message sends');
insert into user_blocks (blocker_id, blocked_id) values ('70000000-0000-0000-0000-0000000000a2', '70000000-0000-0000-0000-0000000000a1');
select throws_like($$ select post_message('72000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-0000000000a1', 'text', 'are you there?') $$, '%BLOCKED%', 'a blocked person cannot message you');
select throws_like($$ select post_message('72000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-0000000000a2', 'text', 'bye') $$, '%BLOCKED%', 'and you cannot message someone you blocked');
delete from user_blocks;

-- Conversation list: mute and clear chat
update conversation_members set muted_until = now() + interval '8 hours' where conversation_id = '72000000-0000-0000-0000-000000000002' and user_id = '70000000-0000-0000-0000-0000000000a2';
select ok((select muted_until is not null from conversation_summaries('70000000-0000-0000-0000-0000000000a2') where conversation_id = '72000000-0000-0000-0000-000000000002'), 'mute state appears in the list');
select ok((select unread_count > 0 from conversation_summaries('70000000-0000-0000-0000-0000000000a2') where conversation_id = '72000000-0000-0000-0000-000000000002'), 'unread before clearing');
update conversation_members set cleared_at = now() + interval '1 second', last_read_at = null where conversation_id = '72000000-0000-0000-0000-000000000002' and user_id = '70000000-0000-0000-0000-0000000000a2';
select is((select unread_count from conversation_summaries('70000000-0000-0000-0000-0000000000a2') where conversation_id = '72000000-0000-0000-0000-000000000002'), 0::bigint, 'clearing a chat clears its unread count for that member only');

select * from finish();
rollback;
