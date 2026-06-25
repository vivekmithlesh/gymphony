-- =============================================================================
-- 20260710 — Notify owner + member when a payment is SUBMITTED (pending).
-- -----------------------------------------------------------------------------
-- 20260624 already notifies the MEMBER when a payment is APPROVED (status →
-- Success/Paid). This adds the missing "submitted / pending verification" event
-- so the OWNER sees an inbox item the moment a member submits, and the member
-- gets a "we received it" confirmation. Exception-safe: a failed notification
-- never blocks the payment insert. Member rows have gym_owner_id NULL (member
-- feed) and owner rows have member_id NULL (owner feed) so the two never cross.
--
-- Idempotent; safe to re-run.
-- =============================================================================

begin;

create or replace function public.fn_notify_on_payment_submitted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.status, '') = 'pending_verification' then
    begin
      if new.gym_owner_id is not null then
        insert into public.activity_log (gym_owner_id, member_id, activity_type, description, is_read, created_at)
        values (new.gym_owner_id, null, 'payment_submitted',
                'New payment submitted' ||
                  case when new.amount is not null then ' (₹' || trim(to_char(new.amount, 'FM999999990')) || ')' else '' end ||
                  ' — pending your verification.',
                false, now());
      end if;
      if new.member_id is not null then
        insert into public.activity_log (gym_owner_id, member_id, activity_type, description, is_read, created_at)
        values (null, new.member_id, 'payment_submitted',
                'Payment submitted — waiting for the gym to confirm.', false, now());
      end if;
    exception when others then
      null; -- best-effort; never block the payment write
    end;
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_on_payment_submitted on public.payments;
create trigger trg_notify_on_payment_submitted
  after insert on public.payments
  for each row execute function public.fn_notify_on_payment_submitted();

commit;

notify pgrst, 'reload schema';
