-- Fechas de pago para ventas al crédito y compras al crédito (para las alertas de cobro y de pago)
alter table public.movimientos add column if not exists vence date;

-- Pago a proveedor: sale de la caja y deja pagada una compra al crédito (paga_id)
alter table public.movimientos add column if not exists paga_id uuid references public.movimientos(id) on delete cascade;
create index if not exists movimientos_paga_idx on public.movimientos(paga_id) where paga_id is not null;
alter table public.movimientos drop constraint movimientos_tipo_check;
alter table public.movimientos add constraint movimientos_tipo_check
  check (tipo in ('contado','fiado','abono','gasto','retiro','compra','compra_credito','pago_compra'));
