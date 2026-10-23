-- 239 · Un índice para que sendChanges() deje de tardar segundos en mirar los rechazos de la última semana
--
-- sendChanges() (lib/amazon/data.ts) lee, antes de mandar nada, los envíos que Amazon rechazó con
-- status = 'invalido' en los últimos siete días, para no insistir con los reincidentes. Sobre
-- amazon_submissions de Entrais (más de 280.000 filas) esa lectura tarda de 3 a 6 segundos EN CALMA, y el
-- 21 oct 2026 se pasó del tiempo máximo de la base de datos (57014): el stock de Entrais estuvo dos días
-- sin llegar a Amazon, con el aviso «Ha fallado la llamada a Amazon y no ha dicho por qué».
--
-- El código ya no depende de esa lectura (si falla, se manda igual) y este índice la deja en milisegundos.
-- Es PARCIAL: solo lleva las filas rechazadas, que son muy pocas, así que ocupa casi nada y no frena las
-- escrituras (los envíos aceptados no lo tocan). Sirve exactamente a esa consulta: connection_id y status
-- por igualdad, sku en lista y orden por (sku, id).
--
-- Seguro de lanzar más de una vez. Tarda un par de segundos: lee la tabla entera una vez para montarlo.

create index if not exists amazon_submissions_invalidos_idx
  on public.amazon_submissions (connection_id, sku, id)
  where status = 'invalido';

-- Que el planificador conozca el índice nuevo desde ya
analyze public.amazon_submissions;
