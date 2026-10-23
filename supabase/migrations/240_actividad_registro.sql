-- 240 · Registro de actividad del equipo (solo para quien supervisa)
--
-- Qué guarda: cuándo abre el ERP cada empleado, qué pantallas pisa, qué botones pulsa y si está activo o parado,
-- con hora y minuto. NUNCA lo que escribe, ni contraseñas, ni capturas, ni lo que haga fuera del ERP.
--
-- Quién lo lee: nadie desde el navegador. La tabla está CERRADA (RLS sin políticas y sin permisos para anon ni
-- authenticated): todo pasa por /api/actividad con la clave de servicio, que escribe con la sesión de quien se mueve
-- (nadie puede escribir ni borrar filas de otro, ni las suyas) y lee solo para administradores y para quien tenga la
-- casilla «Actividad del equipo» en Gestión de Usuarios (esa casilla es el id de app 'actividad' y no necesita SQL).
--
-- Se borra solo a los 90 días: lo hace actividad_purgar(), que llama la propia ruta de escritura como mucho cada
-- seis horas. Seguro de lanzar más de una vez.

create table if not exists public.actividad_registro (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  -- La hora la pone el servidor (el navegador solo dice «hace cuántos ms»): un reloj mal puesto no escribe en otro día
  ocurrio_at  timestamptz not null default now(),
  tipo        text        not null,
  -- La pantalla, sin consulta y con los identificadores cambiados por :id
  ruta        text,
  -- Solo en los clics: el nombre del botón o enlace, sin correos, teléfonos ni cifras largas
  detalle     text,
  -- Una pestaña abierta del navegador (aleatorio, no identifica a nadie)
  sesion      text,
  -- De dónde y con qué se abrió: SOLO en 'sesion' y 'login'
  ip          text,
  agente      text,
  constraint actividad_registro_tipo_ok check (tipo in ('sesion', 'login', 'pagina', 'clic', 'latido', 'oculta', 'visible')),
  constraint actividad_registro_largos_ok check (
    char_length(coalesce(ruta, ''))    <= 200
    and char_length(coalesce(detalle, '')) <= 120
    and char_length(coalesce(sesion, ''))  <= 40
    and char_length(coalesce(ip, ''))      <= 64
    and char_length(coalesce(agente, ''))  <= 200
  )
);

comment on table public.actividad_registro is
  'Actividad de los empleados en el ERP (inicios, pantallas, clics, «sigo aquí»). Cerrada al navegador: solo la clave de servicio. Se purga a los 90 días.';

-- Las dos lecturas que hace la pantalla: el día de una persona y el día de todos
create index if not exists actividad_registro_usuario_idx on public.actividad_registro (user_id, ocurrio_at);
create index if not exists actividad_registro_fecha_idx   on public.actividad_registro (ocurrio_at);

-- CERRADA AL NAVEGADOR: RLS encendida, sin ninguna política, y sin permisos para los roles del navegador
alter table public.actividad_registro enable row level security;
revoke all on table public.actividad_registro from anon, authenticated;
grant all on table public.actividad_registro to service_role;

-- El resumen del equipo para un periodo: una fila por persona con actividad.
--   · primera/ultima: lo primero y lo último que HIZO (salir de la pestaña o volver no cuenta como hacer)
--   · minutos_activos: minutos distintos con un «sigo aquí» o un clic
create or replace function public.actividad_resumen_equipo(p_desde timestamptz, p_hasta timestamptz)
returns table (
  user_id         uuid,
  primera         timestamptz,
  ultima          timestamptz,
  minutos_activos integer,
  paginas         integer,
  clics           integer,
  sesiones        integer,
  logins          integer
)
language sql
stable
set search_path = public
as $$
  select r.user_id,
         min(r.ocurrio_at) filter (where r.tipo not in ('oculta', 'visible')),
         max(r.ocurrio_at) filter (where r.tipo not in ('oculta', 'visible')),
         (count(distinct date_trunc('minute', r.ocurrio_at)) filter (where r.tipo in ('latido', 'clic')))::integer,
         (count(*) filter (where r.tipo = 'pagina'))::integer,
         (count(*) filter (where r.tipo = 'clic'))::integer,
         (count(*) filter (where r.tipo = 'sesion'))::integer,
         (count(*) filter (where r.tipo = 'login'))::integer
    from public.actividad_registro r
   where r.ocurrio_at >= p_desde
     and r.ocurrio_at <  p_hasta
   group by r.user_id
$$;

-- Borra lo anterior a p_dias días (nunca menos de 7: un parámetro mal puesto no vacía la tabla), de 20.000 en 20.000
create or replace function public.actividad_purgar(p_dias integer default 90)
returns integer
language plpgsql
set search_path = public
as $$
declare
  borradas integer;
begin
  with viejas as (
    select id
      from public.actividad_registro
     where ocurrio_at < now() - make_interval(days => greatest(coalesce(p_dias, 90), 7))
     order by ocurrio_at
     limit 20000
  )
  delete from public.actividad_registro r
   using viejas v
   where r.id = v.id;
  get diagnostics borradas = row_count;
  return borradas;
end;
$$;

-- Solo la clave de servicio las ejecuta (con security invoker y sin permisos de tabla, a un empleado no le servirían,
-- pero así ni se puede llamar)
revoke execute on function public.actividad_resumen_equipo(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.actividad_purgar(integer)                          from public, anon, authenticated;
grant  execute on function public.actividad_resumen_equipo(timestamptz, timestamptz) to service_role;
grant  execute on function public.actividad_purgar(integer)                          to service_role;
