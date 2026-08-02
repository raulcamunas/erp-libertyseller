-- =====================================================
-- COLD CALLING: dejar la tabla limpia antes de reimportar
-- =====================================================
-- La primera importación se quedó a medias (José aparecía con 334 leads
-- de 1.178 y ninguno traía lista de origen). Antes de volver a subir los
-- CSV hay que vaciar la tabla, o quedarían mezclados los de la
-- importación buena con los de la rota.
--
-- CASCADE se lleva por delante también las notas asociadas, que en esta
-- fase solo pueden ser las volcadas desde el Excel: si algún comercial ya
-- ha registrado interacciones propias, PARA y avísame antes de ejecutar
-- esto.

TRUNCATE TABLE public.cold_leads CASCADE;
