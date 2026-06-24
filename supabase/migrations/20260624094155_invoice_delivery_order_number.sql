-- Give each invoice its own Delivery Order (D/O) number, independent of the
-- invoice number. Pattern: DO-YYYY-NNNN (parallels INV-YYYY-NNNN).
-- Assigned at invoice creation time via the existing before-insert trigger.

-- 1. Generator: own per-year running sequence, serialized like the invoice one.
CREATE OR REPLACE FUNCTION public.generate_delivery_order_number() RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
DECLARE
  yr text := to_char(CURRENT_DATE, 'YYYY');
  prefix text := 'DO-' || yr || '-';
  next_num int;
BEGIN
  -- Serialize callers within a transaction to prevent races
  PERFORM pg_advisory_xact_lock(hashtext('generate_delivery_order_number'));

  SELECT COALESCE(
    MAX((regexp_replace(delivery_order_number, '^' || prefix, ''))::int),
    0
  ) + 1
  INTO next_num
  FROM invoices
  WHERE delivery_order_number ~ ('^' || prefix || '[0-9]+$');

  RETURN prefix || lpad(next_num::text, 4, '0');
END;
$_$;

GRANT ALL ON FUNCTION public.generate_delivery_order_number() TO anon;
GRANT ALL ON FUNCTION public.generate_delivery_order_number() TO authenticated;
GRANT ALL ON FUNCTION public.generate_delivery_order_number() TO service_role;

-- 2. Column (nullable for now; backfilled then made NOT NULL below).
ALTER TABLE public.invoices ADD COLUMN delivery_order_number text;

-- 3. Backfill existing invoices: per-year sequence ordered by creation.
WITH numbered AS (
  SELECT
    id,
    to_char(invoice_date, 'YYYY') AS yr,
    row_number() OVER (
      PARTITION BY to_char(invoice_date, 'YYYY')
      ORDER BY created_at, id
    ) AS rn
  FROM public.invoices
)
UPDATE public.invoices i
SET delivery_order_number = 'DO-' || n.yr || '-' || lpad(n.rn::text, 4, '0')
FROM numbered n
WHERE i.id = n.id;

-- 4. Enforce presence + uniqueness now that existing rows are populated.
ALTER TABLE public.invoices ALTER COLUMN delivery_order_number SET NOT NULL;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_delivery_order_number_key UNIQUE (delivery_order_number);

-- 5. Auto-assign on insert. Extend the existing before-insert number trigger
--    function so both numbers are set in one place.
CREATE OR REPLACE FUNCTION public.set_invoice_number_default() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.invoice_number := generate_invoice_number();
  END IF;
  IF NEW.delivery_order_number IS NULL OR NEW.delivery_order_number = '' THEN
    NEW.delivery_order_number := generate_delivery_order_number();
  END IF;
  RETURN NEW;
END;
$$;
