-- Las fotos y audios se borran del almacenamiento después de 1 día; lo leído por la IA se conserva.
alter table public.capturas add column if not exists archivo_borrado boolean not null default false;
create index if not exists capturas_limpieza_idx on public.capturas(created_at) where not archivo_borrado;

-- Historial de cierres de caja: uno por negocio y día
create table public.cierres (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  fecha date not null,
  efectivo_inicial numeric(12,2) not null default 0,
  ventas_contado numeric(12,2) not null default 0,
  abonos numeric(12,2) not null default 0,
  gastos numeric(12,2) not null default 0,
  retiros numeric(12,2) not null default 0,
  esperado numeric(12,2) not null,
  contado numeric(12,2) not null check (contado >= 0),
  diferencia numeric(12,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (negocio_id, fecha)
);
create index cierres_negocio_fecha_idx on public.cierres(negocio_id, fecha desc);

alter table public.cierres enable row level security;
create policy "cierres de mis negocios" on public.cierres for all to authenticated
  using (privado.es_mi_negocio(negocio_id)) with check (privado.es_mi_negocio(negocio_id));
