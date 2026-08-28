-- ==================================================================
-- 163 · QUE UN CLIENTE NUEVO APAREZCA EN TODAS PARTES
-- ==================================================================
--
-- La 151 creó `public.clientes` como el cliente único de la agencia y enlazó
-- `amazon_clients` y `marketing_clients` a ella. Y funcionó: al aplicarla no
-- quedó ni un huérfano, y de hecho la propia migración se negaba a terminar si
-- los hubiera.
--
-- Pero enlazó UNA VEZ. Todo lo que se dio de alta después se quedó suelto,
-- porque nada crea la fila de `clientes` al crear un cliente de Amazon:
--
--     Lenobotics         enlazado    (existía al aplicar la 151)
--     Liberty UpGrowth   enlazado
--     Shoplamp           enlazado
--     Yo By Yolanda      SIN ENLACE  15 ago
--     Entrais            SIN ENLACE  17 ago
--     Keslem             SIN ENLACE  25 ago
--     Creative Toys      SIN ENLACE  27 ago
--     Bodegas Valhalla   SIN ENLACE  28 ago
--     Opinas             SIN ENLACE  28 ago
--     Tapas Party        SIN ENLACE  28 ago
--
-- SIETE DE DIEZ. Y el sintoma con el que se descubrio: al asignar una cuenta de
-- anunciante de Amazon Ads a su cliente, «Opinas» no salia en el desplegable. No
-- salia porque ese desplegable lee `clientes`, y Opinas solo estaba en
-- `amazon_clients`.
--
-- Un cliente que existe en una pantalla y no en otra no da ningun error: da una
-- lista incompleta, y quien la mira piensa que se le ha olvidado darlo de alta.
--
--
-- ESTO NO ES LA UNIFICACION, ES EL PARCHE QUE LA HACE ESPERABLE
-- ------------------------------------------------------------
-- Lo correcto sigue siendo una sola tabla de clientes, y sigue pendiente. Esto
-- hace dos cosas mas modestas: enlaza lo que hay, y pone un disparador para que
-- lo que venga se enlace solo. Mientras la unificacion no llegue, al menos la
-- lista no vuelve a desincronizarse sola.

-- ---------- 1. Enlazar por nombre exacto ----------
-- El `nombre_norm` de `clientes` es una columna generada: minusculas, sin
-- tildes y sin espacios de sobra. Aqui se replica la misma normalizacion sobre
-- `amazon_clients.name`, que no la tiene.
UPDATE public.amazon_clients a
SET cliente_id = c.id
FROM public.clientes c
WHERE a.cliente_id IS NULL
  AND lower(trim(translate(a.name, 'áàäâéèëêíìïîóòöôúùüûÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛ',
                                   'aaaaeeeeiiiioooouuuuAAAAEEEEIIIIOOOOUUUU'))) = c.nombre_norm;

-- ---------- 2. Enlazar cuando un nombre contiene al otro ----------
-- «Tapas Party» en Amazon y «Jamones Tapas Party» en marketing son el mismo
-- cliente escrito de dos formas. Crear una fila nueva por eso dejaria dos
-- clientes que son uno, que es peor que el problema que se viene a arreglar.
--
-- SOLO SI HAY UNA SOLA CANDIDATA. Con dos, adivinar cual es peor que no
-- enlazar: el paso 3 crea uno nuevo y queda a la vista para arreglarlo a mano.
UPDATE public.amazon_clients a
SET cliente_id = (
  SELECT c.id FROM public.clientes c
  WHERE c.nombre_norm LIKE '%' || lower(trim(translate(a.name,
          'áàäâéèëêíìïîóòöôúùüûÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛ',
          'aaaaeeeeiiiioooouuuuAAAAEEEEIIIIOOOOUUUU'))) || '%'
)
WHERE a.cliente_id IS NULL
  AND (
    SELECT count(*) FROM public.clientes c
    WHERE c.nombre_norm LIKE '%' || lower(trim(translate(a.name,
            'áàäâéèëêíìïîóòöôúùüûÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛ',
            'aaaaeeeeiiiioooouuuuAAAAEEEEIIIIOOOOUUUU'))) || '%'
  ) = 1;

-- ---------- 3. Crear los que no existen, y enlazarlos ----------
INSERT INTO public.clientes (nombre)
SELECT DISTINCT a.name
FROM public.amazon_clients a
WHERE a.cliente_id IS NULL
ON CONFLICT (nombre_norm) DO NOTHING;

UPDATE public.amazon_clients a
SET cliente_id = c.id
FROM public.clientes c
WHERE a.cliente_id IS NULL
  AND lower(trim(translate(a.name, 'áàäâéèëêíìïîóòöôúùüûÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛ',
                                   'aaaaeeeeiiiioooouuuuAAAAEEEEIIIIOOOOUUUU'))) = c.nombre_norm;

-- ---------- 4. Y que no vuelva a pasar ----------
-- El disparador hace al dar de alta lo mismo que los pasos 1 y 3: busca por
-- nombre normalizado y, si no existe, lo crea. Sin él, el siguiente cliente que
-- se dé de alta vuelve a quedarse fuera de Marketing y nadie se entera hasta que
-- alguien echa en falta un nombre en un desplegable.
CREATE OR REPLACE FUNCTION public.amazon_client_enlaza_cliente()
RETURNS TRIGGER AS $$
DECLARE
  norm TEXT;
  encontrado UUID;
BEGIN
  IF NEW.cliente_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  norm := lower(trim(translate(NEW.name, 'áàäâéèëêíìïîóòöôúùüûÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛ',
                                         'aaaaeeeeiiiioooouuuuAAAAEEEEIIIIOOOOUUUU')));

  SELECT id INTO encontrado FROM public.clientes WHERE nombre_norm = norm;

  IF encontrado IS NULL THEN
    INSERT INTO public.clientes (nombre) VALUES (NEW.name)
    ON CONFLICT (nombre_norm) DO NOTHING;
    SELECT id INTO encontrado FROM public.clientes WHERE nombre_norm = norm;
  END IF;

  NEW.cliente_id := encontrado;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.amazon_client_enlaza_cliente() IS
  'Al dar de alta un cliente de Amazon, lo enlaza con public.clientes o lo crea. Sin esto, el cliente nuevo no aparece en Marketing ni en los desplegables de Ads, y no da ningun error: da una lista incompleta.';

DROP TRIGGER IF EXISTS trg_amazon_clients_enlace ON public.amazon_clients;
CREATE TRIGGER trg_amazon_clients_enlace
  BEFORE INSERT ON public.amazon_clients
  FOR EACH ROW EXECUTE FUNCTION public.amazon_client_enlaza_cliente();

-- ---------- Comprobacion ----------
DO $$
DECLARE
  sueltos INTEGER;
  total INTEGER;
BEGIN
  SELECT count(*) INTO sueltos FROM public.amazon_clients WHERE cliente_id IS NULL;
  SELECT count(*) INTO total FROM public.clientes;

  IF sueltos > 0 THEN
    RAISE EXCEPTION
      'Han quedado % clientes de Amazon sin enlazar. Mira si alguno tiene un nombre que casa con dos de public.clientes a la vez.', sueltos;
  END IF;

  RAISE NOTICE 'Clientes enlazados. public.clientes tiene ahora % filas, y los nuevos se enlazan solos.', total;
END $$;
