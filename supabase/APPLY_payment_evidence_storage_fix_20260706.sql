-- =====================================================================
-- APPLY NOW — paste into Supabase Dashboard → SQL Editor → Run.
-- Fixes: "new row violates row-level security policy" when uploading the
-- platform QR (Admin → Payment settings) and any payment proof.
-- Idempotent — safe to run more than once.
-- Mirror of migration 20260706_payment_evidence_storage_fix.sql.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('payment-evidence', 'payment-evidence', true)
on conflict (id) do update set public = true;

drop policy if exists "payment_evidence_insert"          on storage.objects;
drop policy if exists "Public read payment evidence"     on storage.objects;
drop policy if exists "Owners upload payment evidence"    on storage.objects;
drop policy if exists "Owners update payment evidence"    on storage.objects;
drop policy if exists "Owners delete payment evidence"    on storage.objects;

create policy "Public read payment evidence"
  on storage.objects for select
  using ( bucket_id = 'payment-evidence' );

create policy "Owners upload payment evidence"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-evidence'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Owners update payment evidence"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'payment-evidence'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'payment-evidence'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Owners delete payment evidence"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'payment-evidence'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

notify pgrst, 'reload schema';

-- Verify (optional): should return 4 rows.
-- select policyname from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
--   and policyname ilike '%payment evidence%';
