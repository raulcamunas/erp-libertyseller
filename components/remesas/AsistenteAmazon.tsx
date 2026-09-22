'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  CircleDot,
  Loader2,
  Package,
  RefreshCw,
  Send,
  Trash2,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import type { EnvioDeRemesa, RemesaDePanel } from '@/lib/fba/datos'
import { LineaDeTiempo } from './LineaDeTiempo'

/**
 * EL ASISTENTE QUE CREA EL ENVÍO EN AMAZON.
 *
 * Nueve pasos encadenados, uno por pantalla. No se encadenan solos y no es por
 * pereza: las opciones de agrupado y de reparto VIENEN CON TARIFAS, a veces con
 * descuentos por elegir una u otra. Confirmarlas por nuestra cuenta sería gastar
 * el dinero del cliente sin enseñárselo.
 *
 * El paso de confirmar el reparto es el único que no se deshace. Pide escribir
 * CONFIRMAR, no un «¿seguro?» que se pulsa sin leer.
 */

const PASOS = [
  { id: 'creado', titulo: 'Crear el plan', que: 'Se le dice a Amazon qué se manda y desde dónde' },
  { id: 'empaquetado', titulo: 'Cómo se agrupa', que: 'Amazon propone cómo repartir la mercancía' },
  { id: 'cajas', titulo: 'Mandar las cajas', que: 'Medidas, pesos y qué va dentro de cada una' },
  { id: 'confirmado', titulo: 'A qué centros va', que: 'Amazon reparte, con sus tarifas. Irreversible' },
  { id: 'transporte', titulo: 'Quién lo lleva', que: 'Transportista de Amazon o el tuyo' },
  { id: 'seguimientos', titulo: 'Los seguimientos', que: 'Solo si el transporte es propio' },
] as const

interface Opcion {
  packingOptionId?: string
  placementOptionId?: string
  transportationOptionId?: string
  shipmentId?: string
  estado?: string
  grupos?: string[]
  envios?: string[]
  transportista?: string | null
  modo?: string
  deAmazon?: boolean
  coste: number | null
  descuento?: number
  moneda: string | null
  caduca?: string | null
}

export function AsistenteAmazon({
  remesa,
  unidadesPorEnvio,
}: {
  remesa: RemesaDePanel
  /** Lo recibido por envío, para la línea de tiempo */
  unidadesPorEnvio: { enviadas: number; recibidas: number | null }
}) {
  const router = useRouter()
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [opciones, setOpciones] = useState<Opcion[] | null>(null)
  const [tipoOpciones, setTipoOpciones] = useState<'empaquetado' | 'reparto' | 'transporte' | null>(null)
  const [elegidas, setElegidas] = useState<Record<string, string>>({})
  const [textoConfirmar, setTextoConfirmar] = useState('')

  const paso = remesa.pasoPlan
  const indiceActual = paso ? PASOS.findIndex((p) => p.id === paso) : -1

  async function llamar(accion: string, extra: Record<string, unknown> = {}) {
    setTrabajando(accion)
    try {
      const res = await fetch(`/api/fba/remesas/${remesa.id}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion, ...extra }),
      })
      const p = (await res.json().catch(() => null)) as
        | { error?: string; opciones?: Opcion[]; cajasMezcladas?: number[]; ok?: boolean; avisos?: Array<{ message: string }> }
        | null

      if (!res.ok) {
        if (p?.cajasMezcladas?.length) {
          toast.error('Hay cajas que mezclan grupos', {
            description: `${p.error} Cajas: ${p.cajasMezcladas.join(', ')}`,
            duration: 12_000,
          })
        } else {
          toast.error(p?.error ?? 'No se ha podido avanzar', { duration: 9000 })
        }
        return null
      }

      if (p?.avisos?.length) {
        toast.warning(`Amazon avisa de ${p.avisos.length} cosa(s)`, {
          description: p.avisos.map((a) => a.message).join('. ').slice(0, 220),
          duration: 10_000,
        })
      }
      return p
    } finally {
      setTrabajando(null)
    }
  }

  async function pedirOpciones(tipo: 'empaquetado' | 'reparto' | 'transporte') {
    const r = await llamar(`opciones-${tipo}`, tipo === 'transporte' ? { saleEl: hoy() } : {})
    if (!r) return
    setOpciones(r.opciones ?? [])
    setTipoOpciones(tipo)
    if ((r.opciones ?? []).length === 0) {
      toast.info('Amazon no ha devuelto ninguna opción', {
        description: 'Suele significar que falta algún paso antes, o que las opciones han caducado.',
      })
    }
  }

  async function avanzar(accion: string, extra: Record<string, unknown> = {}) {
    const r = await llamar(accion, extra)
    if (!r) return
    setOpciones(null)
    setTipoOpciones(null)
    setTextoConfirmar('')
    toast.success('Paso completado')
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {/* ---------- LOS PASOS ---------- */}
      <div className="glass-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Package className="h-4 w-4 text-[#FF6600]" />
          <p className="text-[13px] font-semibold text-white">Crear el envío en Amazon</p>
          {remesa.inboundPlanId && (
            <span className="ml-auto font-mono text-[10px] text-white/25" title="Identificador del plan">
              {remesa.inboundPlanId.slice(0, 14)}…
            </span>
          )}
        </div>

        <div className="space-y-1">
          {PASOS.map((p, i) => {
            const hecho = indiceActual >= i
            const actual = indiceActual === i - 1 || (indiceActual === -1 && i === 0)
            return (
              <div
                key={p.id}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${actual ? 'bg-[#FF6600]/[0.07]' : ''}`}
              >
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold ${
                    hecho
                      ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-400'
                      : actual
                        ? 'border-[#FF6600] bg-[#FF6600] text-white'
                        : 'border-white/10 text-white/25'
                  }`}
                >
                  {hecho ? <Check className="h-3 w-3" /> : i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-[12px] ${hecho ? 'text-emerald-400/70' : actual ? 'text-white' : 'text-white/30'}`}>
                    {p.titulo}
                  </p>
                  {actual && <p className="text-[10px] text-white/40">{p.que}</p>}
                </div>
                {actual && <CircleDot className="h-3 w-3 shrink-0 animate-pulse text-[#FF6600]" />}
              </div>
            )
          })}
        </div>

        {remesa.planError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-400/25 bg-red-400/[0.07] px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
            <p className="text-[11px] leading-relaxed text-red-300">{remesa.planError}</p>
          </div>
        )}

        {/* ---------- EL BOTÓN DEL PASO QUE TOCA ---------- */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!paso && (
            <Boton onClick={() => avanzar('crear')} cargando={trabajando === 'crear'}>
              Crear el plan en Amazon
            </Boton>
          )}
          {paso === 'creado' && (
            <Boton onClick={() => pedirOpciones('empaquetado')} cargando={trabajando === 'opciones-empaquetado'}>
              Ver cómo lo agrupa Amazon
            </Boton>
          )}
          {paso === 'empaquetado' && (
            <Boton onClick={() => avanzar('mandar-cajas')} cargando={trabajando === 'mandar-cajas'}>
              Mandar las cajas
            </Boton>
          )}
          {paso === 'cajas' && (
            <Boton onClick={() => pedirOpciones('reparto')} cargando={trabajando === 'opciones-reparto'}>
              Ver a qué centros va
            </Boton>
          )}
          {paso === 'confirmado' && (
            <Boton onClick={() => pedirOpciones('transporte')} cargando={trabajando === 'opciones-transporte'}>
              Ver transportistas
            </Boton>
          )}
          {(paso === 'transporte' || paso === 'seguimientos') && (
            <Boton onClick={() => avanzar('refrescar')} cargando={trabajando === 'refrescar'} secundario>
              <RefreshCw className={`h-3.5 w-3.5 ${trabajando === 'refrescar' ? 'animate-spin' : ''}`} />
              Actualizar desde Amazon
            </Boton>
          )}

          {/* Cancelar. Antes de confirmar no deja rastro; después es de verdad */}
          {paso && (
            <button
              type="button"
              onClick={() => {
                const grave = ['confirmado', 'transporte', 'seguimientos'].includes(paso)
                const texto = grave
                  ? 'Este envío YA EXISTE en Amazon. Cancelarlo es cancelar un envío real, y hay plazos: paquetería 24 h, camión 1 h. ¿Seguro?'
                  : '¿Cancelar el plan? Todavía no existe ningún envío, así que no deja rastro.'
                if (confirm(texto)) avanzar('cancelar')
              }}
              className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-white/35 hover:bg-red-400/10 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Cancelar el plan
            </button>
          )}
        </div>
      </div>

      {/* ---------- LAS OPCIONES QUE HAY QUE ELEGIR ---------- */}
      <AnimatePresence>
        {opciones && tipoOpciones && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass-card p-4"
          >
            <p className="mb-1 text-[12px] font-semibold text-white">
              {tipoOpciones === 'empaquetado'
                ? 'Cómo quiere Amazon que se agrupe'
                : tipoOpciones === 'reparto'
                  ? 'A qué centros lo quiere mandar'
                  : 'Quién lo lleva'}
            </p>
            <p className="mb-3 text-[11px] text-white/40">
              {tipoOpciones === 'reparto'
                ? 'Al confirmar nacen los envíos de verdad, con sus identificadores. Esto no se deshace.'
                : 'Elige una. Los importes son lo que cobra Amazon.'}
            </p>

            <div className="space-y-1.5">
              {opciones.map((o) => {
                const id =
                  o.packingOptionId ?? o.placementOptionId ?? o.transportationOptionId ?? ''
                const clave = tipoOpciones === 'transporte' ? (o.shipmentId ?? '') : 'unica'
                const elegida = elegidas[clave] === id
                const neto = (o.coste ?? 0) - (o.descuento ?? 0)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setElegidas({ ...elegidas, [clave]: id })}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                      elegida
                        ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.07]'
                        : 'border-white/[0.07] hover:border-white/20'
                    }`}
                  >
                    <div
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                        elegida ? 'border-[#FF6600] bg-[#FF6600]' : 'border-white/20'
                      }`}
                    >
                      {elegida && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      {tipoOpciones === 'transporte' ? (
                        <>
                          <p className="text-[12px] text-white">
                            {o.transportista ?? 'Sin transportista'}
                            {o.deAmazon && (
                              <span className="ml-1.5 rounded bg-sky-400/10 px-1.5 py-0.5 text-[9px] text-sky-400">
                                de Amazon
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] text-white/35">
                            {o.modo} · envío {(o.shipmentId ?? '').slice(0, 12)}
                          </p>
                        </>
                      ) : tipoOpciones === 'reparto' ? (
                        <>
                          <p className="text-[12px] text-white">
                            {o.envios?.length ?? 0} envío{(o.envios?.length ?? 0) === 1 ? '' : 's'}
                          </p>
                          <p className="text-[10px] text-white/35">
                            Amazon parte la mercancía en {o.envios?.length ?? 0} destino
                            {(o.envios?.length ?? 0) === 1 ? '' : 's'}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-[12px] text-white">
                            {o.grupos?.length ?? 0} grupo{(o.grupos?.length ?? 0) === 1 ? '' : 's'}
                          </p>
                          <p className="text-[10px] text-white/35">{o.estado}</p>
                        </>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      <p className={`text-[13px] font-semibold tabular-nums ${neto > 0 ? 'text-white' : 'text-emerald-400'}`}>
                        {neto > 0 ? `${neto.toFixed(2)} ${o.moneda ?? ''}` : 'sin coste'}
                      </p>
                      {(o.descuento ?? 0) > 0 && (
                        <p className="text-[10px] text-emerald-400">
                          −{o.descuento!.toFixed(2)} de descuento
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Confirmar */}
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpciones(null)
                  setTipoOpciones(null)
                }}
                className="rounded-lg px-3 py-1.5 text-[12px] text-white/50 hover:text-white"
              >
                Cancelar
              </button>

              {tipoOpciones === 'reparto' ? (
                <div className="flex items-center gap-2">
                  <input
                    value={textoConfirmar}
                    onChange={(e) => setTextoConfirmar(e.target.value)}
                    placeholder="escribe CONFIRMAR"
                    className="w-40 rounded-lg border border-amber-400/30 bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-white placeholder:text-white/25 focus:outline-none"
                  />
                  <Boton
                    peligro
                    disabled={textoConfirmar !== 'CONFIRMAR' || !elegidas.unica}
                    cargando={trabajando === 'confirmar-reparto'}
                    onClick={() => avanzar('confirmar-reparto', { opcion: elegidas.unica })}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Crear los envíos
                  </Boton>
                </div>
              ) : tipoOpciones === 'transporte' ? (
                <Boton
                  disabled={Object.keys(elegidas).length === 0}
                  cargando={trabajando === 'confirmar-transporte'}
                  onClick={() =>
                    avanzar('confirmar-transporte', {
                      selecciones: Object.entries(elegidas)
                        .filter(([k]) => k !== 'unica')
                        .map(([shipmentId, transportationOptionId]) => ({
                          shipmentId,
                          transportationOptionId,
                        })),
                    })
                  }
                >
                  <Truck className="h-3.5 w-3.5" />
                  Confirmar transportista
                </Boton>
              ) : (
                <Boton
                  disabled={!elegidas.unica}
                  cargando={trabajando === 'confirmar-empaquetado'}
                  onClick={() => avanzar('confirmar-empaquetado', { opcion: elegidas.unica })}
                >
                  Confirmar agrupado
                </Boton>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- LOS ENVÍOS, CON SU LÍNEA DE TIEMPO ---------- */}
      {remesa.envios.length > 0 && (
        <div className="space-y-2">
          {remesa.envios.map((e) => (
            <EnvioConSeguimientos
              key={e.shipmentId}
              remesaId={remesa.id}
              envio={e}
              enviadas={Math.round(unidadesPorEnvio.enviadas / remesa.envios.length)}
              recibidas={
                unidadesPorEnvio.recibidas === null
                  ? null
                  : Math.round(unidadesPorEnvio.recibidas / remesa.envios.length)
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function EnvioConSeguimientos({
  remesaId,
  envio,
  enviadas,
  recibidas,
}: {
  remesaId: string
  envio: EnvioDeRemesa
  enviadas: number
  recibidas: number | null
}) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [pro, setPro] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function mandar() {
    setGuardando(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'mandar-seguimientos',
          envio: envio.shipmentId,
          tipo: 'camion',
          numerosPro: pro.split(/[\s,;]+/).filter(Boolean),
        }),
      })
      const p = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(p?.error ?? 'No se han podido mandar')
        return
      }
      toast.success('Seguimientos mandados a Amazon')
      setAbierto(false)
      router.refresh()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div>
      <LineaDeTiempo
        envio={{
          confirmationId: envio.confirmationId,
          estado: envio.estado,
          destino: envio.destino,
          transportista: envio.transportista,
          esDeAmazon: envio.esDeAmazon,
          saleDesde: envio.saleDesde,
          saleHasta: envio.saleHasta,
          entregaDesde: envio.entregaDesde,
          entregaHasta: envio.entregaHasta,
          seguimientos: [],
        }}
        enviadas={enviadas}
        recibidas={recibidas}
      />

      {/* Los seguimientos SOLO si el transporte es propio: con el de Amazon los
          pone él y mandar los nuestros los pisaría */}
      {envio.esDeAmazon === false && (
        <div className="mt-1.5">
          {abierto ? (
            <div className="glass-card flex flex-wrap items-center gap-2 p-2.5">
              <input
                value={pro}
                onChange={(e) => setPro(e.target.value)}
                placeholder="Número PRO del transportista"
                className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-white placeholder:text-white/25 focus:outline-none"
              />
              <Boton onClick={mandar} cargando={guardando} disabled={!pro.trim()}>
                <Send className="h-3.5 w-3.5" />
                Mandar a Amazon
              </Boton>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="text-[11px] text-white/40 hover:text-white"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAbierto(true)}
              className="text-[11px] text-[#FF6600]/80 hover:text-[#FF6600] hover:underline"
            >
              Mandar los seguimientos del transportista
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Boton({
  onClick,
  children,
  cargando,
  disabled,
  peligro,
  secundario,
}: {
  onClick: () => void
  children: React.ReactNode
  cargando?: boolean
  disabled?: boolean
  peligro?: boolean
  secundario?: boolean
}) {
  return (
    <motion.button
      type="button"
      whileHover={disabled ? undefined : { scale: 1.03 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      onClick={onClick}
      disabled={disabled || cargando}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        peligro
          ? 'bg-amber-500 text-white hover:bg-amber-400'
          : secundario
            ? 'border border-white/10 text-white/70 hover:border-white/25 hover:text-white'
            : 'bg-[#FF6600] text-white hover:bg-[#FF6600]/85'
      }`}
    >
      {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </motion.button>
  )
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10)
}
