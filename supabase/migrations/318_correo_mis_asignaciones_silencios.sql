-- 318 · Correo: «Mis correos», asignar buzones (con permiso para responder), asignar un hilo a una persona y silenciar (buzón, hilo, remitente)
--
--   · correo_buzon_preferencias   Por persona y buzón: si está en «Mis correos» (null = por defecto: propios y asignados sí, el resto no), su orden, y si lo tiene
--                                 SILENCIADO (y hasta cuándo). Personal: no afecta a nadie más.
--   · correo_buzon_asignaciones   Un administrador ASIGNA un buzón a una persona para que lo trabaje: lo lee, le avisa y, si puede_responder, ENVÍA desde él.
--                                 Cada cambio va al historial de la 255 (acciones 'asignado', 'desasignado', 'responde', 'solo_avisos'), con «detalle».
--   · correo_hilo_silencios       Conversaciones que una persona ha silenciado.
--   · correo_remitente_silencios  Direcciones que una persona ha silenciado (en todos los buzones que lee).
--   · correo_hilo_asignaciones    «Encárgate tú de esta conversación»: UNA persona por hilo, con nota opcional y «hecho».
--   · correo_mensajes.enviado_por Quién del ERP envió un correo (el correo sale del buzón, pero aquí queda quién lo mandó).
--   · notifications               Admite el tipo 'correo_asignado' (se añade a la lista que haya, sin reescribirla a mano).
--   · correo_sin_leer_de / correo_bandeja   Cuentas y bandeja unificada que ya descuentan (o marcan) lo silenciado.
--   · correo_fusionar_hilos       La de la 236, que ahora pasa los silencios y la encargada al hilo que se queda antes de borrar los otros.
--
-- TODO CERRADO AL NAVEGADOR (RLS sin políticas, REVOKE a anon/authenticated; las funciones solo para service_role). La regla de acceso sigue en lib/correo/acceso.ts.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni perder lo elegido, asignado o silenciado.
-- Hace falta haber lanzado antes la 236 (correo), la 251 (campana), la 255 (lectores) y la 260 (bloqueos).
-- El código funciona SIN esta migración: Correo sigue como hoy y lo nuevo avisa de que falta lanzarla.
--
-- Aviso para otras ramas: si una migración posterior reescribe la lista de notifications_type_check, tiene que incluir 'correo_asignado'.

do $$
begin
  if to_regclass('public.correo_buzones') is null or to_regclass('public.correo_hilos') is null then
    raise exception 'Falta lanzar antes la migración 236_correo.sql.';
  end if;
  if to_regclass('public.correo_buzon_lectores_historial') is null then
    raise exception 'Falta lanzar antes la migración 255_correo_lectores_por_buzon.sql (esta amplía su historial).';
  end if;
  if to_regclass('public.correo_buzon_bloqueos') is null then
    raise exception 'Falta lanzar antes la migración 260_correo_buzones_bloqueados.sql.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass) then
    raise exception 'No encuentro la comprobación notifications_type_check (migración 251 o posteriores).';
  end if;
end $$;


-- ---------- 1. Preferencias por persona y buzón («Mis correos» y silencio del buzón) ----------
create table if not exists public.correo_buzon_preferencias (
  user_id          uuid        not null references public.profiles (id) on delete cascade,
  buzon_id         uuid        not null references public.correo_buzones (id) on delete cascade,
  -- null = lo de por defecto (propio o asignado: sí; el resto: no). true/false = lo ha elegido la persona
  en_mis_correos   boolean,
  orden            smallint,
  silenciado       boolean     not null default false,
  -- Con silenciado = true: null = para siempre; una fecha = hasta entonces (pasada la fecha, vuelve a avisar sin tocar nada)
  silenciado_hasta timestamptz,
  actualizado_at   timestamptz not null default now(),
  primary key (user_id, buzon_id)
);
-- «Quién sigue este buzón» (para la campana) y «quién lo tiene silenciado»
create index if not exists correo_buzon_preferencias_siguen_idx on public.correo_buzon_preferencias (buzon_id) where en_mis_correos is true;
create index if not exists correo_buzon_preferencias_silencio_idx on public.correo_buzon_preferencias (buzon_id) where silenciado;
comment on table public.correo_buzon_preferencias is
  'Por persona y buzon: si esta en «Mis correos» (null = por defecto), su orden y si lo tiene silenciado. Personal. Cerrada al navegador: solo la clave de servicio.';


-- ---------- 2. Asignaciones de buzón ----------
create table if not exists public.correo_buzon_asignaciones (
  buzon_id        uuid        not null references public.correo_buzones (id) on delete cascade,
  persona_id      uuid        not null references public.profiles (id) on delete cascade,
  -- true = puede responder y enviar desde el buzón (queda anotado quién envía). false = solo lo lee y le avisa
  puede_responder boolean     not null default true,
  asignado_por    uuid        references public.profiles (id) on delete set null,
  asignado_at     timestamptz not null default now(),
  primary key (buzon_id, persona_id)
);
-- «Qué buzones tiene asignados esta persona»: se pregunta en cada petición de correo
create index if not exists correo_buzon_asignaciones_persona_idx on public.correo_buzon_asignaciones (persona_id);
comment on table public.correo_buzon_asignaciones is
  'Buzones que un administrador asigna a una persona para trabajarlos: los lee, le avisan y, con puede_responder, envia desde ellos. Cerrada al navegador: solo la clave de servicio.';

-- El historial de la 255/260 cuenta también las asignaciones; «detalle» guarda lo que cambió (p. ej. «responde»)
alter table public.correo_buzon_lectores_historial add column if not exists detalle text;
-- La 260 dejó una comprobación con cuatro acciones: se cambia por una con las ocho. Si ya las admite (se lanzó esta migración antes), no se toca.
do $$
declare
  r record;
begin
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.correo_buzon_lectores_historial'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%solo_avisos%'
  ) then
    for r in
      select c.conname from pg_constraint c
       where c.conrelid = 'public.correo_buzon_lectores_historial'::regclass and c.contype = 'c'
         and pg_get_constraintdef(c.oid) ilike '%accion%'
    loop
      execute format('alter table public.correo_buzon_lectores_historial drop constraint %I', r.conname);
    end loop;
    alter table public.correo_buzon_lectores_historial
      add constraint correo_buzon_lectores_historial_accion_check
      check (accion in ('concedido', 'quitado', 'bloqueado', 'desbloqueado', 'asignado', 'desasignado', 'responde', 'solo_avisos'));
  end if;
end $$;


-- ---------- 3. Silencios de hilo y de remitente ----------
create table if not exists public.correo_hilo_silencios (
  user_id   uuid        not null references public.profiles (id) on delete cascade,
  hilo_id   uuid        not null references public.correo_hilos (id) on delete cascade,
  -- null = para siempre; una fecha = hasta entonces
  hasta     timestamptz,
  creado_at timestamptz not null default now(),
  primary key (user_id, hilo_id)
);
create index if not exists correo_hilo_silencios_hilo_idx on public.correo_hilo_silencios (hilo_id);
comment on table public.correo_hilo_silencios is 'Conversaciones que una persona ha silenciado (personal). Cerrada al navegador.';

create table if not exists public.correo_remitente_silencios (
  user_id   uuid        not null references public.profiles (id) on delete cascade,
  -- La dirección en minúsculas, tal cual llega en contraparte_direccion
  direccion text        not null check (direccion = lower(direccion) and position('@' in direccion) > 1 and char_length(direccion) <= 320),
  hasta     timestamptz,
  creado_at timestamptz not null default now(),
  primary key (user_id, direccion)
);
comment on table public.correo_remitente_silencios is 'Direcciones que una persona ha silenciado en todos los buzones que lee (personal). Cerrada al navegador.';


-- ---------- 4. Asignación de un hilo a una persona ----------
create table if not exists public.correo_hilo_asignaciones (
  hilo_id      uuid        primary key references public.correo_hilos (id) on delete cascade,
  buzon_id     uuid        not null references public.correo_buzones (id) on delete cascade,
  persona_id   uuid        not null references public.profiles (id) on delete cascade,
  asignado_por uuid        references public.profiles (id) on delete set null,
  nota         text        check (nota is null or char_length(nota) <= 280),
  asignado_at  timestamptz not null default now(),
  -- null = pendiente; una fecha = la encargada pulsó «Hecho»
  hecho_at     timestamptz
);
-- «Asignados a mí» (solo los pendientes)
create index if not exists correo_hilo_asignaciones_persona_idx on public.correo_hilo_asignaciones (persona_id, asignado_at desc) where hecho_at is null;
comment on table public.correo_hilo_asignaciones is '«Encargate tu de esta conversacion»: una persona por hilo, con nota y hecho. Cerrada al navegador.';


-- ---------- 5. Quién envió cada correo desde el ERP ----------
alter table public.correo_mensajes add column if not exists enviado_por uuid references public.profiles (id) on delete set null;
-- El nombre copiado: el rastro sigue diciendo quién fue aunque se borre la persona
alter table public.correo_mensajes add column if not exists enviado_por_nombre text;


-- ---------- 6. Índice para la bandeja unificada (desempate estable por id) ----------
create index if not exists correo_hilos_bandeja_idx on public.correo_hilos (buzon_id, ultimo_mensaje_at desc, id desc) where mensajes > 0;


-- ---------- 7. Cerradas al navegador ----------
alter table public.correo_buzon_preferencias  enable row level security;
alter table public.correo_buzon_asignaciones  enable row level security;
alter table public.correo_hilo_silencios      enable row level security;
alter table public.correo_remitente_silencios enable row level security;
alter table public.correo_hilo_asignaciones   enable row level security;
revoke all on table public.correo_buzon_preferencias  from anon, authenticated;
revoke all on table public.correo_buzon_asignaciones  from anon, authenticated;
revoke all on table public.correo_hilo_silencios      from anon, authenticated;
revoke all on table public.correo_remitente_silencios from anon, authenticated;
revoke all on table public.correo_hilo_asignaciones   from anon, authenticated;


-- ---------- 8. La campana admite 'correo_asignado' (sin reescribir a mano la lista de otras ramas) ----------
-- Se lee la lista que haya ahora (pg_get_constraintdef la enseña como type = ANY (ARRAY['comment'::text, ...])) y se le añade el tipo nuevo.
-- Se vuelve a escribir como check (type in ('a', 'b', ...)), igual que las demás migraciones, para que la definición siga teniendo cada
-- tipo entre comillas ('x'::text). Con '{a,b}'::text[] la siguiente lectura (y la comprobación de abajo) ya no los encontraría.
do $$
declare
  def         text;
  tipos       text[];
  n_literales integer;
  n_text      integer;
  lista       text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass;
  if def like '%''correo_asignado''%' then
    return;
  end if;
  select array_agg(distinct m[1]) into tipos from regexp_matches(def, '''([^'']+)''', 'g') as m;
  -- Cada tipo aparece como 'x'::text: si no salen tantos literales como '::text hay en la definición, algo no se ha leído bien
  select count(*) into n_literales from regexp_matches(def, '''([^'']+)''', 'g');
  select count(*) into n_text      from regexp_matches(def, '''::text', 'g');
  if tipos is null or array_length(tipos, 1) < 5 or n_literales <> n_text then
    raise exception 'No he podido leer la lista de tipos de la campana (%). Revísala a mano.', def;
  end if;
  tipos := array_append(tipos, 'correo_asignado');
  select string_agg(quote_literal(t), ', ' order by t) into lista from unnest(tipos) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type in (%s))', lista);
end $$;


-- ---------- 9. Funciones ----------
-- ¿Está silenciado este hilo para esta persona ahora? (el hilo o su remitente; un silencio con fecha pasada ya no cuenta)
-- Para consultas sueltas. correo_sin_leer_de y correo_bandeja NO la llaman: llevan la misma condición en línea, porque una función SQL con SET
-- no se inserta en la consulta y se ejecutaría una vez por hilo (miles en un buzón importado, cada minuto y por persona).
create or replace function public.correo_hilo_silenciado(p_user uuid, p_hilo uuid, p_contraparte text)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.correo_hilo_silencios s where s.user_id = p_user and s.hilo_id = p_hilo and (s.hasta is null or s.hasta > now()))
      or exists (select 1 from public.correo_remitente_silencios r where r.user_id = p_user and r.direccion = lower(p_contraparte) and (r.hasta is null or r.hasta > now()));
$$;

-- Conversaciones sin leer por buzón, SIN contar las silenciadas por esta persona (el número del menú y de la barra).
-- El silencio de un BUZÓN entero no se descuenta aquí: lo aplica el servidor con correo_buzon_preferencias.
create or replace function public.correo_sin_leer_de(p_user uuid, p_buzones uuid[])
returns table (buzon_id uuid, hilos_sin_leer bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  select h.buzon_id, count(*)
    from public.correo_hilos h
   where h.buzon_id = any (p_buzones) and h.mensajes > 0 and h.no_leidos > 0
     -- En línea (no correo_hilo_silenciado): una función SQL con SET no se inserta en la consulta y sería una llamada por hilo sin leer
     and not exists (select 1 from public.correo_hilo_silencios s where s.user_id = p_user and s.hilo_id = h.id and (s.hasta is null or s.hasta > now()))
     and not exists (select 1 from public.correo_remitente_silencios r where r.user_id = p_user and r.direccion = lower(h.contraparte_direccion) and (r.hasta is null or r.hasta > now()))
   group by h.buzon_id;
$$;

-- Bandeja unificada: los hilos de varios buzones mezclados por fecha. Cada buzón aporta como mucho p_limite + 1 por su índice
-- y luego se mezclan: el coste no crece con el tamaño de los buzones. Cursor (p_antes, p_antes_id) estable aunque dos hilos tengan la misma fecha.
-- Devuelve p_limite + 1 filas como mucho: si sale la de más, hay otra página. Con p_ocultar_silenciados = false (lo normal) los silenciados vienen
-- con silenciado = true; con true se quitan DENTRO de cada buzón, antes del limit: una página nunca llega vacía (o corta) por lo silenciado
-- mientras haya más correos detrás. La firma vieja (7 argumentos, de un borrador anterior) se borra para que no queden dos.
drop function if exists public.correo_bandeja(uuid, uuid[], text, boolean, timestamptz, uuid, integer);
drop function if exists public.correo_bandeja(uuid, uuid[], text, boolean, timestamptz, uuid, integer, boolean);
-- p_buzones_silenciados: los buzones que quien mira ha silenciado. Con p_ocultar_silenciados = true se quitan sus hilos, PERO un rebote nunca se oculta
-- (ni el de un buzón o un remitente silenciado): es la misma regla que esRebote (lib/correo/avisos.ts) y que la lista del cliente.
create or replace function public.correo_bandeja(
  p_user uuid, p_buzones uuid[], p_vista text, p_solo_no_leidos boolean,
  p_antes timestamptz, p_antes_id uuid, p_limite integer, p_ocultar_silenciados boolean default false,
  p_buzones_silenciados uuid[] default '{}')
returns table (
  id uuid, buzon_id uuid, asunto text, contraparte text, contraparte_direccion text, vista_previa text,
  ultimo_mensaje_at timestamptz, mensajes integer, no_leidos integer, entrantes integer, salientes integer,
  tiene_adjuntos boolean, destacado boolean, ultimo_es_entrante boolean, automatico boolean,
  silenciado boolean, asignado_a uuid)
language sql
stable
set search_path = public, pg_temp
as $$
  with lim as (select least(greatest(coalesce(p_limite, 40), 1), 100) as n),
  cand as (
    select h.*
      from unnest(p_buzones) as b(buzon_id)
      cross join lateral (
        select x.* from public.correo_hilos x
         where x.buzon_id = b.buzon_id and x.mensajes > 0
           and (p_antes is null or (x.ultimo_mensaje_at, x.id) < (p_antes, coalesce(p_antes_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
           and (p_vista is distinct from 'recibidos'  or x.entrantes > 0)
           and (p_vista is distinct from 'enviados'   or x.salientes > 0)
           and (p_vista is distinct from 'destacados' or x.destacado)
           and (p_vista is distinct from 'pendientes' or x.ultimo_es_entrante)
           and (not coalesce(p_solo_no_leidos, false) or x.no_leidos > 0)
           -- Los silencios, en línea (anti-join): correo_hilo_silenciado lleva SET y no se insertaría, sería una llamada por fila
           and (not coalesce(p_ocultar_silenciados, false)
                or lower(split_part(coalesce(x.contraparte_direccion, ''), '@', 1)) ~ '^(mailer-daemon|postmaster|mail\.?delivery(\.?subsystem)?)([._+-]|[0-9]|$)'
                or coalesce(x.asunto, '') ~* '^\s*(undeliver|delivery status|returned mail|mail delivery (failed|system)|failure notice|delivery failure|no se (ha )?(pudo|podido) entregar|mensaje no entregado|error de entrega|devuelto)'
                or (
                 x.buzon_id <> all (coalesce(p_buzones_silenciados, '{}'::uuid[]))
                 and not exists (select 1 from public.correo_hilo_silencios s where s.user_id = p_user and s.hilo_id = x.id and (s.hasta is null or s.hasta > now()))
                 and not exists (select 1 from public.correo_remitente_silencios r where r.user_id = p_user and r.direccion = lower(x.contraparte_direccion) and (r.hasta is null or r.hasta > now()))))
         order by x.ultimo_mensaje_at desc, x.id desc
         limit (select n from lim) + 1
      ) h
  )
  select c.id, c.buzon_id, c.asunto, c.contraparte, c.contraparte_direccion, c.vista_previa,
         c.ultimo_mensaje_at, c.mensajes, c.no_leidos, c.entrantes, c.salientes,
         c.tiene_adjuntos, c.destacado, c.ultimo_es_entrante, c.automatico,
         (exists (select 1 from public.correo_hilo_silencios s where s.user_id = p_user and s.hilo_id = c.id and (s.hasta is null or s.hasta > now()))
          or exists (select 1 from public.correo_remitente_silencios r where r.user_id = p_user and r.direccion = lower(c.contraparte_direccion) and (r.hasta is null or r.hasta > now()))),
         a.persona_id
    from cand c
    left join public.correo_hilo_asignaciones a on a.hilo_id = c.id and a.hecho_at is null
   order by c.ultimo_mensaje_at desc, c.id desc
   limit (select n from lim) + 1;
$$;

-- Unir hilos (236) SIN perder silencios ni la persona encargada: el mismo cuerpo de la 236 con dos pasos antes del DELETE
-- (el cascade de correo_hilos borraría las filas de los hilos absorbidos). Misma firma y mismo search_path.
-- Como en la 236, solo se fusiona dentro del buzón del destino; si el destino no existe (v_buzon nulo), no se toca nada.
-- Silencios: si una persona tenía varios, se queda el más largo (para siempre gana); si el destino ya tenía uno suyo, se queda ese.
-- Encargada: si el destino ya tiene, se queda esa; si no, la pendiente más reciente de los absorbidos (o la más reciente ya hecha).
create or replace function public.correo_fusionar_hilos(p_destino uuid, p_origenes uuid[])
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_destacado boolean;
  v_buzon     uuid;
begin
  if p_origenes is null or cardinality(p_origenes) = 0 then
    return;
  end if;
  select d.buzon_id into v_buzon from public.correo_hilos d where d.id = p_destino;

  select bool_or(h.destacado) into v_destacado
    from public.correo_hilos h
   where h.id = any (p_origenes) and h.id <> p_destino and h.buzon_id = v_buzon;

  update public.correo_mensajes m
     set hilo_id = p_destino
   where m.hilo_id = any (p_origenes) and m.hilo_id <> p_destino and m.buzon_id = v_buzon;

  -- NUEVO (318): los silencios y la encargada de los hilos absorbidos pasan al destino antes de que el cascade los borre
  insert into public.correo_hilo_silencios (user_id, hilo_id, hasta, creado_at)
  select distinct on (s.user_id) s.user_id, p_destino, s.hasta, s.creado_at
    from public.correo_hilo_silencios s
    join public.correo_hilos h on h.id = s.hilo_id and h.buzon_id = v_buzon
   where s.hilo_id = any (p_origenes) and s.hilo_id <> p_destino
   order by s.user_id, s.hasta desc nulls first
  on conflict do nothing;

  insert into public.correo_hilo_asignaciones (hilo_id, buzon_id, persona_id, asignado_por, nota, asignado_at, hecho_at)
  select p_destino, a.buzon_id, a.persona_id, a.asignado_por, a.nota, a.asignado_at, a.hecho_at
    from public.correo_hilo_asignaciones a
   where a.hilo_id = any (p_origenes) and a.hilo_id <> p_destino and a.buzon_id = v_buzon
   order by (a.hecho_at is null) desc, a.asignado_at desc
   limit 1
  on conflict (hilo_id) do nothing;

  delete from public.correo_hilos h
   where h.id = any (p_origenes) and h.id <> p_destino and h.buzon_id = v_buzon
     and not exists (select 1 from public.correo_mensajes m where m.hilo_id = h.id);

  if v_destacado is true then
    update public.correo_hilos set destacado = true where id = p_destino;
  end if;

  perform public.correo_actualizar_hilo(p_destino);
end;
$$;
comment on function public.correo_fusionar_hilos(uuid, uuid[]) is
  'Pasa todos los mensajes de los hilos de origen al hilo destino (del mismo buzon), con sus silencios y su encargada, borra los origenes que quedan vacios y recalcula el destino.';

revoke all on function public.correo_fusionar_hilos(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.correo_hilo_silenciado(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.correo_sin_leer_de(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.correo_bandeja(uuid, uuid[], text, boolean, timestamptz, uuid, integer, boolean, uuid[]) from public, anon, authenticated;
grant execute on function public.correo_fusionar_hilos(uuid, uuid[]) to service_role;
grant execute on function public.correo_hilo_silenciado(uuid, uuid, text) to service_role;
grant execute on function public.correo_sin_leer_de(uuid, uuid[]) to service_role;
grant execute on function public.correo_bandeja(uuid, uuid[], text, boolean, timestamptz, uuid, integer, boolean, uuid[]) to service_role;


-- ---------- Comprobación ----------
do $$
declare
  cerradas integer;
begin
  select count(*) into cerradas
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relrowsecurity
     and c.relname in ('correo_buzon_preferencias', 'correo_buzon_asignaciones', 'correo_hilo_silencios', 'correo_remitente_silencios', 'correo_hilo_asignaciones');
  if cerradas <> 5 then
    raise exception 'Faltan tablas o alguna no tiene la seguridad por filas encendida (% de 5).', cerradas;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'correo_mensajes' and column_name = 'enviado_por') then
    raise exception 'correo_mensajes no tiene la columna enviado_por.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notifications_type_check' and pg_get_constraintdef(oid) like '%''correo_asignado''%') then
    raise exception 'La campana no admite el tipo correo_asignado.';
  end if;
end $$;

-- El editor SQL de Supabase no enseña los NOTICE: esta fila es la comprobación. TODAS las columnas tienen que salir true.
select
  (select count(*) = 5 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relrowsecurity
      and c.relname in ('correo_buzon_preferencias', 'correo_buzon_asignaciones', 'correo_hilo_silencios', 'correo_remitente_silencios', 'correo_hilo_asignaciones')) as tablas_cerradas,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'correo_mensajes' and column_name = 'enviado_por') as tiene_enviado_por,
  exists (select 1 from pg_constraint where conname = 'notifications_type_check' and pg_get_constraintdef(oid) like '%''correo_asignado''%') as campana_admite_correo_asignado,
  exists (select 1 from pg_constraint c where c.conrelid = 'public.correo_buzon_lectores_historial'::regclass and c.contype = 'c'
           and pg_get_constraintdef(c.oid) like '%solo_avisos%') as historial_admite_asignado,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'correo_fusionar_hilos' and p.prosrc like '%correo_hilo_silencios%') as fusion_conserva_silencios;
