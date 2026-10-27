'use client'

import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

/**
 * «ECHAR PARA ATRÁS»: vuelve a la página de la que se venía.
 *
 * Usa el historial del navegador, así se vuelve a Mi rendimiento con la misma persona y el mismo periodo que se estaban mirando (un enlace fijo los perdería). Si no hay de
 * dónde volver (se abrió la dirección en una pestaña nueva), va a `alternativa`.
 */
export function BotonVolver({ alternativa, texto = 'Volver' }: { alternativa: string; texto?: string }) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back()
        else router.push(alternativa)
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2.5 text-[12.5px] font-semibold text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ls-acc-graf)]"
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      {texto}
    </button>
  )
}
