-- Atomic payment RPCs — replace the old insert-then-separately-update flow.

-- Record a payment and atomically advance billing status.
-- Never downgrades an already-paid invoice.
create or replace function public.record_payment(
  p_invoice_id uuid,
  p_amount     numeric,
  p_created_by uuid,
  p_payment_date date default current_date,
  p_reference  text default null,
  p_notes      text default null
) returns text
language plpgsql
set search_path to 'public'
as $$
declare
  v_total numeric;
  v_status text;
  v_paid numeric;
  v_new_status text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be positive';
  end if;

  insert into payments (invoice_id, amount, payment_date, reference_number, notes, created_by)
  values (p_invoice_id, p_amount, coalesce(p_payment_date, current_date), p_reference, p_notes, p_created_by);

  select total, status into v_total, v_status from invoices where id = p_invoice_id;
  select coalesce(sum(amount), 0) into v_paid from payments where invoice_id = p_invoice_id;

  v_new_status := case
    when v_status = 'paid' then 'paid'
    when v_paid >= v_total then 'paid'
    else 'partial'
  end;

  update invoices set status = v_new_status where id = p_invoice_id;
  return v_new_status;
end;
$$;

-- Mark an invoice paid, creating a balancing payment for the outstanding amount
-- so sum(payments) always reconciles with the 'paid' status (the money-model fix).
create or replace function public.mark_invoice_paid(
  p_invoice_id uuid,
  p_created_by uuid,
  p_reference  text default null
) returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_total numeric;
  v_paid numeric;
  v_outstanding numeric;
begin
  select total into v_total from invoices where id = p_invoice_id;
  select coalesce(sum(amount), 0) into v_paid from payments where invoice_id = p_invoice_id;
  v_outstanding := greatest(coalesce(v_total, 0) - v_paid, 0);

  if v_outstanding > 0 then
    insert into payments (invoice_id, amount, payment_date, reference_number, notes, created_by)
    values (p_invoice_id, v_outstanding, current_date, p_reference, 'Marked as paid', p_created_by);
  end if;

  update invoices set status = 'paid' where id = p_invoice_id;
end;
$$;
