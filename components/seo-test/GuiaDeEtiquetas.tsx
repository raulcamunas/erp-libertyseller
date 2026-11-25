'use client'

import { useState } from 'react'
import { BookOpen, CircleHelp } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { Boton, PanelLateral } from '@/components/ui-ls'

/**
 * LA GUÍA DE ETIQUETAS DE SEO: qué significa cada etiqueta que pone el ERP a una búsqueda, con un ejemplo en cifras, QUÉ HAY QUE HACER y QUIÉN lo hace. Se abre desde la cabecera del módulo
 * («Guía») en cualquier pestaña. Los textos siguen las reglas de lib/seo/embudo.ts (UMBRALES_DEL_EMBUDO y RESPONSABLE): si cambia una regla, se cambia aquí.
 */

interface Entrada {
  texto: string
  color: string
  quien: string
  significa: string
  ejemplo: string
  hacer: string[]
}

const ENTRADAS: Entrada[] = [
  {
    texto: 'Infraexpuesta',
    color: COLOR_ESTADO.violeta,
    quien: 'PPC (y SEO si no está en el título)',
    significa: 'Cuando te ven en esa búsqueda, te compran MÁS que a la media; el problema es que te ven poco. Tu cuota de compras es al menos 1,2 veces tu cuota de impresiones, sales en menos del 20 % de las impresiones y ya tienes 2 compras o más.',
    ejemplo: 'Sales en el 4 % de las impresiones de «funda nórdica 150» y te llevas el 9 % de las compras: cada vez que apareces, vendes el doble de lo normal.',
    hacer: [
      'Publicidad primero, porque da exposición ya: keyword EXACTA propia para esa búsqueda o, si ya la tiene, subir su puja o Top of Search.',
      'Si la búsqueda no está entera en el título ni en los Item Highlights, apúntala para el próximo cambio de ficha.',
      'Mírala en «Marketing Test → Campañas», en la tarjeta del producto: sale en «Desde SEO».',
    ],
  },
  {
    texto: 'Falta visibilidad',
    color: COLOR_ESTADO.azul,
    quien: 'SEO',
    significa: 'No se pierde en ningún paso del embudo (los que te ven hacen clic, añaden y compran con normalidad), pero te ven poco. Es trabajo de ficha: Amazon no te enseña lo suficiente para esa búsqueda.',
    ejemplo: '«cojín lumbar coche»: 0,8 % de impresiones, y clics, carritos y compras en la misma línea que el resto del mercado.',
    hacer: [
      'Que la búsqueda esté entera en el título o en los Item Highlights (pestaña Ficha → «Las búsquedas que venden y no están»).',
      'Si ya está y sigue saliendo poco, empujarla con una keyword EXACTA en publicidad.',
      'Respeta la ventana: un cambio de título cada 30 días y 21 días antes de juzgarlo.',
    ],
  },
  {
    texto: 'Pierde en clics',
    color: COLOR_ESTADO.ambar,
    quien: 'Imagen principal, precio o reseñas (no es SEO)',
    significa: 'Te ven, pero hacen clic en otros. Lo que decide el clic es lo que se ve en el resultado de búsqueda: imagen, precio, estrellas y número de reseñas.',
    ejemplo: 'Tienes el 6 % de las impresiones de «organizador cajones» pero solo el 2 % de los clics.',
    hacer: ['No reescribas el título por esto.', 'Compara tu imagen principal, precio y valoraciones con los productos que se llevan el clic en esa búsqueda (pestaña Competencia).', 'Si la búsqueda no describe tu producto, márcala «No es nuestro producto» y negativízala en PPC.'],
  },
  {
    texto: 'Pierde en carrito',
    color: COLOR_ESTADO.ambar,
    quien: 'Bullets, A+ o precio (no es SEO)',
    significa: 'Entran en la ficha pero no lo añaden al carrito: lo que ven dentro no les convence.',
    ejemplo: '5 % de los clics de «lámpara escritorio led» y solo 2 % de los carritos.',
    hacer: ['Revisa que los bullets y el A+ respondan a lo que busca esa gente (medidas, compatibilidad, uso).', 'Comprueba que el precio no asusta frente al del sector en esa búsqueda.'],
  },
  {
    texto: 'Pierde en compra',
    color: COLOR_ESTADO.ambar,
    quien: 'Envío o Buy Box (no es SEO)',
    significa: 'Lo añaden al carrito pero no lo compran. Casi siempre es la Buy Box, el plazo de entrega o una rotura de stock.',
    ejemplo: '4 % de los carritos y 1 % de las compras.',
    hacer: ['Comprueba que tienes la Buy Box y que el plazo de entrega es el de Prime.', 'Mira si hubo días sin stock en ese periodo (sale en la evolución del producto).'],
  },
  {
    texto: 'Lidera',
    color: COLOR_ESTADO.verde,
    quien: 'Nadie: mantener',
    significa: 'Ya te llevas el 30 % o más de las compras de esa búsqueda.',
    ejemplo: '«almohada cervical viscoelástica»: 34 % de las compras.',
    hacer: ['No tocar lo que funciona: si se cambia la ficha, que esta búsqueda siga entera en el título.', 'Vigilar en Competencia que nadie te la quite (precio, reseñas).'],
  },
  {
    texto: 'Pocos datos',
    color: 'var(--ls-t4)',
    quien: 'Nadie todavía',
    significa: 'Sales tan poco que no se puede juzgar ningún paso del embudo y no tienes ni un carrito ni una compra.',
    ejemplo: '3 impresiones tuyas de 40.000 y ninguna venta.',
    hacer: ['Si describe tu producto: es una oportunidad de visibilidad (título o EXACTA en publicidad).', 'Si sale «¿Ajena?», probablemente es otro producto: márcala «No es nuestro producto».'],
  },
  {
    texto: '¿Ajena? / No es tuya',
    color: 'var(--ls-t4)',
    quien: 'SEO (para decidir) y PPC (para negativizar)',
    significa: 'La búsqueda lleva palabras que no están en tu ficha ni en tus búsquedas habituales: puede ser de otro producto. «No es tuya» es cuando alguien del equipo ya la ha marcado así.',
    ejemplo: '«lego» en un juego de mesa: muchas impresiones, ninguna compra tuya.',
    hacer: ['Confirma o descarta con el botón de la búsqueda. Las ajenas no cuentan para la ficha ni para las tareas.', 'Si gasta en publicidad, que PPC la negativice.'],
  },
  {
    texto: 'Ruido',
    color: 'var(--ls-t4)',
    quien: 'Nadie',
    significa: 'Casi nadie compra tras esa búsqueda (menos de una quinta parte de lo normal en las búsquedas del producto): no hay nada que ganar.',
    ejemplo: '«ideas regalo» con 200.000 búsquedas y casi ninguna compra.',
    hacer: ['No trabajarla ni meterla en la ficha.'],
  },
  {
    texto: 'Otro precio',
    color: 'var(--ls-t4)',
    quien: 'Nadie',
    significa: 'En esa búsqueda la gente compra a menos de la mitad de tu precio: es otro producto u otro segmento.',
    ejemplo: 'Vendes a 49 € y en «auriculares baratos» se compra a 15 €.',
    hacer: ['No perseguirla con la ficha ni con publicidad: ni el mejor título lo arregla.'],
  },
]

const RESULTADOS: Array<{ texto: string; color: string; significa: string }> = [
  { texto: 'Mejora', color: COLOR_ESTADO.verde, significa: 'La cuota (de compras, o de impresiones si hay pocas compras) sube un 10 % o más en las 3 semanas después frente a las 3 de antes. Se deja así.' },
  { texto: 'Empeora', color: COLOR_ESTADO.rojo, significa: 'Cae un 10 % o más. Mira qué búsquedas salieron de la ficha con el cambio y valora volver a la versión anterior (botón «Cargar esta versión»).' },
  { texto: 'Sin efecto claro', color: 'var(--ls-t3)', significa: 'Se mueve menos de un 10 %. El cambio no ha hecho daño; el próximo puede ir a por otras búsquedas.' },
  { texto: 'No atribuible', color: COLOR_ESTADO.ambar, significa: 'En esas semanas hubo una rotura de stock u otro cambio de ficha: lo que se mueva puede ser eso.' },
  { texto: 'Provisional', color: COLOR_ESTADO.azul, significa: 'Aún no han pasado 21 días o no hay 3 semanas de Brand Analytics de después. Se enseña la tendencia, sin veredicto.' },
]

export function GuiaDeEtiquetas() {
  const [abierta, setAbierta] = useState(false)
  return (
    <>
      <Boton variante="secundario" icono={CircleHelp} onClick={() => setAbierta(true)} title="Qué significa cada etiqueta y qué hay que hacer">
        Guía
      </Boton>
      <PanelLateral abierto={abierta} onCambio={setAbierta} titulo="Qué significa cada etiqueta" descripcion="Y qué hay que hacer en cada caso, y quién" icono={BookOpen} acento="seo" ancho={560}>
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] leading-[1.55] text-[var(--ls-t3)]">
            Cada búsqueda pasa por un embudo: <b className="text-[var(--ls-t2)]">te ven</b> (impresiones) → <b className="text-[var(--ls-t2)]">hacen clic</b> → <b className="text-[var(--ls-t2)]">lo añaden</b> → <b className="text-[var(--ls-t2)]">lo compran</b>. El ERP compara tu parte en cada paso con la de todo Amazon y pone una etiqueta según dónde se pierde. Solo lo que se pierde en «te ven» es trabajo de SEO.
          </p>
          {ENTRADAS.map((e) => (
            <div key={e.texto} className="rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-[5px] px-[7px] py-[2px] text-[12px] font-semibold" style={{ color: e.color, background: `color-mix(in srgb, ${e.color} 14%, transparent)` }}>
                  {e.texto}
                </span>
                <span className="text-[11.5px] text-[var(--ls-t4)]">Lo hace: {e.quien}</span>
              </div>
              <p className="mt-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">{e.significa}</p>
              <p className="mt-1 text-[12px] italic leading-[1.5] text-[var(--ls-t4)]">Ejemplo: {e.ejemplo}</p>
              <div className="mt-2 text-[12px] font-semibold text-[var(--ls-t1)]">Qué hacer</div>
              <ul className="mt-1 flex list-disc flex-col gap-[3px] pl-4 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
                {e.hacer.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          ))}
          <div className="mt-2 text-[13px] font-semibold text-[var(--ls-t1)]">El resultado de un cambio de ficha</div>
          <p className="text-[12.5px] leading-[1.5] text-[var(--ls-t3)]">
            En la pestaña Ficha, cada cambio aplicado compara las 3 semanas de antes con las 3 de después (la semana del cambio no cuenta), con las mismas búsquedas a ambos lados. Se mira la cuota, no las compras a secas, para que la temporada no engañe.
          </p>
          {RESULTADOS.map((r) => (
            <div key={r.texto} className="flex items-start gap-2 text-[12.5px] leading-[1.5]">
              <span className="mt-[1px] shrink-0 rounded-[5px] px-[7px] py-[1px] text-[12px] font-semibold" style={{ color: r.color, background: `color-mix(in srgb, ${r.color} 14%, transparent)` }}>
                {r.texto}
              </span>
              <span className="text-[var(--ls-t2)]">{r.significa}</span>
            </div>
          ))}
        </div>
      </PanelLateral>
    </>
  )
}
