'use client'

import { Check, CircleAlert, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AnalisisDeContenido, NivelDeContenido } from '@/lib/correo/verificacion/contenido'
import type { NivelDeDireccion } from '@/lib/correo/verificacion/verificar'
import { enviarJson } from '../api'

/**
 * ¿ES UN BUEN CORREO? LA COMPROBACIÓN QUE SE VE MIENTRAS SE ESCRIBE.
 *
 * Mira las direcciones de «Para» y «Cc» (cómo están escritas, si ya rebotaron antes, si su dominio existe y recibe correo) y el texto (lo que hace que un
 * filtro lo mande a spam). Nunca bloquea: avisa, propone la corrección de una errata y deja que quien envía decida. Espera a que se deje de teclear (700 ms)
 * y, si el servidor no contesta, desaparece sin hacer ruido: no puede estorbar a enviar un correo.
 */

export interface VeredictoCliente {
  direccion: string
  nivel: NivelDeDireccion
  motivo: string
  sugerencia: string | null
  sinComprobar: boolean
  rebotada: boolean
}

export interface ResultadoDeComprobacion {
  direcciones: VeredictoCliente[]
  contenido: AnalisisDeContenido | null
}

/** Las direcciones de un campo «Para»: separadas por comas o punto y coma, con o sin «Nombre <dirección>» */
export function direccionesDelCampo(campo: string): string[] {
  return campo
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (/<([^>]+)>/.exec(x)?.[1] ?? x).trim())
    .filter((x) => x.length > 0)
}

export interface EntradaDeComprobacion {
  direcciones: string[]
  asunto: string
  /** El cuerpo sin la firma */
  texto: string
  esRespuesta: boolean
}

const claveDe = (e: EntradaDeComprobacion): string => JSON.stringify([e.direcciones, e.asunto, e.texto, e.esRespuesta])

/** Pide la revisión al servidor. null si no contesta o falla: la revisión es una ayuda, nunca una condición para enviar */
export async function comprobarAhora(e: EntradaDeComprobacion): Promise<ResultadoDeComprobacion | null> {
  if (e.direcciones.length === 0 && e.texto.trim().length < 20) return null
  const r = await enviarJson<ResultadoDeComprobacion>('/api/correo/verificar', 'POST', {
    direcciones: e.direcciones,
    asunto: e.asunto,
    texto: e.texto.trim().length >= 20 ? e.texto : undefined,
    esRespuesta: e.esRespuesta,
  })
  return r.ok ? { direcciones: r.datos.direcciones ?? [], contenido: r.datos.contenido ?? null } : null
}

/**
 * Revisa mientras se escribe, esperando 700 ms a que se deje de teclear. `vigente` dice si el resultado es de lo que hay escrito ahora (si no, se está
 * esperando o ha cambiado desde entonces); `fijar` deja un resultado pedido a mano (justo antes de enviar) como el vigente.
 */
export function useComprobacion(entrada: EntradaDeComprobacion & { activa: boolean }) {
  const [guardado, setGuardado] = useState<{ clave: string; resultado: ResultadoDeComprobacion | null } | null>(null)
  const generacion = useRef(0)
  const clave = claveDe(entrada)
  const entradaActual = useRef(entrada)
  entradaActual.current = entrada
  useEffect(() => {
    const mia = ++generacion.current
    if (!entrada.activa) {
      setGuardado(null)
      return
    }
    const t = setTimeout(async () => {
      const resultado = await comprobarAhora(entradaActual.current)
      if (mia === generacion.current) setGuardado({ clave, resultado })
    }, 700)
    return () => clearTimeout(t)
  }, [clave, entrada.activa])
  return {
    resultado: guardado?.resultado ?? null,
    vigente: guardado !== null && guardado.clave === clave,
    fijar: (resultado: ResultadoDeComprobacion | null) => setGuardado({ clave, resultado }),
  }
}

const COLOR_DE_DIRECCION: Record<NivelDeDireccion, string> = { buena: 'var(--ls-e-verde)', dudosa: 'var(--ls-e-ambar)', mala: 'var(--ls-e-rojo)' }
const COLOR_DE_CONTENIDO: Record<NivelDeContenido, string> = { bien: 'var(--ls-e-verde)', mejorable: 'var(--ls-e-ambar)', arriesgado: 'var(--ls-e-rojo)' }
const ETIQUETA_DE_CONTENIDO: Record<NivelDeContenido, string> = { bien: 'Buen correo', mejorable: 'Mejorable', arriesgado: 'Riesgo de spam' }

/** La dirección que hay que corregir antes de enviar: la que está mal escrita, desechable o ya rebotó */
export function hayDireccionMala(r: ResultadoDeComprobacion | null): VeredictoCliente[] {
  return r ? r.direcciones.filter((d) => d.nivel === 'mala') : []
}

interface Props {
  resultado: ResultadoDeComprobacion | null
  /** Cambiar una dirección por la que se propone (arregla la errata en «Para» o «Cc») */
  onUsarSugerencia: (de: string, a: string) => void
}

export function ComprobacionDeCorreo({ resultado, onUsarSugerencia }: Props) {
  if (!resultado) return null
  const problemas = resultado.direcciones.filter((d) => d.nivel !== 'buena')
  const c = resultado.contenido
  const avisos = c ? c.avisos.filter((a) => a.gravedad !== 'leve' || c.nivel !== 'bien').slice(0, 4) : []
  if (problemas.length === 0 && (!c || (c.nivel === 'bien' && avisos.length === 0))) {
    // Todo bien: una línea discreta para que se sepa que se ha mirado
    return (
      <p className="sec-sube flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t4)]" role="status">
        <ShieldCheck className="h-3.5 w-3.5 text-[var(--ls-e-verde)]" aria-hidden />
        {c ? `Buen correo (${c.puntos}/100): ` : ''}direcciones y texto revisados, sin nada raro.
      </p>
    )
  }
  return (
    <div className="sec-sube space-y-1.5" role="status" aria-label="Revisión del correo">
      {problemas.map((d) => (
        <p key={d.direccion} className="flex items-start gap-2 rounded-[8px] border border-l-2 border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 py-1.5 text-[12px] leading-snug text-[var(--ls-t2)]" style={{ borderLeftColor: COLOR_DE_DIRECCION[d.nivel] }}>
          {d.nivel === 'mala' ? <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: COLOR_DE_DIRECCION[d.nivel] }} aria-hidden /> : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: COLOR_DE_DIRECCION[d.nivel] }} aria-hidden />}
          <span className="min-w-0 flex-1">
            <strong className="break-all font-medium text-[var(--ls-t1)]">{d.direccion}</strong>: {d.motivo}
            {d.nivel === 'mala' && !d.sugerencia && ' Si la envías, el correo rebotará y dañará la reputación de tu buzón.'}
          </span>
          {d.sugerencia && (
            <button type="button" onClick={() => onUsarSugerencia(d.direccion, d.sugerencia as string)} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[5px] border border-[var(--ls-linea2)] px-2 text-[11.5px] font-medium text-[var(--ls-t1)] transition-colors hover:bg-[var(--ls-sup3)]">
              <Check className="h-3 w-3" aria-hidden /> Usar {d.sugerencia}
            </button>
          )}
        </p>
      ))}
      {c && (c.nivel !== 'bien' || avisos.length > 0) && (
        <div className="rounded-[8px] border border-l-2 border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 py-1.5" style={{ borderLeftColor: COLOR_DE_CONTENIDO[c.nivel] }}>
          <p className="flex items-center gap-2 text-[12px] text-[var(--ls-t2)]">
            <span className="font-semibold" style={{ color: COLOR_DE_CONTENIDO[c.nivel] }}>
              {ETIQUETA_DE_CONTENIDO[c.nivel]}
            </span>
            <span className="relative h-[5px] w-24 overflow-hidden rounded-full bg-[var(--ls-sup3)]" aria-hidden>
              <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${c.puntos}%`, background: COLOR_DE_CONTENIDO[c.nivel] }} />
            </span>
            <span className="tabular-nums text-[var(--ls-t4)]">{c.puntos}/100</span>
          </p>
          {avisos.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11.5px] leading-snug text-[var(--ls-t3)]">
              {avisos.map((a) => (
                <li key={a.codigo + a.texto}>{a.texto}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
