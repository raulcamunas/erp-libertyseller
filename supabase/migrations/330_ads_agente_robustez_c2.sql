-- 330 · Agente PPC: guardas técnicas (grupo c2: uso de presupuesto, vigilar y R1)
--
-- Tres tipos nuevos en la línea de tiempo del agente (ads_agente_eventos). No son frenos: el agente no cambia de estado, solo deja de escribir
-- en Amazon mientras dura el fallo y lo anota una vez al día.
--   · datos_viejos      el rendimiento o los términos llevan > 36 h sin sincronizar: aplicar y el deshacer de efectos no escriben, vigilar no propone R1–R4.
--   · vigilar_falla     vigilar ha fallado 3 veces seguidas: aplicar no escribe hasta que vuelva a ir bien.
--   · sin_autorizacion  la conexión con Amazon Ads está en error o revocada (401/403): aplicar no escribe hasta que una lectura vaya bien.
--
-- Sin esta migración el código funciona igual: anotarGuardaUnaVez apunta esos eventos como «uso_error» con el tipo real en datos->>'guarda'.
-- Idempotente: se puede lanzar más de una vez.

ALTER TABLE public.ads_agente_eventos DROP CONSTRAINT IF EXISTS ads_agente_eventos_tipo_check;
ALTER TABLE public.ads_agente_eventos ADD CONSTRAINT ads_agente_eventos_tipo_check CHECK (tipo IN (
  'encendido', 'apagado', 'ensayo_saltado', 'ensayo_fin', 'veda', 'rampa', 'freno', 'reanudado', 'reanudar_rechazado', 'deshacer_freno',
  'postura', 'objetivo_auto', 'objetivo_revisado', 'techo_auto', 'ritmo', 'agotada_top', 'mover_presupuesto', 'deshacer_auto', 'deshacer_fallo',
  'calibracion', 'ia_fallo', 'ia_tope', 'stock', 'stock_vuelve', 'stock_fallo', 'uso_error', 'primera_escritura', 'parada_general', 'topes', 'producto', 'temporada',
  'datos_viejos', 'vigilar_falla', 'sin_autorizacion'));
