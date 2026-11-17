-- 321 · PRECIOS DINÁMICOS DE ENTRAIS EN PCCOMPONENTES
--
-- Cada `cada_minutos` el ERP lee las ofertas de PcComponentes de los productos que Entrais tiene publicados y pone cada uno `centimos` por debajo del más
-- barato (o sube hasta quedar justo por debajo del siguiente si ya es el más barato), NUNCA por debajo del margen mínimo: `margen_bajo` si el producto cuesta
-- menos de `limite_coste` €, `margen_alto` si cuesta eso o más. En `ensayo` solo apunta lo que haría, sin tocar la tienda.
--
--   pcc_precios_config   una sola fila con la configuración y el resumen de la última pasada
--   pcc_precios_log      cada cambio decidido (o simulado), con el porqué y el puesto en que salía la oferta (para medir si ser el más barato basta)
--
-- Las dos cerradas al navegador: solo el servidor (clave de servicio), tras comprobar que quien pide es administrador. Desde aquí se cambian precios de un cliente.

create table if not exists public.pcc_precios_config (
  unica          boolean     primary key default true check (unica),
  activo         boolean     not null default true,
  ensayo         boolean     not null default true,
  cada_minutos   integer     not null default 30 check (cada_minutos between 5 and 1440),
  centimos       numeric     not null default 0.05 check (centimos >= 0.01 and centimos <= 5),
  limite_coste   numeric     not null default 100 check (limite_coste > 0),
  margen_bajo    numeric     not null default 0.10 check (margen_bajo >= 0 and margen_bajo < 0.8),
  margen_alto    numeric     not null default 0.08 check (margen_alto >= 0 and margen_alto < 0.8),
  subir          boolean     not null default true,
  ultima_pasada_at timestamptz,
  ultimo_resumen jsonb,
  actualizado_at timestamptz not null default now(),
  actualizado_por uuid references public.profiles (id) on delete set null
);
insert into public.pcc_precios_config (unica) values (true) on conflict (unica) do nothing;
alter table public.pcc_precios_config enable row level security;
comment on table public.pcc_precios_config is
  'Precios dinámicos de Entrais en PcComponentes: configuración (una fila). Cerrada al navegador.';

create table if not exists public.pcc_precios_log (
  id               bigserial   primary key,
  pasada_at        timestamptz not null default now(),
  sku              text        not null,
  ean              text,
  titulo           text,
  precio_antes     numeric,
  precio_nuevo     numeric,
  minimo           numeric,
  competidor_precio numeric,
  competidor_tienda text,
  -- En qué puesto salía nuestra oferta en la lista de PcComponentes (1 = la primera), antes del cambio
  puesto           integer,
  tiendas          integer,
  motivo           text        not null,
  ensayo           boolean     not null default true,
  enviado          boolean     not null default false,
  importacion_id   text,
  error            text
);
create index if not exists pcc_precios_log_pasada_idx on public.pcc_precios_log (pasada_at desc);
create index if not exists pcc_precios_log_sku_idx on public.pcc_precios_log (sku, pasada_at desc);
alter table public.pcc_precios_log enable row level security;
comment on table public.pcc_precios_log is
  'Cada cambio de precio decidido (o simulado en ensayo) en PcComponentes, con el porqué y el puesto de la oferta. Cerrada al navegador.';
