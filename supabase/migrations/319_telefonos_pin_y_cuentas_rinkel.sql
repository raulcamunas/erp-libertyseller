-- 319 · Teléfonos: columna PIN y «Cuentas de Rinkel» (correo + contraseña)
--
--   · phone_numbers.pin      El PIN de cada número, en la misma tabla (solo dirección: la RLS de la 099 ya lo cierra a admin/partner).
--   · rinkel_cuentas         Las cuentas de Rinkel: correo, contraseña CIFRADA (AES-256-GCM en el servidor, con la clave del entorno; en la base solo hay texto cifrado) y notas.
--                            Cerrada al navegador: RLS sin políticas y REVOKE; solo la clave de servicio, a través de /api/rinkel-cuentas (solo administradores).
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE. El código funciona sin ella (la pantalla avisa de que falta lanzarla).

alter table public.phone_numbers add column if not exists pin text;

create table if not exists public.rinkel_cuentas (
  id               uuid        primary key default gen_random_uuid(),
  email            text        not null check (char_length(email) between 3 and 320),
  password_cifrada text,
  notas            text        check (notas is null or char_length(notas) <= 500),
  position         integer,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists rinkel_cuentas_position_idx on public.rinkel_cuentas (position);
comment on table public.rinkel_cuentas is 'Cuentas de Rinkel (correo y contraseña cifrada). Cerrada al navegador: solo la clave de servicio.';

alter table public.rinkel_cuentas enable row level security;
revoke all on table public.rinkel_cuentas from anon, authenticated;

select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'phone_numbers' and column_name = 'pin') as tiene_pin,
  (select relrowsecurity from pg_class where oid = 'public.rinkel_cuentas'::regclass) as cuentas_cerradas;
