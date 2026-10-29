-- ============================================================================
-- 264 · EL CICLO COMERCIAL DEL LEAD NUEVO (FASE 2, FASE 3 Y «NO RESPONDE»)
-- ============================================================================
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE.
-- NO borra, NO renombra y NO reescribe ninguna fila existente: solo añade DOS columnas VACÍAS a `cold_leads` y un índice. Los 35.067 leads siguen exactamente igual después de pegar esto,
-- y la app funciona igual que antes hasta que se pase algún lead a una lista de ciclo.
--
-- POR QUÉ. Los leads nuevos se van a trabajar con un ritmo fijo (dos toques de llamada; si nadie contesta, el primer correo con seguimientos y el WhatsApp; la rellamada el mismo día que sale cada
-- seguimiento; y si tampoco así, «No responde» y vuelta a los dos meses). Los leads de antes —los que ya están en «No contesta», «Rellamada», «Info enviada»…— NO entran: se quedan en su panel de
-- siempre. Para distinguirlos hace falta marcar a los que sí entran y en qué punto del ritmo van.
--
-- LA FASE NO ES UN ESTADO NUEVO. `status` sigue siendo uno de los siete de siempre y todo lo que lo lee (Rendimiento, el conector, la IA de correos y de WhatsApp, las secuencias, el cierre por
-- «no me interesa») sigue entendiendo lo mismo. Estas dos columnas son una etiqueta que se pone encima (lib/cold-calling/ciclo.ts).
--
--
-- ============ LAS COLUMNAS ===================================================
--
--   ciclo_vuelta   NULL = el lead NO está en el sistema del ciclo (se trabaja como siempre). 1 = primera vuelta; 2 = la que vuelve a empezar a los dos meses de un «No responde»; y así.
--                  Se pone al pasar el lead a una lista de ciclo (scripts/ciclo-pasar-leads.py).
--   ciclo_fase     En qué punto del ritmo va un lead del ciclo mientras nadie contesta:
--                    NULL            Fase 1: «Sin contactar» (los dos toques de llamada). No tiene fase propia.
--                    'f2'            Fase 2: ya salió el primer correo; se rellama el día del seguimiento 1.
--                    'f3'            Fase 3: se rellama el día del seguimiento 2 (el de cierre).
--                    'sin_respuesta' «No responde»: pasó por las dos rellamadas sin contestar; se vuelve a llamar a los 60 días.
--                  La pone el proceso automático «Ciclo comercial» (cron, cada 2 minutos) y se la quita quien saca al lead del ritmo (En seguimiento, Cita agendada, No le interesa…).
--                  Solo tiene sentido con `ciclo_vuelta` puesto.
--
-- SIN `lock_timeout` esto podría dejar la tabla de leads BLOQUEADA para todo el equipo: cambiar una tabla pide un instante de acceso exclusivo, y si hay una consulta larga abierta se queda
-- esperando y todas las demás hacen cola detrás de ella. Con el tope, si no consigue el bloqueo en 5 segundos se cancela SOLO, sin romper nada, y se vuelve a pegar un minuto después.
--
--
-- ============ CÓMO COMPROBAR QUE FUNCIONA ====================================
--
--   -- las dos columnas existen y están vacías (0 filas con ciclo)
--   select count(*) filter (where ciclo_vuelta is not null) as en_el_ciclo, count(*) filter (where ciclo_fase is not null) as con_fase from public.cold_leads;
--
--   -- cómo va el ritmo, por lista (cuando haya leads en él)
--   select source_list, ciclo_vuelta, ciclo_fase, status, count(*) from public.cold_leads where ciclo_vuelta is not null group by 1, 2, 3, 4 order by 1, 2, 3, 4;
--
-- ============================================================================

set lock_timeout = '5s';

alter table public.cold_leads add column if not exists ciclo_vuelta smallint;
alter table public.cold_leads add column if not exists ciclo_fase text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cold_leads_ciclo_fase_valida') then
    alter table public.cold_leads add constraint cold_leads_ciclo_fase_valida
      check (ciclo_fase is null or ciclo_fase in ('f2', 'f3', 'sin_respuesta'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cold_leads_ciclo_vuelta_valida') then
    alter table public.cold_leads add constraint cold_leads_ciclo_vuelta_valida
      check (ciclo_vuelta is null or ciclo_vuelta between 1 and 20);
  end if;
  -- Una fase sin vuelta no significa nada: la fase solo la tiene un lead que está en el ciclo
  if not exists (select 1 from pg_constraint where conname = 'cold_leads_ciclo_fase_con_vuelta') then
    alter table public.cold_leads add constraint cold_leads_ciclo_fase_con_vuelta
      check (ciclo_fase is null or ciclo_vuelta is not null);
  end if;
end $$;

-- Solo los que tienen fase: es lo que lee el proceso automático en cada pasada y el índice se queda diminuto
create index if not exists cold_leads_ciclo_fase_idx on public.cold_leads (id) where ciclo_fase is not null;

comment on column public.cold_leads.ciclo_vuelta is 'NULL = el lead no está en el sistema del ciclo comercial. 1 = primera vuelta; 2 = la que empieza a los dos meses de un «No responde».';
comment on column public.cold_leads.ciclo_fase is 'Punto del ritmo del ciclo mientras nadie contesta: NULL = Fase 1 (Sin contactar), f2, f3 o sin_respuesta («No responde»). La pone el proceso «Ciclo comercial»; no es un estado: status sigue siendo uno de los siete de siempre.';

-- Que PostgREST vea las columnas nuevas sin esperar
notify pgrst, 'reload schema';
