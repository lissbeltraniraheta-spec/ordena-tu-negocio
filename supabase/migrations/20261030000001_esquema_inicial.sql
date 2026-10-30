-- Negocios: cada usuario tiene uno o más negocios
create table public.negocios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 80),
  efectivo_inicial numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index negocios_owner_idx on public.negocios(owner_id);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 80),
  telefono text,
  created_at timestamptz not null default now()
);
create index clientes_negocio_idx on public.clientes(negocio_id);

-- Fotos del cuaderno y notas de voz procesadas con IA
create table public.capturas (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  tipo text not null check (tipo in ('foto','audio')),
  archivo_path text not null,
  mime text,
  estado text not null default 'pendiente' check (estado in ('pendiente','procesada','error')),
  transcripcion text,
  resultado jsonb,
  error text,
  created_at timestamptz not null default now()
);
create index capturas_negocio_idx on public.capturas(negocio_id);

create table public.movimientos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  fecha date not null default (now() at time zone 'America/El_Salvador')::date,
  hora time not null default (now() at time zone 'America/El_Salvador')::time,
  tipo text not null check (tipo in ('contado','fiado','abono','gasto','retiro')),
  descripcion text not null check (char_length(descripcion) between 1 and 120),
  monto numeric(12,2) not null check (monto > 0),
  cliente_id uuid references public.clientes(id) on delete set null,
  origen text not null default 'manual' check (origen in ('manual','foto','audio')),
  captura_id uuid references public.capturas(id) on delete set null,
  created_at timestamptz not null default now()
);
create index movimientos_negocio_fecha_idx on public.movimientos(negocio_id, fecha);
create index movimientos_cliente_idx on public.movimientos(cliente_id);
create index movimientos_captura_idx on public.movimientos(captura_id);

-- Función de pertenencia, en un esquema que la API no expone
create schema if not exists privado;
revoke all on schema privado from public, anon;
grant usage on schema privado to authenticated;

create or replace function privado.es_mi_negocio(nid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.negocios n where n.id = nid and n.owner_id = (select auth.uid())) $$;
revoke execute on function privado.es_mi_negocio(uuid) from anon, public;
grant execute on function privado.es_mi_negocio(uuid) to authenticated;

alter table public.negocios enable row level security;
alter table public.clientes enable row level security;
alter table public.capturas enable row level security;
alter table public.movimientos enable row level security;

create policy "negocios propios" on public.negocios for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "clientes de mis negocios" on public.clientes for all to authenticated
  using (privado.es_mi_negocio(negocio_id)) with check (privado.es_mi_negocio(negocio_id));
create policy "capturas de mis negocios" on public.capturas for all to authenticated
  using (privado.es_mi_negocio(negocio_id)) with check (privado.es_mi_negocio(negocio_id));
create policy "movimientos de mis negocios" on public.movimientos for all to authenticated
  using (privado.es_mi_negocio(negocio_id)) with check (privado.es_mi_negocio(negocio_id));

-- Saldo de fiados por cliente (respeta RLS de quien consulta)
create view public.saldos_clientes with (security_invoker = true) as
select c.id, c.negocio_id, c.nombre, c.telefono,
  coalesce(sum(case when m.tipo = 'fiado' then m.monto when m.tipo = 'abono' then -m.monto end), 0)::numeric(12,2) as saldo,
  max(m.fecha) filter (where m.tipo = 'abono') as ultimo_abono,
  min(m.fecha) filter (where m.tipo = 'fiado') as primer_fiado
from public.clientes c
left join public.movimientos m on m.cliente_id = c.id
group by c.id;

-- Totales por mes y tipo (cierre de mes y expediente)
create view public.resumen_mensual with (security_invoker = true) as
select negocio_id, date_trunc('month', fecha)::date as mes, tipo,
  sum(monto)::numeric(14,2) as total, count(*)::int as cantidad
from public.movimientos
group by negocio_id, date_trunc('month', fecha), tipo;

-- Almacenamiento privado de fotos y audios: primera carpeta = id del negocio
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('capturas', 'capturas', false, 15728640,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','audio/ogg','audio/opus','audio/mpeg','audio/mp4','audio/m4a','audio/x-m4a','audio/aac','audio/wav','audio/x-wav','audio/webm','audio/amr','audio/3gpp','video/mp4','application/ogg']);

create policy "leer capturas propias" on storage.objects for select to authenticated
  using (bucket_id = 'capturas' and privado.es_mi_negocio(((storage.foldername(name))[1])::uuid));
create policy "subir capturas propias" on storage.objects for insert to authenticated
  with check (bucket_id = 'capturas' and privado.es_mi_negocio(((storage.foldername(name))[1])::uuid));
create policy "borrar capturas propias" on storage.objects for delete to authenticated
  using (bucket_id = 'capturas' and privado.es_mi_negocio(((storage.foldername(name))[1])::uuid));
