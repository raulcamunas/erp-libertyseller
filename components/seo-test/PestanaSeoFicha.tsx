'use client'

import { useMemo, useState } from 'react'
import { CircleAlert, CircleCheck, FileText, Info, TriangleAlert } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { haceCuanto } from '@/components/marketing-test/formato'
import { Vacio } from '@/components/plataforma/comun'
import { NOMBRE_DE_ETAPA, RESPONSABLE, RESPONSABLE_INFRAEXPUESTA } from '@/lib/seo/embudo'
import { ventanaDeCambio } from '@/lib/seo/tareas'
import { marcaDelTitulo } from '@/lib/seo/marcas'
import { decisionesDe, diagnosticoDe, fichaDe, SelectorDeProducto } from './comun'
import type { DatosSeo } from './useCuentaSeo'
import { PropuestaConIa } from './PropuestaConIa'
import { EditorDeFicha } from './EditorDeFicha'
import { ResultadoDeCambios } from './ResultadoDeCambios'
import { AvisoDeHighlights } from './TarjetaDelEstudio'
import { HighlightsDeLaFicha } from './HighlightsDeLaFicha'
import { useDelProducto } from './useDelProducto'
import type { DatosDePublicidad } from './PestanaSeoBusquedas'

/**
 * LA FICHA DE UN PRODUCTO, EN UN SOLO PANEL (Raúl, 25 nov 2026: «que se vea casi todo en una misma página y se pueda editar en tiempo real»):
 *   · arriba, el aviso de Item Highlights sin guardar y la «puerta de salida» del SOP (si el embudo dice que se pierde en clics, carrito o compra, reescribir la ficha no es lo primero);
 *   · el EDITOR (EditorDeFicha): los campos con lo que falla justo debajo y, al lado, la puntuación de 0 a 100, las palabras que pesan, las búsquedas y lo que dice Amazon, todo
 *     recalculado con cada tecla; «Enviar a Amazon» valida (sin guardar) y pide confirmación;
 *   · debajo, la propuesta con IA y el resultado de los cambios ya aplicados.
 */
export function PestanaSeoFicha({ cuentaId, datos, asin, setAsin, irAProductos, recargar }: { cuentaId: string; datos: DatosSeo; asin: string | null; setAsin: (a: string) => void; irAProductos: () => void; recargar?: () => void | Promise<unknown> }) {
  const publicidad = useDelProducto<DatosDePublicidad>(asin ? `/api/seo/publicidad?cuenta=${encodeURIComponent(cuentaId)}&asin=${asin}` : null)
  const ficha = asin ? fichaDe(datos, asin) : null
  const diagnostico = useMemo(() => (asin ? diagnosticoDe(datos, asin) : null), [datos, asin])
  const decisiones = useMemo(() => decisionesDe(datos), [datos])
  const [abrirHighlights, setAbrirHighlights] = useState(0)
  const mkt = cuentaId.split('~')[1] ?? null
  const ventana = asin ? ventanaDeCambio(datos.cambios ?? [], asin, new Date().toISOString().slice(0, 10)) : null
  const hayBusquedas = (diagnostico?.busquedas.length ?? 0) > 0

  if (datos.productos.length === 0)
    return (
      <Vacio icono={<FileText />} titulo="Primero hay que seguir algún producto" accion={<button type="button" onClick={irAProductos} className="h-[30px] rounded-[9px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)]">Ir a Productos</button>}>
        La ficha se lee de Amazon para cada producto que sigues.
      </Vacio>
    )

  return (
    <div className="flex flex-col gap-3 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <SelectorDeProducto productos={datos.productos} datos={datos} asin={asin} setAsin={setAsin} />
        {ficha && <span className="text-[11.5px] text-[var(--ls-t4)]">Leída de Amazon {haceCuanto(Date.parse(ficha.leidaAt))}{ficha.sku ? ` · SKU ${ficha.sku}` : ''}</span>}
      </div>

      {!ficha ? (
        <Vacio icono={<FileText />} titulo="Todavía no se ha leído la ficha de este producto">
          {datos.productos.find((p) => p.asin === asin)?.sku ? 'Se lee de Amazon una vez al día. Si acabas de añadirlo, pulsa «Actualizar» arriba y espera un par de minutos.' : 'Este producto no tiene SKU apuntado y sin él no se puede leer la ficha. El ERP lo busca solo en el catálogo de la cuenta; si no aparece, quítalo y vuelve a añadirlo desde «Añadir productos».'}
        </Vacio>
      ) : (
        <>
          {!ficha.origenHighlights && (
            <AvisoDeHighlights
              pegar={() => {
                setAbrirHighlights((n) => n + 1)
                setTimeout(() => document.getElementById(`hl-${asin}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
              }}
            />
          )}
          <PuertaDeSalida d={diagnostico} hayBusquedas={hayBusquedas} ventana={ventana} />
          {asin && ficha.sku ? (
            <EditorDeFicha
              key={`editor-${asin}`}
              cuentaId={cuentaId}
              asin={asin}
              mkt={mkt}
              ficha={ficha}
              ventana={ventana}
              onAplicada={recargar ? () => void recargar() : undefined}
              busquedas={diagnostico?.busquedas ?? []}
              marca={marcaDelTitulo(ficha.titulo)}
              publicidad={publicidad.datos?.hayMarketingTest ? publicidad.datos.vendePorPublicidad : undefined}
              extraHighlights={
                ficha.origenHighlights !== 'amazon' ? (
                  <div id={`hl-${asin}`} className="scroll-mt-6">
                    <HighlightsDeLaFicha key={`hl-${asin}`} cuentaId={cuentaId} asin={asin} ficha={ficha} recargar={recargar} abrir={abrirHighlights} />
                  </div>
                ) : undefined
              }
            />
          ) : (
            <p className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-3 text-[12.5px] text-[var(--ls-t3)]">Este producto no tiene SKU apuntado: sin él no se puede editar la ficha desde aquí.</p>
          )}
          {asin && <PropuestaConIa key={asin} cuentaId={cuentaId} asin={asin} hayBusquedas={hayBusquedas} hayFicha={!!ficha.titulo} mejoras={!!datos.lectura.mejoras} diagnostico={diagnostico} ventana={ventana} />}
          {asin && <ResultadoDeCambios key={`resultado-${asin}`} cuentaId={cuentaId} asin={asin} precio={datos.precios?.[asin] ?? null} decisiones={decisiones} />}
        </>
      )}
    </div>
  )
}

/**
 * LA PUERTA DE SALIDA DEL SOP: antes de tocar la ficha, ¿es de verdad un problema de SEO? Si el embudo del producto se cae en clics, carrito o compra, se dice claro y quién lo tiene que arreglar.
 * Y si la ficha se cambió hace menos de 30 días, también: no se toca.
 */
function PuertaDeSalida({ d, hayBusquedas, ventana }: { d: ReturnType<typeof diagnosticoDe> | null; hayBusquedas: boolean; ventana: ReturnType<typeof ventanaDeCambio> }) {
  const v = d?.producto.veredicto
  const fecha = (x: string) => new Date(`${x}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' })
  const bloques: Array<{ color: string; Icono: typeof CircleAlert; titulo: string; texto: string }> = []
  if (ventana?.bloqueada) bloques.push({ color: COLOR_ESTADO.ambar, Icono: TriangleAlert, titulo: `Ficha cambiada el ${fecha(ventana.ultimo)}: no se toca el título hasta el ${fecha(ventana.puedeDesde)}`, texto: `El SOP pide como mucho un cambio de título cada 30 días y 21 días antes de juzgarlo (${ventana.juzgable ? 'ya se puede juzgar' : `se juzga desde el ${fecha(ventana.juzgarDesde)}`}). Si no, el resultado no se puede atribuir a ningún cambio.` })
  if (v?.tipo === 'fuga') {
    const r = RESPONSABLE[v.etapa]
    bloques.push({ color: COLOR_ESTADO.ambar, Icono: CircleAlert, titulo: `Antes de reescribir: el embudo se cae en ${NOMBRE_DE_ETAPA[v.etapa].toLowerCase()}. No es SEO, es de: ${r.quien}`, texto: `${v.motivo} ${r.accion} Reescribir el título aquí no cambia nada y gasta la ventana de cambio del mes.` })
  } else if (v?.tipo === 'infraexpuesta') {
    bloques.push({ color: COLOR_ESTADO.violeta, Icono: Info, titulo: 'Convierte de sobra y sale poco: lo más rápido es publicidad', texto: `${v.motivo} ${RESPONSABLE_INFRAEXPUESTA.accion}` })
  } else if (v?.tipo === 'visibilidad' || v?.tipo === 'lider') {
    bloques.push({ color: COLOR_ESTADO.verde, Icono: CircleCheck, titulo: v.tipo === 'lider' ? 'El producto ya manda en sus búsquedas' : 'El embudo dice que es SEO: el trabajo está en la ficha', texto: v.motivo })
  } else if (!hayBusquedas) {
    bloques.push({ color: 'var(--ls-t4)', Icono: Info, titulo: 'Sin búsquedas de Brand Analytics todavía', texto: 'Sin ellas no se puede saber si el problema es de SEO. La revisión de la norma de abajo sí vale ya.' })
  }
  if (bloques.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {bloques.map((b) => (
        <div key={b.titulo} className="flex items-start gap-3 rounded-[12px] border px-4 py-3" style={{ borderColor: `color-mix(in srgb, ${b.color} 35%, var(--ls-linea))`, background: `color-mix(in srgb, ${b.color} 6%, var(--ls-sup))` }}>
          <b.Icono className="mt-[2px] h-[15px] w-[15px] shrink-0" style={{ color: b.color }} />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--ls-t1)]">{b.titulo}</div>
            <div className="mt-[2px] text-[12.5px] leading-[1.5] text-[var(--ls-t3)]">{b.texto}</div>
          </div>
        </div>
      ))}
    </div>
  )
}




