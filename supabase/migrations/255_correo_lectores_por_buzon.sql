-- 255 · Correo: qué personas pueden LEER cada buzón (lo decide un administrador, buzón a buzón)
--
-- Hasta ahora un buzón lo leía su dueño, cualquier administrador, y quien tuviera uno de los dos permisos sueltos de supervisión («Supervisión del equipo comercial»:
-- los buzones de los comerciales; «Supervisión del correo»: los de todo el equipo menos los de los administradores). Eran permisos de todo o nada. Esto añade
-- una tercera forma, más fina: un administrador le abre a una persona UN buzón concreto, desde Correo → «Quién ve qué». Sirve para que la supervisora lea los de los
-- comerciales y ningún otro, para que lo de los administrativos lo vea solo quien tú digas, y para quitarlo con un clic.
--
--   · correo_buzon_lectores            Una fila por persona y buzón abierto. Quien tiene fila LEE ese buzón (solo lectura: no escribe desde él, no lo desconecta) y cada
--                                      vez que lo mira queda anotado en correo_accesos, como con los demás permisos.
--   · correo_buzon_lectores_historial  Quién abrió o cerró qué a quién y cuándo. Se queda aunque se borre la fila, el buzón o la persona (los nombres van copiados).
--
-- LAS DOS TABLAS ESTÁN CERRADAS AL NAVEGADOR (RLS sin políticas y sin permisos para anon ni authenticated), como las demás correo_*: las lee y las escribe el servidor
-- con la clave de servicio, y solo la ruta de administradores /api/correo/lectores las escribe.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni perder lo concedido.
-- El código funciona SIN esta migración: Correo sigue como siempre y «Quién ve qué» avisa de que falta lanzarla. Hace falta haber lanzado antes la 236 (correo).


create table if not exists public.correo_buzon_lectores (
  buzon_id      uuid        not null references public.correo_buzones (id) on delete cascade,
  lector_id     uuid        not null references public.profiles (id) on delete cascade,
  -- Quién se lo abrió. Si esa persona se borra, la fila se queda sin saberlo
  concedido_por uuid        references public.profiles (id) on delete set null,
  concedido_at  timestamptz not null default now(),
  primary key (buzon_id, lector_id)
);

-- «Qué buzones lee esta persona»: es lo que se pregunta en cada petición de correo
create index if not exists correo_buzon_lectores_lector_idx on public.correo_buzon_lectores (lector_id);

comment on table public.correo_buzon_lectores is
  'Buzones de correo que un administrador ha abierto, a mano, a una persona concreta para que los LEA (solo lectura, con rastro). Cerrada al navegador: solo la clave de servicio.';


create table if not exists public.correo_buzon_lectores_historial (
  id               bigint      generated always as identity primary key,
  -- Los ids pueden quedarse sin dueño si se borra el buzón o la persona; la dirección y los nombres van copiados para que el rastro siga diciendo qué fue
  buzon_id         uuid        references public.correo_buzones (id) on delete set null,
  buzon_direccion  text        not null,
  lector_id        uuid        references public.profiles (id) on delete set null,
  lector_nombre    text        not null,
  accion           text        not null check (accion in ('concedido', 'quitado')),
  hecho_por        uuid        references public.profiles (id) on delete set null,
  hecho_por_nombre text        not null,
  hecho_at         timestamptz not null default now()
);

create index if not exists correo_buzon_lectores_historial_hecho_idx on public.correo_buzon_lectores_historial (hecho_at desc);

comment on table public.correo_buzon_lectores_historial is
  'Quién abrió o cerró qué buzón a quién y cuándo (la auditoría de correo_buzon_lectores). Cerrada al navegador: solo la clave de servicio.';


-- CERRADAS AL NAVEGADOR: RLS encendida, sin ninguna política, y sin permisos para los roles del navegador
alter table public.correo_buzon_lectores           enable row level security;
alter table public.correo_buzon_lectores_historial enable row level security;
revoke all on table public.correo_buzon_lectores           from anon, authenticated;
revoke all on table public.correo_buzon_lectores_historial from anon, authenticated;


-- ---------- Comprobación ----------
do $$
declare
  tablas integer;
  cerradas integer;
begin
  select count(*) into tablas
    from information_schema.tables
   where table_schema = 'public' and table_name in ('correo_buzon_lectores', 'correo_buzon_lectores_historial');
  if tablas <> 2 then
    raise exception 'Faltan tablas de los lectores de correo (hay %, tienen que ser 2).', tablas;
  end if;

  select count(*) into cerradas
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('correo_buzon_lectores', 'correo_buzon_lectores_historial') and c.relrowsecurity;
  if cerradas <> 2 then
    raise exception 'Alguna tabla de los lectores de correo no tiene la seguridad por filas encendida (% de 2).', cerradas;
  end if;

  raise notice 'Listo. Correo → «Quién ve qué» (solo administradores) abre buzones, uno a uno, a quien tú decidas.';
end $$;
