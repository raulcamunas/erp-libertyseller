'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { pedirAlCorreo } from '@/lib/correo/peticiones'
import type { ColdLead } from '@/lib/types/cold-leads'

/**
 * ESCRIBIRLE A UN LEAD: pulsar su email lleva a Correo con el mensaje ya abierto y dirigido a él.
 *
 * Antes el chip era un `mailto:` y abría el programa de correo del ordenador, que no es donde trabaja el comercial (su buzón está
 * conectado al ERP). Ahora deja un encargo en lib/correo/peticiones.ts y cambia de aplicación SIN recargar: Cold Calling se queda montada
 * detrás, con el lead abierto y la lista donde estaba, y al volver está todo como se dejó. El mensaje que salga queda apuntado solo en el
 * historial del lead.
 */

/** La primera dirección de la cadena: en el Excel un lead puede traer varias separadas por espacio, coma, punto y coma o barra */
export const primerEmail = (email: string | null | undefined): string | null => email?.split(/[\s/,;]+/).find((e) => e.includes('@')) ?? null

export function useEscribirAlLead() {
  const router = useRouter()
  return useCallback(
    (lead: Pick<ColdLead, 'id' | 'store_name' | 'company' | 'email'> & { decisor?: string | null }) => {
      const para = primerEmail(lead.email)
      if (!para) return
      pedirAlCorreo({
        tipo: 'redactar',
        para,
        lead: { id: lead.id, nombre: lead.store_name, empresa: lead.company || null, contacto: lead.decisor || null },
      })
      router.push('/dashboard/correo')
    },
    [router]
  )
}
