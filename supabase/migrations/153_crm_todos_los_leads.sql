-- ==================================================================
-- 153 · EL CRM DEJA DE ENSENAR SOLO LAS CITAS CUALIFICADAS
-- ==================================================================
--
-- Hasta hoy una cita solo entraba en el CRM si alguien la marcaba como
-- «Cita Cualificada». El resto —las que estaban por celebrar, las que no
-- aparecieron, las que se cualificaron mal— no existian en la lista, y por
-- tanto no habia donde documentarlas ni forma de repescarlas.
--
-- Eso convertia el CRM en un archivo de lo que ya habia salido bien, cuando lo
-- que hace falta es lo contrario: un sitio donde esten TODOS los leads y donde
-- se decida cual queda cualificada y cual no, con esa decision a la vista.
--
--
-- LO QUE NO CAMBIA, Y ES LO IMPORTANTE
-- ------------------------------------
-- LAS COMISIONES NO SE TOCAN. Se calculan leyendo `appointments` con
-- status = 'qualified' (lib/payroll/cost.ts) y NO leyendo `crm_clients`. Que
-- ahora haya ficha de CRM para una cita sin cualificar no devenga ni un euro de
-- mas: la condicion de cobro sigue siendo exactamente la misma y sigue estando
-- en el mismo sitio.
--
-- Se mantiene la exclusion de `is_external`: esos son los huecos importados de
-- Google («Hueco no disponible»), no son leads de nadie.
--
--
-- Y UN CAJON PARA LAS PREGUNTAS DE LA REUNION
-- -------------------------------------------
-- Va en JSONB y no en una columna por pregunta a proposito. El guion de la
-- reunion es un documento vivo de la agencia: hoy son trece preguntas para quien
-- ya vende en Amazon y once para quien no, y manana seran otras. Con una columna
-- por pregunta, cambiar el guion es una migracion; con JSONB es editar una lista
-- en el codigo, y las respuestas viejas siguen ahi aunque su pregunta ya no se
-- pregunte.
--
-- Lo que se pierde —CHECKs, indices, tipado— aqui no hace falta: nadie va a
-- filtrar leads por lo que contestaron a la pregunta siete.

-- ---------- 1. El cajon de las preguntas ----------
ALTER TABLE public.crm_clients
  ADD COLUMN IF NOT EXISTS preguntas JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.crm_clients.preguntas IS
  'Respuestas del guion de la reunion, por clave de pregunta. El guion vive en lib/types/crm.ts (PREGUNTAS_REUNION); aqui solo se guarda lo contestado, asi que cambiar el guion no pierde nada de lo ya escrito.';

-- ---------- 2. La ficha se crea para cualquier cita, no solo la cualificada ----------
CREATE OR REPLACE FUNCTION public.sync_crm_client_from_appointment()
RETURNS TRIGGER AS $$
BEGIN
  -- Antes: IF NEW.status = 'qualified' AND NEW.is_external = false
  --
  -- Los huecos importados de Google siguen fuera: no son leads, son el calendario
  -- personal de alguien.
  IF NEW.is_external = false THEN
    INSERT INTO public.crm_clients (appointment_id, owner_id)
    VALUES (NEW.id, COALESCE(NEW.assigned_closer_id, NEW.comercial_id))
    ON CONFLICT (appointment_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- El disparador escuchaba solo cambios de `status`, que era coherente con la
-- condicion vieja. Ahora la ficha nace con la cita, asi que basta con INSERT y
-- con los cambios de responsable; se deja tambien el de status para no perder el
-- caso de una cita que se reasigna al cualificarla.
DROP TRIGGER IF EXISTS trg_appointment_to_crm ON public.appointments;
CREATE TRIGGER trg_appointment_to_crm
  AFTER INSERT OR UPDATE OF status, assigned_closer_id, comercial_id
  ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_crm_client_from_appointment();

-- ---------- 3. Las citas que ya existian ----------
INSERT INTO public.crm_clients (appointment_id, owner_id)
SELECT a.id, COALESCE(a.assigned_closer_id, a.comercial_id)
  FROM public.appointments a
 WHERE a.is_external = false
ON CONFLICT (appointment_id) DO NOTHING;

-- ---------- Comprobación ----------
DO $$
DECLARE
  sin_ficha INTEGER;
  con_preguntas INTEGER;
BEGIN
  SELECT count(*) INTO sin_ficha
    FROM public.appointments a
    LEFT JOIN public.crm_clients c ON c.appointment_id = a.id
   WHERE a.is_external = false AND c.id IS NULL;

  IF sin_ficha > 0 THEN
    RAISE EXCEPTION 'Han quedado % citas no externas sin ficha de CRM.', sin_ficha;
  END IF;

  SELECT count(*) INTO con_preguntas
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'crm_clients' AND column_name = 'preguntas';

  IF con_preguntas <> 1 THEN
    RAISE EXCEPTION 'La columna crm_clients.preguntas no se ha creado.';
  END IF;

  RAISE NOTICE 'CRM: todas las citas no externas tienen ficha y existe el cajon de preguntas.';
END $$;
