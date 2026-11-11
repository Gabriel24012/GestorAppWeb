alter table public.records
  drop constraint if exists records_birth_date_check;

alter table public.records
  add constraint records_birth_date_reasonable_check
  check (birth_date between (current_date - interval '120 years')::date and current_date)
  not valid;
