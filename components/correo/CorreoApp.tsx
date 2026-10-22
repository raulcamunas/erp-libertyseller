'use client'

import { useEffect, useMemo, useState } from 'react'
import { Esqueleto } from '@/components/rendimiento/ui'
import { puedeSupervisarCorreoEnNavegador } from '@/lib/permisos-cliente'
import { createClient } from '@/lib/supabase/client'
import type { UserProfile } from '@/lib/supabase/get-user-profile'
import { PanelCorreo } from './PanelCorreo'

/**
 * CORREO COMO APLICACIÓN QUE SE QUEDA ABIERTA.
 *
 * El webmail de cada comercial dentro del ERP: conecta su buzón de Hostinger y desde aquí lee, contesta y envía, con las conversaciones
 * agrupadas en hilos y una búsqueda. Quien supervisa (el administrador, o quien tenga el permiso suelto «Supervisión del correo», que lee
 * el buzón de cualquiera del equipo, o el de «Supervisión del equipo comercial», que lee el de los comerciales) elige desde un selector
 * qué bandeja leer, en solo lectura y dejando rastro de cada vez que mira una. Un partner no entra: el middleware no le abre esta pantalla.
 *
 * LA MONTA UNA SOLA VEZ `AppsPersistentes` (components/layout/AppsPersistentes.tsx) y se queda montada aunque se vaya a Cold Calling: al volver
 * están el hilo abierto, la búsqueda y hasta el mensaje a medio escribir, y no se vuelve a pedir nada. La dirección guarda dónde estás
 * (?buzon=<id>&hilo=<id>) y se lee SOLO al montar, para los enlaces; un encargo de otra aplicación («escribe a este lead», «abre este
 * correo») llega por lib/correo/peticiones.ts, sin recargar.
 *
 * ESTO SOLO DECIDE QUÉ SE PINTA. Las tablas correo_* están cerradas al navegador y todo pasa por las rutas de /api/correo, que son las
 * que deciden qué buzón puede abrir cada persona (lib/correo/acceso.ts). Un id de la dirección que no sea de esta persona devuelve «no
 * existe», no el buzón de otra.
 *
 * NECESITA LA MIGRACIÓN 236. Si falta, la propia pantalla lo dice con el nombre del fichero que hay que lanzar; desplegar el código antes
 * que el SQL no estropea nada.
 */

interface Props {
  perfil: UserProfile
  activa: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const idValido = (v: string | null) => (v && UUID.test(v) ? v.toLowerCase() : null)
const nombreDe = (p: { full_name: string | null; email: string | null }) => p.full_name?.trim() || p.email || 'Sin nombre'

export function CorreoApp({ perfil, activa }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [puedeSupervisar, setPuedeSupervisar] = useState<boolean | null>(perfil.role === 'admin' ? true : null)

  // El enlace con ?buzon= o ?hilo= se lee una vez, al montar
  const inicial = useMemo(() => {
    const p = new URLSearchParams(window.location.search)
    return { buzon: idValido(p.get('buzon')), hilo: idValido(p.get('hilo')) }
  }, [])

  useEffect(() => {
    if (puedeSupervisar !== null) return
    let vivo = true
    void puedeSupervisarCorreoEnNavegador(supabase, perfil.role, perfil.id).then((v) => {
      if (vivo) setPuedeSupervisar(v)
    })
    return () => {
      vivo = false
    }
  }, [supabase, perfil, puedeSupervisar])

  return (
    <div className="space-y-3 pb-6">
      <div>
        <h1 className="mb-0.5 text-[22px] font-semibold leading-tight tracking-[-0.012em] text-[var(--ls-t1)]">Correo</h1>
        <p className="max-w-3xl text-[13px] text-[var(--ls-t3)]">
          {puedeSupervisar
            ? 'Tu correo y el del equipo: elige arriba qué bandeja leer. Las del resto se abren en solo lectura y cada vez que miras una queda anotado.'
            : 'Tu correo de Hostinger dentro del ERP: lee, contesta y sigue cada conversación en su hilo.'}
        </p>
      </div>

      {puedeSupervisar === null ? (
        <div className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4" aria-busy="true" aria-label="Cargando el correo">
          <div className="space-y-3">
            <Esqueleto className="h-8 w-64" />
            <Esqueleto className="h-14 w-full" />
            <Esqueleto className="h-14 w-full" />
            <Esqueleto className="h-14 w-full" />
          </div>
        </div>
      ) : (
        <PanelCorreo yo={{ id: perfil.id, nombre: nombreDe(perfil) }} puedeSupervisar={puedeSupervisar} esAdmin={perfil.role === 'admin'} buzonInicial={inicial.buzon} hiloInicial={inicial.hilo} activa={activa} />
      )}
    </div>
  )
}
