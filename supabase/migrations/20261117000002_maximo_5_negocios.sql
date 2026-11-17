-- Cada cuenta puede tener como máximo 5 negocios
create or replace function privado.limite_negocios()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.negocios where owner_id = new.owner_id) >= 5 then
    raise exception 'LIMITE_NEGOCIOS: Solo se permiten 5 negocios por cuenta.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function privado.limite_negocios() from public, anon, authenticated;

create trigger negocios_maximo_5
  before insert on public.negocios
  for each row execute function privado.limite_negocios();
