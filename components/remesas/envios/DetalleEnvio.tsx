'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, Check, Copy, Loader2, Pencil, RefreshCw, StickyNote, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { BOTON, CAMPO, TIPO } from '@/lib/estilo/denso'
import { analizarProductos, resumenDeRitmo } from '@/lib/fba/analisis'
import type { RemesaDePanel, SkuDePanel } from '@/lib/fba/datos'
import { estaEnlazada, haceCuanto } from '@/lib/fba/vista'
import { cx } from '../comun/ui'
import { fecha } from '../formato'
import { CifrasEnvio } from './CifrasEnvio'
import { InsigniaAmazon } from './estadoAmazon'
import { PestanasEnvio } from './PestanasEnvio'
import { SeguidorAmazon } from './SeguidorAmazon'

/**
 * UN ENVÍO REAL, CON TODO LO QUE SE SABE DE ÉL.
 *
 * Arriba, tres franjas que NO hacen scroll y que juntas miden unos 190 px:
 *   · la ficha: estado en Amazon, nombre, número de envío y fechas;
 *   · el recorrido del envío en Amazon;
 *   · las cifras de siempre en una sola fila.
 * Debajo, las pestañas ocupan TODA la altura que queda y hacen scroll dentro. Antes
 * la ficha, los pasos internos, los botones y las cifras se comían más de la mitad
 * de la pantalla y el desglose vivía en la mitad de abajo.
 *
 * Aquí no hay pasos de trabajo —borrador, aprobada, etiquetas…—: eso es de
 * Propuestas. Esto es lo que ya existe en Amazon.
 */

export function DetalleEnvio({
  remesa,
  skus,
  hoy,
  puedeEditar,
  puedeBorrar,
  conectado,
}: {
  remesa: RemesaDePanel
  skus: SkuDePanel[]
  hoy: string
  puedeEditar: boolean
  puedeBorrar: boolean
  conectado: boolean
}) {
  const router = useRouter()
  const [siguiendo, setSiguiendo] = useState(false)
  const [editando, setEditando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const [confirmarBorrado, setConfirmarBorrado] = useState(false)
  const [form, setForm] = useState({
    nombre: remesa.nombre ?? '',
    fechaEnvio: remesa.fechaEnvio,
    referenciaEnvio: remesa.referenciaEnvio ?? '',
    nota: remesa.nota ?? '',
  })

  // Las cifras de la franja de arriba salen del mismo cálculo que las pestañas
  const ritmo = useMemo(() => {
    const globales = new Map(skus.map((s) => [s.sku, s]))
    return resumenDeRitmo(remesa, analizarProductos(remesa, globales, hoy), hoy)
  }, [remesa, skus, hoy])

  /**
   * PREGUNTARLE A AMAZON AHORA MISMO.
   *
   * Pide el estado y cuántas unidades ha recibido de cada referencia, que es lo
   * que el reparto usa para descontar: lo que hay en el almacén es lo RECIBIDO,
   * no lo declarado. Va a botón y no automático porque son dos llamadas a la API
   * y el cupo es del cliente; el resto del tiempo lo hace el ERP cada hora.
   */
  async function consultar(): Promise<boolean> {
    setSiguiendo(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesa.id}/seguir`, { method: 'POST' })
      const cuerpo = (await res.json().catch(() => null)) as
        | { estado?: string; centro?: string | null; referencias?: number; faltan?: number; error?: string }
        | null

      if (!res.ok) {
        toast.error(cuerpo?.error ?? 'No se ha podido consultar el envío en Amazon')
        router.refresh()
        return false
      }
      const faltan = cuerpo?.faltan ?? 0
      if (faltan > 0) {
        toast.warning(`Amazon dice «${cuerpo?.estado}». Faltan ${faltan} unidad${faltan === 1 ? '' : 'es'} de las que se mandaron: el reparto ya cuenta con las recibidas.`)
      } else {
        toast.success(`Amazon dice «${cuerpo?.estado}»${cuerpo?.centro ? ` · ${cuerpo.centro}` : ''}. ${cuerpo?.referencias ?? 0} referencia(s) al día, sin unidades perdidas.`)
      }
      router.refresh()
      return true
    } finally {
      setSiguiendo(false)
    }
  }

  /** Enlazar un envío que no tenía número: se guarda y se comprueba contra Amazon */
  async function enlazar(numero: string): Promise<void> {
    const res = await fetch(`/api/fba/remesas/${remesa.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referenciaEnvio: numero }),
    })
    if (!res.ok) {
      const p = (await res.json().catch(() => null)) as { error?: string } | null
      toast.error(p?.error ?? 'No se ha podido guardar el número')
      throw new Error('guardar')
    }
    const bien = await consultar()
    if (!bien) throw new Error('consultar')
  }

  async function guardar() {
    setGuardando(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesa.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const p = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(p?.error ?? 'No se ha podido guardar')
        return
      }
      toast.success('Envío actualizado')
      setEditando(false)
      router.refresh()
    } finally {
      setGuardando(false)
    }
  }

  async function borrar() {
    setBorrando(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesa.id}`, { method: 'DELETE' })
      const p = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(p?.error ?? 'No se ha podido borrar')
        return
      }
      toast.success('Envío borrado')
      router.refresh()
    } finally {
      setBorrando(false)
      setConfirmarBorrado(false)
    }
  }

  async function copiar() {
    if (!remesa.referenciaEnvio) return
    try {
      await navigator.clipboard.writeText(remesa.referenciaEnvio)
      toast.success('Número de envío copiado')
    } catch {
      toast.error('No se ha podido copiar')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* ======= LA CABECERA: FICHA, RECORRIDO EN AMAZON Y CIFRAS, EN UNA TARJETA ======= */}
      <header className="shrink-0 overflow-hidden rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
        {/* ---------- ficha ---------- */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-[9px]">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <InsigniaAmazon remesa={remesa} />
            {editando ? (
              <input
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder={`Envío del ${fecha(remesa.fechaEnvio)}`}
                className={cx(CAMPO.input, 'h-[28px] w-[280px] text-[14px] font-semibold')}
                aria-label="Nombre del envío"
              />
            ) : (
              <h2 className={cx(TIPO.xl, 'min-w-0 truncate text-[var(--ls-t1)]')}>{remesa.nombre ?? `Envío del ${fecha(remesa.fechaEnvio)}`}</h2>
            )}
            {editando ? (
              <input
                value={form.referenciaEnvio}
                onChange={(e) => setForm({ ...form, referenciaEnvio: e.target.value })}
                placeholder="FBA15ABCDEF"
                className={cx(CAMPO.input, 'h-[26px] w-[150px] font-mono')}
                aria-label="Número de envío FBA"
              />
            ) : (
              estaEnlazada(remesa) && (
                <span className="inline-flex items-center gap-[4px] rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] py-[1px] pl-2 pr-[3px]" title="Número de envío FBA">
                  <span className="font-mono text-[12px] text-[var(--ls-t1)]">{remesa.referenciaEnvio}</span>
                  <button type="button" onClick={copiar} className={BOTON.icono} title="Copiar el número">
                    <Copy className="h-3 w-3" />
                  </button>
                </span>
              )
            )}
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--ls-t3)]">
              <Dato icono={<Calendar className="h-3 w-3" />} titulo="Fecha de envío">
                {editando ? (
                  <input
                    type="date"
                    value={form.fechaEnvio}
                    onChange={(e) => setForm({ ...form, fechaEnvio: e.target.value })}
                    className={cx(CAMPO.input, 'h-[24px] w-[135px]')}
                    aria-label="Fecha de envío"
                  />
                ) : (
                  <>Enviado {fecha(remesa.fechaEnvio)}</>
                )}
              </Dato>
              {!editando && remesa.llegadaAt && <Dato titulo="Cuándo entró en el almacén, según el libro mayor">Llegó {fecha(remesa.llegadaAt)}</Dato>}
              {!editando && remesa.seguimientoAt && (
                <Dato titulo={`Última consulta a Amazon: ${fecha(remesa.seguimientoAt)}`}>Consultado {haceCuanto(remesa.seguimientoAt, hoy)}</Dato>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-[6px]">
              {estaEnlazada(remesa) && puedeEditar && !editando && (
                <button
                  type="button"
                  onClick={() => void consultar()}
                  disabled={siguiendo}
                  title="Preguntarle a Amazon por este envío: en qué estado va y cuántas unidades ha recibido"
                  className={cx(BOTON.base, BOTON.secundario)}
                >
                  {siguiendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  {siguiendo ? 'Preguntando…' : 'Consultar en Amazon'}
                </button>
              )}
              {puedeEditar &&
                (editando ? (
                  <>
                    <button type="button" onClick={() => setEditando(false)} className={cx(BOTON.base, BOTON.secundario)} title="Cancelar">
                      <X className="h-3 w-3" />
                      Cancelar
                    </button>
                    <button type="button" onClick={guardar} disabled={guardando} className={cx(BOTON.base, BOTON.primario)} title="Guardar">
                      {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Guardar
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => setEditando(true)} className={BOTON.icono} title="Corregir la ficha">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {puedeBorrar &&
                      (confirmarBorrado ? (
                        <span className="flex items-center gap-2 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2 py-[2px] text-[11.5px]">
                          <span className="text-[var(--ls-t2)]">¿Borrar?</span>
                          <button type="button" onClick={borrar} disabled={borrando} className="font-semibold text-[var(--ls-e-rojo)] hover:underline">
                            {borrando ? '…' : 'Sí'}
                          </button>
                          <button type="button" onClick={() => setConfirmarBorrado(false)} className="text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
                            No
                          </button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirmarBorrado(true)} className={cx(BOTON.icono, 'hover:!text-[var(--ls-e-rojo)]')} title="Borrar el envío">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ))}
                  </>
                ))}
            </div>
          </div>
        </div>

        {(editando || remesa.nota) && (
          <div className="flex items-start gap-[6px] border-t border-[var(--ls-linea)] px-4 py-[6px] text-[12px] text-[var(--ls-t3)]">
            <StickyNote className="mt-[2px] h-3 w-3 shrink-0" />
            {editando ? (
              <textarea
                value={form.nota}
                onChange={(e) => setForm({ ...form, nota: e.target.value })}
                rows={2}
                placeholder="Una nota, si hace falta"
                className={cx(CAMPO.input, 'h-auto py-1')}
                aria-label="Nota"
              />
            ) : (
              <span>{remesa.nota}</span>
            )}
          </div>
        )}

        {/* En pantallas estrechas no cabe la columna de la derecha: el recorrido y las
            cifras bajan aquí, en una fila cada uno */}
        <div className="xl:hidden">
          <div className="border-t border-[var(--ls-linea)] px-4 py-[8px]">
            <SeguidorAmazon remesa={remesa} puedeEditar={puedeEditar} onEnlazar={enlazar} />
          </div>
          <div className="border-t border-[var(--ls-linea)]">
            <CifrasEnvio remesa={remesa} ritmo={ritmo} />
          </div>
        </div>
      </header>

      {/* ======= EL DESGLOSE, A TODA LA ALTURA QUE QUEDA, Y AL LADO LO QUE NO SE VA ======= */}
      <div className="flex min-h-0 flex-1 gap-3">
        <PestanasEnvio remesa={remesa} skus={skus} hoy={hoy} conectado={conectado} />

        {/* La columna fija: el recorrido en Amazon y las cifras, siempre a la vista
            mientras las pestañas hacen scroll. Solo en pantallas anchas. */}
        <aside className="hidden w-[276px] shrink-0 flex-col gap-2 overflow-y-auto xl:flex" aria-label="Estado y cifras del envío">
          <section className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
            <h3 className="border-b border-[var(--ls-linea)] px-3 py-[7px] text-[12px] font-semibold text-[var(--ls-t1)]">Recorrido en Amazon</h3>
            <div className="px-3 py-[10px]">
              <SeguidorAmazon remesa={remesa} puedeEditar={puedeEditar} onEnlazar={enlazar} vertical />
            </div>
          </section>
          <section className="overflow-hidden rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
            <h3 className="border-b border-[var(--ls-linea)] px-3 py-[7px] text-[12px] font-semibold text-[var(--ls-t1)]">Cifras</h3>
            <CifrasEnvio remesa={remesa} ritmo={ritmo} rejilla />
          </section>
        </aside>
      </div>
    </div>
  )
}

function Dato({ icono, titulo, children }: { icono?: React.ReactNode; titulo?: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[6px]" title={titulo}>
      {icono && <span className="text-[var(--ls-t4)]">{icono}</span>}
      {children}
    </span>
  )
}
