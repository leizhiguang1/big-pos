-- Voided invoices are terminal. The application no longer exposes restore,
-- and this trigger prevents future service-role writes from clearing the
-- soft-delete marker after it has been set.

create or replace function public.prevent_invoice_restore()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.voided_at is not null and new.voided_at is null then
    raise exception 'Voided invoices cannot be restored'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_prevent_restore on public.invoices;

create trigger invoices_prevent_restore
before update of voided_at on public.invoices
for each row
execute function public.prevent_invoice_restore();
