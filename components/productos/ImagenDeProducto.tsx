'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { Package } from 'lucide-react'
import { imagenEnTamano } from '@/lib/productos/imagenes'

/**
 * LA IMAGEN PRINCIPAL DE UN PRODUCTO (SEO, Marketing Test, Remesas). Se pide a /api/productos/imagenes JUNTANDO todas las que pinta la pantalla en una sola llamada (por país, en
 * tandas cada 40 ms) y se recuerdan mientras la página está abierta. Mientras llega, un hueco con brillo; si Amazon no tiene imagen, el icono de un paquete. Aparece con un fundido.
 */

/** El país por defecto de las imágenes de una zona entera (Remesas: el almacén de España) cuando el componente no lo pasa */
export const MercadoDeImagenes = createContext<string | null>(null)

type Estado = { url: string | null; listo: boolean }
const cache = new Map<string, Estado>()
const oyentes = new Map<string, Set<() => void>>()
const pendientes = new Map<string, Set<string>>()
let temporizador: ReturnType<typeof setTimeout> | null = null
const k = (mkt: string, asin: string) => `${mkt}|${asin}`

function avisar(clave: string) {
  for (const f of oyentes.get(clave) ?? []) f()
}

async function vaciar() {
  temporizador = null
  const tandas = [...pendientes.entries()]
  pendientes.clear()
  for (const [mkt, conjunto] of tandas) {
    const asins = [...conjunto]
    for (let i = 0; i < asins.length; i += 100) {
      const trozo = asins.slice(i, i + 100)
      let imagenes: Record<string, string | null> = {}
      try {
        const r = await fetch(`/api/productos/imagenes?mkt=${encodeURIComponent(mkt)}&asins=${trozo.join(',')}`, { credentials: 'same-origin' })
        if (r.ok) imagenes = ((await r.json()) as { imagenes?: Record<string, string | null> }).imagenes ?? {}
      } catch {
        // sin imagen: se enseña el paquete
      }
      for (const a of trozo) {
        cache.set(k(mkt, a), { url: imagenes[a] ?? null, listo: true })
        avisar(k(mkt, a))
      }
    }
  }
}

function pedir(mkt: string, asin: string) {
  const c = k(mkt, asin)
  if (cache.has(c)) return
  cache.set(c, { url: null, listo: false })
  const conjunto = pendientes.get(mkt) ?? new Set<string>()
  conjunto.add(asin)
  pendientes.set(mkt, conjunto)
  if (!temporizador) temporizador = setTimeout(() => void vaciar(), 40)
}

export function useImagenDeProducto(mkt: string | null | undefined, asin: string | null | undefined): Estado {
  const clave = mkt && asin ? k(mkt, asin.toUpperCase()) : null
  const [, setVersion] = useState(0)
  useEffect(() => {
    if (!clave || !mkt || !asin) return
    const f = () => setVersion((v) => v + 1)
    const set = oyentes.get(clave) ?? new Set()
    set.add(f)
    oyentes.set(clave, set)
    pedir(mkt, asin.toUpperCase())
    return () => {
      set.delete(f)
    }
  }, [clave, mkt, asin])
  return clave ? (cache.get(clave) ?? { url: null, listo: false }) : { url: null, listo: true }
}

export function ImagenDeProducto({ asin, mkt, lado = 48, redondeo = 10, className = '', titulo }: { asin: string | null | undefined; mkt?: string | null; lado?: number; redondeo?: number; className?: string; titulo?: string }) {
  const porDefecto = useContext(MercadoDeImagenes)
  const { url, listo } = useImagenDeProducto(mkt ?? porDefecto, asin)
  const [cargada, setCargada] = useState(false)
  const src = imagenEnTamano(url, Math.min(1000, lado * 2))
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ${className}`}
      style={{ width: lado, height: lado, borderRadius: redondeo, boxShadow: 'inset 0 0 0 1px var(--ls-linea)' }}
      title={titulo}
    >
      {(!listo || (src && !cargada)) && <span className="absolute inset-0 animate-pulse bg-[var(--ls-sup2)]" />}
      {listo && !src && <Package className="text-[var(--ls-t4)]" style={{ width: lado * 0.42, height: lado * 0.42 }} />}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          onLoad={() => setCargada(true)}
          onError={() => setCargada(true)}
          className="h-full w-full object-contain p-[6%] transition-[opacity,transform] duration-500 ease-out"
          style={{ opacity: cargada ? 1 : 0, transform: cargada ? 'scale(1)' : 'scale(0.94)' }}
        />
      )}
    </span>
  )
}
