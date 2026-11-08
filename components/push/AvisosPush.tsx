'use client'

import { useCallback, useEffect, useState } from 'react'
import { BellRing, Loader2, Send, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import type { DispositivoDePush } from '@/lib/push/servidor'

/**
 * ACTIVAR LOS AVISOS EN ESTE DISPOSITIVO. Pide el permiso (hace falta un clic: el navegador no lo deja pedir solo), registra el service worker de los avisos (public/sw.js), se
 * suscribe con la clave pública del servidor y se la entrega. Desde ahí cada aviso de la campana llega como notificación aunque la app esté cerrada. En el iPhone solo funciona con
 * la app instalada en la pantalla de inicio (es una norma de Apple), y el componente lo dice.
 */

type Estado = 'cargando' | 'no_soportado' | 'instalar' | 'sin_migracion' | 'bloqueado' | 'inactivo' | 'activo'

const aBytes = (b64: string): Uint8Array => {
  const relleno = '='.repeat((4 - (b64.length % 4)) % 4)
  const crudo = atob((b64 + relleno).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...crudo].map((c) => c.charCodeAt(0)))
}

const esIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const estaInstalada = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true

async function suscripcionLocal(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration('/')
  return reg ? reg.pushManager.getSubscription() : null
}

async function pedirJson<T>(url: string, metodo = 'GET', cuerpo?: unknown): Promise<T> {
  const res = await fetch(url, { method: metodo, cache: 'no-store', ...(cuerpo !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) } : {}) })
  const datos = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !datos) throw new Error(datos?.error ?? `Error ${res.status}`)
  return datos
}

export function AvisosPush() {
  const [estado, setEstado] = useState<Estado>('cargando')
  const [dispositivo, setDispositivo] = useState<DispositivoDePush | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const revisar = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return setEstado(esIphone() && !estaInstalada() ? 'instalar' : 'no_soportado')
    if (esIphone() && !estaInstalada()) return setEstado('instalar')
    try {
      const r = await pedirJson<{ disponible: boolean; dispositivos: DispositivoDePush[] }>('/api/push/clave')
      if (!r.disponible) return setEstado('sin_migracion')
      if (Notification.permission === 'denied') return setEstado('bloqueado')
      const local = await suscripcionLocal()
      const mio = local ? (r.dispositivos.find((d) => d.endpoint === local.endpoint) ?? null) : null
      setDispositivo(mio)
      setEstado(mio ? 'activo' : 'inactivo')
    } catch {
      setEstado('inactivo')
    }
  }, [])

  useEffect(() => {
    void revisar()
  }, [revisar])

  const activar = async () => {
    setOcupado(true)
    try {
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') return setEstado(permiso === 'denied' ? 'bloqueado' : 'inactivo')
      const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js', { scope: '/' }))
      await navigator.serviceWorker.ready
      const { clave } = await pedirJson<{ clave: string | null }>('/api/push/clave')
      if (!clave) return setEstado('sin_migracion')
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(clave) as unknown as BufferSource }))
      await pedirJson('/api/push/suscribir', 'POST', { suscripcion: sub.toJSON(), categoria: 'tareas' })
      await revisar()
      toast.success('Avisos activados en este dispositivo')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se han podido activar los avisos')
    } finally {
      setOcupado(false)
    }
  }

  const desactivar = async () => {
    setOcupado(true)
    try {
      const sub = await suscripcionLocal()
      if (sub) {
        await pedirJson('/api/push/suscribir', 'DELETE', { endpoint: sub.endpoint })
        await sub.unsubscribe()
      }
      setDispositivo(null)
      setEstado('inactivo')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se han podido desactivar')
    } finally {
      setOcupado(false)
    }
  }

  const cambiarCategoria = async (categoria: 'tareas' | 'todo') => {
    if (!dispositivo) return
    setDispositivo({ ...dispositivo, categoria })
    try {
      await pedirJson('/api/push/suscribir', 'PATCH', { endpoint: dispositivo.endpoint, categoria })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
      void revisar()
    }
  }

  const probar = async () => {
    setOcupado(true)
    try {
      const r = await pedirJson<{ enviados: number; fallidos: number }>('/api/push/suscribir', 'PUT', { prueba: true })
      toast.message(r.enviados > 0 ? 'Aviso de prueba enviado: debería llegarte en unos segundos' : 'No se ha podido entregar a ningún dispositivo')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido mandar la prueba')
    } finally {
      setOcupado(false)
    }
  }

  if (estado === 'cargando') return null
  return (
    <div className="tc-dia-push" data-estado={estado}>
      <Smartphone className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t3)]" />
      <div className="min-w-0 flex-1 text-[12px] leading-snug text-[var(--ls-t3)]">
        {estado === 'activo' && <span className="text-[var(--ls-t1)]">Avisos activados en este dispositivo ({dispositivo?.dispositivo})</span>}
        {estado === 'inactivo' && <>Recibe los avisos en este dispositivo aunque tengas la app cerrada.</>}
        {estado === 'bloqueado' && <>Los avisos están bloqueados en este navegador. Actívalos en los ajustes del sitio.</>}
        {estado === 'instalar' && <>En iPhone, abre la app instalada en la pantalla de inicio para activar los avisos.</>}
        {estado === 'no_soportado' && <>Este navegador no admite avisos push.</>}
        {estado === 'sin_migracion' && <>Falta lanzar la migración 280 en Supabase para activar los avisos.</>}
      </div>
      {estado === 'inactivo' && <button type="button" onClick={() => void activar()} disabled={ocupado} className="tc-boton-primario !h-7 shrink-0">{ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <BellRing className="h-3 w-3" />} Activar</button>}
      {estado === 'activo' && (
        <div className="flex shrink-0 items-center gap-1.5">
          <select aria-label="Qué avisos recibir" value={dispositivo?.categoria ?? 'tareas'} onChange={(e) => void cambiarCategoria(e.target.value as 'tareas' | 'todo')} className="h-7 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-1.5 text-[11.5px]">
            <option value="tareas">Solo tareas</option>
            <option value="todo">Todos los avisos</option>
          </select>
          <button type="button" onClick={() => void probar()} disabled={ocupado} className="tc-icono-boton !h-7 !w-7" title="Mandar un aviso de prueba" aria-label="Mandar un aviso de prueba"><Send className="h-3 w-3" /></button>
          <button type="button" onClick={() => void desactivar()} disabled={ocupado} className="tc-boton-suave tc-discreto">Quitar</button>
        </div>
      )}
    </div>
  )
}
