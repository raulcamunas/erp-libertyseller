-- =====================================================
-- ADJUNTOS DE LA CITA (capturas de pantalla)
-- =====================================================
-- No todas las citas salen de una llamada: algunas se cierran por correo
-- o por WhatsApp. En esos casos no hay grabación que subir, pero sí una
-- captura de la conversación que sirve igual como prueba de la cita.

CREATE TABLE IF NOT EXISTS public.appointment_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  file_url TEXT NOT NULL,
  file_path TEXT,            -- ruta dentro del bucket, para poder borrarlo
  filename TEXT NOT NULL,
  mime_type TEXT,
  file_size BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appointment_attachments_appointment
  ON public.appointment_attachments(appointment_id, created_at DESC);

ALTER TABLE public.appointment_attachments ENABLE ROW LEVEL SECURITY;

-- Mismo criterio que los comentarios de la cita: el equipo ve todo, y
-- borra quien lo subió o un admin.
DROP POLICY IF EXISTS "Team can view attachments" ON public.appointment_attachments;
CREATE POLICY "Team can view attachments"
  ON public.appointment_attachments FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Team can add attachments" ON public.appointment_attachments;
CREATE POLICY "Team can add attachments"
  ON public.appointment_attachments FOR INSERT
  TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

DROP POLICY IF EXISTS "Uploader or admin can delete attachment" ON public.appointment_attachments;
CREATE POLICY "Uploader or admin can delete attachment"
  ON public.appointment_attachments FOR DELETE
  TO authenticated
  USING (uploaded_by = auth.uid() OR public.is_admin_or_partner(auth.uid()));

-- ---------- Bucket ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'appointment-attachments',
  'appointment-attachments',
  true,
  20971520, -- 20MB
  ARRAY[
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
    'image/gif', 'image/heic', 'application/pdf'
  ]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated can upload appointment attachments" ON storage.objects;
CREATE POLICY "Authenticated can upload appointment attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'appointment-attachments');

DROP POLICY IF EXISTS "Authenticated can read appointment attachments" ON storage.objects;
CREATE POLICY "Authenticated can read appointment attachments"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'appointment-attachments');

DROP POLICY IF EXISTS "Authenticated can delete appointment attachments" ON storage.objects;
CREATE POLICY "Authenticated can delete appointment attachments"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'appointment-attachments');
