'use client'

import { motion } from 'framer-motion'
import {
  AlertTriangle,
  Building2,
  Check,
  PackageCheck,
  PackageOpen,
  Truck,
  Warehouse,
} from 'lucide-react'
import { ESTADO_INBOUND_TEXTO } from '@/lib/fba/inbound'
import { fecha } from './formato'

/**
 * POR DÓNDE VA EL ENVÍO, Y PARA CUÁNDO.
 *
 * El estado de Amazon a secas —SHIPPED, RECEIVING— contesta «¿por dónde va?»
 * pero no «¿para cuándo?», que es lo que pregunta el cliente. Aquí van las dos
 * cosas: los hitos por los que pasa y las fechas que Amazon ha dado.
 *
 *
 * ============ EL ÚLTIMO HITO ES EL QUE IMPORTA ============
 *
 * «Recibiendo» no es el final. Amazon puede estar recibiendo durante días y
 * registrar 97 de 100 unidades: mientras el contador no llegue al total, el
 * envío no ha terminado aunque el estado diga que está en el almacén.
 *
 * Por eso el último paso no se marca por el estado sino por las unidades, y la
 * barra se llena con lo que Amazon ha contado de verdad.
 */

type Fase = 'pendiente' | 'actual' | 'hecho' | 'aviso'

interface Hito {
  clave: string
  titulo: string
  icono: React.ReactNode
  detalle?: string | null
  fase: Fase
}

export interface EnvioParaLinea {
  confirmationId: string | null
  estado: string | null
  destino: string | null
  transportista: string | null
  esDeAmazon: boolean | null
  saleDesde: string | null
  saleHasta: string | null
  entregaDesde: string | null
  entregaHasta: string | null
  /** Seguimientos por caja, con lo que opina Amazon de cada número */
  seguimientos: Array<{ numero: string | null; valido: string | null }>
}

/** Los estados de Amazon, en el orden por el que pasan */
const ORDEN = ['WORKING', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CHECKED_IN', 'RECEIVING', 'CLOSED']

function faseDe(estado: string | null, hasta: string): Fase {
  if (!estado) return 'pendiente'
  const i = ORDEN.indexOf(estado)
  const j = ORDEN.indexOf(hasta)
  if (i < 0 || j < 0) return 'pendiente'
  if (i > j) return 'hecho'
  if (i === j) return 'actual'
  return 'pendiente'
}

export function LineaDeTiempo({
  envio,
  enviadas,
  recibidas,
}: {
  envio: EnvioParaLinea
  enviadas: number
  /** Lo que Amazon dice que ha contado. null = todavía no ha dicho nada */
  recibidas: number | null
}) {
  const invalidos = envio.seguimientos.filter(
    (s) => s.valido && s.valido.toUpperCase() !== 'VALIDATED' && s.valido.toUpperCase() !== 'VALID'
  )
  const conNumero = envio.seguimientos.filter((s) => s.numero).length
  const completo = recibidas !== null && recibidas >= enviadas && enviadas > 0
  const pct = recibidas !== null && enviadas > 0 ? Math.min(100, Math.round((recibidas / enviadas) * 100)) : 0

  const hitos: Hito[] = [
    {
      clave: 'preparado',
      titulo: 'Preparado',
      icono: <PackageOpen className="h-3.5 w-3.5" />,
      detalle: envio.saleDesde ? `sale a partir del ${fecha(envio.saleDesde)}` : null,
      fase: envio.estado ? 'hecho' : 'pendiente',
    },
    {
      clave: 'salida',
      titulo: 'En camino',
      icono: <Truck className="h-3.5 w-3.5" />,
      detalle:
        conNumero > 0
          ? `${conNumero} seguimiento${conNumero === 1 ? '' : 's'}${envio.transportista ? ` · ${envio.transportista}` : ''}`
          : envio.transportista,
      fase: invalidos.length > 0 ? 'aviso' : faseDe(envio.estado, 'IN_TRANSIT'),
    },
    {
      clave: 'llegada',
      titulo: 'En el almacén',
      icono: <Warehouse className="h-3.5 w-3.5" />,
      detalle:
        envio.entregaDesde && envio.entregaHasta
          ? `entrega entre el ${fecha(envio.entregaDesde)} y el ${fecha(envio.entregaHasta)}`
          : envio.destino
            ? `centro ${envio.destino}`
            : null,
      fase: faseDe(envio.estado, 'CHECKED_IN'),
    },
    {
      clave: 'recibido',
      titulo: completo ? 'Recibido entero' : 'Recibiendo',
      icono: <PackageCheck className="h-3.5 w-3.5" />,
      detalle:
        recibidas === null
          ? 'Amazon todavía no ha contado nada'
          : `${recibidas} de ${enviadas} unidades`,
      // No lo decide el estado sino las unidades: Amazon puede estar «recibiendo»
      // durante días con tres unidades sin aparecer.
      fase: completo ? 'hecho' : recibidas !== null && recibidas > 0 ? 'actual' : faseDe(envio.estado, 'RECEIVING'),
    },
  ]

  return (
    <div className="glass-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-[#FF6600]" />
          <span className="font-mono text-[13px] font-semibold text-white">
            {envio.confirmationId ?? 'sin identificador todavía'}
          </span>
        </div>
        {envio.estado && (
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/60">
            {ESTADO_INBOUND_TEXTO[envio.estado]?.texto ?? envio.estado}
          </span>
        )}
        {envio.esDeAmazon && (
          <span
            className="rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] text-sky-400"
            title="Transportista asociado de Amazon: los seguimientos los pone él"
          >
            transporte de Amazon
          </span>
        )}
      </div>

      {/* La barra de lo recibido. Es el dato que de verdad se mira */}
      {recibidas !== null && (
        <div className="mb-4">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wide text-white/35">Recibido</span>
            <span className={`text-[12px] font-semibold tabular-nums ${completo ? 'text-emerald-400' : 'text-white'}`}>
              {recibidas} / {enviadas}
              {recibidas < enviadas && (
                <span className="ml-1.5 text-[11px] font-normal text-amber-400">
                  faltan {enviadas - recibidas}
                </span>
              )}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
              className={`h-full rounded-full ${completo ? 'bg-emerald-400/70' : 'bg-[#FF6600]/70'}`}
            />
          </div>
        </div>
      )}

      {/* Los hitos */}
      <div className="space-y-0">
        {hitos.map((h, i) => (
          <div key={h.clave} className="flex gap-3">
            <div className="flex flex-col items-center">
              <motion.div
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: i * 0.08, type: 'spring', stiffness: 380, damping: 26 }}
                className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                  h.fase === 'hecho'
                    ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-400'
                    : h.fase === 'actual'
                      ? 'border-[#FF6600] bg-[#FF6600]/15 text-[#FF6600]'
                      : h.fase === 'aviso'
                        ? 'border-amber-400/40 bg-amber-400/15 text-amber-400'
                        : 'border-white/10 bg-white/[0.03] text-white/25'
                }`}
              >
                {h.fase === 'actual' && (
                  <motion.span
                    className="absolute -inset-1 rounded-full bg-[#FF6600]/20"
                    animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
                <span className="relative">
                  {h.fase === 'hecho' ? <Check className="h-3.5 w-3.5" /> : h.fase === 'aviso' ? <AlertTriangle className="h-3.5 w-3.5" /> : h.icono}
                </span>
              </motion.div>
              {i < hitos.length - 1 && (
                <div className="h-6 w-px overflow-hidden bg-white/[0.07]">
                  <motion.div
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: h.fase === 'hecho' ? 1 : 0 }}
                    transition={{ duration: 0.4, delay: 0.1 + i * 0.08 }}
                    style={{ originY: 0 }}
                    className="h-full w-full bg-emerald-400/40"
                  />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 pb-1.5">
              <p
                className={`text-[12px] font-medium ${
                  h.fase === 'pendiente' ? 'text-white/30' : h.fase === 'aviso' ? 'text-amber-400' : 'text-white'
                }`}
              >
                {h.titulo}
              </p>
              {h.detalle && <p className="text-[11px] text-white/40">{h.detalle}</p>}
            </div>
          </div>
        ))}
      </div>

      {invalidos.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <p className="text-[11px] leading-relaxed text-amber-200/90">
            Amazon no ha podido validar {invalidos.length} número
            {invalidos.length === 1 ? '' : 's'} de seguimiento contra el transportista. Un número que
            no valida deja el envío esperando en el almacén sin que nadie entienda por qué —
            compruébalos antes de que llegue.
          </p>
        </div>
      )}
    </div>
  )
}
