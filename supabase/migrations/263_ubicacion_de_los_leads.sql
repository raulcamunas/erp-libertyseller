-- ============================================================================
-- 263 · EN QUÉ COMUNIDAD AUTÓNOMA ESTÁ CADA LEAD (para avisar de los festivos)
-- ============================================================================
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE.
-- NO borra, NO renombra y NO reescribe ninguna fila existente: solo añade cinco columnas VACÍAS a `cold_leads`, un índice, un disparador y una función.
--
-- POR QUÉ. El lunes 2 de noviembre es festivo en nueve comunidades y en las otras diez no. Un comercial que llama a una tienda de Madrid un día festivo en Madrid pierde
-- la llamada; uno que la deja para otro día porque «cree» que es festivo y en Barcelona no lo es, pierde un día. Para avisar en cada lead hace falta saber en qué
-- comunidad está, y los leads lo traen escrito de mil maneras: la ciudad, la provincia de Amazon («BARCELONA», «CATALUÑA», «MOLINA DE SEGURA»), la dirección con su
-- código postal, el Registro Mercantil, un teléfono fijo.
--
-- El localizador (lib/ubicacion/resolver.ts, con sus pruebas) lee todo eso y lo deja en estas columnas. NO lo hace esta migración: lo hace el proceso automático
-- «Ubicación de los leads» (cron, cada 2 minutos), que en cuanto esta migración esté lanzada empieza SOLO por los 35.000 leads que hay —unos 100 por segundo, para no
-- cargar el tiempo real: unos 12 minutos en total— y después ubica cada lead nuevo o cuya ciudad, provincia, dirección, registro, teléfono o web cambie. Hasta entonces las columnas están vacías
-- y la app funciona exactamente igual que antes (sin avisos de festivos).
--
-- Las fiestas en sí NO están en la base de datos: son los calendarios del BOE (lib/festivos/datos/, generados con scripts/festivos-desde-boe.py). Se cambian una vez al
-- año, en octubre, cuando el BOE publica el del año siguiente.
--
--
-- ============ LAS COLUMNAS ===================================================
--
--   ccaa                    La comunidad autónoma o ciudad autónoma, con su código ISO 3166-2:ES: AN AR AS CB CE CL CM CN CT EX GA IB MC MD ME NC PV RI VC.
--                           NULL = no se ha podido saber (el lead no trae ninguna pista). NO se inventa.
--   municipio_ine           El municipio, con su código del INE (cinco dígitos: 28079 es Madrid), si se ha podido saber. Hace falta para las fiestas de las islas
--                           de Canarias y del Valle de Arán (y las locales, si algún día se cargan).
--   ubicacion_origen        De qué campo salió: ciudad · direccion · provincia · registro · telefono · web.
--   ubicacion_confianza     alta (lo dice el propio lead: ciudad, código postal, provincia) · media (el Registro Mercantil: la empresa puede operar en otro sitio) ·
--                           baja (el prefijo de un teléfono fijo o la terminación .cat/.gal/.eus de la web).
--   ubicacion_calculada_at  Cuándo se calculó. NULL = pendiente: el proceso automático la coge. Un lead sin ninguna pista también se sella (con ccaa NULL), para no
--                           volver a mirarlo cada vez.
--
-- Si cambian la ciudad, la provincia, la dirección, el registro, el teléfono o la web de un lead, un disparador pone `ubicacion_calculada_at` a NULL y el proceso
-- lo vuelve a ubicar. Un lead nuevo ya nace con NULL.
--
--
-- ============ CÓMO COMPROBAR QUE FUNCIONA ====================================
--
--   -- cuántos quedan por ubicar (baja a cero en unos minutos; 0 al final)
--   select count(*) from public.cold_leads where ubicacion_calculada_at is null;
--
--   -- cómo ha quedado el reparto (comunidad · de dónde sale)
--   select ccaa, ubicacion_origen, count(*) from public.cold_leads group by 1, 2 order by 3 desc;
--
-- ============================================================================

alter table public.cold_leads add column if not exists ccaa text;
alter table public.cold_leads add column if not exists municipio_ine text;
alter table public.cold_leads add column if not exists ubicacion_origen text;
alter table public.cold_leads add column if not exists ubicacion_confianza text;
alter table public.cold_leads add column if not exists ubicacion_calculada_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cold_leads_ccaa_valida') then
    alter table public.cold_leads add constraint cold_leads_ccaa_valida
      check (ccaa is null or ccaa in ('AN','AR','AS','CB','CE','CL','CM','CN','CT','EX','GA','IB','MC','MD','ME','NC','PV','RI','VC'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cold_leads_municipio_ine_valido') then
    alter table public.cold_leads add constraint cold_leads_municipio_ine_valido
      check (municipio_ine is null or municipio_ine ~ '^[0-9]{5}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cold_leads_ubicacion_origen_valido') then
    alter table public.cold_leads add constraint cold_leads_ubicacion_origen_valido
      check (ubicacion_origen is null or ubicacion_origen in ('ciudad','direccion','provincia','registro','telefono','web'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cold_leads_ubicacion_confianza_valida') then
    alter table public.cold_leads add constraint cold_leads_ubicacion_confianza_valida
      check (ubicacion_confianza is null or ubicacion_confianza in ('alta','media','baja'));
  end if;
end $$;

-- Solo los pendientes: el proceso automático los lee por aquí y el índice se queda diminuto cuando no queda ninguno
create index if not exists cold_leads_sin_ubicar_idx on public.cold_leads (id) where ubicacion_calculada_at is null;

-- Si cambia algo de lo que sirve para ubicar el lead, hay que volver a ubicarlo
create or replace function public.marcar_ubicacion_de_lead_pendiente()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.ciudad is not distinct from old.ciudad
     and new.province is not distinct from old.province
     and new.business_address is not distinct from old.business_address
     and new.mercantile_registry is not distinct from old.mercantile_registry
     and new.phone is not distinct from old.phone
     and new.web is not distinct from old.web then
    return new;
  end if;
  new.ubicacion_calculada_at := null;
  return new;
end;
$$;

drop trigger if exists cold_leads_marcar_ubicacion on public.cold_leads;
create trigger cold_leads_marcar_ubicacion
  before update of ciudad, province, business_address, mercantile_registry, phone, web on public.cold_leads
  for each row
  execute function public.marcar_ubicacion_de_lead_pendiente();

-- Lo que usa el proceso automático para guardar un lote entero de una vez (hasta unos cientos de leads por llamada). Solo la clave de servicio puede llamarla.
create or replace function public.poner_ubicaciones_de_leads(filas jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cuantos integer;
begin
  with f as (
    select * from jsonb_to_recordset(filas) as x(id uuid, ccaa text, municipio_ine text, origen text, confianza text)
  ), u as (
    update public.cold_leads l
       set ccaa = f.ccaa,
           municipio_ine = f.municipio_ine,
           ubicacion_origen = f.origen,
           ubicacion_confianza = f.confianza,
           ubicacion_calculada_at = now()
      from f
     where l.id = f.id
    returning 1
  )
  select count(*) into cuantos from u;
  return coalesce(cuantos, 0);
end;
$$;

revoke all on function public.poner_ubicaciones_de_leads(jsonb) from public, anon, authenticated;
grant execute on function public.poner_ubicaciones_de_leads(jsonb) to service_role;

-- Que PostgREST vea las columnas y la función nuevas sin esperar
notify pgrst, 'reload schema';
