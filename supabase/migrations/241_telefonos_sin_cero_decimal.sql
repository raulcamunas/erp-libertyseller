-- 241 · Teléfonos de los leads sin el «.0» de Excel, y que no vuelva a entrar
--
-- Un teléfono que pasó por una hoja de cálculo como número llega con un decimal pegado: «653476608.0». Mirando la
-- pantalla parece igual, pero al copiarlo y pegarlo en WhatsApp o en Rinkel no se reconoce, y para el enlace con las
-- llamadas de Rinkel es un número de diez cifras, o sea ninguno: a esos leads no se les enlazaba ninguna llamada.
-- El 23 oct 2026 eran 714 de 6.978.
--
-- Qué hace:
--   1. Un disparador en cold_leads (al insertar o al cambiar `phone`) que, SI el teléfono es un número con ceros
--      decimales («653476608.0»), le quita el decimal y, si queda un número español de nueve cifras (o de once con el
--      34), le pone el «+34» delante: «+34653476608», igual que los demás. Es lo que hace que se pueda pegar tal cual en
--      WhatsApp o en Rinkel. Lo que no lleve ese decimal NO se toca (ni «600.112.233», ni «+34 600 11 22 33»).
--      Así, venga la lista de donde venga (importación de Supabase, un script, la pantalla), no vuelve a entrar.
--   2. Una pasada sobre los que ya están: `update ... set phone = phone` dispara el mismo disparador solo en las filas
--      con «.0».
--
-- Seguro de lanzar más de una vez: la segunda no encuentra ninguna fila con «.0».

create or replace function public.limpiar_telefono_de_lead()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  limpio text;
begin
  if new.phone is not null and btrim(new.phone) ~ '^[0-9]+\.0+$' then
    limpio := regexp_replace(btrim(new.phone), '\.0+$', '');
    if limpio ~ '^[6-9][0-9]{8}$' then
      limpio := '+34' || limpio;
    elsif limpio ~ '^34[6-9][0-9]{8}$' then
      limpio := '+' || limpio;
    end if;
    new.phone := limpio;
  end if;
  return new;
end;
$$;

drop trigger if exists cold_leads_limpiar_telefono on public.cold_leads;
create trigger cold_leads_limpiar_telefono
  before insert or update of phone on public.cold_leads
  for each row
  execute function public.limpiar_telefono_de_lead();

-- Los que ya están
update public.cold_leads
   set phone = phone
 where btrim(phone) ~ '^[0-9]+\.0+$';
