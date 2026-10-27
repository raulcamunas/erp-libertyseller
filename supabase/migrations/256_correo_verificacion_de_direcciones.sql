-- 256 · Correo: comprobar con MillionVerifier que una dirección existe ANTES de enviarle el primer correo
--
-- Antes de enviar el primer correo a un lead (y de programar sus seguimientos) el ERP le pregunta a un servicio de pago, MillionVerifier, si esa dirección existe.
-- Si no existe, el correo no sale. Si existe, se guarda la respuesta y esa dirección no se vuelve a preguntar (ni a pagar): los seguimientos, que salen a la misma
-- dirección, usan lo guardado. Si el servicio no contesta o se acaban los créditos, el correo sale igual: un fallo del servicio nunca deja al equipo sin escribir.
--
--   · correo_verificacion_ajustes   Una sola fila: si está encendido, qué hacer con las direcciones dudosas (las de empresas cuyo servidor acepta cualquier dirección),
--                                   la clave de la API CIFRADA (con la clave del servidor, igual que las de Rinkel y las contraseñas de los buzones), los créditos
--                                   que quedaban en la última respuesta y el último fallo del servicio.
--   · correo_verificaciones         Una fila por dirección ya comprobada: qué dijo el servicio y cuándo. Es la «memoria» que evita pagar dos veces.
--   · correo_direcciones_malas      Ya existía (migración 245). Ahora admite el origen `verificador`: una dirección que el servicio da por inexistente entra en la misma memoria
--                                   que las que han rebotado, así que el cuadro de escribir, las secuencias y el botón «Liberar» ya saben qué hacer con ella.
--
-- LAS DOS TABLAS NUEVAS ESTÁN CERRADAS AL NAVEGADOR (RLS sin políticas y sin permisos para anon ni authenticated): las lee y las escribe el servidor con la clave de
-- servicio, y la clave de la API NUNCA sale hacia la pantalla (ni siquiera cifrada: solo se enseñan sus últimos caracteres).
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni perder lo guardado.
-- El código funciona SIN esta migración (todo sigue como siempre y la pantalla de ajustes avisa de que falta lanzarla). Hace falta haber lanzado antes la 245.


create table if not exists public.correo_verificacion_ajustes (
  id               boolean     primary key default true check (id),
  -- El interruptor general. Nace apagado: se enciende solo al guardar una clave que vale
  activa           boolean     not null default false,
  -- Qué hacer con una dirección «dudosa» (el servidor de esa empresa acepta cualquier dirección y no se puede confirmar que el buzón exista)
  dudosas          text        not null default 'avisar' check (dudosas in ('avisar', 'sin_seguimientos', 'bloquear')),
  -- La clave de la API, cifrada (AES-256-GCM). Nunca en claro, nunca hacia el navegador
  clave_cifrada    text,
  -- Los últimos caracteres de la clave, para reconocerla en la pantalla sin enseñarla
  clave_termina    text        check (clave_termina is null or length(clave_termina) <= 8),
  clave_puesta_at  timestamptz,
  -- Los créditos que le quedaban a la cuenta en la última respuesta del servicio
  creditos         integer     check (creditos is null or creditos >= 0),
  creditos_at      timestamptz,
  -- Lo último que fue mal con el servicio (una frase nuestra, nunca el texto de su respuesta) y cuándo. Se borra al volver a funcionar
  error_causa      text        check (error_causa is null or error_causa in ('clave', 'sin_creditos', 'ip', 'red', 'otro')),
  error_texto      text        check (error_texto is null or length(error_texto) <= 300),
  error_at         timestamptz,
  actualizada_at   timestamptz not null default now(),
  actualizada_por  uuid        references public.profiles (id) on delete set null
);

insert into public.correo_verificacion_ajustes (id) values (true) on conflict (id) do nothing;

comment on table public.correo_verificacion_ajustes is
  'Ajustes de la verificacion de direcciones con MillionVerifier (una sola fila): interruptor, que hacer con las dudosas, la clave de la API cifrada y el estado del servicio. Cerrada al navegador.';


create table if not exists public.correo_verificaciones (
  direccion       text        primary key check (direccion = lower(direccion) and length(direccion) between 3 and 320),
  nivel           text        not null check (nivel in ('buena', 'dudosa', 'mala')),
  -- Lo que dijo el servicio: ok · catch_all · unknown · disposable · invalid
  resultado       text        check (resultado is null or length(resultado) <= 40),
  -- Su `subresult`: ok · no_mailbox · bad_domain · mailbox_disabled…
  detalle         text        check (detalle is null or length(detalle) <= 60),
  calidad         text        check (calidad is null or length(calidad) <= 20),
  -- La errata que proponía («…@gmail.com» para «…@gmal.com»)
  sugerencia      text        check (sugerencia is null or length(sugerencia) <= 320),
  proveedor       text        not null default 'millionverifier',
  -- Por qué se preguntó: el primer correo a un lead, un seguimiento que no tenía su dirección comprobada, o una prueba desde Ajustes
  origen          text        not null default 'primer_correo' check (origen in ('primer_correo', 'seguimiento', 'prueba')),
  verificada_por  uuid        references public.profiles (id) on delete set null,
  verificada_at   timestamptz not null default now()
);

create index if not exists correo_verificaciones_nivel_idx on public.correo_verificaciones (nivel);
create index if not exists correo_verificaciones_fecha_idx on public.correo_verificaciones (verificada_at desc);

comment on table public.correo_verificaciones is
  'Direcciones ya comprobadas con el servicio de verificacion: que dijo y cuando. Evita preguntar (y pagar) dos veces por la misma. Cerrada al navegador.';


-- La memoria de direcciones que no sirven admite un origen más: el servicio de verificación
do $$
declare
  nombre text;
begin
  for nombre in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.correo_direcciones_malas'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%origen%'
       and pg_get_constraintdef(c.oid) not like '%verificador%'
  loop
    execute format('alter table public.correo_direcciones_malas drop constraint %I', nombre);
  end loop;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.correo_direcciones_malas'::regclass
       and conname = 'correo_direcciones_malas_origen_con_verificador'
  ) then
    alter table public.correo_direcciones_malas
      add constraint correo_direcciones_malas_origen_con_verificador
      check (origen in ('rebote', 'rechazo_smtp', 'manual', 'verificador'));
  end if;
end $$;


-- CERRADAS AL NAVEGADOR: RLS encendida, sin ninguna política, y sin permisos para los roles del navegador
alter table public.correo_verificacion_ajustes enable row level security;
alter table public.correo_verificaciones       enable row level security;
revoke all on table public.correo_verificacion_ajustes from anon, authenticated;
revoke all on table public.correo_verificaciones       from anon, authenticated;


-- ---------- Comprobación ----------
do $$
declare
  tablas integer;
  cerradas integer;
  origen_admite boolean;
begin
  select count(*) into tablas
    from information_schema.tables
   where table_schema = 'public' and table_name in ('correo_verificacion_ajustes', 'correo_verificaciones');
  if tablas <> 2 then
    raise exception 'Faltan tablas de la verificacion de direcciones (hay %, tienen que ser 2).', tablas;
  end if;

  select count(*) into cerradas
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('correo_verificacion_ajustes', 'correo_verificaciones') and c.relrowsecurity;
  if cerradas <> 2 then
    raise exception 'Alguna tabla de la verificacion de direcciones no tiene la seguridad por filas encendida (% de 2).', cerradas;
  end if;

  select exists (
    select 1 from pg_constraint
     where conrelid = 'public.correo_direcciones_malas'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%verificador%'
  ) into origen_admite;
  if not origen_admite then
    raise exception 'La memoria de direcciones malas no admite todavia el origen «verificador».';
  end if;

  if (select count(*) from public.correo_verificacion_ajustes) <> 1 then
    raise exception 'Los ajustes de la verificacion tienen que tener una sola fila.';
  end if;

  raise notice 'Listo. Correo → Secuencias → Ajustes → «Verificación de direcciones»: pega la clave de MillionVerifier y se enciende sola.';
end $$;
