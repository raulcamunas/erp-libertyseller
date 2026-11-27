-- ENTRAIS · TOPE DE UNIDADES POR PRODUCTO (Amazon y PcComponentes juntos)
-- Un producto con tope no se publica con más stock que «tope − lo vendido desde `desde`» en los dos canales, hasta `hasta` (incluido).
-- Pasada la fecha, vuelve solo al stock del proveedor. Caso de uso: ofertas del distribuidor limitadas a N unidades por cliente.
CREATE TABLE IF NOT EXISTS public.entrais_topes (
  sku TEXT PRIMARY KEY,
  unidades INTEGER NOT NULL CHECK (unidades >= 0),
  desde DATE NOT NULL,
  hasta DATE NOT NULL,
  nota TEXT,
  creado_por UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (hasta >= desde)
);
ALTER TABLE public.entrais_topes ENABLE ROW LEVEL SECURITY;

-- El primero: ASUS VivoBook X1504VA-BQ4104 (ref. 48087), máximo 5 unidades hasta fin de mes
INSERT INTO public.entrais_topes (sku, unidades, desde, hasta, nota)
VALUES ('48087', 5, '2026-11-27', '2026-11-30', 'Oferta Black Friday del distribuidor: 5 unidades por cliente')
ON CONFLICT (sku) DO NOTHING;
