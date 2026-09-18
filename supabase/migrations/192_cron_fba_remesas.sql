-- ============================================================================
-- 192 · HORARIO DE LA PASADA DE REMESAS A FBA
-- ============================================================================
--
-- Una vez al día (1440 minutos). No es una cadencia conservadora por si acaso:
-- el libro mayor de inventario es HISTÓRICO, no stock vivo. Pedirlo cada hora
-- devolvería exactamente lo mismo y cada pasada gasta una ficha de createReport,
-- que Amazon repone UNA VEZ POR MINUTO y comparte con el censo del catálogo.
--
-- El stock de FBA que la misma pasada refresca sí se mueve durante el día, pero
-- para el panel de remesas solo hace falta para CUADRAR —comparar lo que dicen
-- las remesas con lo que Amazon tiene—, y eso se mira una vez al día, no a cada
-- rato. El stock que se ve en la pantalla de catálogo sigue viniendo del ciclo
-- de quince minutos, que no se toca.
--
-- Se puede subir o bajar desde la pantalla de Sistema sin desplegar.
-- ============================================================================

INSERT INTO public.cron_config (tarea, cada_minutos, activo)
VALUES ('fba-remesas', 1440, true)
ON CONFLICT (tarea) DO UPDATE
  SET cada_minutos = EXCLUDED.cada_minutos,
      activo = EXCLUDED.activo,
      actualizado_at = NOW();
