-- Stable line-item ordering.
--
-- Problem: invoice_items had no column recording the order lines were entered.
-- The detail/edit queries and the printed doc all ordered by created_at, but
-- every item in an invoice shares the same created_at (now() is constant within
-- the insert transaction) and id is a random uuid — so tied rows fell back to
-- physical heap order. Any UPDATE (e.g. changing work_status) rewrites the row's
-- tuple to a new heap location, so the edited line jumped position. Processed in
-- status order, it looked like the list was sorting itself by work status.
--
-- Fix: add sort_order, populate it from the save payload's array position
-- (WITH ORDINALITY), and order by it. Backfill preserves each existing invoice's
-- current display order (created_at, ctid = original entry / heap order) so no
-- existing invoice reshuffles on deploy.

alter table public.invoice_items
  add column sort_order integer not null default 0;

update public.invoice_items ii
set sort_order = sub.rn
from (
  select id,
         (row_number() over (partition by invoice_id order by created_at, ctid) - 1)::int as rn
  from public.invoice_items
) sub
where ii.id = sub.id;

-- Recreate the save RPCs (latest definitions live in 20260623010000_invoice_sst_tax.sql)
-- with sort_order threaded from the p_items array position. Bodies are otherwise
-- identical to that migration.

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
    subtotal, discount_pct, discount_amount, tax_rate, tax_amount, total
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
    coalesce((p_invoice->>'discount_pct')::numeric, 0),
    coalesce((p_invoice->>'discount_amount')::numeric, 0),
    coalesce((p_invoice->>'tax_rate')::numeric, 0),
    coalesce((p_invoice->>'tax_amount')::numeric, 0),
    coalesce((p_invoice->>'total')::numeric, 0)
  ) returning id into v_id;

  insert into invoice_items (invoice_id, product_id, description, quantity, unit_price, amount, work_note, sort_order)
  select v_id,
         nullif(it->>'product_id', '')::uuid,
         it->>'description',
         (it->>'quantity')::numeric,
         (it->>'unit_price')::numeric,
         (it->>'amount')::numeric,
         nullif(it->>'work_note', ''),
         (ord - 1)::int
  from jsonb_array_elements(p_items) with ordinality as t(it, ord);

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
    discount_pct      = coalesce((p_invoice->>'discount_pct')::numeric, 0),
    discount_amount   = coalesce((p_invoice->>'discount_amount')::numeric, 0),
    tax_rate          = coalesce((p_invoice->>'tax_rate')::numeric, 0),
    tax_amount        = coalesce((p_invoice->>'tax_amount')::numeric, 0),
    total             = coalesce((p_invoice->>'total')::numeric, 0)
  where id = p_invoice_id;

  delete from invoice_items
  where invoice_id = p_invoice_id
    and id not in (
      select (it->>'id')::uuid
      from jsonb_array_elements(p_items) as it
      where coalesce(it->>'id', '') <> ''
    );

  update invoice_items ii set
    product_id  = nullif(it->>'product_id', '')::uuid,
    description = it->>'description',
    quantity    = (it->>'quantity')::numeric,
    unit_price  = (it->>'unit_price')::numeric,
    amount      = (it->>'amount')::numeric,
    work_note   = nullif(it->>'work_note', ''),
    sort_order  = (ord - 1)::int
  from jsonb_array_elements(p_items) with ordinality as t(it, ord)
  where coalesce(it->>'id', '') <> '' and ii.id = (it->>'id')::uuid;

  insert into invoice_items (invoice_id, product_id, description, quantity, unit_price, amount, work_note, sort_order)
  select p_invoice_id,
         nullif(it->>'product_id', '')::uuid,
         it->>'description',
         (it->>'quantity')::numeric,
         (it->>'unit_price')::numeric,
         (it->>'amount')::numeric,
         nullif(it->>'work_note', ''),
         (ord - 1)::int
  from jsonb_array_elements(p_items) with ordinality as t(it, ord)
  where coalesce(it->>'id', '') = '';
end;
$function$;
