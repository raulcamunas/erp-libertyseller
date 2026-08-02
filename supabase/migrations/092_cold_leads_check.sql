-- =====================================================
-- COLD CALLING: comprobar que la importación entró completa
-- =====================================================
-- Ejecutar al final. Si algún número no cuadra con lo de abajo, es que
-- alguno de los CSV no llegó a subirse entero.
--
-- Esperado:
--   TOTAL 3978
--   1a lista 557 | 2a lista 413 | Alejandro V2 916  -> Alejandro 1886
--   José 262 | José V2 916                          -> José      1178
--   Yamila 457                                      -> Yamila      457
--   Maoli 457                                       -> Maoli       457

SELECT 'TOTAL' AS scope, NULL AS detalle, count(*) AS leads
FROM public.cold_leads
UNION ALL
SELECT 'Por lista', source_list, count(*)
FROM public.cold_leads
GROUP BY source_list
UNION ALL
SELECT 'Por comercial', COALESCE(p.full_name, p.email, '(SIN ASIGNAR)'), count(*)
FROM public.cold_leads l
LEFT JOIN public.profiles p ON p.id = l.assigned_to
GROUP BY COALESCE(p.full_name, p.email, '(SIN ASIGNAR)')
UNION ALL
SELECT 'Sin lista de origen', NULL, count(*)
FROM public.cold_leads WHERE source_list IS NULL
UNION ALL
SELECT 'Sin comercial asignado', NULL, count(*)
FROM public.cold_leads WHERE assigned_to IS NULL
ORDER BY 1, 3 DESC;
