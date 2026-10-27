'use client'

import { useState } from 'react'
import { ClipboardList, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { contestadas, PREGUNTAS_REUNION } from '@/lib/types/crm'
import { respuestasParaElGuion } from '@/lib/crm/gemini/guion'
import type { AnalisisDeReunion } from '@/lib/crm/gemini/tipos'
import { AREA_FANTASMA, Boton, Seccion } from './piezas'
import type { ContextoFicha } from './tipos'

/**
 * EL GUION DE LA REUNIÓN (las preguntas de Liberty Seller), con lo que la IA pudo contestar de lo hablado.
 *
 * Se rellena MIENTRAS se habla con el cliente, y las respuestas se guardan por CLAVE en `crm_clients.preguntas` (lib/types/crm.ts), no por posición. Se guarda ENTERO en cada
 * blur y no pregunta a pregunta: son veinticinco campos en la misma columna JSONB, y veinticinco escrituras parciales contra el mismo objeto es la receta para que la última pise
 * a las anteriores en cuanto alguien tabule rápido.
 *
 * «Pasar al guion» copia las respuestas que dedujo la IA SOLO a las preguntas que siguen vacías: lo que una persona ya escribió no se pisa nunca.
 */
export function GuionDeLaReunion({ ctx, analisis }: { ctx: ContextoFicha; analisis: AnalisisDeReunion | null }) {
  const { client, puedeEditar } = ctx
  const [preguntas, setPreguntas] = useState<Record<string, string>>(client.preguntas ?? {})
  const [abierto, setAbierto] = useState(false)
  const total = PREGUNTAS_REUNION.reduce((n, b) => n + contestadas(b, preguntas), 0)

  const limpiar = (r: Record<string, string>) => {
    const salida: Record<string, string> = {}
    for (const [clave, valor] of Object.entries(r)) {
      const texto = valor.trim()
      if (texto !== '') salida[clave] = texto
    }
    return salida
  }

  async function guardar() {
    const limpio = limpiar(preguntas)
    if (JSON.stringify(limpio) === JSON.stringify(client.preguntas ?? {})) return
    if (await ctx.patch({ preguntas: limpio })) setPreguntas(limpio)
  }

  const propuestas = analisis ? respuestasParaElGuion(analisis, limpiar(preguntas)) : {}
  const nPropuestas = Object.keys(propuestas).length

  async function pasarAlGuion() {
    const actuales = limpiar(preguntas)
    const mezcla = { ...actuales, ...respuestasParaElGuion(analisis!, actuales) }
    if (await ctx.patch({ preguntas: mezcla })) {
      setPreguntas(mezcla)
      setAbierto(true)
      toast.success(`${nPropuestas} respuesta${nPropuestas === 1 ? '' : 's'} pasada${nPropuestas === 1 ? '' : 's'} al guion`)
    }
  }

  return (
    <Seccion
      titulo="Preguntas de la reunión"
      icono={<ClipboardList />}
      derecha={
        <span className="flex items-center gap-2">
          {total > 0 && <span className="text-[11px] tabular-nums text-[var(--ls-acc)]">{total} contestadas</span>}
          <Boton onClick={() => setAbierto((v) => !v)}>{abierto ? 'Cerrar' : 'Abrir'}</Boton>
        </span>
      }
    >
      {puedeEditar && nPropuestas > 0 && (
        <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[9px] py-[7px]" style={{ borderLeft: '2px solid var(--ls-e-azul)' }}>
          <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--ls-e-azul)' }} />
          <p className="min-w-0 flex-1 text-[12px] leading-[1.5] text-[var(--ls-t2)]">
            La IA puede contestar <strong className="font-semibold text-[var(--ls-t1)]">{nPropuestas}</strong> pregunta{nPropuestas === 1 ? '' : 's'} del guion con lo hablado en la reunión. Solo se rellenan las que están vacías.
          </p>
          <Boton tono="primario" onClick={() => void pasarAlGuion()}>
            Pasar al guion
          </Boton>
        </div>
      )}

      {!abierto ? (
        <p className="text-[12px] text-[var(--ls-t3)]">El guion de la reunión: uno para quien ya vende en Amazon y otro para quien no.</p>
      ) : (
        <div className="space-y-4">
          {PREGUNTAS_REUNION.map((bloque) => (
            <div key={bloque.id}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <h4 className="text-[12.5px] font-semibold text-[var(--ls-t1)]">{bloque.titulo}</h4>
                <span className="text-[11px] text-[var(--ls-t4)]">{bloque.pista}</span>
                <span className="ml-auto text-[11px] tabular-nums text-[var(--ls-t4)]">
                  {contestadas(bloque, preguntas)}/{bloque.preguntas.length}
                </span>
              </div>
              <div className="grid grid-cols-1 items-start gap-2 md:grid-cols-2 2xl:grid-cols-3">
                {bloque.preguntas.map((p) => {
                  const sugerida = propuestas[p.clave]
                  return (
                    <div key={p.clave} className={`rounded-[6px] border p-2 ${p.cierre ? 'md:col-span-2 2xl:col-span-3 border-[var(--ls-e-verde)]/40 bg-[var(--ls-sup2)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup)]'}`}>
                      <p className={`mb-1 text-[11.5px] leading-[1.35] ${p.cierre ? 'font-semibold text-[var(--ls-t1)]' : 'text-[var(--ls-t3)]'}`}>{p.texto}</p>
                      <textarea readOnly={!puedeEditar} value={preguntas[p.clave] ?? ''} onChange={(e) => setPreguntas((prev) => ({ ...prev, [p.clave]: e.target.value }))} onBlur={() => void guardar()} rows={2} placeholder="Escribe aquí lo que conteste" className={AREA_FANTASMA} />
                      {sugerida && (
                        <p className="mt-1 flex items-start gap-1 text-[11px] leading-[1.45] text-[var(--ls-t3)]">
                          <Sparkles className="mt-[2px] h-3 w-3 shrink-0" style={{ color: 'var(--ls-e-azul)' }} />
                          <span>
                            <span className="font-semibold">La IA entendió: </span>
                            {sugerida}
                          </span>
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Seccion>
  )
}
