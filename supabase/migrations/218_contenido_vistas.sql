-- ============================================================================
-- 218 · LAS IMÁGENES DE CADA PIEZA, para poder verlas sin descargar nada
-- ============================================================================
--
-- La 217 guardaba un fichero por pieza: el mp4 del vídeo, el PDF del carrusel.
-- Y con eso la pantalla solo puede ofrecer un botón de descarga, que es justo lo
-- que no sirve: quien entra el martes no quiere bajarse un PDF para saber qué le
-- toca publicar, quiere VER las láminas, leer el texto y copiarlo.
--
-- Un PDF no se puede pintar en una página sin un visor. Las láminas sí, porque
-- el generador ya las produce como PNG sueltos antes de coserlas — se tiraban.
--
-- `vistas` es la lista ordenada de esas imágenes dentro del bucket `contenido`.
-- Para un carrusel son sus nueve láminas; para un vídeo, un fotograma de
-- portada, que es lo que permite que el día no sea una fila de texto gris.
--
-- POR QUÉ UNA COLUMNA Y NO UNA TABLA APARTE: no hay nada que decir de una
-- imagen salvo dónde está y en qué orden va. Una tabla hija obligaría a un join
-- en todas las consultas del calendario para recuperar un array de cadenas.
--
-- POR QUÉ LA RUTA Y NO LA URL: borrar un objeto de Storage necesita la ruta. Y
-- si algún día el bucket deja de ser público, las URL guardadas serían basura
-- mientras que las rutas siguen valiendo.
-- ============================================================================

ALTER TABLE public.contenido_piezas
  ADD COLUMN IF NOT EXISTS vistas JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.contenido_piezas.vistas IS
  'Array ordenado de rutas dentro del bucket `contenido`: las láminas de un carrusel, '
  'o el fotograma de portada de un vídeo. Es lo que la pantalla pinta para que se vea '
  'qué hay que publicar sin descargar el fichero.';

-- Que el contenido se pueda ver desde el navegador sin autenticar: el bucket ya
-- es público, pero las políticas de lectura exigían sesión y una etiqueta <img>
-- no la lleva. Sin esto las miniaturas salen rotas.
DROP POLICY IF EXISTS "Cualquiera lee contenido" ON storage.objects;
CREATE POLICY "Cualquiera lee contenido"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'contenido');
