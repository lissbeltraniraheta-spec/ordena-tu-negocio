-- Nuevo tipo de movimiento: compras de mercadería o producto para vender
alter table public.movimientos drop constraint movimientos_tipo_check;
alter table public.movimientos add constraint movimientos_tipo_check
  check (tipo in ('contado','fiado','abono','gasto','retiro','compra'));

-- El cierre de caja guarda también lo que salió en compras
alter table public.cierres add column if not exists compras numeric(12,2) not null default 0;
