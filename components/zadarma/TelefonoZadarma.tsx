'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { ponerEstado } from '@/lib/zadarma/cliente'

/**
 * EL TELÉFONO DE ZADARMA DENTRO DEL ERP (llamadas a México). Solo se enciende cuando la comercial tiene abierta su lista «Vendedores México» (decisión de Raúl,
 * 19 nov 2026: que no se solape con Rinkel ni les salga a los demás). Al encenderse pide al servidor la llave de SU extensión y carga el widget WebRTC de Zadarma:
 * habla con el micrófono del ordenador y recibe las llamadas a su número de México mientras el ERP esté abierto. Al cambiar de lista se esconde y deja de recibir.
 * Las llamadas, con su grabación, llegan al historial del lead por el aviso de Zadarma (app/api/zadarma/webhook).
 */

const VERSION = 'v9'
const SCRIPTS = [`https://my.zadarma.com/webphoneWebRTCWidget/${VERSION}/js/loader-phone-lib.js?sub_v=1`, `https://my.zadarma.com/webphoneWebRTCWidget/${VERSION}/js/loader-phone-fn.js?sub_v=1`]

let cargado: Promise<void> | null = null
let sipActual: string | null = null

function cargarScript(src: string): Promise<void> {
  return new Promise((ok, mal) => {
    const s = document.createElement('script')
    s.src = src
    s.async = false
    s.onload = () => ok()
    s.onerror = () => mal(new Error('No se ha podido cargar el teléfono de Zadarma.'))
    document.body.appendChild(s)
  })
}

const esperar = async (cond: () => boolean, ms: number) => {
  const fin = Date.now() + ms
  while (!cond()) {
    if (Date.now() > fin) return false
    await new Promise((r) => setTimeout(r, 200))
  }
  return true
}

async function encender() {
  ponerEstado('cargando')
  const r = await fetch('/api/zadarma/llave', { cache: 'no-store' })
  if (r.status === 404) return ponerEstado('apagado')
  const j = (await r.json().catch(() => ({}))) as { key?: string; sip?: string; numero?: string | null; error?: string }
  if (!r.ok || !j.key || !j.sip) throw new Error(j.error ?? 'No se ha podido preparar el teléfono.')
  if (!cargado) {
    cargado = (async () => {
      await cargarScript(SCRIPTS[0])
      await cargarScript(SCRIPTS[1])
      if (!(await esperar(() => typeof window.zadarmaWidgetFn === 'function', 15_000))) throw new Error('El teléfono de Zadarma no ha arrancado.')
      window.zadarmaWidgetFn!(j.key!, j.sip!, 'square', 'es', true, { right: '24px', bottom: '96px' })
    })()
    sipActual = j.sip
  } else if (sipActual) {
    try {
      window.zdrmWPhI?.apiWidget?.reg?.(sipActual)
    } catch {}
  }
  await cargado
  await esperar(() => Boolean(window.zdrmWPhI?.apiWidget), 15_000)
  document.documentElement.classList.remove('zadarma-oculto')
  ponerEstado('listo', null, j.numero ?? null)
}

function apagar() {
  document.documentElement.classList.add('zadarma-oculto')
  try {
    window.zdrmWPhI?.apiWidget?.unreg?.()
  } catch {}
  ponerEstado('apagado')
}

export function TelefonoZadarma({ activo }: { activo: boolean }) {
  const ultimo = useRef(false)
  useEffect(() => {
    if (activo === ultimo.current) return
    ultimo.current = activo
    if (activo) {
      encender().catch((e) => {
        ponerEstado('error', e instanceof Error ? e.message : 'No se ha podido preparar el teléfono.')
        toast.error(e instanceof Error ? e.message : 'No se ha podido preparar el teléfono de Zadarma.')
      })
    } else if (cargado) apagar()
  }, [activo])
  return null
}
