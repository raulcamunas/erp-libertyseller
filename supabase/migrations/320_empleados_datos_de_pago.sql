-- 320 · DATOS DE PAGO DE LOS EMPLEADOS Y EL ENLACE PARA PEDIRLOS
--
-- Para pagar a todo el equipo a la vez (un CSV de pagos en lote de Payset o Wise) hacen falta los datos bancarios de cada persona. Se los pide un
-- enlace público de un solo uso que dirección manda por WhatsApp: la persona rellena un formulario (sin entrar al ERP) y los datos quedan en su ficha.
--
--   employee_payment_details            los datos vigentes de cada empleado (uno por persona)
--   employee_payment_details_historial  cada envío, con fecha e IP: si alguien intenta desviar un pago cambiando la cuenta, queda rastro
--   employee_payment_links              los enlaces: token de 256 bits, caducan a los 7 días y sirven UNA vez
--
-- Las tres tablas están CERRADAS al navegador (RLS sin políticas): solo las toca el servidor con la clave de servicio, después de comprobar que quien
-- pide es administrador o, en el enlace público, que el token es válido. Son datos bancarios: ni un socio ni un empleado los lee desde el cliente.
--
-- Aviso para otras ramas: si una migración posterior reescribe la lista de notifications_type_check, tiene que incluir 'datos_de_pago'.

do $$
begin
  if to_regclass('public.employees') is null then
    raise exception 'Falta lanzar antes la migración 111_employees.sql.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass) then
    raise exception 'No encuentro la comprobación notifications_type_check (migración 251 o posteriores).';
  end if;
end $$;


-- ---------- 1. Los datos vigentes ----------
create table if not exists public.employee_payment_details (
  employee_id  uuid        primary key references public.employees (id) on delete cascade,
  -- Lo que ha rellenado la persona, ya validado en el servidor (lib/empleados/datos-de-pago.ts): titular, dirección, banco, moneda y la cuenta según el país
  datos        jsonb       not null,
  enviado_at   timestamptz not null default now(),
  enviado_ip   text,
  actualizado_at timestamptz not null default now()
);
alter table public.employee_payment_details enable row level security;
comment on table public.employee_payment_details is
  'Datos bancarios vigentes de cada empleado. Cerrada al navegador: solo la clave de servicio, tras comprobar admin.';


-- ---------- 2. El historial de envíos ----------
create table if not exists public.employee_payment_details_historial (
  id           uuid        primary key default gen_random_uuid(),
  employee_id  uuid        not null references public.employees (id) on delete cascade,
  datos        jsonb       not null,
  enviado_at   timestamptz not null default now(),
  enviado_ip   text,
  user_agent   text
);
create index if not exists employee_payment_details_historial_emp_idx on public.employee_payment_details_historial (employee_id, enviado_at desc);
alter table public.employee_payment_details_historial enable row level security;
comment on table public.employee_payment_details_historial is
  'Cada envío de datos bancarios de un empleado, con fecha e IP. Rastro por si alguien cambia la cuenta para desviar un pago. Cerrada al navegador.';


-- ---------- 3. Los enlaces ----------
create table if not exists public.employee_payment_links (
  id           uuid        primary key default gen_random_uuid(),
  employee_id  uuid        not null references public.employees (id) on delete cascade,
  -- 32 bytes de azar en base64url: es la credencial del formulario público
  token        text        not null unique,
  creado_por   uuid        references public.profiles (id) on delete set null,
  creado_at    timestamptz not null default now(),
  caduca_at    timestamptz not null,
  -- Se rellena al enviar: un enlace usado ya no abre nada
  usado_at     timestamptz,
  desactivado  boolean     not null default false,
  aperturas    integer     not null default 0,
  ultima_apertura timestamptz
);
create index if not exists employee_payment_links_emp_idx on public.employee_payment_links (employee_id, creado_at desc);
alter table public.employee_payment_links enable row level security;
comment on table public.employee_payment_links is
  'Enlaces de un solo uso (7 días) para que un empleado envíe sus datos de pago. Cerrada al navegador.';


-- ---------- 4. El aviso de la campana: «X ha enviado sus datos de pago» ----------
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
  if def like '%''datos_de_pago''%' then
    return;
  end if;
  select array_agg(distinct m[1]) into tipos from regexp_matches(def, '''([^'']+)''', 'g') as m;
  select count(*) into n_literales from regexp_matches(def, '''([^'']+)''', 'g');
  select count(*) into n_text      from regexp_matches(def, '''::text', 'g');
  if tipos is null or array_length(tipos, 1) < 5 or n_literales <> n_text then
    raise exception 'No he podido leer la lista de tipos de la campana (%). Revísala a mano.', def;
  end if;
  tipos := array_append(tipos, 'datos_de_pago');
  select string_agg(quote_literal(t), ', ' order by t) into lista from unnest(tipos) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type in (%s))', lista);
end $$;
