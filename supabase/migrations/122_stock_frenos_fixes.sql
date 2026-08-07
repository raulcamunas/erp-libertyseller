-- =====================================================
-- 122 · LOS FRENOS, DESPUÉS DE LA AUDITORÍA
-- =====================================================
--
-- Tres revisiones de la automatización encontraron el mismo patrón repetido en
-- sitios distintos: UN FRENO QUE NO SE PUEDE MEDIR DEJABA PASAR EL LOTE. Un
-- umbral sin rellenar, un dato que falta o un caso que nadie contempló salían
-- todos igual —«no ha saltado»— y contaban como permiso para escribir en la
-- tienda de un cliente. Esta migración cierra la parte que vive en la base:
--
--   1. freno_caida_unidades_pct, que no existía. Ningún freno cubría el
--      derrumbe de unidades que NO llega a cero: un fichero con todas sus
--      líneas, todos sus SKU y las unidades divididas por mil no movía el
--      porcentaje a cero, no movía la caída de líneas y no tocaba ningún
--      precio. La tienda se quedaba con 200 unidades donde había 280.000 y la
--      ejecución se registraba en verde.
--
--   2. freno_max_cambios nacía en NULL —era el único de los cuatro sin
--      DEFAULT— así que el «freno de red», el que coge lo que a los otros se
--      les escapa, venía apagado de fábrica en todos los clientes nuevos.
--
--   3. No se podía encender el envío automático sin frenos, y ahora sí se
--      exige: la decisión D del encargo existe justo para impedir eso.
--
--   4. stock_profile_runs.avisos, para que lo que el simulacro redacta y no
--      frena —el espejo del catálogo vacío, el fichero de EAN ilegible, una
--      columna que casó por parecido— deje rastro. Sin esta columna se
--      redactaba, se enseñaba una vez y se perdía; en el ciclo automático, que
--      no tiene a nadie delante, se perdía siempre.
--
-- Se lanza en el editor SQL de Supabase, después de la 120 y la 121.
-- Es idempotente: se puede volver a pegar sin romper nada.

-- =====================================================
-- 1) EL FRENO QUE FALTABA: CAÍDA DE UNIDADES
-- =====================================================

ALTER TABLE public.stock_read_profiles
  ADD COLUMN IF NOT EXISTS freno_caida_unidades_pct NUMERIC(5, 2) DEFAULT 40;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_read_profiles_caida_unidades_ok'
  ) THEN
    ALTER TABLE public.stock_read_profiles
      ADD CONSTRAINT stock_read_profiles_caida_unidades_ok
      CHECK (freno_caida_unidades_pct IS NULL
             OR (freno_caida_unidades_pct >= 0 AND freno_caida_unidades_pct <= 100));
  END IF;
END $$;

COMMENT ON COLUMN public.stock_read_profiles.freno_caida_unidades_pct IS
  'Caída máxima de UNIDADES publicadas, en %, sobre lo que Amazon tiene ahora en los SKU que el lote toca. Es el único freno que ve un derrumbe de stock que no llega a cero: un CSV leído con el criterio decimal equivocado deja todas las líneas y todos los SKU en su sitio y hunde las cantidades.';

-- El 40% por defecto no es un número redondo por casualidad: un almacén real
-- puede perder un tercio de sus unidades en una semana de campaña sin que pase
-- nada raro, y lo que este freno busca es el orden de magnitud —dividir por
-- diez o por cien—, no la variación de un martes.
UPDATE public.stock_read_profiles
  SET freno_caida_unidades_pct = 40
  WHERE freno_caida_unidades_pct IS NULL;

-- =====================================================
-- 2) freno_max_cambios DEJA DE NACER APAGADO
-- =====================================================
-- Era el único de los cuatro sin DEFAULT (los otros llevan 20, 30 y 15), así
-- que había que acordarse de rellenarlo a mano en cada cliente para que el
-- freno existiera. Y es justo el que coge lo que a los demás se les escapa:
-- un fichero con los precios en otra divisa, un cambio de criterio en el ERP
-- del cliente. Cualquier cosa rara acaba tocando muchas más líneas de lo normal.
ALTER TABLE public.stock_read_profiles
  ALTER COLUMN freno_max_cambios SET DEFAULT 500;

COMMENT ON COLUMN public.stock_read_profiles.freno_max_cambios IS
  'Máximo de SKU que pueden cambiar en un lote. 500 de fábrica: conservador para un cliente pequeño y ajustable hacia arriba con el primer simulacro delante. Antes nacía NULL, que es lo mismo que nacer apagado.';

-- A los perfiles que ya existen se les pone también, por lo mismo: un perfil
-- creado ayer no debería quedarse sin este freno para siempre.
UPDATE public.stock_read_profiles
  SET freno_max_cambios = 500
  WHERE freno_max_cambios IS NULL;

-- =====================================================
-- 3) NO SE ENCIENDE EL ENVÍO AUTOMÁTICO SIN FRENOS
-- =====================================================
-- Los umbrales son NULLABLE y están en la lista blanca de campos editables, así
-- que la pantalla podía dejarlos vacíos; con los cuatro a NULL, un lote que
-- ponía a cero el catálogo entero de un cliente salía con puedeEnviar = true y
-- nada en la base lo impedía.
--
-- lineas_referencia entra en la exigencia a propósito: sin ese número el freno
-- de caída de líneas está declarado pero no puede saltar, y es precisamente el
-- que detecta el volcado a medias. Obligarlo aquí significa que la referencia
-- se fija con una ejecución en simulacro que una persona ha dado por buena
-- ANTES de encender el envío, que es lo que ya recomendaba el código y nada
-- obligaba.
-- Antes de poner el CHECK hay que dejar las filas que ya existen en un estado
-- que lo cumpla, o el ALTER TABLE falla entero. Un perfil con el envío
-- encendido y sin frenos es justo lo que esta migración existe para impedir, así
-- que se le APAGA el envío: vuelve a simulacro, que es donde nace todo perfil, y
-- quien lo encendió lo vuelve a encender cuando rellene los límites.
DO $$
DECLARE
  apagados INTEGER;
BEGIN
  UPDATE public.stock_read_profiles
    SET envio_automatico = false
    WHERE envio_automatico = true
      AND (
        freno_pct_a_cero IS NULL
        OR freno_variacion_precio_pct IS NULL
        OR freno_caida_lineas_pct IS NULL
        OR freno_caida_unidades_pct IS NULL
        OR freno_max_cambios IS NULL
        OR lineas_referencia IS NULL
      );
  GET DIAGNOSTICS apagados = ROW_COUNT;
  IF apagados > 0 THEN
    RAISE NOTICE 'Se ha apagado el envío automático de % perfil(es) que lo tenían encendido sin todos los frenos puestos. Vuelve a encenderlo cuando rellenes los límites.', apagados;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_read_profiles_frenos_ok'
  ) THEN
    ALTER TABLE public.stock_read_profiles
      ADD CONSTRAINT stock_read_profiles_frenos_ok
      CHECK (
        envio_automatico = false
        OR (
          freno_pct_a_cero IS NOT NULL
          AND freno_variacion_precio_pct IS NOT NULL
          AND freno_caida_lineas_pct IS NOT NULL
          AND freno_caida_unidades_pct IS NOT NULL
          AND freno_max_cambios IS NOT NULL
          AND lineas_referencia IS NOT NULL
        )
      );
  END IF;
END $$;

-- =====================================================
-- 4) EL NUEVO CÓDIGO DE FRENO EN LAS EJECUCIONES
-- =====================================================
-- El código tiene que ser el mismo en tres sitios: aquí, en StockBrakeCode
-- (lib/types/stock-sync.ts) y en lib/stock-sync/frenos.ts. Si baila en uno de
-- los tres, la fila no se puede guardar y se pierde la constancia del freno.
ALTER TABLE public.stock_profile_runs
  DROP CONSTRAINT IF EXISTS stock_profile_runs_freno_check;

ALTER TABLE public.stock_profile_runs
  ADD CONSTRAINT stock_profile_runs_freno_check
  CHECK (freno IS NULL OR freno IN (
    'pct_a_cero', 'variacion_precio', 'caida_lineas', 'caida_unidades', 'max_cambios'
  ));

-- =====================================================
-- 5) LOS AVISOS DE LA EJECUCIÓN
-- =====================================================
ALTER TABLE public.stock_profile_runs
  ADD COLUMN IF NOT EXISTS avisos JSONB;

COMMENT ON COLUMN public.stock_profile_runs.avisos IS
  'Avisos del simulacro ya redactados en español. No frenan, pero son lo único que explica un resultado raro: espejo del catálogo vacío, fichero de códigos de barras ilegible, columna emparejada por parecido de nombre. Antes se perdían en cuanto se cerraba la pantalla.';

-- =====================================================
-- 6) LA CAMPANA DEJA DE MENTIR
-- =====================================================
-- Dos cosas, las dos de la misma auditoría:
--
--   · El aviso decía «Envío detenido» también en los perfiles que tienen el
--     envío APAGADO, que por la decisión E son TODOS los clientes nuevos. Ahí
--     un freno no detiene ningún envío, porque no había ninguno: lo que ha
--     pasado es que el simulacro ha frenado, y decirlo de otra forma hace que
--     el primer aviso que recibe alguien sobre un cliente nuevo sea falso.
--
--   · Sonaba también cuando el simulacro lo lanzaba una persona desde la
--     pantalla. Pulsar «Ejecutar simulacro» durante el alta de un cliente
--     mandaba una notificación a TODOS los admins del ERP, y quien lo pulsó
--     está mirando el resultado en su pantalla.
CREATE OR REPLACE FUNCTION public.create_stock_freno_notification()
RETURNS TRIGGER AS $$
DECLARE
  admin_user RECORD;
  nombre_cliente TEXT;
  anterior RECORD;
  automatico BOOLEAN;
  tipo_aviso TEXT;
  titulo TEXT;
  cuerpo TEXT;
BEGIN
  IF NEW.estado NOT IN ('frenado', 'error') THEN
    RETURN NEW;
  END IF;

  -- Lo ha lanzado una persona desde la pantalla: ya está viendo el resultado.
  IF NEW.created_by IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- La ejecución ANTERIOR de este mismo perfil. Es todo lo que hace falta para
  -- distinguir «acaba de pasar algo» de «sigue pasando lo mismo».
  SELECT r.estado, r.freno INTO anterior
  FROM public.stock_profile_runs r
  WHERE r.profile_id = NEW.profile_id
    AND r.id <> NEW.id
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT 1;

  IF anterior.estado IS NOT NULL
     AND anterior.estado = NEW.estado
     AND anterior.freno IS NOT DISTINCT FROM NEW.freno
  THEN
    RETURN NEW;
  END IF;

  SELECT name INTO nombre_cliente FROM public.stock_clients WHERE id = NEW.client_id;
  SELECT envio_automatico INTO automatico
    FROM public.stock_read_profiles WHERE id = NEW.profile_id;

  IF NEW.estado = 'frenado' THEN
    tipo_aviso := 'freno_stock';
    titulo := CASE
      WHEN COALESCE(automatico, false)
        THEN 'Envío detenido: ' || COALESCE(nombre_cliente, 'cliente sin nombre')
      ELSE 'Freno en el simulacro de ' || COALESCE(nombre_cliente, 'cliente sin nombre')
    END;
    cuerpo := COALESCE(NEW.freno_detalle, 'Ha saltado un freno y no se ha mandado nada a Amazon.');
  ELSE
    tipo_aviso := 'fallo_stock';
    titulo := 'No se ha podido procesar: ' || COALESCE(nombre_cliente, 'cliente sin nombre');
    -- Recortado: el cuerpo de la campana son dos líneas, y un error de Drive con
    -- su traza entera dentro no lo lee nadie. El texto completo está en la fila.
    cuerpo := LEFT(COALESCE(NEW.error_message, 'La lectura del fichero ha fallado.'), 300);
  END IF;

  FOR admin_user IN SELECT id FROM public.profiles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, type, title, message, read, created_at)
    VALUES (admin_user.id, tipo_aviso, titulo, cuerpo, false, NOW());
  END LOOP;

  RETURN NEW;
EXCEPTION
  -- Que no se pueda avisar NO puede costar la fila de la ejecución: sin ella se
  -- pierde el único sitio donde consta que el sistema paró y por qué.
  WHEN OTHERS THEN
    RAISE NOTICE 'No se ha podido crear el aviso de la ejecución (%). La ejecución sí queda registrada.', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
