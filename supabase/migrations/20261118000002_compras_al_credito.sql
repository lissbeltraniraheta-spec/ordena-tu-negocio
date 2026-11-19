-- Compras al crédito: mercadería que se recibe hoy y se le paga al proveedor después.
-- No sale dinero de la caja, por eso es un tipo distinto de "compra" (al contado).
alter table public.movimientos drop constraint movimientos_tipo_check;
alter table public.movimientos add constraint movimientos_tipo_check
  check (tipo in ('contado','fiado','abono','gasto','retiro','compra','compra_credito'));
