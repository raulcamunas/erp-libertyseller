-- ============================================================================
-- 229 · CALENDARIO DE CONTENIDO: EL TEXTO DE CADA PIEZA EN CADA RED
-- ============================================================================
--
-- El plan nació para LinkedIn: el texto del post vive en contenido_piezas.texto_post.
-- Pero un VÍDEO se sube además a Instagram, TikTok y Facebook, y cada red pide su
-- propio texto: más corto en TikTok, con pocos hashtags en Instagram (la red los
-- limita a 5), con algo más de explicación en Facebook. Hasta ahora esos textos no
-- existían en ningún sitio, o vivían en una conversación.
--
-- UNA FILA POR PIEZA Y RED (UNIQUE). El texto de LinkedIn NO se mueve de
-- contenido_piezas.texto_post: es lo que ya leen el resto de pantallas y no hay
-- motivo para duplicarlo.
--
--   texto              el pie / descripción que se pega en la red, SIN los hashtags
--   hashtags           aparte, para poder contarlos (Instagram admite como mucho 5)
--                      y para que la pantalla los pegue debajo del texto
--   comentario_fijado  lo que se deja como primer comentario (la cuenta paso a paso,
--                      la regla...). Opcional, y solo donde cabe: el de TikTok admite
--                      150 caracteres, así que ahí no se rellena
--
-- QUIÉN TOCA QUÉ: leer, todo el que entra al calendario; crear, editar y borrar, solo
-- admin o partner, igual que las piezas.
--
--
-- LOS TEXTOS QUE SE CARGAN
-- ------------------------
-- Los cuatro vídeos que hay subidos (Abrir Europa, el best seller, las tres cosas del
-- Black Friday y el tope de clic) traen ya su texto para Instagram, TikTok y Facebook,
-- escrito a partir de su guion y con el tono de los textos de LinkedIn: sin cifras de
-- clientes, con «números de ejemplo» donde los números lo son, y sin una palabra sobre
-- cómo cobra la agencia.
--
-- ON CONFLICT DO NOTHING: volver a lanzar esta migración NO pisa lo que se haya editado
-- después desde la pantalla. Si una pieza no está subida todavía, su fila se salta sin
-- error; el aviso final dice cuántos textos hay.
--
-- OJO CON EL TIEMPO: los dos vídeos de Black Friday dicen «faltan unas seis semanas».
-- Es cierto hasta unos días después del 19 de octubre; si se publican más tarde, hay que
-- cambiarlo en el texto y en el vídeo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.contenido_textos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pieza_id UUID NOT NULL REFERENCES public.contenido_piezas(id) ON DELETE CASCADE,
  red TEXT NOT NULL CHECK (red IN ('linkedin', 'instagram', 'tiktok', 'facebook')),
  texto TEXT NOT NULL DEFAULT '',
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  comentario_fijado TEXT,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (pieza_id, red)
);

COMMENT ON TABLE public.contenido_textos IS
  'El texto de una pieza en una red concreta (Instagram, TikTok, Facebook...). El de LinkedIn sigue en contenido_piezas.texto_post.';

COMMENT ON COLUMN public.contenido_textos.hashtags IS
  'Con su almohadilla y aparte del texto: así se pueden contar (Instagram admite 5) y la pantalla los pega debajo.';

CREATE INDEX IF NOT EXISTS contenido_textos_pieza_idx ON public.contenido_textos (pieza_id);

-- ---------- Quién ve y quién toca ----------

ALTER TABLE public.contenido_textos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados leen los textos por red" ON public.contenido_textos;
CREATE POLICY "Autenticados leen los textos por red"
  ON public.contenido_textos FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin y partner crean textos por red" ON public.contenido_textos;
CREATE POLICY "Admin y partner crean textos por red"
  ON public.contenido_textos FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admin y partner editan textos por red" ON public.contenido_textos;
CREATE POLICY "Admin y partner editan textos por red"
  ON public.contenido_textos FOR UPDATE
  TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admin y partner borran textos por red" ON public.contenido_textos;
CREATE POLICY "Admin y partner borran textos por red"
  ON public.contenido_textos FOR DELETE
  TO authenticated
  USING (public.is_admin_or_partner(auth.uid()));

-- ============================================================================
-- Los textos de los cuatro vídeos
-- ============================================================================

INSERT INTO public.contenido_textos (pieza_id, red, texto, hashtags, comentario_fijado)
SELECT p.id, v.red, v.texto, v.hashtags, v.comentario
FROM (VALUES

  -- ------------------------------------------------------------ Abrir Europa
  ('abrir-europa', 'instagram',
   $t$Abrir Europa puede doblar tus ventas. O multiplicar por cuatro tus problemas.

Todo depende de tres decisiones que se toman antes de mover una caja:

1. Cuándo salir. Cuando España ya es rentable y conoces tu ACOS de equilibrio. Si aquí pierdes dinero, fuera pierdes cuatro veces.
2. Cómo enviar. EFN, MCI o Paneuropeo: cada uno paga una cosa distinta, y el que te conviene cambia con el volumen.
3. Qué cumplir. Registro de envases en Alemania, número de productor en Francia, seguridad del producto y etiquetas en el idioma de cada país.

Y lo que casi nadie suma: el marketing, por cuatro. Cuatro fichas escritas por nativos, cuatro estudios de keywords, cuatro campañas. Tu posición en España no viaja contigo.

En el vídeo, la cuenta completa y la regla para decidir cuándo abrir un país nuevo. Guárdalo para cuando te toque.$t$,
   ARRAY['#amazonfba', '#amazoneurope', '#vendersenamazon', '#ecommerce', '#amazonseller'],
   $t$La regla, por si quieres guardarla antes de abrir un país:
- España rentable y estable
- Demanda comprobada en el país nuevo
- Registros en regla: envases, productor y seguridad del producto
- Presupuesto para unos 90 días de anuncios
Empieza con EFN para validar. Cuando un país vende, manda stock ahí con MCI. Y Paneuropeo cuando vendes en serio en varios.$t$),

  ('abrir-europa', 'tiktok',
   $t$Abrir Europa puede doblar tus ventas o multiplicar por cuatro tus problemas. Las 3 decisiones antes de mover una caja: cuándo salir, cómo enviar (EFN, MCI o Paneuropeo) y qué cumplir. ¿Vendes ya fuera de España?$t$,
   ARRAY['#amazonfba', '#amazoneurope', '#vendersenamazon', '#ecommerce', '#aprendeentiktok'],
   NULL),

  ('abrir-europa', 'facebook',
   $t$Abrir Europa no es un botón de Seller Central. Son tres decisiones, y las tres se toman antes de mover una caja.

Cuándo salir: cuando España ya es rentable y conoces tu ACOS de equilibrio. Si aquí pierdes dinero, fuera pierdes cuatro veces.

Cómo enviar: EFN, MCI o Paneuropeo. Cada uno paga una cosa distinta, y el que te conviene cambia con el volumen.

Qué cumplir: registro de envases en Alemania, número de productor en Francia, seguridad del producto y etiquetas en el idioma del país. Esto no se resuelve la semana del lanzamiento.

Dos minutos con la cuenta completa, incluido lo que casi nadie suma: el marketing, por cuatro.

¿Vendes ya fuera de España? Cuéntanos cómo lo envías.$t$,
   ARRAY['#AmazonFBA', '#AmazonEurope', '#Ecommerce'],
   $t$La regla, por si quieres guardarla antes de abrir un país:
- España rentable y estable
- Demanda comprobada en el país nuevo
- Registros en regla: envases, productor y seguridad del producto
- Presupuesto para unos 90 días de anuncios
Empieza con EFN para validar. Cuando un país vende, manda stock ahí con MCI. Y Paneuropeo cuando vendes en serio en varios.$t$),

  -- ------------------------------------------- Tu best seller te puede estar arruinando
  ('best-seller-que-te-arruina', 'instagram',
   $t$Tu producto más vendido puede ser el que más dinero te quita.

Y no lo ves: tu panel enseña ventas, no beneficio.

Un ejemplo con números inventados. 600 pedidos al mes, 8 € de margen por pedido: 4.800 € al mes en el papel. Pero vuelven 20 de cada 100, a la mitad no se les puede dar salida y el almacén también cobra. Quedan 660 €.

El producto B, el que casi no miras, vende cuatro veces menos y gana más: 885 € al mes.

En el vídeo, la cuenta entera, cuándo NO conviene quitar un producto y la regla de tres cifras para ordenar tu catálogo.

Los números son de ejemplo, no de ninguna cuenta, pero el cálculo es el mismo con los tuyos. Guárdalo y haz la cuenta con tu producto más vendido.

En Liberty Seller cada producto pasa por estas tres cifras antes de gastar un euro en anunciarlo.$t$,
   ARRAY['#amazonfba', '#vendersenamazon', '#amazonseller', '#ecommerce', '#rentabilidad'],
   $t$La cuenta del producto A, por cada 100 pedidos:
+640 € de los 80 que se quedan (8 € cada uno)
-240 € de los 20 que vuelven: el envío y el anuncio ya estaban pagados (5 + 7 € cada uno)
-140 € de las 10 que no se pueden revender (14 € de coste cada una)
-150 € de almacén
= 110 € → 1,10 € por pedido → 660 € al mes con 600 pedidos.
Números de ejemplo.$t$),

  ('best-seller-que-te-arruina', 'tiktok',
   $t$Tu best seller te puede estar arruinando. 600 pedidos al mes y solo 660 € de beneficio: la cuenta con devoluciones y almacén, para que la repitas con tu producto. Números de ejemplo. ¿Cuánto te deja de verdad?$t$,
   ARRAY['#amazonfba', '#vendersenamazon', '#amazonseller', '#ecommerce', '#aprendeentiktok'],
   NULL),

  ('best-seller-que-te-arruina', 'facebook',
   $t$Tu producto más vendido puede ser el que más dinero te quita.

Con un producto de ejemplo, la cuenta sale así: 600 pedidos al mes y 8 € por pedido en el panel de Amazon son 4.800 € al mes. Pero de cada 100 pedidos vuelven 20, a la mitad no se les puede dar salida y el almacén también cobra. Con todo eso son 1,10 € por pedido: 660 € al mes.

El producto B vende cuatro veces menos y gana más.

En el vídeo está la cuenta entera y la regla que usamos para decidir qué producto se arregla y cuál se saca del catálogo. Los números son de ejemplo, no de ninguna cuenta, pero el cálculo es el mismo con los tuyos.

Compártelo con alguien que venda en Amazon.$t$,
   ARRAY['#AmazonFBA', '#VenderEnAmazon', '#Ecommerce'],
   $t$La cuenta del producto A, por cada 100 pedidos:
+640 € de los 80 que se quedan (8 € cada uno)
-240 € de los 20 que vuelven: el envío y el anuncio ya estaban pagados (5 + 7 € cada uno)
-140 € de las 10 que no se pueden revender (14 € de coste cada una)
-150 € de almacén
= 110 € → 1,10 € por pedido → 660 € al mes con 600 pedidos.
Números de ejemplo.$t$),

  -- ------------------------------------------ Black Friday: tres cosas para esta semana
  ('q4-tres-cosas-video', 'instagram',
   $t$Imagina que llega el Black Friday y tu mejor producto está agotado.

Le pasa a bastante gente, y casi nunca se decide en noviembre. Se decide ahora, en octubre: faltan unas seis semanas y un pedido a fábrica puede tardar unas trece en estar a la venta. Es como reservar mesa para Nochevieja el 30 de diciembre.

Tres cosas que se pueden hacer esta semana:

1. Contar hacia atrás desde el Black Friday y mandar lo que ya tienes. Y llamar hoy al proveedor: ¿qué tiene listo para enviar?
2. No mandar todo en avión. Elegir según el dinero que deja cada producto, no según lo que más vende.
3. Subir las pujas solo donde merezca la pena y poner una alarma para bajarlas el 1 de diciembre.

Y cuándo es mejor no entrar: a veces la mejor oferta es no hacer ninguna.

Guárdalo para tu lista de esta semana. ¿Ya sabes qué vas a mandar?$t$,
   ARRAY['#amazonfba', '#blackfriday', '#amazonseller', '#ecommerce', '#vendersenamazon'],
   $t$Los plazos del ejemplo, para rehacer la cuenta con tu proveedor:
- Fábrica 45 días + barco 30 + recepción en Amazon 14 = 89 días, unas 13 semanas (depende de cada proveedor).
- Black Friday: 27 de noviembre de 2026.
- Lo que ya viene en el barco llega. Lo que está en tu almacén, mándalo esta semana. Lo que sigue en fábrica solo llega en avión.
- Alarma el 1 de diciembre para bajar las pujas.$t$),

  ('q4-tres-cosas-video', 'tiktok',
   $t$Imagina que llega el Black Friday y tu mejor producto está agotado. Faltan unas 6 semanas y un pedido a fábrica puede tardar unas 13. Las 3 cosas que puedes hacer esta semana. ¿Ya sabes qué vas a mandar?$t$,
   ARRAY['#amazonfba', '#blackfriday', '#vendersenamazon', '#ecommerce', '#aprendeentiktok'],
   NULL),

  ('q4-tres-cosas-video', 'facebook',
   $t$Imagina que llega el Black Friday y tu mejor producto está agotado.

Le pasa a bastante gente, y casi nunca se decide en noviembre. Se decide ahora, en octubre. Faltan unas seis semanas y un pedido a fábrica puede tardar unas trece en estar a la venta, entre la fábrica, el barco y la recepción en Amazon. Es como reservar mesa para Nochevieja el 30 de diciembre.

Sin stock, tus anuncios se paran, tu producto desaparece de las búsquedas y tu competidor se queda con la venta. Y recuperar el puesto cuesta semanas.

En el vídeo van tres cosas que puedes hacer esta semana:

1. Contar hacia atrás desde el Black Friday y mandar lo que ya tienes. Y llamar hoy al proveedor.
2. No mandar todo en avión: elegir según el dinero que deja cada producto, no según lo que más vende.
3. Subir las pujas solo donde merezca la pena y poner una alarma para bajarlas el 1 de diciembre.

Y también cuándo es mejor no entrar. A veces la mejor oferta es no hacer ninguna.

¿Tienes ya claro qué vas a mandar esta semana?$t$,
   ARRAY['#AmazonFBA', '#BlackFriday', '#Ecommerce'],
   $t$Los plazos del ejemplo, para rehacer la cuenta con tu proveedor:
- Fábrica 45 días + barco 30 + recepción en Amazon 14 = 89 días, unas 13 semanas (depende de cada proveedor).
- Black Friday: 27 de noviembre de 2026.
- Lo que ya viene en el barco llega. Lo que está en tu almacén, mándalo esta semana. Lo que sigue en fábrica solo llega en avión.
- Alarma el 1 de diciembre para bajar las pujas.$t$),

  -- ------------------------------------- Black Friday: cuánto puedes pagar por un clic
  ('q4-tope-de-clic-video', 'instagram',
   $t$¿Cuánto puedes pagar por un clic en Black Friday sin perder dinero?

Un ejemplo con números inventados. Un clic de 1,20 € y una conversión del 10 % son 12 € de publicidad por venta. Si la venta te deja 9 €, pierdes 3 cada vez que vendes.

En Black Friday la conversión suele subir. Con un 15 %, la misma puja sale a 8 € por venta, y ya ganas 1.

La cuenta para saber tu tope: margen por conversión. 9 € × 15 % = 1,35 €. Ese es tu tope de clic: por encima, pierdes en cada venta.

Y el error que cuesta dinero en silencio: el 1 de diciembre la conversión vuelve a lo normal, el tope baja a 0,90 € y, si dejas la puja donde estaba, pagas de más en cada clic.

En el vídeo, la cuenta completa y cuándo no entrar. Los números son de ejemplo, no de ninguna cuenta, pero el cálculo es el mismo con los tuyos.

¿Conoces el tope de clic de tus productos?$t$,
   ARRAY['#amazonfba', '#blackfriday', '#amazonads', '#ecommerce', '#amazonseller'],
   $t$La cuenta del ejemplo:
- Clic a 1,20 € con un 10 % de conversión: 1,20 ÷ 0,10 = 12 € de publicidad por venta. Con 9 € de margen, -3 €.
- En Black Friday, con un 15 %: 1,20 ÷ 0,15 = 8 € por venta. 9 - 8 = +1 €.
- Tope de clic = margen × conversión: 9 € × 15 % = 1,35 € en Black Friday, y 9 € × 10 % = 0,90 € un día normal.
- El 1 de diciembre, un clic a 1,35 € son 0,45 € de más cada vez.
Números de ejemplo.$t$),

  ('q4-tope-de-clic-video', 'tiktok',
   $t$¿Cuánto puedes pagar por un clic en Black Friday sin perder dinero? Tope de clic = margen × conversión. Con 9 € de margen y un 15 % de conversión: 1,35 €. Números de ejemplo. ¿Conoces el tuyo?$t$,
   ARRAY['#amazonfba', '#blackfriday', '#amazonads', '#vendersenamazon', '#aprendeentiktok'],
   NULL),

  ('q4-tope-de-clic-video', 'facebook',
   $t$Si hoy pides stock a fábrica, te llega después del Black Friday. Un pedido tarda unas 13 semanas y faltan unas 6. Con ese plazo, lo que importa ahora es cómo vas a vender lo que ya tienes, y eso pasa por los anuncios.

En el vídeo hacemos la cuenta completa, con números de ejemplo, de cuánto puedes pagar por un clic en Black Friday sin perder dinero.

Pongamos que un clic cuesta 1,20 € y conviertes al 10 %: cada venta te cuesta 12 € en publicidad. Si la venta te deja 9, pierdes 3 cada vez. Con un 15 % de conversión, la misma puja sale a 8 € por venta y ya ganas 1.

Tu tope de clic es margen por conversión: 9 € × 15 % = 1,35 €. Por encima, pierdes en cada venta. Y el 1 de diciembre la conversión vuelve a lo normal, el tope baja a 0,90 € y, si dejas la puja donde estaba, pagas de más en cada clic.

Los números son de ejemplo, no de ninguna cuenta, pero el cálculo es el mismo con los tuyos.

¿Conoces el tope de clic de tus productos?$t$,
   ARRAY['#AmazonFBA', '#BlackFriday', '#AmazonAds'],
   $t$La cuenta del ejemplo:
- Clic a 1,20 € con un 10 % de conversión: 1,20 ÷ 0,10 = 12 € de publicidad por venta. Con 9 € de margen, -3 €.
- En Black Friday, con un 15 %: 1,20 ÷ 0,15 = 8 € por venta. 9 - 8 = +1 €.
- Tope de clic = margen × conversión: 9 € × 15 % = 1,35 € en Black Friday, y 9 € × 10 % = 0,90 € un día normal.
- El 1 de diciembre, un clic a 1,35 € son 0,45 € de más cada vez.
Números de ejemplo.$t$)

) AS v(slug, red, texto, hashtags, comentario)
JOIN public.contenido_piezas p ON p.slug = v.slug
ON CONFLICT (pieza_id, red) DO NOTHING;

-- ---------- Comprobación ----------
DO $$
DECLARE
  n INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'contenido_textos'
  ) THEN
    RAISE EXCEPTION 'La tabla contenido_textos no se ha creado.';
  END IF;
  SELECT count(*) INTO n FROM public.contenido_textos;
  RAISE NOTICE 'Listo. Hay % textos por red (los 4 vídeos cargan 12: Instagram, TikTok y Facebook de cada uno).', n;
END $$;
