-- Preguntas que el dueño le hace a la IA sobre su negocio (máximo 5 por día y negocio)
create table public.preguntas_ia (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  pregunta text not null check (char_length(pregunta) between 1 and 300),
  respuesta text not null,
  created_at timestamptz not null default now()
);
create index preguntas_ia_negocio_fecha_idx on public.preguntas_ia(negocio_id, created_at desc);

alter table public.preguntas_ia enable row level security;
-- Solo ver y agregar: no se pueden borrar ni cambiar (así el límite diario no se puede saltar)
create policy "ver preguntas de mis negocios" on public.preguntas_ia for select to authenticated
  using (privado.es_mi_negocio(negocio_id));
create policy "agregar preguntas a mis negocios" on public.preguntas_ia for insert to authenticated
  with check (privado.es_mi_negocio(negocio_id) and created_at >= now() - interval '1 minute');
