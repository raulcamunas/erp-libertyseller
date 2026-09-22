'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Calendar, Check, Hash, Loader2, Pencil, StickyNote, Trash2, Truck, X } from 'lucide-react'
import { toast } from 'sonner'
import type { RemesaDePanel, SkuDePanel } from '@/lib/fba/datos'
import type { CajasDeRemesa } from '@/lib/fba/cajas'
import { puedeEditarCajas } from '@/lib/fba/flujo'
import { ESTADO_INBOUND_TEXTO } from '@/lib/fba/inbound'
import { AccionesPaso } from './AccionesPaso'
import { EditorCajas } from './EditorCajas'
import { Pasarela } from './Pasarela'
import { colorDeCobertura, fecha } from './formato'

/**
 * UN ENVÍO, CON TODO LO QUE SE SABE DE ÉL.
 *
 * Arriba la ficha: nombre, fechas, número de envío, nota. Editables en el sitio
 * para quien pueda editar; se guarda al confirmar, no a cada tecla.
 *
 * En medio, seis cifras que resumen cómo va.
 *
 * Abajo, las referencias una a una. Cada línea junta lo suyo —enviadas,
 * vendidas, devueltas, quedan— con lo del SKU a nivel global —velocidad y
 * cuándo se agota—, porque la pregunta de verdad cuando miras un envío es
 * «¿de qué talla tengo que reponer ya?».
 */

const TH =
  'px-2 py-1.5 text-left text-[9px] font-semibold text-white/35 uppercase tracking-wider whitespace-nowrap border-b border-white/[0.08]'
const TD = 'px-2 py-1.5 text-[12px] text-white/80 whitespace-nowrap'

type Orden = 'quedan' | 'cobertura' | 'sku' | 'vendidas'

export function DetalleRemesa({
  remesa,
  skus,
  puedeEditar,
  puedeBorrar,
  conectado,
  esAdmin,
  cajas,
}: {
  remesa: RemesaDePanel
  skus: SkuDePanel[]
  puedeEditar: boolean
  puedeBorrar: boolean
  conectado: boolean
  esAdmin: boolean
  /** Las cajas de ESTA remesa. null si el servidor no las ha traído */
  cajas: CajasDeRemesa | null
}) {
  const router = useRouter()
  const [editando, setEditando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const [confirmarBorrado, setConfirmarBorrado] = useState(false)
  const [orden, setOrden] = useState<Orden>('cobertura')
  const [form, setForm] = useState({
    nombre: remesa.nombre ?? '',
    fechaEnvio: remesa.fechaEnvio,
    referenciaEnvio: remesa.referenciaEnvio ?? '',
    nota: remesa.nota ?? '',
  })

  const porSku = useMemo(() => new Map(skus.map((s) => [s.sku, s])), [skus])

  const lineas = useMemo(() => {
    const l = remesa.lineas.map((x) => ({ ...x, global: porSku.get(x.sku) ?? null }))
    const cob = (g: SkuDePanel | null) => g?.diasDeCobertura ?? Number.POSITIVE_INFINITY
    switch (orden) {
      case 'quedan':
        return l.sort((a, b) => b.quedan - a.quedan)
      case 'vendidas':
        return l.sort((a, b) => b.consumidas - a.consumidas)
      case 'sku':
        return l.sort((a, b) => a.sku.localeCompare(b.sku))
      default:
        return l.sort((a, b) => cob(a.global) - cob(b.global))
    }
  }, [remesa.lineas, porSku, orden])

  const totales = useMemo(() => {
    const consumidas = remesa.lineas.reduce((s, l) => s + l.consumidas, 0)
    const devueltas = remesa.lineas.reduce((s, l) => s + l.devueltas, 0)
    const noVendibles = remesa.lineas.reduce((s, l) => s + (l.quedan - l.quedanVendibles), 0)
    const agotadas = remesa.lineas.filter((l) => l.quedan === 0).length
    return { consumidas, devueltas, noVendibles, agotadas }
  }, [remesa.lineas])

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
      toast.success('Remesa actualizada')
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
      toast.success('Remesa borrada')
      router.refresh()
    } finally {
      setBorrando(false)
      setConfirmarBorrado(false)
    }
  }

  const actor = esAdmin ? 'agencia' : 'cliente'
  const enCajas = puedeEditarCajas(remesa.estado)

  return (
    <div className="flex h-full flex-col gap-3">
      {/* ================= LOS PASOS ================= */}
      <Pasarela estado={remesa.estado} />

      <AccionesPaso
        remesaId={remesa.id}
        estado={remesa.estado}
        actor={actor}
        lineas={remesa.lineas.length}
        cuadre={cajas?.cuadre}
        cajas={cajas?.estado}
      />

      {/* ================= FICHA ================= */}
      <div className="glass-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {editando ? (
              <input
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder={`Envío del ${fecha(remesa.fechaEnvio)}`}
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[16px] font-semibold text-white focus:border-[#FF6600]/40 focus:outline-none"
              />
            ) : (
              <h2 className="truncate text-[18px] font-semibold text-white">
                {remesa.nombre ?? `Envío del ${fecha(remesa.fechaEnvio)}`}
              </h2>
            )}

            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px]">
              <Dato icono={<Calendar className="h-3 w-3" />} etiqueta="Enviado">
                {editando ? (
                  <input
                    type="date"
                    value={form.fechaEnvio}
                    onChange={(e) => setForm({ ...form, fechaEnvio: e.target.value })}
                    className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[11px] text-white focus:outline-none"
                  />
                ) : (
                  fecha(remesa.fechaEnvio)
                )}
              </Dato>
              <Dato icono={<Truck className="h-3 w-3" />} etiqueta="Estado en Amazon">
                <EstadoEnvio remesa={remesa} />
              </Dato>
              <Dato icono={<Hash className="h-3 w-3" />} etiqueta="Nº envío FBA">
                {editando ? (
                  <input
                    value={form.referenciaEnvio}
                    onChange={(e) => setForm({ ...form, referenciaEnvio: e.target.value })}
                    placeholder="FBA15ABCDEF"
                    className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[11px] text-white focus:outline-none"
                  />
                ) : (
                  <span className="font-mono">{remesa.referenciaEnvio ?? <span className="text-white/30">—</span>}</span>
                )}
              </Dato>
            </div>

            {(editando || remesa.nota) && (
              <div className="mt-2 flex items-start gap-1.5 text-[11px] text-white/50">
                <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
                {editando ? (
                  <textarea
                    value={form.nota}
                    onChange={(e) => setForm({ ...form, nota: e.target.value })}
                    rows={2}
                    placeholder="Una nota, si hace falta"
                    className="w-full rounded border border-white/10 bg-white/[0.03] px-1.5 py-1 text-[11px] text-white focus:outline-none"
                  />
                ) : (
                  <span>{remesa.nota}</span>
                )}
              </div>
            )}
          </div>

          {puedeEditar && (
            <div className="flex shrink-0 items-center gap-1">
              {editando ? (
                <>
                  <Boton onClick={() => setEditando(false)} title="Cancelar">
                    <X className="h-3.5 w-3.5" />
                  </Boton>
                  <Boton onClick={guardar} primario disabled={guardando} title="Guardar">
                    {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  </Boton>
                </>
              ) : (
                <>
                  <Boton onClick={() => setEditando(true)} title="Corregir la ficha">
                    <Pencil className="h-3.5 w-3.5" />
                  </Boton>
                  {puedeBorrar &&
                    (confirmarBorrado ? (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center gap-1 rounded-lg border border-red-400/30 bg-red-400/[0.08] px-2 py-1"
                      >
                        <span className="text-[10px] text-red-300">¿Borrar?</span>
                        <button
                          type="button"
                          onClick={borrar}
                          disabled={borrando}
                          className="text-[10px] font-semibold text-red-400 hover:underline"
                        >
                          {borrando ? '…' : 'Sí'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmarBorrado(false)}
                          className="text-[10px] text-white/50 hover:text-white"
                        >
                          No
                        </button>
                      </motion.div>
                    ) : (
                      <Boton onClick={() => setConfirmarBorrado(true)} title="Borrar la remesa" peligro>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Boton>
                    ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ================= CIFRAS ================= */}
      <div className="grid grid-cols-6 gap-2">
        <CifraChica etiqueta="Enviadas" valor={remesa.enviadas} />
        <CifraChica etiqueta="Vendidas" valor={totales.consumidas} />
        <CifraChica etiqueta="Devueltas" valor={totales.devueltas} tono={totales.devueltas > 0 ? 'aviso' : undefined} />
        <CifraChica etiqueta="Quedan" valor={remesa.quedan} tono="acento" />
        <CifraChica etiqueta="Consumido" valor={`${remesa.consumidoPct}%`} />
        {remesa.unidadesQueNoLlegaron > 0 ? (
          <CifraChica etiqueta="No llegaron" valor={remesa.unidadesQueNoLlegaron} tono="aviso" />
        ) : (
          <CifraChica
            etiqueta="Ref. agotadas"
            valor={`${totales.agotadas}/${remesa.lineas.length}`}
            tono={totales.agotadas === remesa.lineas.length ? 'apagado' : undefined}
          />
        )}
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div
          key={remesa.id}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, remesa.consumidoPct)}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className={`h-full rounded-full ${
            remesa.consumidoPct >= 90 ? 'bg-red-400/70' : remesa.consumidoPct >= 60 ? 'bg-amber-400/70' : 'bg-[#FF6600]/70'
          }`}
        />
      </div>

      {/* ================= CAJAS, MIENTRAS SE ENCAJA ================= */}
      {enCajas && (
        <EditorCajas
          remesaId={remesa.id}
          lineas={remesa.lineas}
          cajasIniciales={(cajas?.cajas ?? []).map((c) => ({
            numero: c.numero,
            largoCm: c.largoCm,
            anchoCm: c.anchoCm,
            altoCm: c.altoCm,
            pesoKg: c.pesoKg,
            contenido: c.contenido,
          }))}
          puedeEditar={puedeEditar}
        />
      )}

      {/* ================= REFERENCIAS ================= */}
      <div className="glass-card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
          <p className="text-[11px] font-medium text-white/60">
            {remesa.lineas.length} referencia{remesa.lineas.length === 1 ? '' : 's'}
            {totales.noVendibles > 0 && (
              <span className="ml-2 text-amber-400" title="Unidades que volvieron y no se pueden vender">
                · {totales.noVendibles} inservible{totales.noVendibles === 1 ? '' : 's'}
              </span>
            )}
          </p>
          <div className="flex items-center gap-1 text-[10px] text-white/35">
            Ordenar por
            {(
              [
                ['cobertura', 'urgencia'],
                ['quedan', 'quedan'],
                ['vendidas', 'vendidas'],
                ['sku', 'SKU'],
              ] as Array<[Orden, string]>
            ).map(([k, t]) => (
              <button
                key={k}
                type="button"
                onClick={() => setOrden(k)}
                className={`rounded px-1.5 py-0.5 transition-colors ${
                  orden === k ? 'bg-[#FF6600]/15 text-[#FF6600]' : 'hover:text-white/70'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-[#0d0d0d]">
              <tr>
                <th className={TH}>SKU</th>
                <th className={TH}>Producto</th>
                <th className={TH}>Var.</th>
                <th className={TH}>ASIN</th>
                <th className={`${TH} text-right`}>Env.</th>
                <th className={`${TH} text-right`} title="Lo que Amazon dice que ha recibido de las que mandamos">
                  Recib.
                </th>
                <th className={`${TH} text-right`}>Vend.</th>
                <th className={`${TH} text-right`}>Dev.</th>
                <th className={`${TH} text-right`}>Quedan</th>
                {conectado && (
                  <>
                    <th className={`${TH} text-right`} title="Unidades por día de este SKU, contando todos sus envíos">
                      Ud/día
                    </th>
                    <th className={`${TH} text-right`} title="Días hasta agotar todo lo que queda de este SKU">
                      Cobertura
                    </th>
                  </>
                )}
                <th className={TH}>Agotada</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => {
                const g = l.global
                const agotada = l.quedan === 0
                return (
                  <motion.tr
                    key={l.sku}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.015, 0.25) }}
                    className={`border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] ${agotada ? 'opacity-50' : ''}`}
                  >
                    <td className={`${TD} font-mono text-[11px] text-white/60`}>{l.sku}</td>
                    <td className={`${TD} max-w-[200px] truncate`} title={l.nombre ?? ''}>
                      {l.nombre ?? <span className="text-white/25">—</span>}
                    </td>
                    <td className={TD}>{l.variante ?? <span className="text-white/25">—</span>}</td>
                    <td className={`${TD} font-mono text-[10px] text-white/40`}>{l.asin ?? '—'}</td>
                    <td className={`${TD} text-right text-white/45`}>{l.enviadas}</td>
                    <td
                      className={`${TD} text-right ${
                        l.recibidas === null
                          ? 'text-white/20'
                          : l.recibidas < l.enviadas
                            ? 'font-semibold text-amber-400'
                            : 'text-white/45'
                      }`}
                      title={
                        l.recibidas === null
                          ? 'Todavía sin preguntar a Amazon'
                          : l.recibidas < l.enviadas
                            ? `Faltan ${l.enviadas - l.recibidas} unidades por registrar`
                            : ''
                      }
                    >
                      {l.recibidas ?? '—'}
                    </td>
                    <td className={`${TD} text-right`}>{l.consumidas}</td>
                    <td className={`${TD} text-right ${l.devueltas > 0 ? 'text-amber-400' : 'text-white/25'}`}>
                      {l.devueltas || '—'}
                    </td>
                    <td className={`${TD} text-right font-semibold ${agotada ? 'text-white/30' : 'text-white'}`}>
                      {l.quedan}
                      {l.quedanVendibles !== l.quedan && (
                        <span className="ml-1 text-[9px] font-normal text-amber-400" title="De estas, algunas volvieron inservibles">
                          ({l.quedanVendibles})
                        </span>
                      )}
                    </td>
                    {conectado && (
                      <>
                        <td className={`${TD} text-right text-white/45`}>{g?.velocidad || '—'}</td>
                        <td className={`${TD} text-right font-semibold ${colorDeCobertura(g?.diasDeCobertura ?? null)}`}>
                          {g?.diasDeCobertura === null || g?.diasDeCobertura === undefined
                            ? '—'
                            : `${g.diasDeCobertura} d`}
                        </td>
                      </>
                    )}
                    <td className={`${TD} text-white/35`}>{fecha(l.agotadaEl)}</td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Dato({ icono, etiqueta, children }: { icono: React.ReactNode; etiqueta: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-white/70">
      <span className="text-white/30">{icono}</span>
      <span className="text-white/35">{etiqueta}</span>
      <span>{children}</span>
    </span>
  )
}

function CifraChica({
  etiqueta,
  valor,
  tono,
}: {
  etiqueta: string
  valor: number | string
  tono?: 'acento' | 'aviso' | 'apagado'
}) {
  const color =
    tono === 'acento' ? 'text-[#FF6600]' : tono === 'aviso' ? 'text-amber-400' : tono === 'apagado' ? 'text-white/35' : 'text-white'
  return (
    <div className="glass-card px-3 py-2">
      <p className={`text-[16px] font-semibold leading-none tabular-nums ${color}`}>{valor}</p>
      <p className="mt-1 text-[8px] uppercase tracking-wider text-white/30">{etiqueta}</p>
    </div>
  )
}

function Boton({
  onClick,
  children,
  title,
  primario,
  peligro,
  disabled,
}: {
  onClick: () => void
  children: React.ReactNode
  title: string
  primario?: boolean
  peligro?: boolean
  disabled?: boolean
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      className={`rounded-lg p-1.5 transition-colors disabled:opacity-40 ${
        primario
          ? 'bg-[#FF6600] text-white'
          : peligro
            ? 'text-white/40 hover:bg-red-400/10 hover:text-red-400'
            : 'text-white/40 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      {children}
    </motion.button>
  )
}

/**
 * EN QUÉ PUNTO ESTÁ EL ENVÍO.
 *
 * Tres casos distintos y los tres tienen que leerse diferente:
 *
 *   · Sin número de envío -> no es que falle: es que nunca se preguntó. Las diez
 *     remesas que vinieron del Excel están así, y decirles «sin confirmar» sin
 *     más invita a buscar una avería que no existe.
 *   · Con número y respuesta -> el estado de Amazon, en cristiano.
 *   · Con número y error -> lo que contestó Amazon, no un genérico.
 */
function EstadoEnvio({ remesa }: { remesa: RemesaDePanel }) {
  if (!remesa.referenciaEnvio) {
    return (
      <span className="text-white/30" title="Escribe el número de envío arriba y Amazon empezará a contarnos por dónde va">
        sin número de envío
      </span>
    )
  }

  if (remesa.seguimientoError) {
    return (
      <span className="text-red-400" title={remesa.seguimientoError}>
        {remesa.seguimientoError.slice(0, 40)}
      </span>
    )
  }

  if (!remesa.estadoAmazon) {
    return (
      <span className="text-white/30" title="Se consulta en la pasada de cada noche">
        pendiente de consultar
      </span>
    )
  }

  const info = ESTADO_INBOUND_TEXTO[remesa.estadoAmazon]
  const color =
    info?.tono === 'ok'
      ? 'text-emerald-400'
      : info?.tono === 'camino'
        ? 'text-sky-400'
        : info?.tono === 'malo'
          ? 'text-red-400'
          : 'text-amber-400'

  return (
    <span className="flex items-center gap-1.5">
      <span className={color}>{info?.texto ?? remesa.estadoAmazon}</span>
      {remesa.llegadaAt && <span className="text-white/30">· entró el {fecha(remesa.llegadaAt)}</span>}
      {remesa.seguimientoAt && (
        <span className="text-white/20" title={`Consultado el ${fecha(remesa.seguimientoAt)}`}>
          ·
        </span>
      )}
    </span>
  )
}
