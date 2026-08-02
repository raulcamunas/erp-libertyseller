-- =====================================================
-- HORAS HISTÓRICAS IMPORTADAS DE LOS EXCEL
-- =====================================================
-- Volcado de «Horas Nombre.xlsx» (marzo a agosto de 2026). Los
-- totales cuadran con las celdas «Horas Totales» de cada hoja:
-- Alejandro 412 h, José 164 h, Yamila 24 h, Maoli 0 h.
--
-- ON CONFLICT DO NOTHING: si alguien ya ha apuntado algo en la app
-- para ese día, manda lo suyo — esto no pisa nada.

-- ---------- Yamila (6 días, 24 h) ----------
INSERT INTO public.work_hours (user_id, work_date, hours)
SELECT p.id, v.d::date, v.h
FROM public.profiles p
CROSS JOIN (VALUES
  ('2026-07-20', 4),
  ('2026-07-21', 4),
  ('2026-07-22', 4),
  ('2026-07-23', 4),
  ('2026-07-24', 4),
  ('2026-07-27', 4)
) AS v(d, h)
WHERE p.email = 'yamila@libertyseller.com'
ON CONFLICT (user_id, work_date) DO NOTHING;

-- Maoli: la hoja está vacía, no hay nada que importar.

-- ---------- Alejandro (96 días, 412 h) ----------
INSERT INTO public.work_hours (user_id, work_date, hours)
SELECT p.id, v.d::date, v.h
FROM public.profiles p
CROSS JOIN (VALUES
  ('2026-03-16', 3),
  ('2026-03-17', 5),
  ('2026-03-18', 5),
  ('2026-03-19', 5),
  ('2026-03-20', 3),
  ('2026-03-23', 3),
  ('2026-03-24', 5),
  ('2026-03-25', 5),
  ('2026-03-26', 5),
  ('2026-03-27', 3),
  ('2026-03-30', 3),
  ('2026-03-31', 5),
  ('2026-04-01', 5),
  ('2026-04-07', 5),
  ('2026-04-08', 5),
  ('2026-04-09', 5),
  ('2026-04-10', 3),
  ('2026-04-13', 3),
  ('2026-04-14', 5),
  ('2026-04-15', 5),
  ('2026-04-16', 5),
  ('2026-04-17', 3),
  ('2026-04-20', 3),
  ('2026-04-21', 5),
  ('2026-04-22', 5),
  ('2026-04-23', 5),
  ('2026-04-24', 3),
  ('2026-04-27', 3),
  ('2026-04-28', 5),
  ('2026-04-29', 5),
  ('2026-04-30', 5),
  ('2026-05-04', 3),
  ('2026-05-05', 3),
  ('2026-05-06', 3),
  ('2026-05-07', 3),
  ('2026-05-08', 3),
  ('2026-05-11', 3),
  ('2026-05-12', 3),
  ('2026-05-13', 3),
  ('2026-05-14', 3),
  ('2026-05-15', 3),
  ('2026-05-18', 3),
  ('2026-05-19', 3),
  ('2026-05-20', 3),
  ('2026-05-21', 3),
  ('2026-05-22', 3),
  ('2026-05-25', 3),
  ('2026-05-26', 3),
  ('2026-05-27', 5),
  ('2026-05-28', 3),
  ('2026-05-29', 3),
  ('2026-06-01', 3),
  ('2026-06-02', 3),
  ('2026-06-03', 3),
  ('2026-06-04', 3),
  ('2026-06-05', 3),
  ('2026-06-08', 4),
  ('2026-06-09', 4),
  ('2026-06-10', 3),
  ('2026-06-11', 3),
  ('2026-06-12', 3),
  ('2026-06-15', 3),
  ('2026-06-16', 3),
  ('2026-06-17', 3),
  ('2026-06-18', 3),
  ('2026-06-22', 3),
  ('2026-06-23', 3),
  ('2026-06-24', 3),
  ('2026-06-25', 3),
  ('2026-06-26', 3),
  ('2026-06-29', 3),
  ('2026-06-30', 3),
  ('2026-07-01', 7),
  ('2026-07-02', 7),
  ('2026-07-03', 6),
  ('2026-07-06', 6),
  ('2026-07-07', 6),
  ('2026-07-08', 6),
  ('2026-07-09', 7),
  ('2026-07-10', 4),
  ('2026-07-13', 7),
  ('2026-07-14', 7),
  ('2026-07-15', 7),
  ('2026-07-16', 4),
  ('2026-07-17', 7),
  ('2026-07-18', 7),
  ('2026-07-20', 7),
  ('2026-07-21', 7),
  ('2026-07-22', 7),
  ('2026-07-23', 7),
  ('2026-07-24', 7),
  ('2026-07-27', 7),
  ('2026-07-28', 7),
  ('2026-07-29', 7),
  ('2026-07-30', 4),
  ('2026-07-31', 4)
) AS v(d, h)
WHERE p.email = 'alejandro@libertyseller.com'
ON CONFLICT (user_id, work_date) DO NOTHING;

-- ---------- José (43 días, 164 h) ----------
INSERT INTO public.work_hours (user_id, work_date, hours)
SELECT p.id, v.d::date, v.h
FROM public.profiles p
CROSS JOIN (VALUES
  ('2026-05-28', 4),
  ('2026-05-29', 4),
  ('2026-06-01', 4),
  ('2026-06-02', 4),
  ('2026-06-03', 4),
  ('2026-06-04', 2),
  ('2026-06-05', 4),
  ('2026-06-08', 4),
  ('2026-06-09', 4),
  ('2026-06-10', 4),
  ('2026-06-11', 4),
  ('2026-06-12', 2),
  ('2026-06-15', 4),
  ('2026-06-16', 4),
  ('2026-06-17', 4),
  ('2026-06-18', 4),
  ('2026-06-22', 4),
  ('2026-06-23', 4),
  ('2026-06-24', 4),
  ('2026-06-25', 4),
  ('2026-06-26', 4),
  ('2026-06-29', 4),
  ('2026-06-30', 4),
  ('2026-07-01', 4),
  ('2026-07-02', 4),
  ('2026-07-03', 4),
  ('2026-07-06', 4),
  ('2026-07-07', 4),
  ('2026-07-08', 3),
  ('2026-07-09', 4),
  ('2026-07-10', 4),
  ('2026-07-13', 4),
  ('2026-07-14', 4),
  ('2026-07-15', 1),
  ('2026-07-16', 4),
  ('2026-07-17', 4),
  ('2026-07-20', 4),
  ('2026-07-21', 4),
  ('2026-07-22', 4),
  ('2026-07-23', 4),
  ('2026-07-24', 4),
  ('2026-07-27', 4),
  ('2026-07-28', 4)
) AS v(d, h)
WHERE p.email = 'jose@libertyseller.com'
ON CONFLICT (user_id, work_date) DO NOTHING;

-- ---------- Comisión por cita: excepciones de los Excel ----------
-- Las tarifas generales (marzo-mayo 15 $, junio 20 $, julio-agosto 15 $)
-- ya se cargaron en la migración 083. Aquí solo van las personas que en
-- algún ciclo cobraron distinto al resto del equipo.
INSERT INTO public.payroll_rates (period_start, user_id, hourly_rate, commission_per_appointment)
SELECT v.period::date, p.id, 3.5, v.commission
FROM (VALUES
  -- En junio el equipo pasó a 20 $, pero José siguió a 15 $
  ('2026-06-15', 'jose@libertyseller.com',      15),
  -- En julio se volvió a 15 $ general; Alejandro y José se quedaron en 20 $
  ('2026-07-15', 'alejandro@libertyseller.com', 20),
  ('2026-07-15', 'jose@libertyseller.com',      20)
) AS v(period, email, commission)
JOIN public.profiles p ON p.email = v.email
ON CONFLICT DO NOTHING;
