-- 254 · Briefing diario dentro del ERP
--
-- La rutina «Briefing diario Liberty Seller» (cada mañana, de lunes a viernes) ya construye un briefing con lo que necesitan Raúl y Marius: agenda, lo que hay
-- que revisar hoy, el equipo comercial, el equipo de cuentas, las tareas de los clientes y el correo. Hasta ahora lo dejaba en un artefacto de claude.ai. Con
-- esto además lo PUBLICA en el ERP (herramienta `publicar_briefing` del conector, ruta /api/mcp/briefing/<enlace>) y el ERP lo enseña en Briefing, con sus
-- puntos que se marcan como resueltos y un selector de días.
--
-- Tres tablas, TODAS CERRADAS AL NAVEGADOR (RLS sin políticas y sin permisos para anon ni authenticated): todo pasa por la clave de servicio de las rutas,
-- que antes comprueban quién eres y si tienes la casilla «Briefing» en Gestión de Usuarios (esa casilla es el id de app 'briefing' y no necesita SQL; un
-- administrador entra siempre).
--
--   · briefings          Un briefing por día, ya limpio de textos largos, enlaces raros y claves desconocidas (lib/briefing/esquema.ts). Publicar otra vez el mismo
--                        día lo sustituye. `tipo` existe para el día que haya otro briefing (el semanal de los lunes); hoy solo hay 'diario'.
--   · briefing_marcas    Qué puntos del día se han marcado como resueltos, por quién y cuándo. Borrar un día borra sus marcas.
--   · briefing_conector  El enlace secreto con el que publica la rutina. SOLO se guarda su huella SHA-256 (no se puede recuperar el enlace desde ella): el enlace
--                        entero se enseña una vez, al crearlo en Briefing → «Conexión con Claude».
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni perder lo guardado.
-- El código funciona SIN esta migración: la pantalla dice qué fichero lanzar y el conector contesta que falta.


create table if not exists public.briefings (
  tipo           text        not null default 'diario',
  -- El día del briefing, en hora de Madrid
  dia            date        not null,
  -- El JSON ya limpio (mismas claves que el de la rutina)
  contenido      jsonb       not null,
  -- Copias para las listas, sin abrir el JSON
  titular        text        not null,
  puntos_revisar integer     not null default 0,
  -- La primera vez que se publicó y la última (una sustitución conserva la primera)
  publicado_at   timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),
  primary key (tipo, dia),
  constraint briefings_tipo_ok check (tipo in ('diario')),
  constraint briefings_contenido_es_objeto check (jsonb_typeof(contenido) = 'object'),
  constraint briefings_tamano_ok check (pg_column_size(contenido) <= 400000)
);

comment on table public.briefings is
  'Briefing diario que publica la rutina de Claude (uno por día). Cerrada al navegador: solo la clave de servicio.';

-- El selector de días y «el último»
create index if not exists briefings_dia_idx on public.briefings (tipo, dia desc);


create table if not exists public.briefing_marcas (
  tipo      text        not null default 'diario',
  dia       date        not null,
  -- La clave del punto dentro de su día («r-1a2b3c4d»): la calcula el validador a partir de su área y su título
  clave     text        not null,
  hecho_por uuid        references auth.users (id) on delete set null,
  hecho_at  timestamptz not null default now(),
  primary key (tipo, dia, clave),
  foreign key (tipo, dia) references public.briefings (tipo, dia) on delete cascade,
  constraint briefing_marcas_clave_ok check (clave ~ '^[rc]-[0-9a-f]{8}(-[0-9]{1,3})?$')
);

comment on table public.briefing_marcas is
  'Puntos del briefing marcados como resueltos (quién y cuándo). Cerrada al navegador: solo la clave de servicio.';


create table if not exists public.briefing_conector (
  -- Una sola fila: el CHECK impide que haya dos
  id          boolean     primary key default true check (id),
  -- SHA-256 en hexadecimal del enlace. El enlace NO se guarda
  token_hash  text        not null,
  creado_at   timestamptz not null default now(),
  creado_por  uuid        references auth.users (id) on delete set null,
  -- La última vez que la rutina lo usó (se apunta como mucho cada 5 minutos)
  ultimo_uso_at timestamptz,
  constraint briefing_conector_huella_ok check (token_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.briefing_conector is
  'Huella del enlace secreto del conector que publica el briefing. El enlace no se guarda. Cerrada al navegador: solo la clave de servicio.';


-- CERRADAS AL NAVEGADOR: RLS encendida, sin ninguna política, y sin permisos para los roles del navegador
alter table public.briefings         enable row level security;
alter table public.briefing_marcas   enable row level security;
alter table public.briefing_conector enable row level security;
revoke all on table public.briefings         from anon, authenticated;
revoke all on table public.briefing_marcas   from anon, authenticated;
revoke all on table public.briefing_conector from anon, authenticated;
grant all on table public.briefings         to service_role;
grant all on table public.briefing_marcas   to service_role;
grant all on table public.briefing_conector to service_role;


-- ---------- Comprobación ----------
do $$
declare
  tablas integer;
  cerradas integer;
begin
  select count(*) into tablas
    from information_schema.tables
   where table_schema = 'public' and table_name in ('briefings', 'briefing_marcas', 'briefing_conector');
  if tablas <> 3 then
    raise exception 'Faltan tablas del briefing (hay %, tienen que ser 3).', tablas;
  end if;

  select count(*) into cerradas
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('briefings', 'briefing_marcas', 'briefing_conector') and c.relrowsecurity;
  if cerradas <> 3 then
    raise exception 'Alguna tabla del briefing no tiene la seguridad por filas encendida (% de 3).', cerradas;
  end if;

  raise notice 'Listo. Briefing → «Conexión con Claude» crea el enlace que hay que añadir en Claude como conector personalizado.';
end $$;
