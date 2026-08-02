-- =====================================================
-- COLD CALLING: el seguimiento del Excel, al historial
-- =====================================================
-- El CSV trae la columna SEGUIMIENTO en follow_up, pero ahí se queda como
-- un campo suelto que cualquiera puede sobreescribir. Se vuelca también
-- como primera entrada del historial de interacciones, con el comercial
-- que lo escribió, para que quede constancia de lo que ya se habló con
-- cada seller aunque luego se edite la nota.
--
-- Se ejecuta DESPUÉS de importar el CSV y de la 088 (que asigna dueño).
-- Es idempotente: solo crea la entrada si el lead no tiene ninguna.

INSERT INTO public.cold_lead_notes (lead_id, author_id, kind, body, occurred_at)
SELECT
  l.id,
  l.assigned_to,
  'nota',
  CASE
    WHEN COALESCE(TRIM(l.action_label), '') <> ''
      THEN '[Excel] ' || TRIM(l.action_label) || E'\n' || TRIM(l.follow_up)
    ELSE '[Excel] ' || TRIM(l.follow_up)
  END,
  l.created_at
FROM public.cold_leads l
WHERE COALESCE(TRIM(l.follow_up), '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.cold_lead_notes n WHERE n.lead_id = l.id
  );

-- Los que solo tenían la etiqueta de acción, sin texto de seguimiento
INSERT INTO public.cold_lead_notes (lead_id, author_id, kind, body, occurred_at)
SELECT
  l.id,
  l.assigned_to,
  'nota',
  '[Excel] ' || TRIM(l.action_label),
  l.created_at
FROM public.cold_leads l
WHERE COALESCE(TRIM(l.action_label), '') <> ''
  AND COALESCE(TRIM(l.follow_up), '') = ''
  AND NOT EXISTS (
    SELECT 1 FROM public.cold_lead_notes n WHERE n.lead_id = l.id
  );

-- Un lead ya trabajado debe constar como contactado, para que las
-- métricas de la cartera no lo cuenten como virgen.
UPDATE public.cold_leads
SET last_contacted_at = created_at
WHERE status <> 'pendiente'
  AND last_contacted_at IS NULL;

-- Y si ya se le llamó, al menos un intento hubo.
UPDATE public.cold_leads
SET call_attempts = 1
WHERE status IN ('no_contesta', 'programado', 'email_enviado', 'seguimiento', 'cita_cualificada', 'no_interesa')
  AND call_attempts = 0;
