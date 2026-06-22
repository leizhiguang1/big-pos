-- Strip the redundant leading "per " from products.unit so values are stored as
-- bare nouns (e.g. "per set" -> "set"). The UI renders "per {unit}" for display.
-- Guarded + idempotent: rows already normalized do not match and are left alone.
update products
set unit = lower(trim(regexp_replace(unit, '^per\s+', '', 'i')))
where unit ~* '^per\s+';
