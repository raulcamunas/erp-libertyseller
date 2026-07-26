-- =====================================================
-- AGENDA: datos comerciales del lead + comentarios + grabación de audio
-- =====================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS revenue_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS call_date DATE,
  ADD COLUMN IF NOT EXISTS amazon_link TEXT,
  ADD COLUMN IF NOT EXISTS recording_url TEXT,
  ADD COLUMN IF NOT EXISTS recording_filename TEXT;

-- ---------- Comentarios (hilo colaborativo, como en Notion) ----------
CREATE TABLE IF NOT EXISTS public.appointment_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appointment_comments_appointment
  ON public.appointment_comments(appointment_id);

ALTER TABLE public.appointment_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team can view all comments" ON public.appointment_comments;
CREATE POLICY "Team can view all comments"
  ON public.appointment_comments FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Team can add comments" ON public.appointment_comments;
CREATE POLICY "Team can add comments"
  ON public.appointment_comments FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "Author or admin can delete comment" ON public.appointment_comments;
CREATE POLICY "Author or admin can delete comment"
  ON public.appointment_comments FOR DELETE
  TO authenticated
  USING (author_id = auth.uid() OR public.is_admin_or_partner(auth.uid()));

-- ---------- Storage bucket para las grabaciones de llamadas (mp3) ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'call-recordings',
  'call-recordings',
  true,
  104857600, -- 100MB
  ARRAY['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/ogg']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can upload call recordings" ON storage.objects;
CREATE POLICY "Authenticated users can upload call recordings"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'call-recordings');

DROP POLICY IF EXISTS "Authenticated users can read call recordings" ON storage.objects;
CREATE POLICY "Authenticated users can read call recordings"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'call-recordings');

DROP POLICY IF EXISTS "Authenticated users can delete call recordings" ON storage.objects;
CREATE POLICY "Authenticated users can delete call recordings"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'call-recordings');
