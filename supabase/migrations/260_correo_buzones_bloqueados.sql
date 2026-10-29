-- 260 · Correo: BLOQUEAR a una persona un buzón concreto, aunque un permiso de supervisión se lo abriera
--
-- Hasta ahora un buzón lo leía su dueño, cualquier administrador, quien tuviera uno de los dos permisos sueltos de supervisión («Supervisión del equipo comercial»: los buzones de
-- los comerciales; «Supervisión del correo»: los de todo el equipo menos los de los administradores) y quien tuviera el buzón abierto a mano (migración 255). Todo eso SUMABA: no había
-- forma de dar un permiso de supervisión y, aun así, dejar fuera un buzón. Esto añade lo contrario, desde Correo → «Quién ve qué» (solo administradores):
--
--   · correo_buzon_bloqueos            Una fila por persona y buzón bloqueado. Quien tiene fila NO lee ese buzón, sea cual sea el permiso o la apertura a mano que se lo daba.
--                                      No toca el permiso de la persona: solo cierra ese buzón. Sirve, por ejemplo, para que Alejandro y Jhanna sigan supervisando al
--                                      equipo y no lean los buzones de los administrativos. El dueño de un buzón siempre lee el suyo y a un administrador no se le bloquea
--                                      nada: la regla está en lib/correo/acceso.ts y la fuerza el servidor en cada petición de correo.
--   · correo_buzon_lectores_historial  (la de la 255) ahora admite también las acciones «bloqueado» y «desbloqueado», así que «Últimos cambios» cuenta todo en un solo sitio.
--
-- LA TABLA NUEVA ESTÁ CERRADA AL NAVEGADOR (RLS sin políticas y sin permisos para anon ni authenticated), como las demás correo_*: la lee y la escribe el servidor con la clave de
-- servicio, y solo la ruta de administradores /api/correo/lectores la escribe.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni perder lo bloqueado. Hace falta haber lanzado antes la 255 (esta amplía su
-- historial). El código funciona SIN esta migración: Correo sigue como siempre y «Quién ve qué» avisa de que falta lanzarla en lugar de ofrecer bloquear.


-- Sin la 255 no hay historial que ampliar: se avisa con el nombre del fichero, en vez de un error de Postgres
do $$
begin
  if to_regclass('public.correo_buzon_lectores_historial') is null or to_regclass('public.correo_buzones') is null then
    raise exception 'Falta lanzar antes la migración 255_correo_lectores_por_buzon.sql (esta amplía su historial).';
  end if;
end $$;


create table if not exists public.correo_buzon_bloqueos (
  buzon_id      uuid        not null references public.correo_buzones (id) on delete cascade,
  lector_id     uuid        not null references public.profiles (id) on delete cascade,
  -- Quién se lo bloqueó. Si esa persona se borra, la fila se queda sin saberlo
  bloqueado_por uuid        references public.profiles (id) on delete set null,
  bloqueado_at  timestamptz not null default now(),
  primary key (buzon_id, lector_id)
);

-- «Qué buzones tiene bloqueados esta persona»: es lo que se pregunta en cada petición de correo
create index if not exists correo_buzon_bloqueos_lector_idx on public.correo_buzon_bloqueos (lector_id);

comment on table public.correo_buzon_bloqueos is
  'Buzones de correo que un administrador ha BLOQUEADO a una persona concreta: no los lee por ningun permiso de supervision ni abierto a mano. Cerrada al navegador: solo la clave de servicio.';

alter table public.correo_buzon_bloqueos enable row level security;
revoke all on table public.correo_buzon_bloqueos from anon, authenticated;


-- ---------- El historial admite «bloqueado» y «desbloqueado» ----------
-- La 255 lo creó con una comprobación inline (accion in ('concedido', 'quitado')): se cambia por una que admita las cuatro. Si ya las admite (se lanzó esta migración antes), no se toca.
do $$
declare
  r record;
begin
  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.correo_buzon_lectores_historial'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%desbloqueado%'
  ) then
    for r in
      select c.conname
        from pg_constraint c
       where c.conrelid = 'public.correo_buzon_lectores_historial'::regclass
         and c.contype = 'c'
         and pg_get_constraintdef(c.oid) ilike '%accion%'
    loop
      execute format('alter table public.correo_buzon_lectores_historial drop constraint %I', r.conname);
    end loop;

    alter table public.correo_buzon_lectores_historial
      add constraint correo_buzon_lectores_historial_accion_check
      check (accion in ('concedido', 'quitado', 'bloqueado', 'desbloqueado'));
  end if;
end $$;


-- ---------- Comprobación ----------
do $$
declare
  cerrada boolean;
  acciones integer;
begin
  select c.relrowsecurity into cerrada
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'correo_buzon_bloqueos';
  if cerrada is distinct from true then
    raise exception 'La tabla correo_buzon_bloqueos no existe o no tiene la seguridad por filas encendida.';
  end if;

  select count(*) into acciones
    from pg_constraint c
   where c.conrelid = 'public.correo_buzon_lectores_historial'::regclass
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%bloqueado%'
     and pg_get_constraintdef(c.oid) like '%desbloqueado%';
  if acciones <> 1 then
    raise exception 'El historial de lectores de correo no admite las acciones bloqueado y desbloqueado (hay % comprobaciones, tiene que ser 1).', acciones;
  end if;

  raise notice 'Listo. Correo → «Quién ve qué» (solo administradores) ya puede bloquear a una persona un buzón concreto.';
end $$;
