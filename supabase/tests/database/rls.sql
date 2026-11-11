begin;
select plan(7);

select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'profiles tiene RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.capture_sessions'::regclass), 'capture_sessions tiene RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.records'::regclass), 'records tiene RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.record_versions'::regclass), 'record_versions tiene RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.audit_events'::regclass), 'audit_events tiene RLS');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'records' and policyname = 'records insert own'), 'records limita inserciones al dueño');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'records' and policyname = 'records select scoped'), 'records limita consultas por alcance');

select * from finish();
rollback;
