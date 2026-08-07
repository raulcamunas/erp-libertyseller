-- =====================================================
-- AMAZON API — DOS COLUMNAS QUE FALTABAN
-- =====================================================
-- Va DESPUÉS de 118_amazon_api.sql y no la sustituye: aquella crea el módulo
-- entero, esta añade dos datos que el código de arriba necesita guardar y no
-- tenía dónde. Las dos salieron de la revisión del módulo y las dos tapan un
-- fallo que no da ningún error visible, que es la clase peligrosa.
--
-- IDEMPOTENTE: se puede lanzar las veces que haga falta.

-- ---------- Guardia previa ----------
-- El editor SQL de Supabase corre el script entero en UNA transacción, así que
-- reventar aquí deja la base como estaba en vez de a medias.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'amazon_connections'
  ) THEN
    RAISE EXCEPTION
      'No existe public.amazon_connections. Lanza antes 118_amazon_api.sql, que es la que crea el módulo.';
  END IF;
END $$;

-- =====================================================
-- 1) EL VENDEDOR CON EL QUE SE ABRIÓ EL FLUJO DE OAUTH
-- =====================================================
-- QUÉ PROBLEMA RESUELVE, porque no se ve a simple vista:
--
-- En el camino del Appstore (/connect, ruta PÚBLICA y sin sesión) el
-- `selling_partner_id` llega por la query, o sea que lo pone quien llama. Con
-- él se resuelve a qué ficha de cliente del ERP pertenece la autorización, y el
-- `state` se ata a esa ficha. Hasta aquí, correcto.
--
-- El agujero estaba en la vuelta: /callback cogía el cliente del `state` —bien—
-- pero se creía el `selling_partner_id` que venía en la URL del callback SIN
-- comprobar que fuera el mismo con el que se abrió el flujo. O sea que se podía
-- abrir el flujo diciendo «soy el vendedor A» (el de un cliente real, para que
-- el state quede atado a SU ficha) y cerrarlo con «soy el vendedor B». El token
-- de la tienda de B quedaba archivado bajo la ficha del cliente A y, como el
-- UNIQUE es (selling_partner_id, region), ni siquiera sustituía a la conexión
-- buena: se ponía al lado. A partir de ahí, un admin que editara precios sobre
-- esa tarjeta los estaría mandando a la tienda de B.
--
-- Guardando aquí el vendedor con el que se abrió el flujo, el callback puede
-- comparar y cortar. NULL a propósito en el camino A (el enlace que genera un
-- admin desde la pantalla): ahí todavía no se sabe quién va a autorizar, así
-- que no hay nada que comparar y no se compara.
ALTER TABLE public.amazon_oauth_states
  ADD COLUMN IF NOT EXISTS selling_partner_id TEXT;

COMMENT ON COLUMN public.amazon_oauth_states.selling_partner_id IS
  'Vendedor con el que se ABRIÓ el flujo, cuando se conoce (camino del Appstore). Al volver por /callback tiene que coincidir con el que mande Amazon o la autorización se rechaza. NULL en los enlaces que genera un admin: ahí todavía no se sabe quién autoriza.';

-- =====================================================
-- 2) EL BARRIDO QUE SE QUEDÓ CORTO
-- =====================================================
-- searchListingsItems no puede paginar más allá de 1000 SKU: por encima de eso
-- deja de devolver páginas SIN DAR ERROR. El barrido detecta el recorte y lo
-- devuelve en su resultado, pero ese dato moría ahí: no se guardaba en ningún
-- sitio, así que el único aviso salía en la sesión de quien hubiera pulsado
-- «Refrescar» a mano — y quien refresca de verdad es el cron de cada quince
-- minutos, que no tiene a nadie delante.
--
-- Resultado: un cliente con 1.500 referencias aparecía con 1.000, la tarjeta
-- decía «1.000 referencias» como si fuera el total, el buscador no encontraba
-- los que faltaban y la conclusión era que ese producto no está en Amazon. Y
-- como el barrido ordena por SKU ascendente, siempre se leen los mismos 1.000:
-- el resto se congela con aspecto de estar al día.
--
-- Con esta columna la pantalla lo puede decir al abrirla, no solo tras
-- refrescar. Es además la señal de que a ese cliente hay que pasarlo al informe
-- GET_MERCHANT_LISTINGS_ALL_DATA, que es lo que ya prevé el comentario de
-- fetchCatalog.
ALTER TABLE public.amazon_connections
  ADD COLUMN IF NOT EXISTS last_sync_truncated BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.amazon_connections.last_sync_truncated IS
  'true cuando el último barrido no pudo recorrer el catálogo entero (searchListingsItems no pagina más allá de 1000 SKU y no da error al quedarse corto). La pantalla lo avisa: lo que se ve NO es todo el catálogo.';

-- =====================================================
-- 3) CUÁNTAS REFERENCIAS DICE AMAZON QUE HAY
-- =====================================================
-- Sin este número el aviso de arriba solo puede decir «faltan líneas». Con él
-- dice «Amazon dice que hay 1.500 y por esta vía solo se pueden leer 1.000»,
-- que es lo que permite decidir si merece la pena montar el informe.
ALTER TABLE public.amazon_connections
  ADD COLUMN IF NOT EXISTS last_sync_declared INTEGER;

COMMENT ON COLUMN public.amazon_connections.last_sync_declared IS
  'Cuántas referencias declaró Amazon en el último barrido (numberOfResults). Se compara con last_sync_items para saber cuántas se han quedado sin leer.';
