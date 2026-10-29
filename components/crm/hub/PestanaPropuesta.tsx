'use client'

import { useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { CheckCircle2, Circle, Euro, FileText, Layers, ListChecks, Plus, Rocket, ShieldAlert, Sparkles, StickyNote, Trash2, Wrench } from 'lucide-react'
import { toMadrid } from '@/lib/timezone'
import { CrmDocuments } from '../CrmDocuments'
import { avanceDeLaPropuesta, leerPlan, LIMITES_DEL_PLAN, planDesdeAnalisis, planEstaVacio, VARIABLE_POR_DEFECTO, type AvanceDeLaPropuesta, type PasoDelPlan, type PropuestaPlan, type ServicioDelPlan } from '@/lib/crm/propuesta'
import { Medidor } from './etiquetas'
import { AREA_FANTASMA, Aviso, Boton, Fila, INPUT_FANTASMA, Seccion } from './piezas'
import type { ContextoFicha } from './tipos'

const fecha = (iso: string) => format(toMadrid(new Date(iso)), "d 'de' MMMM", { locale: es })

/** Una lista de pasos editable: título corto + detalle de una frase. Hasta LIMITES_DEL_PLAN.pasos */
function EditorDePasos({ pasos, soloLectura, vacio, onCambiar, onGuardar }: { pasos: PasoDelPlan[]; soloLectura: boolean; vacio: string; onCambiar: (p: PasoDelPlan[], guardar: boolean) => void; onGuardar: () => void }) {
  return (
    <div className="space-y-1.5">
      {pasos.length === 0 && <p className="text-[12px] text-[var(--ls-t4)]">{vacio}</p>}
      {pasos.map((p, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <span className="mt-[5px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] text-[10.5px] font-semibold tabular-nums text-[var(--ls-t3)]">{i + 1}</span>
          <div className="grid min-w-0 flex-1 gap-1 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
            <input readOnly={soloLectura} value={p.titulo} onChange={(e) => onCambiar(pasos.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)), false)} onBlur={onGuardar} placeholder="Título del paso" className={`${INPUT_FANTASMA} font-medium`} />
            <input readOnly={soloLectura} value={p.detalle} onChange={(e) => onCambiar(pasos.map((x, j) => (j === i ? { ...x, detalle: e.target.value } : x)), false)} onBlur={onGuardar} placeholder="Qué se hace" className={INPUT_FANTASMA} />
          </div>
          {!soloLectura && (
            <button type="button" onClick={() => onCambiar(pasos.filter((_, j) => j !== i), true)} className="mt-[3px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" aria-label="Quitar el paso">
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {!soloLectura && pasos.length < LIMITES_DEL_PLAN.pasos && (
        <Boton onClick={() => onCambiar([...pasos, { titulo: '', detalle: '' }], false)} icono={<Plus />}>
          Añadir paso
        </Boton>
      )}
    </div>
  )
}

export function PestanaPropuesta({ ctx, plan, avance }: { ctx: ContextoFicha; plan: PropuestaPlan; avance: AvanceDeLaPropuesta }) {
  const { client, puedeEditar, notas } = ctx
  const soloLectura = !puedeEditar

  // El borrador conserva las filas a medio escribir (el plan guardado las tira); lo que se manda a la base va siempre limpio
  const [borrador, setBorrador] = useState<PropuestaPlan>(plan)
  const ref = useRef<PropuestaPlan>(plan)
  const [setup, setSetup] = useState(client.setup_budget != null ? String(client.setup_budget) : '')
  const [cuota, setCuota] = useState(client.maintenance_budget != null ? String(client.maintenance_budget) : '')
  const [variable, setVariable] = useState(plan.variable_pct != null ? String(plan.variable_pct) : '')

  function cambiar(siguiente: PropuestaPlan, guardarYa = false) {
    ref.current = siguiente
    setBorrador(siguiente)
    if (guardarYa) void guardar()
  }

  async function guardar() {
    const guardado = leerPlan(client.propuesta_plan)
    const nuevo = leerPlan({ ...ref.current, editado_en: null })
    // Pasar por un campo sin cambiar nada no es una edición: no se guarda ni se marca como escrita a mano
    if (JSON.stringify({ ...nuevo, origen: null, editado_en: null }) === JSON.stringify({ ...guardado, origen: null, editado_en: null })) return
    await ctx.patch({ propuesta_plan: { ...nuevo, origen: nuevo.origen ?? 'manual', editado_en: new Date().toISOString() } })
  }

  // La sugerencia de la IA: la propuesta de la reunión analizada más reciente
  const sugerida = useMemo(() => notas.find((n) => n.analisis && (n.analisis.propuesta.servicios.length > 0 || n.analisis.propuesta.enfoque)) ?? null, [notas])
  const hayPlan = !planEstaVacio(plan)

  async function usarSugerencia() {
    if (!sugerida?.analisis) return
    if (hayPlan && !window.confirm('Esto sustituye lo que hay escrito en el plan por la propuesta de la IA. ¿Seguro?')) return
    const nuevo = planDesdeAnalisis(sugerida.analisis, sugerida.id)
    // Se conserva el % variable que ya hubiera decidido alguien
    const conVariable = { ...nuevo, variable_pct: plan.variable_pct, notas: plan.notas, editado_en: new Date().toISOString() }
    if (await ctx.patch({ propuesta_plan: conVariable })) {
      ref.current = conVariable
      setBorrador(conVariable)
      toast.success('Propuesta de la IA cargada: ahora puedes retocarla')
    }
  }

  function guardarVariable() {
    const texto = variable.trim().replace(',', '.')
    const n = texto === '' ? null : Number(texto)
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) {
      setVariable(ref.current.variable_pct != null ? String(ref.current.variable_pct) : '')
      toast.error('El porcentaje tiene que estar entre 0 y 100')
      return
    }
    cambiar({ ...ref.current, variable_pct: n }, true)
  }

  const piezas: Array<{ nombre: string; hecha: boolean }> = [
    { nombre: 'Enfoque', hecha: avance.hechas.includes('Enfoque') },
    { nombre: 'Servicios', hecha: avance.hechas.includes('Servicios') },
    { nombre: 'Datos clave', hecha: avance.hechas.includes('Datos clave') },
    { nombre: 'Fase 1 · Setup', hecha: avance.hechas.includes('Fase 1 · Setup') },
    { nombre: 'Fase 2 · Crecimiento', hecha: avance.hechas.includes('Fase 2 · Crecimiento') },
    { nombre: 'Importes', hecha: avance.hechas.includes('Importes') },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {puedeEditar && sugerida?.analisis && (!hayPlan || plan.nota_id !== sugerida.id) && (
        <Aviso tono="azul" icono={<Sparkles />}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-[12px] leading-[1.5]">
              {!hayPlan ? (
                <>
                  La IA ha preparado una propuesta con lo hablado{sugerida.fecha_reunion ? ` el ${fecha(sugerida.fecha_reunion)}` : ''}: <strong className="font-semibold text-[var(--ls-t1)]">{sugerida.analisis.propuesta.servicios.length} servicios</strong> y el plan en dos fases. Se carga aquí para retocarla; sin importes.
                </>
              ) : (
                <>Hay una reunión analizada{sugerida.fecha_reunion ? ` (${fecha(sugerida.fecha_reunion)})` : ''} con otra propuesta sugerida. Puedes sustituir el plan actual por ella.</>
              )}
            </p>
            <Boton tono={hayPlan ? 'secundario' : 'primario'} onClick={() => void usarSugerencia()}>
              {hayPlan ? 'Sustituir por la sugerencia' : 'Usar esta propuesta'}
            </Boton>
          </div>
        </Aviso>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {/* ---------------- El plan, página a página ---------------- */}
        <div className="flex min-w-0 flex-col gap-3">
          <Seccion titulo="Enfoque" icono={<Layers />} derecha={borrador.origen === 'ia' ? <span className="text-[11px] text-[var(--ls-t4)]">Sugerido por la IA · retócalo</span> : undefined}>
            <textarea readOnly={soloLectura} value={borrador.enfoque} onChange={(e) => cambiar({ ...ref.current, enfoque: e.target.value })} onBlur={() => void guardar()} rows={3} placeholder="La idea central de la propuesta para este cliente, en dos o tres frases." className={AREA_FANTASMA} />
          </Seccion>

          <Seccion titulo="Servicios de la portada" icono={<ListChecks />} derecha={<span className="text-[11px] text-[var(--ls-t4)]">Tres o cuatro</span>}>
            <div className="space-y-1.5">
              {borrador.servicios.length === 0 && <p className="text-[12px] text-[var(--ls-t4)]">Todavía no hay servicios.</p>}
              {borrador.servicios.map((s: ServicioDelPlan, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <div className="grid min-w-0 flex-1 gap-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_88px]">
                    <input readOnly={soloLectura} value={s.nombre} onChange={(e) => cambiar({ ...ref.current, servicios: ref.current.servicios.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)) })} onBlur={() => void guardar()} placeholder="Servicio" className={`${INPUT_FANTASMA} font-medium`} />
                    <input readOnly={soloLectura} value={s.motivo} onChange={(e) => cambiar({ ...ref.current, servicios: ref.current.servicios.map((x, j) => (j === i ? { ...x, motivo: e.target.value } : x)) })} onBlur={() => void guardar()} placeholder="Por qué (ligado a lo hablado)" className={INPUT_FANTASMA} />
                    <select disabled={soloLectura} value={s.prioridad} onChange={(e) => cambiar({ ...ref.current, servicios: ref.current.servicios.map((x, j) => (j === i ? { ...x, prioridad: e.target.value as ServicioDelPlan['prioridad'] } : x)) }, true)} className={`${INPUT_FANTASMA} cursor-pointer`}>
                      <option value="alta">Alta</option>
                      <option value="media">Media</option>
                      <option value="baja">Baja</option>
                    </select>
                  </div>
                  {!soloLectura && (
                    <button type="button" onClick={() => cambiar({ ...ref.current, servicios: ref.current.servicios.filter((_, j) => j !== i) }, true)} className="mt-[3px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" aria-label="Quitar el servicio">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              {!soloLectura && borrador.servicios.length < LIMITES_DEL_PLAN.servicios && (
                <Boton onClick={() => cambiar({ ...ref.current, servicios: [...ref.current.servicios, { nombre: '', motivo: '', prioridad: 'media' }] })} icono={<Plus />}>
                  Añadir servicio
                </Boton>
              )}
            </div>
          </Seccion>

          <Seccion titulo="Tres datos clave del diagnóstico" icono={<FileText />}>
            <div className="space-y-1.5">
              {borrador.datos_clave.length === 0 && <p className="text-[12px] text-[var(--ls-t4)]">Tres cifras que abren la página de diagnóstico: «20.000 €/mes — facturación actual».</p>}
              {borrador.datos_clave.map((d, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <div className="grid min-w-0 flex-1 gap-1 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.6fr)]">
                    <input readOnly={soloLectura} value={d.valor} onChange={(e) => cambiar({ ...ref.current, datos_clave: ref.current.datos_clave.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) })} onBlur={() => void guardar()} placeholder="Valor" className={`${INPUT_FANTASMA} font-semibold tabular-nums`} />
                    <input readOnly={soloLectura} value={d.etiqueta} onChange={(e) => cambiar({ ...ref.current, datos_clave: ref.current.datos_clave.map((x, j) => (j === i ? { ...x, etiqueta: e.target.value } : x)) })} onBlur={() => void guardar()} placeholder="Qué es" className={INPUT_FANTASMA} />
                  </div>
                  {!soloLectura && (
                    <button type="button" onClick={() => cambiar({ ...ref.current, datos_clave: ref.current.datos_clave.filter((_, j) => j !== i) }, true)} className="mt-[3px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" aria-label="Quitar el dato">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              {!soloLectura && borrador.datos_clave.length < LIMITES_DEL_PLAN.datos && (
                <Boton onClick={() => cambiar({ ...ref.current, datos_clave: [...ref.current.datos_clave, { valor: '', etiqueta: '' }] })} icono={<Plus />}>
                  Añadir dato
                </Boton>
              )}
            </div>
          </Seccion>

          <Seccion titulo="Fase 1 · Setup" icono={<Wrench />} derecha={<span className="text-[11px] text-[var(--ls-t4)]">Meses 1 a 3 · cuatro pasos</span>}>
            <EditorDePasos pasos={borrador.fase_setup} soloLectura={soloLectura} vacio="Sin pasos todavía." onCambiar={(p, g) => cambiar({ ...ref.current, fase_setup: p }, g)} onGuardar={() => void guardar()} />
          </Seccion>

          <Seccion titulo="Fase 2 · Crecimiento" icono={<Rocket />} derecha={<span className="text-[11px] text-[var(--ls-t4)]">Mes 4 en adelante · cuatro pasos</span>}>
            <EditorDePasos pasos={borrador.fase_crecimiento} soloLectura={soloLectura} vacio="Sin pasos todavía." onCambiar={(p, g) => cambiar({ ...ref.current, fase_crecimiento: p }, g)} onGuardar={() => void guardar()} />
          </Seccion>

          <Seccion titulo="Riesgos y puntos a vigilar" icono={<ShieldAlert />}>
            <div className="space-y-1.5">
              {borrador.riesgos.length === 0 && <p className="text-[12px] text-[var(--ls-t4)]">Sin riesgos apuntados.</p>}
              {borrador.riesgos.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input readOnly={soloLectura} value={r} onChange={(e) => cambiar({ ...ref.current, riesgos: ref.current.riesgos.map((x, j) => (j === i ? e.target.value : x)) })} onBlur={() => void guardar()} placeholder="Qué hay que vigilar" className={INPUT_FANTASMA} />
                  {!soloLectura && (
                    <button type="button" onClick={() => cambiar({ ...ref.current, riesgos: ref.current.riesgos.filter((_, j) => j !== i) }, true)} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" aria-label="Quitar el riesgo">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              {!soloLectura && borrador.riesgos.length < LIMITES_DEL_PLAN.riesgos && (
                <Boton onClick={() => cambiar({ ...ref.current, riesgos: [...ref.current.riesgos, ''] })} icono={<Plus />}>
                  Añadir riesgo
                </Boton>
              )}
            </div>
          </Seccion>

          <Seccion titulo="Notas de la propuesta" icono={<StickyNote />}>
            <textarea readOnly={soloLectura} value={borrador.notas} onChange={(e) => cambiar({ ...ref.current, notas: e.target.value })} onBlur={() => void guardar()} rows={3} placeholder="Lo que haya que recordar al preparar esta propuesta y no cabe arriba." className={AREA_FANTASMA} />
          </Seccion>
        </div>

        {/* ---------------- Estado, importes y documentos ---------------- */}
        <div className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-0 xl:self-start">
          <Seccion titulo="Estado de la propuesta" icono={<ListChecks />}>
            <Medidor hechas={avance.hechas.length} />
            <ul className="mt-2.5 space-y-1">
              {piezas.map((p) => (
                <li key={p.nombre} className="flex items-center gap-2 text-[12.5px]">
                  {p.hecha ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--ls-e-verde)' }} /> : <Circle className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" />}
                  <span className={p.hecha ? 'text-[var(--ls-t2)]' : 'text-[var(--ls-t3)]'}>{p.nombre}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 border-t border-[var(--ls-linea)] pt-2 text-[11px] leading-[1.5] text-[var(--ls-t4)]">
              {avance.faltan.length === 0 ? 'Con todo esto ya se puede preparar la propuesta en PDF.' : 'Esta es la base de la propuesta en PDF: cuando estén las seis piezas se podrá generar a partir de ella.'}
              {borrador.editado_en ? ` Última edición: ${fecha(borrador.editado_en)}.` : ''}
            </p>
          </Seccion>

          {ctx.puedeVerImportes && (
          <Seccion titulo="Importes" icono={<Euro />}>
            <Fila etiqueta="Set up" ancho={96}>
              <input readOnly={!ctx.puedeImportes} value={setup} onChange={(e) => setSetup(e.target.value)} onBlur={() => ctx.commitNumber('setup_budget', setup)} inputMode="decimal" placeholder="0 €" className={`${INPUT_FANTASMA} tabular-nums`} />
            </Fila>
            <Fila etiqueta="Cuota base" ancho={96}>
              <input readOnly={!ctx.puedeImportes} value={cuota} onChange={(e) => setCuota(e.target.value)} onBlur={() => ctx.commitNumber('maintenance_budget', cuota)} inputMode="decimal" placeholder="0 € / mes" className={`${INPUT_FANTASMA} tabular-nums`} />
            </Fila>
            <Fila etiqueta="% variable" ancho={96}>
              <input readOnly={!ctx.puedeImportes} value={variable} onChange={(e) => setVariable(e.target.value)} onBlur={guardarVariable} inputMode="decimal" placeholder={`${VARIABLE_POR_DEFECTO} %`} className={`${INPUT_FANTASMA} tabular-nums`} />
            </Fila>
            <p className="mt-2 text-[11px] leading-[1.5] text-[var(--ls-t4)]">El set up es de los meses 1 a 3 y la cuota base, del mes 4 en adelante (sin IVA). El variable ({VARIABLE_POR_DEFECTO} % salvo que se negocie) es solo sobre el excedente de facturación por encima de la media actual del cliente.{!ctx.puedeImportes ? ' Los importes los cambia dirección.' : ''}</p>
          </Seccion>
          )}

          {ctx.esDireccion && (
            <Seccion titulo="Propuestas enviadas" icono={<FileText />}>
              {ctx.cargando ? <p className="text-[11.5px] text-[var(--ls-t4)]">Cargando…</p> : <CrmDocuments clientId={client.id} kind="propuesta" label="Propuesta" documents={ctx.documentos} onChange={ctx.setDocumentos} puedeEditar={ctx.puedeEditar} />}
            </Seccion>
          )}
        </div>
      </div>
    </div>
  )
}
