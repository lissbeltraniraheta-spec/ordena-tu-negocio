-- Cierre de caja de varios días: "fecha" es el último día del cierre y "fecha_desde" el primero.
-- Si fecha_desde es null, el cierre es de un solo día (los cierres ya guardados quedan igual).
alter table public.cierres add column if not exists fecha_desde date;
alter table public.cierres add constraint cierres_rango_valido check (fecha_desde is null or fecha_desde <= fecha);
