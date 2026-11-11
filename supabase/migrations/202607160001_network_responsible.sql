alter table public.capture_sessions
add column if not exists network_responsible jsonb;

alter table public.records
add column if not exists network_responsible jsonb;

create index if not exists capture_sessions_network_responsible_idx
on public.capture_sessions using gin (network_responsible);

create index if not exists records_network_responsible_idx
on public.records using gin (network_responsible);
