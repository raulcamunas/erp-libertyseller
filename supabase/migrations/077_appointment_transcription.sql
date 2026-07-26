-- =====================================================
-- TRANSCRIPCIÓN Y RESUMEN CON IA DE LA GRABACIÓN
-- =====================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS transcription TEXT,
  ADD COLUMN IF NOT EXISTS transcription_summary TEXT,
  ADD COLUMN IF NOT EXISTS transcription_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS transcription_error TEXT;

-- 'none' | 'processing' | 'done' | 'error'
