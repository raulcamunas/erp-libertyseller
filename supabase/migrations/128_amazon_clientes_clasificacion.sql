-- ============================================================================
-- 128 — CUÁNDO SE CLASIFICÓ UN CLIENTE
-- ============================================================================
--
-- UNA SOLA COLUMNA, Y EL MOTIVO CABE EN UN PÁRRAFO.
--
-- La migración 123 añadió `amazon_clients.modelo_negocio` con NOT NULL DEFAULT
-- 'mix'. O sea que ahora mismo los 16 clientes dicen «mixto», y ninguno lo dice
-- porque alguien lo haya decidido: lo dicen porque es el valor por defecto y
-- hasta hoy no existía la pantalla para cambiarlo.
--
-- Eso mezcla dos cosas que no son la misma:
--
--     «este cliente es mixto»          -> una decisión
--     «nadie se ha pronunciado»        -> un hueco
--
-- Y la diferencia se paga en la ventana nocturna. Mientras un catálogo de
-- reventa de 13.700 SKU siga marcado como mixto por defecto, el planificador le
-- pide el BSR a diario: unas 44.000 llamadas a dos por segundo son seis horas
-- cada noche midiendo el ranking de productos que no son de ese cliente. Hasta
-- que alguien clasifique, no se ahorra nada — y la pantalla no puede decir
-- cuántos faltan si no sabe distinguir el hueco de la decisión.
--
-- CON LA COLUMNA, «sin clasificar» es `modelo_negocio_at IS NULL` y el contador
-- de la pestaña Cuentas baja hasta cero según se va trabajando. SIN ella, la
-- pantalla tiene que tomar «mixto» por «sin clasificar», y entonces un cliente
-- que de verdad es mixto se queda marcado como pendiente para siempre: una
-- alerta que no se apaga nunca es una alerta que nadie lee.
--
-- La pantalla funciona con y sin esta migración: si la columna no está, cae al
-- criterio de arriba y lo dice. Lanzarla es lo que hace que el contador sirva.
--
-- IDEMPOTENTE. El editor SQL de Supabase ejecuta el fichero entero en UNA
-- transacción, así que todo va con guarda y se puede volver a lanzar.
-- ============================================================================

-- ---------- La marca de «esto lo ha decidido alguien» ----------
-- Anulable A PROPÓSITO: NULL no es una fecha cero, es «todavía nadie». Es la
-- misma regla que gobierna el FOEP, el BSR y el coste en este módulo — un cero
-- que en realidad significa «no lo sabemos» es el error más caro de esta capa.
ALTER TABLE public.amazon_clients
  ADD COLUMN IF NOT EXISTS modelo_negocio_at TIMESTAMPTZ;

COMMENT ON COLUMN public.amazon_clients.modelo_negocio_at IS
  'Cuándo se confirmó a mano el modelo de negocio y la política de BSR de este '
  'cliente. NULL = nadie se ha pronunciado y lo que dice modelo_negocio es solo '
  'el valor por defecto de la migración 123, no una decisión.';

-- ---------- Los que ya estaban clasificados de verdad ----------
-- Nadie puede haber clasificado nada todavía: la pantalla que escribe estas dos
-- columnas se estrena con esta migración. Pero si alguien lo hizo a mano por
-- SQL, su decisión NO se puede perder por lanzar esto — un cliente marcado como
-- marca propia o como arbitraje no es el valor por defecto, así que se da por
-- confirmado y no vuelve a la lista de pendientes.
--
-- Los que están en 'mix' se quedan en NULL: ahí no hay forma de saber si es una
-- decisión o el defecto, y ante la duda se pregunta en vez de inventar.
UPDATE public.amazon_clients
SET modelo_negocio_at = COALESCE(updated_at, created_at, now())
WHERE modelo_negocio_at IS NULL
  AND modelo_negocio IS NOT NULL
  AND modelo_negocio <> 'mix';

-- ---------- Buscar a los pendientes ----------
-- Parcial y sobre NULL: la consulta que hace la pantalla es «¿quién falta?», y
-- el índice solo tiene que llevar dentro a los que faltan. Según se vayan
-- clasificando, el índice se vacía solo.
CREATE INDEX IF NOT EXISTS amazon_clients_sin_clasificar_idx
  ON public.amazon_clients (id)
  WHERE modelo_negocio_at IS NULL;

-- ---------- RLS ----------
-- No se toca ninguna política: `amazon_clients` ya las tiene de la migración
-- 118 y añadir una columna no las cambia. Además esta columna solo se escribe
-- desde /api/amazon/clients/[id], que corre en el servidor con service_role
-- detrás de requireAmazonAdmin().
