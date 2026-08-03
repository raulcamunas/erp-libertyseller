-- =====================================================
-- NÚMEROS DE TELÉFONO
-- =====================================================
-- Registro de los números que usa la agencia y para qué es cada uno.
-- Sustituye la tablita del Excel: teléfono, cliente y otro uso.

CREATE TABLE IF NOT EXISTS public.phone_numbers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL DEFAULT '',
  client TEXT,
  other_use TEXT,
  notes TEXT,
  position INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phone_numbers_position ON public.phone_numbers(position);

CREATE OR REPLACE FUNCTION public.update_phone_numbers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_phone_numbers_updated_at ON public.phone_numbers;
CREATE TRIGGER trg_phone_numbers_updated_at
  BEFORE UPDATE ON public.phone_numbers
  FOR EACH ROW EXECUTE FUNCTION public.update_phone_numbers_updated_at();

ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage phone numbers" ON public.phone_numbers;
CREATE POLICY "Admins manage phone numbers"
  ON public.phone_numbers FOR ALL
  TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

-- ---------- Lo que ya había en el Excel ----------
-- Transcrito de la hoja: conviene repasar los números antes de darlos por
-- buenos.
INSERT INTO public.phone_numbers (phone, client, other_use, position)
VALUES
  ('623973018', 'Eduardo', NULL, 1),
  ('623971273', 'Yolanda', 'Bot Liberty UpGrowth', 2),
  ('623780725', 'Shoplamp', 'Test Liberty UpGrowth', 3),
  ('644389953', 'Keslem', 'Facturación Liberty UpGrowth', 4),
  ('644907415', 'Valhala', 'Tecnico Liberty UpGrowth', 5),
  ('644529517', 'SHOESF LT', NULL, 6),
  ('694227854', 'Cobo Family', 'Whatsapp Alejandro Liberty Seller', 7),
  ('910796414', 'Rinkel / Whatsapp', 'Jose', 8),
  ('644864985', NULL, NULL, 9),
  ('621071720', 'no disponible', NULL, 10),
  ('684784425', NULL, NULL, 11),
  ('644250635', 'Yamila final', NULL, 12)
ON CONFLICT DO NOTHING;
