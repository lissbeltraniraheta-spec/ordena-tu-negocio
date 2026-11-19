-- Nombre del proveedor en las compras (opcional)
alter table public.movimientos add column if not exists proveedor text check (proveedor is null or char_length(proveedor) <= 80);
