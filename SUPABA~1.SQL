-- 아마추어 글쓰기 v14.23 · 공개 책 영구 보관용 테이블
-- Supabase Dashboard > SQL Editor > New query 에 붙여넣고 Run 하세요.
-- 개인정보/관리 키의 해시는 서버가 작성합니다. 웹 브라우저에 비밀 키를 넣지 마세요.
create table if not exists public.writing_room_shelves (
  room_code text primary key,
  state jsonb not null default '{"books":[],"deleted":[]}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint writing_room_shelves_room_code_check
    check (char_length(room_code) between 1 and 18)
);

-- 브라우저의 공개 키로 직접 데이터베이스를 읽지 못하도록 설정.
-- 서버의 Secret key(service_role)만 데이터에 접근합니다.
alter table public.writing_room_shelves enable row level security;
revoke all on table public.writing_room_shelves from anon, authenticated;
grant select, insert, update, delete on table public.writing_room_shelves to service_role;
