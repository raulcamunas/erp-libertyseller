-- ==================================================================
-- 179 · LOS PRECIOS DE ENTRAIS, EN SU PROPIA PASADA
-- ==================================================================
--
-- Los precios se publicaban dentro de la pasada de stock, en la misma petición,
-- y por eso no se mandaban todos: las dos cosas se repartían una sola ventana
-- de 600 segundos. Medido en las ejecuciones reales del 14 de septiembre:
--
--     solo stock          ~145 s
--     stock y precios      300-480 s
--
-- A los precios les quedaban unos 115 segundos, que a los cinco patchListingsItem
-- por segundo que deja Amazon son unos 570 precios. La última pasada dejó
-- escrito: «598 precios aceptados por Amazon, 2 frenados. Quedan 893 para las
-- siguientes pasadas».
--
-- Y esos 893 no se retomaban enseguida: `amazon-sync` está a quince minutos, así
-- que cada resto esperaba un cuarto de hora.
--
-- Ahora los precios tienen su propia ruta y su propia ventana de 600 segundos:
-- unos 2.900 precios por pasada, cuando los que cambian de verdad hoy son 966.

-- ---------- 1. La tarea nueva ----------
-- cada_minutos = 1 a propósito. La ruta corre cada minuto y NO mira esta tabla
-- para decidir si publica: el intervalo de verdad está en
-- entrais_config.publicar_cada_minutos. Lo que consigue correr cada minuto es
-- que un resto pendiente se retome al minuto siguiente y no al cuarto de hora.
INSERT INTO public.cron_config (tarea, cada_minutos, activo)
VALUES ('entrais-precios', 1, true)
ON CONFLICT (tarea) DO UPDATE
  SET cada_minutos = 1, activo = true;

-- ---------- 2. La cadencia que pidió Raúl: cada hora ----------
--
-- Estaba a 0, que significa «al ritmo del sincronismo» —cada quince minutos—.
-- Recalcular y publicar una vez por hora es lo pedido, y de paso deja de
-- competir con el stock por el catálogo del proveedor.
--
-- Se cambia SOLO si sigue en 0: si alguien ya le puso un número a mano, manda
-- lo que puso.
UPDATE public.entrais_config
SET publicar_cada_minutos = 60,
    updated_at = NOW()
WHERE publicar_cada_minutos = 0;

DO $$
DECLARE
  v_cada INTEGER;
  v_auto BOOLEAN;
BEGIN
  SELECT publicar_cada_minutos, publicar_automatico INTO v_cada, v_auto
  FROM public.entrais_config LIMIT 1;
  RAISE NOTICE 'Precios de Entrais: automatico=% cada % minutos, en su propia pasada.', v_auto, v_cada;
END $$;
