-- ============================================================================
-- 249 · CORREO: ESCRIBIR CADA SEGUIMIENTO JUSTO ANTES DE ENVIARLO
-- ============================================================================
--
-- Hasta ahora, los seguimientos de una secuencia se escribían todos al programarla (el comercial manda el primer correo y la IA deja escritos los de
-- dentro de 3 y 7 días hábiles) y salían tal cual, salvo que desde entonces alguien hubiera anotado algo en la ficha del lead.
--
-- Con este ajuste, unos minutos antes de enviar cada seguimiento la IA lo escribe de nuevo leyendo TODO lo que consta del lead en ese momento: lo que se
-- habló en las llamadas (el resumen que deja la transcripción de Rinkel, el interés que mostró y el siguiente paso acordado), las notas del comercial, lo
-- que ya se le envió y los datos de su empresa. Así el correo es de esa persona y no una plantilla de hace una semana. El texto de cuando se programó
-- queda como BORRADOR (una idea de por dónde ir y, si la IA no puede, lo que sale). Si en el historial hay algo que pide que lo mire una persona (dijo que
-- no le interesa, pidió esperar, se quejó…), no escribe: deja la secuencia en pausa con el motivo.
--
--   · `correo_secuencia_ajustes.redactar_al_enviar`  Interruptor, en Correo → Secuencias → Ajustes. Nace ENCENDIDO. Apagado vuelve a lo de antes.
--
-- Una sola columna: no toca ninguna fila ni ninguna política. El código funciona SIN esta migración (se comporta como con el interruptor apagado).
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni perder lo hecho.
-- Hace falta haber lanzado antes la 245 (secuencias).
-- ============================================================================


ALTER TABLE public.correo_secuencia_ajustes
  ADD COLUMN IF NOT EXISTS redactar_al_enviar BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.correo_secuencia_ajustes.redactar_al_enviar IS
  'Si true, la IA escribe cada seguimiento justo antes de enviarlo leyendo todo el historial del lead (llamadas, notas, correos); el texto programado queda de borrador. Si false, sale el texto programado (revisado con la IA solo si hay algo nuevo en la ficha).';


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
--
-- El editor de Supabase NO ENSEÑA los NOTICE. Lo que falle revienta con un error; lo que salga bien se lee en la fila de abajo, y las dos columnas
-- tienen que decir «true».
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'correo_secuencia_ajustes' AND column_name = 'redactar_al_enviar')
    AS columna_puesta,
  COALESCE((SELECT redactar_al_enviar FROM public.correo_secuencia_ajustes WHERE id = true), true)
    AS encendido_por_defecto;
