-- Carry per-line internal remarks (invoice_items.work_note) through the invoice
-- create/update RPCs. The column already exists; previously the RPCs never wrote
-- it, so remarks entered on the billing form were dropped. Both functions now
-- read `work_note` from each item in p_items (empty string -> NULL).
--
-- Whether work_note is shown on the printed invoice is a separate, later UI
-- decision; this migration only ensures the data is persisted.

create or replace function public.create_invoice_with_items(p_invoice jsonb, p_items jsonb)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into invoices (
    customer_id, created_by, invoice_date, due_date, status, notes,
    patient, doctor, service_status_id,
    bill_to_name, bill_to_contact, bill_to_phone, billing_address,
    ship_to_name, ship_to_contact, delivery_address,
    subtotal, total
  ) values (
    (p_invoice->>'customer_id')::uuid,
    (p_invoice->>'created_by')::uuid,
    (p_invoice->>'invoice_date')::date,
    (p_invoice->>'due_date')::date,
    coalesce(p_invoice->>'status', 'draft'),
    p_invoice->>'notes',
    p_invoice->>'patient',
    p_invoice->>'doctor',
    nullif(p_invoice->>'service_status_id', '')::uuid,
    p_invoice->>'bill_to_name',
    p_invoice->>'bill_to_contact',
    p_invoice->>'bill_to_phone',
    p_invoice->>'billing_address',
    p_invoice->>'ship_to_name',
    p_invoice->>'ship_to_contact',
    p_invoice->>'delivery_address',
    coalesce((p_invoice->>'subtotal')::numeric, 0),
    coalesce((p_invoice->>'total')::numeric, 0)
  ) returning id into v_id;

  insert into invoice_items (invoice_id, product_id, description, quantity, unit_price, amount, work_note)
  select v_id,
         nullif(it->>'product_id', '')::uuid,
         it->>'description',
         (it->>'quantity')::numeric,
         (it->>'unit_price')::numeric,
         (it->>'amount')::numeric,
         nullif(it->>'work_note', '')
  from jsonb_array_elements(p_items) as it;

  return v_id;
end;
$function$;

create or replace function public.update_invoice_with_items(p_invoice_id uuid, p_invoice jsonb, p_items jsonb)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
  update invoices set
    customer_id       = (p_invoice->>'customer_id')::uuid,
    invoice_date      = (p_invoice->>'invoice_date')::date,
    due_date          = (p_invoice->>'due_date')::date,
    notes             = p_invoice->>'notes',
    patient           = p_invoice->>'patient',
    doctor            = p_invoice->>'doctor',
    service_status_id = nullif(p_invoice->>'service_status_id', '')::uuid,
    bill_to_name      = p_invoice->>'bill_to_name',
    bill_to_contact   = p_invoice->>'bill_to_contact',
    bill_to_phone     = p_invoice->>'bill_to_phone',
    billing_address   = p_invoice->>'billing_address',
    ship_to_name      = p_invoice->>'ship_to_name',
    ship_to_contact   = p_invoice->>'ship_to_contact',
    delivery_address  = p_invoice->>'delivery_address',
    subtotal          = coalesce((p_invoice->>'subtotal')::numeric, 0),
    total             = coalesce((p_invoice->>'total')::numeric, 0)
  where id = p_invoice_id;

  -- Remove line items the client dropped (kept rows carry their existing id).
  delete from invoice_items
  where invoice_id = p_invoice_id
    and id not in (
      select (it->>'id')::uuid
      from jsonb_array_elements(p_items) as it
      where coalesce(it->>'id', '') <> ''
    );

  -- Update the rows that still have an id.
  update invoice_items ii set
    product_id  = nullif(it->>'product_id', '')::uuid,
    description = it->>'description',
    quantity    = (it->>'quantity')::numeric,
    unit_price  = (it->>'unit_price')::numeric,
    amount      = (it->>'amount')::numeric,
    work_note   = nullif(it->>'work_note', '')
  from jsonb_array_elements(p_items) as it
  where coalesce(it->>'id', '') <> '' and ii.id = (it->>'id')::uuid;

  -- Insert the new rows (no id yet).
  insert into invoice_items (invoice_id, product_id, description, quantity, unit_price, amount, work_note)
  select p_invoice_id,
         nullif(it->>'product_id', '')::uuid,
         it->>'description',
         (it->>'quantity')::numeric,
         (it->>'unit_price')::numeric,
         (it->>'amount')::numeric,
         nullif(it->>'work_note', '')
  from jsonb_array_elements(p_items) as it
  where coalesce(it->>'id', '') = '';
end;
$function$;
