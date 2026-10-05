-- ============================================================================
-- 219 · EL CARRUSEL SE DESCARGA EN ZIP, no en PDF
-- ============================================================================
--
-- El botón de descarga de un carrusel daba el PDF, y el PDF no sirve para lo que
-- se hace con él: estas piezas se publican como imágenes sueltas, una por
-- lámina. Bajarse un PDF para luego extraer nueve páginas a mano es trabajo que
-- no tiene que hacer nadie.
--
-- Ahora el fichero de un carrusel es un ZIP con foto-1.png … foto-9.png a tamaño
-- completo, listo para descomprimir y subir. El PDF se sigue generando en local
-- por si algún día se publica como documento de LinkedIn, pero no sube al ERP:
-- lo que está aquí es lo que se usa.
--
-- Esta migración solo abre el tipo MIME. Sin ella Storage devuelve 400 al subir
-- el ZIP, porque la 217 cerró el bucket a mp4, PDF e imágenes a propósito —para
-- que nadie acabe usándolo de disco duro.
-- ============================================================================

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'video/mp4',
  'video/quicktime',
  'application/pdf',
  'application/zip',
  'image/png',
  'image/jpeg'
]
WHERE id = 'contenido';
