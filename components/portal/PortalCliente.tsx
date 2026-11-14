'use client'

import { useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { EncajeCliente } from '@/components/encaje/EncajeCliente'
import { Cabecera } from '@/components/encaje/Cabecera'
import { FUENTE_CUERPO, fechaLarga } from '@/components/encaje/marca'
import type { DatosDeEncaje } from '@/lib/fba/encaje-enlace'
import type { DatosDelPortal } from '@/lib/fba/portal'
import { FASES_DEL_PORTAL, type FaseDelPortal } from '@/lib/fba/propuesta-cliente'
import { BarraDeFases } from './BarraDeFases'
import { FaseEnvio } from './FaseEnvio'
import { FaseEtiquetas } from './FaseEtiquetas'
import { FasePropuesta } from './FasePropuesta'

/**
 * EL PORTAL DEL CLIENTE: SU ENVÍO, DE LA PROPUESTA A AMAZON, EN UN SOLO ENLACE.
 *
 * Arriba la banda de la marca (la misma de /encajar, de los Excel y de los PDF), debajo las cuatro fases y
 * en medio la que toca. «Cajas» es el encaje de siempre, entero, con las fases encima: no se ha rehecho,
 * se reutiliza. Se abre en la fase en la que está el envío y se puede volver a mirar las anteriores.
 *
 * Movimiento con `MotionConfig reducedMotion="user"`: quien pide menos movimiento en su sistema no lo ve.
 */
export function PortalCliente({ token, inicial, encaje }: { token: string; inicial: DatosDelPortal; encaje: DatosDeEncaje | null }) {
  const [datos, setDatos] = useState(inicial)
  const [vista, setVista] = useState<FaseDelPortal>(inicial.fase)

  async function recargar() {
    try {
      const res = await fetch(`/api/publico/envio/${token}`, { cache: 'no-store' })
      if (res.ok) setDatos((await res.json()) as DatosDelPortal)
    } catch {
      /* si no hay conexión se queda lo que hay */
    }
  }

  const barra = <BarraDeFases actual={datos.fase} vista={vista} onVer={setVista} pegada={vista !== 'cajas'} />

  if (vista === 'cajas' && encaje) {
    return (
      <MotionConfig reducedMotion="user">
        <EncajeCliente token={token} inicial={encaje} encima={barra} etiquetaCabecera="Tu envío" />
      </MotionConfig>
    )
  }

  const unidades = datos.lineas.reduce((s, l) => s + l.unidades, 0)
  const pista = FASES_DEL_PORTAL.find((f) => f.id === vista)?.pista

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[#F7F5F2] text-[#141414]" style={{ fontFamily: FUENTE_CUERPO }}>
        <Cabecera titulo={datos.titulo} cliente={datos.cliente} referencias={datos.lineas.filter((l) => l.unidades > 0).length} unidades={unidades} fechaEnvio={datos.fechaEnvio} etiqueta="Tu envío" />
        {barra}
        <main className="mx-auto max-w-[1180px] px-4 pb-28 pt-6 sm:px-8">
          {pista && <p className="mb-5 text-[14px] text-[#5E5852]">{pista}</p>}
          {datos.sinMigrar && vista === 'propuesta' ? (
            <p className="rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF] px-6 py-10 text-center text-[14px] text-[#5E5852]">Todavía no puedes revisar la propuesta desde aquí. Liberty Seller te la mandará en cuanto esté disponible.</p>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={vista} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                {vista === 'propuesta' && <FasePropuesta key={`${datos.punto}-${datos.version}`} token={token} datos={datos} onAceptada={() => void recargar()} />}
                {vista === 'etiquetas' && <FaseEtiquetas token={token} datos={datos} />}
                {vista === 'envio' && <FaseEnvio token={token} datos={datos} />}
                {vista === 'cajas' && !encaje && <p className="rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF] px-6 py-10 text-center text-[14px] text-[#5E5852]">Las cajas se abren cuando hayas etiquetado. Te avisaremos.</p>}
              </motion.div>
            </AnimatePresence>
          )}
          <p className="mt-10 text-center text-[12px] text-[#B8AE9F]">Este enlace es personal: no lo compartas. Caduca el {fechaLarga(datos.caducaAt.slice(0, 10))}.</p>
        </main>
      </div>
    </MotionConfig>
  )
}
