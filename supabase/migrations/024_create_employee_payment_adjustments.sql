-- =====================================================
-- TABLA DE AJUSTES DE PAGO PARA EMPLEADOS
-- =====================================================

-- Tabla para almacenar ajustes de pago (comisiones, incrementos, etc.)
CREATE TABLE IF NOT EXISTS public.employee_payment_adjustments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id TEXT NOT NULL,
  week_start_date DATE NOT NULL, -- Lunes de la semana
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('commission', 'bonus', 'deduction', 'hourly_rate_override')),
  amount NUMERIC(10, 2) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(employee_id, week_start_date, adjustment_type, description)
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_employee_payment_adjustments_employee_id ON public.employee_payment_adjustments(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_payment_adjustments_week_start ON public.employee_payment_adjustments(week_start_date);
CREATE INDEX IF NOT EXISTS idx_employee_payment_adjustments_type ON public.employee_payment_adjustments(adjustment_type);

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_employee_payment_adjustments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_employee_payment_adjustments_updated_at
  BEFORE UPDATE ON public.employee_payment_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION update_employee_payment_adjustments_updated_at();

-- Habilitar RLS
ALTER TABLE public.employee_payment_adjustments ENABLE ROW LEVEL SECURITY;

-- Política: Usuarios autenticados pueden ver todos los ajustes
CREATE POLICY "Authenticated users can view all payment adjustments"
  ON public.employee_payment_adjustments
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Política: Usuarios autenticados pueden insertar ajustes
CREATE POLICY "Authenticated users can insert payment adjustments"
  ON public.employee_payment_adjustments
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Política: Usuarios autenticados pueden actualizar ajustes
CREATE POLICY "Authenticated users can update payment adjustments"
  ON public.employee_payment_adjustments
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Política: Usuarios autenticados pueden eliminar ajustes
CREATE POLICY "Authenticated users can delete payment adjustments"
  ON public.employee_payment_adjustments
  FOR DELETE
  USING (auth.role() = 'authenticated');



