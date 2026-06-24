-- Allow a Super-Admin void-restore (clearing voided_at) ONLY when the action sets
-- the transaction-local flag app.allow_invoice_restore = 'on'. Every other update
-- path still hits the original block, preserving the "voided is terminal" rule for
-- the normal application. Supersedes 20260624104409_prevent_invoice_restore.sql.
create or replace function public.prevent_invoice_restore()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.voided_at is not null and new.voided_at is null then
    if coalesce(current_setting('app.allow_invoice_restore', true), 'off') <> 'on' then
      raise exception 'Voided invoices cannot be restored'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- Trigger definition unchanged (still BEFORE UPDATE OF voided_at), just re-pointing
-- at the updated function body above for clarity / idempotency.
drop trigger if exists invoices_prevent_restore on public.invoices;
create trigger invoices_prevent_restore
before update of voided_at on public.invoices
for each row
execute function public.prevent_invoice_restore();

-- SECURITY DEFINER RPC the void-restore action calls: it flips the flag and clears
-- the void in one transaction. Locked down so only the service role can execute it.
create or replace function public.admin_restore_void(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.allow_invoice_restore', 'on', true);
  update public.invoices
     set voided_at = null, voided_by = null, void_reason = null
   where id = p_id;
end;
$$;

revoke all on function public.admin_restore_void(uuid) from public, anon, authenticated;
