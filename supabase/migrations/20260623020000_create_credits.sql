-- Wave 6 — Credits & adjustments (additive entity).
--
-- A credit is a non-payment reduction of a clinic's account: a remake, a return,
-- or a goodwill gesture. It is distinct from a payment (money in) and from a void
-- (cancels an invoice). Because payments are now full-outstanding-only, a credit
-- is NEVER an overpayment sink — it only ever represents remake/return/goodwill.
--
-- Optionally tied to a specific invoice (invoice_id) or left clinic-level (null).
-- Feeds the per-clinic statement ledger and the clinic account balance.
--
-- Security mirrors invoices/payments: RLS read for any authenticated user; NO
-- authenticated write policy. Inserts happen only via the service_role client in
-- a permission-gated server action (RLS-bypassing + code-gated), same as payments.

create table if not exists public.credits (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  invoice_id  uuid references public.invoices(id),
  credit_date date not null default current_date,
  amount      numeric(12,2) not null check (amount > 0),
  reason      text not null check (reason in ('remake', 'return', 'goodwill')),
  notes       text,
  created_by  uuid not null,
  created_at  timestamptz not null default now()
);

create index if not exists credits_customer_id_idx on public.credits (customer_id);
create index if not exists credits_invoice_id_idx  on public.credits (invoice_id);

alter table public.credits enable row level security;

-- Read for any authenticated user (statements / clinic page need it).
create policy credits_read on public.credits for select to authenticated using (true);
-- No authenticated write policy on purpose: credits are written only through the
-- service_role client in a code-gated server action (mirrors invoices/payments).
