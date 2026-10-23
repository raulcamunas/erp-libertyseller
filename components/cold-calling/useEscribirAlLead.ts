'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { pedirCorreoRapido } from '@/lib/correo/correo-rapido'
import { pedirAlCorreo } from '@/lib/correo/peticiones'
import type { ColdLead } from '@/lib/types/cold-leads'

/**
 * ESCRIBIRLE A UN LEAD: pulsar su email (o «Correo con IA») abre el cuadro de escribir ENCIMA de la ficha, ya dirigido a él.
 *
 * Antes el chip era un `mailto:` (abría el programa de correo del ordenador) y después llevaba a la aplicación de Correo, con lo que el
 * comercial se salía de la ficha. Ahora el encargo lo recoge la ventana rápida de Cold Calling (components/cold-calling/CorreoRapido.tsx,
 * vía lib/correo/correo-rapido.ts): se escribe y se envía sin moverse, y el correo queda entero en el historial del lead. Solo si esa ventana
 * no estuviera montada se hace lo de antes: dejar un encargo en lib/correo/peticiones.ts y cambiar a Correo SIN recargar.
 */

/** La primera dirección de la cadena: en el Excel un lead puede traer varias separadas por espacio, coma, punto y coma o barra */
export const primerEmail = (email: string | null | undefined): string | null => email?.split(/[\s/,;]+/).find((e) => e.includes('@')) ?? null

export function useEscribirAlLead() {
  const router = useRouter()
  return useCallback(
    (lead: Pick<ColdLead, 'id' | 'store_name' | 'company' | 'email'> & { decisor?: string | null }, direccion?: string, opciones?: { ia?: boolean }) => {
      // Sin dirección concreta, a la primera del campo `email`. Con ella (un correo extra de la ficha), a esa
      const para = direccion?.includes('@') ? direccion : primerEmail(lead.email)
      if (!para) return
      const origen = { id: lead.id, nombre: lead.store_name, empresa: lead.company || null, contacto: lead.decisor || null }
      // «Correo con IA»: el cuadro se abre y la IA ya está escribiendo el borrador (components/correo/Redactar.tsx)
      const ia = opciones?.ia === true
      if (pedirCorreoRapido({ para, ia, lead: origen })) return
      pedirAlCorreo({ tipo: 'redactar', para, lead: origen, ia })
      router.push('/dashboard/correo')
    },
    [router]
  )
}
