'use client'

import { motion } from 'framer-motion'
import { CircleCheck, Package, Scale, Truck } from 'lucide-react'
import type { DatosDelPortal } from '@/lib/fba/portal'
import { FUENTE_TITULO, cx, n0, n1 } from '@/components/encaje/marca'

/**
 * LA FASE «ENVÍO» DEL PORTAL: QUÉ PASA CON TUS CAJAS.
 *
 * Hoy dice en qué punto está (preparando el envío en Amazon, enviado con su nº FBA, recibido) y resume las
 * cajas. El envío a Amazon (reparto por centros, transporte, UPS) lo hace la agencia y NO se toca aquí.
 *
 * ============ EL HUECO PARA EL COSTE DEL TRANSPORTE ============
 *
 * `HuecoCosteTransporte` es donde otro trabajo añadirá la APROBACIÓN DEL COSTE DEL TRANSPORTE por el
 * cliente (cuando el ERP cree el envío en Amazon y tenga la tarifa del UPS asociado). Recibe el token y los
 * datos del portal; hoy no pinta nada. Para enchufarlo: implementa el componente aquí (o importa el suyo y
 * devuélvelo), con su ruta pública bajo /api/publico/envio/[token]/… pasando por `entrarConEnlace`, y
 * apunta en el historial con `registrarEnHistorial`.
 */
export function HuecoCosteTransporte(_props: { token: string; datos: DatosDelPortal }) {
  return null
}

const PASOS = [
  { estados: ['lista'], texto: 'Preparando el envío', pista: 'Estamos creando el envío en Amazon con tus cajas.' },
  { estados: ['enviada'], texto: 'De camino a Amazon', pista: 'La mercancía ha salido hacia el almacén de Amazon.' },
  { estados: ['cerrada'], texto: 'Recibido', pista: 'Amazon ha terminado de recibir tu envío.' },
] as const

export function FaseEnvio({ token, datos }: { token: string; datos: DatosDelPortal }) {
  const i = PASOS.findIndex((p) => (p.estados as readonly string[]).includes(datos.estado))
  const actual = i >= 0 ? i : 0

  return (
    <div className="space-y-5">
      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-[#E5E1DB] bg-[#FFFFFF] p-6 sm:p-8">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#2B2B2B] to-[#0E0E0E] text-[#F26212]">
          <Truck className="h-7 w-7" />
        </span>
        <h2 className="mt-5 text-[24px] leading-tight text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
          {PASOS[actual].texto}
        </h2>
        <p className="mt-2 max-w-[560px] text-[14.5px] leading-relaxed text-[#5E5852]">{PASOS[actual].pista}</p>
        {datos.referenciaEnvio && (
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#F7F5F2] px-3 py-1.5 font-mono text-[13px] text-[#141414]">Nº de envío FBA: {datos.referenciaEnvio}</p>
        )}

        <ol className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {PASOS.map((p, n) => (
            <li key={p.texto} className={cx('flex items-center gap-3 rounded-2xl border px-4 py-3 text-[14px]', n < actual ? 'border-[#2F9657]/30 bg-[#E4F3EA] text-[#1F5A36]' : n === actual ? 'border-[#F26212]/40 bg-[#FBEFE8] text-[#141414]' : 'border-[#E5E1DB] text-[#B8AE9F]')}>
              {n < actual ? <CircleCheck className="h-5 w-5 shrink-0" /> : <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold', n === actual ? 'bg-[#F26212] text-[#FFFFFF]' : 'border border-current')}>{n + 1}</span>}
              {p.texto}
            </li>
          ))}
        </ol>
      </motion.section>

      {datos.cajas && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Dato icono={<Package className="h-5 w-5" />} rotulo="Cajas" valor={n0(datos.cajas.cajas)} />
          <Dato icono={<Package className="h-5 w-5" />} rotulo="Unidades" valor={n0(datos.cajas.unidades)} />
          <Dato icono={<Scale className="h-5 w-5" />} rotulo="Peso total" valor={`${n1(datos.cajas.pesoKg)} kg`} />
        </div>
      )}

      {/* Aquí irá la aprobación del coste del transporte (ver arriba) */}
      <HuecoCosteTransporte token={token} datos={datos} />
    </div>
  )
}

function Dato({ icono, rotulo, valor }: { icono: React.ReactNode; rotulo: string; valor: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF] px-4 py-4">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#FBEFE8] text-[#F26212]">{icono}</span>
      <div>
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#8C857C]">{rotulo}</p>
        <p className="text-[20px] leading-tight tabular-nums text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
          {valor}
        </p>
      </div>
    </div>
  )
}
