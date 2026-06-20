-- =====================================================================
-- 20260706 — Fix payment-evidence storage RLS (uploads were rejected).
-- =====================================================================
-- Symptom: uploading the platform QR (admin) and payment proof (owner /
-- member / international) all failed with
--   "new row violates row-level security policy".
--
-- Root cause: the payment-evidence bucket + its INSERT policy were created
-- in 20260626_payment_hardening.sql inside a `do $$ ... exception when
-- others then null` block. If any statement in that block raised on the
-- live DB, the WHOLE block was swallowed — leaving the bucket with RLS on
-- but NO usable policy, so every authenticated upload is denied.
--
-- This migration re-creates the bucket and ALL four policies directly,
-- WITHOUT swallowing errors, mirroring the proven inventory-items bucket
-- (20260603_inventory_products.sql). It is idempotent: safe to re-run.
--
-- Policy model: bucket is public (anyone can read via the public URL);
-- authenticated users may write only inside their own `${auth.uid()}/...`
-- folder — which is exactly the path every uploader uses:
--   admin QR  -> `${uid}/platform-qr-*.png`
--   owner sub -> `${uid}/sub-*`
--   intl      -> `${uid}/intl-*`
--   member    -> `${member_id}/*`   (member_id == that member's auth uid)
-- =====================================================================

-- 1. Bucket (public read). Force public in case it already exists private.
insert into storage.buckets (id, name, public)
values ('payment-evidence', 'payment-evidence', true)
on conflict (id) do update set public = true;

-- 2. Drop every prior payment-evidence policy (old swallowed one + reruns).
drop policy if exists "payment_evidence_insert"          on storage.objects;
drop policy if exists "Public read payment evidence"     on storage.objects;
drop policy if exists "Owners upload payment evidence"    on storage.objects;
drop policy if exists "Owners update payment evidence"    on storage.objects;
drop policy if exists "Owners delete payment evidence"    on storage.objects;

-- 3. Recreate cleanly.
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
