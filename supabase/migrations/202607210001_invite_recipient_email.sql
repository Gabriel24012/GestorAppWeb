alter table public.manager_invites
add column if not exists recipient_email text;

alter table public.capturer_invites
add column if not exists recipient_email text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'manager_invites_recipient_email_check'
  ) then
    alter table public.manager_invites
    add constraint manager_invites_recipient_email_check
    check (recipient_email is null or recipient_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'capturer_invites_recipient_email_check'
  ) then
    alter table public.capturer_invites
    add constraint capturer_invites_recipient_email_check
    check (recipient_email is null or recipient_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
  end if;
end $$;
