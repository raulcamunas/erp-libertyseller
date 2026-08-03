-- =====================================================
-- CITAS CUALIFICADAS AÑADIDAS A MANO
-- =====================================================
-- Las comisiones salen de la agenda, pero no todo pasa por ahí: una cita
-- cerrada por WhatsApp, una que se agendó fuera del ERP o un ajuste
-- pactado con el comercial. Esto permite a los admins sumarlas al
-- periodo sin inventarse una cita falsa en el calendario.

CREATE TABLE IF NOT EXISTS public.payroll_manual_appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lead_name TEXT NOT NULL,
  /** Día de la cita: decide a qué ciclo del 15 al 14 pertenece */
  appointment_date DATE NOT NULL,
  /** Comisión concreta. Si va vacía se aplica la tarifa del periodo. */
  commission NUMERIC,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payroll_manual_user_date
  ON public.payroll_manual_appointments(user_id, appointment_date);

ALTER TABLE public.payroll_manual_appointments ENABLE ROW LEVEL SECURITY;

-- Cada comercial ve las suyas — tiene derecho a saber de dónde sale su
-- comisión — pero solo los admins las crean y las quitan.
DROP POLICY IF EXISTS "Own manual appointments or admin can view"
  ON public.payroll_manual_appointments;
CREATE POLICY "Own manual appointments or admin can view"
  ON public.payroll_manual_appointments FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admins add manual appointments"
  ON public.payroll_manual_appointments;
CREATE POLICY "Admins add manual appointments"
  ON public.payroll_manual_appointments FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admins update manual appointments"
  ON public.payroll_manual_appointments;
CREATE POLICY "Admins update manual appointments"
  ON public.payroll_manual_appointments FOR UPDATE
  TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admins delete manual appointments"
  ON public.payroll_manual_appointments;
CREATE POLICY "Admins delete manual appointments"
  ON public.payroll_manual_appointments FOR DELETE
  TO authenticated
  USING (public.is_admin_or_partner(auth.uid()));

-- Realtime: si un admin añade una cita, el comercial ve subir su total
ALTER PUBLICATION supabase_realtime ADD TABLE public.payroll_manual_appointments;
