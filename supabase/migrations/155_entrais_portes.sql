-- ==================================================================
-- 155 · EL PORTE DEJA DE SER UN NUMERO Y PASA A SER UNA REGLA
-- ==================================================================
--
-- Hasta ahora el porte eran 4 € para todo. Y para casi todo vale: el catalogo
-- tiene un peso mediano de 0,35 kg y son cables, cargadores y cajas de disco.
--
-- Pero el cliente ha pasado su tarifa de televisores:
--
--     de 50 a 55 pulgadas   35 €
--     de 55 a 65 pulgadas   45 €
--     de 65 en adelante     60 €
--     ... y TODO IVA INCLUIDO
--
-- Un televisor de 60 pulgadas con 4 € de porte sale a un precio que pierde
-- CUARENTA Y UN EUROS en cada venta, y el margen en pantalla diria que va al
-- 10 %. Es exactamente el tipo de numero que se descubre en la liquidacion.
--
--
-- LO DEL IVA NO ES UN DETALLE
-- ---------------------------
-- Los 4 € de siempre son SIN IVA: el coste de adquisicion se calcula sin
-- impuestos porque el IVA de compra se deduce. Los 35/45/60 que ha dado el
-- cliente son CON IVA — lo dice el ultimo mensaje.
--
-- Meter 35 en la misma columna donde hay un 4 que significa otra cosa es como
-- se cuela un 21 % de error sin que nadie lo note. Por eso cada regla dice si su
-- importe lleva IVA, y el motor lo quita antes de sumarlo. 35 € con IVA son
-- 28,93 € de coste real.
--
--
-- POR QUE POR SUBFAMILIA Y NO LEYENDO LAS PULGADAS DEL NOMBRE
-- ----------------------------------------------------------
-- Porque el nombre miente. En el catalogo hay 104 articulos con «TV» y solo 36
-- son televisores: el resto son SOPORTES de pared, y se llaman «SOPORTE
-- MONITOR-TV 37''-70''». Sacando las pulgadas del texto, a un soporte de 20 €
-- le tocarian 45 € de porte.
--
-- La subfamilia del proveedor ya trae el rango —«TV 55''-75''», «TV 85'' -
-- 120''»— y viene tanto en su API como en su fichero de tarifa. Es el dato que
-- ellos mantienen, no uno que nos inventemos parseando.

CREATE TABLE IF NOT EXISTS public.entrais_portes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- La primera regla que encaja manda. Sin orden explicito el resultado
  -- dependeria de como devolviera las filas Postgres ese dia.
  orden INTEGER NOT NULL,
  nombre TEXT NOT NULL,

  tipo TEXT NOT NULL CHECK (tipo IN ('subfamilia', 'familia', 'sku', 'defecto')),
  -- Lo que se busca. En 'subfamilia' y 'familia' se compara SIN distinguir
  -- mayusculas ni acentos y basta con que lo contenga; en 'sku' es exacto.
  -- En 'defecto' se ignora: esa regla encaja con todo.
  patron TEXT,

  importe NUMERIC NOT NULL CHECK (importe >= 0),
  -- true = el importe que hay arriba lleva IVA y hay que quitarselo
  iva_incluido BOOLEAN NOT NULL DEFAULT false,

  activa BOOLEAN NOT NULL DEFAULT true,
  nota TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id),

  -- Una regla que no es 'defecto' sin patron no encajaria con nada y ademas
  -- pareceria configurada. Se corta aqui.
  CONSTRAINT entrais_portes_patron_si_hace_falta
    CHECK (tipo = 'defecto' OR (patron IS NOT NULL AND btrim(patron) <> ''))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entrais_portes_orden ON public.entrais_portes (orden);

COMMENT ON TABLE public.entrais_portes IS
  'Cuanto cuesta el porte de cada producto. La primera regla que encaja manda; la de tipo «defecto» es la red que recoge todo lo demas.';
COMMENT ON COLUMN public.entrais_portes.iva_incluido IS
  'true = el importe lleva IVA y el motor lo quita antes de sumarlo al coste. Los 4 € de siempre son sin IVA; los portes de televisor que dio el cliente son con IVA.';

-- ---------- El porte aplicado queda en la fila del precio ----------
-- Sin esto, una propuesta de 703 € no dice si lleva 4 € de porte o 50, y
-- auditarla obligaria a volver a resolver las reglas del dia que se calculo.
ALTER TABLE public.entrais_precios
  ADD COLUMN IF NOT EXISTS porte NUMERIC;

COMMENT ON COLUMN public.entrais_precios.porte IS
  'El porte que se aplico a este producto, YA SIN IVA. Va aparte del coste para poder auditar de donde sale un precio.';

-- ---------- RLS: igual que el resto del modulo ----------
ALTER TABLE public.entrais_portes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entrais_portes_admin ON public.entrais_portes;
CREATE POLICY entrais_portes_admin ON public.entrais_portes
  FOR ALL USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

-- ---------- Las reglas que ya sabemos ----------
--
-- Los tramos del cliente NO encajan con los del proveedor, y hay que decirlo:
--
--     cliente:    50-55 -> 35    55-65 -> 45    65+ -> 60
--     proveedor:  TV 32''-43''  TV 49''-50''  TV 55''-75''  TV 85'' - 120''
--
-- «TV 55''-75''» cae a caballo entre el tramo de 45 € y el de 60 €. Se le pone
-- el de 60 porque quedarse corto en el porte es publicar barato y perder dinero
-- en cada venta, mientras que pasarse solo cuesta vender alguna menos. Y «TV
-- 32''-43''» no lo cotizo el cliente: se deja el porte de siempre y con una nota,
-- que es mejor que inventarse un numero.
INSERT INTO public.entrais_portes (orden, nombre, tipo, patron, importe, iva_incluido, nota)
VALUES
  (10, 'TV de 85 pulgadas o mas', 'subfamilia', 'TV 85',      60, true,
   'Tarifa del cliente: de 65 pulgadas en adelante, 60 € IVA incluido.'),
  (20, 'TV de 55 a 75 pulgadas',  'subfamilia', 'TV 55',      60, true,
   'A CABALLO ENTRE DOS TRAMOS del cliente (45 € hasta 65 pulgadas, 60 € por encima). Se pone el alto: quedarse corto en el porte es perder dinero en cada venta.'),
  (30, 'TV de 49 a 50 pulgadas',  'subfamilia', 'TV 49',      35, true,
   'Tarifa del cliente: de 50 a 55 pulgadas, 35 € IVA incluido.'),
  (40, 'TV de 32 a 43 pulgadas',  'subfamilia', 'TV 32',       4, false,
   'EL CLIENTE NO LO COTIZO: por debajo de las 50 pulgadas no dio precio. Se deja el porte de siempre hasta preguntarle.'),
  (999, 'Todo lo demas',          'defecto',    NULL,          4, false,
   'Los 4 € de siempre, sin IVA. Vale para el 99 % del catalogo: peso mediano 0,35 kg.')
ON CONFLICT (orden) DO NOTHING;

-- ---------- Comprobación ----------
DO $$
DECLARE
  n INTEGER;
  defectos INTEGER;
BEGIN
  IF to_regclass('public.entrais_portes') IS NULL THEN
    RAISE EXCEPTION 'No se ha creado public.entrais_portes.';
  END IF;

  SELECT count(*) INTO n FROM public.entrais_portes;
  SELECT count(*) INTO defectos FROM public.entrais_portes WHERE tipo = 'defecto' AND activa;

  -- Sin una regla que recoja todo, un producto que no encaje con ninguna se
  -- quedaria SIN PORTE, o sea con el coste incompleto y el margen inflado.
  IF defectos <> 1 THEN
    RAISE EXCEPTION 'Tiene que haber exactamente UNA regla de porte por defecto activa, y hay %.', defectos;
  END IF;

  RAISE NOTICE 'Reglas de porte: % en total, con su regla por defecto.', n;
END $$;
