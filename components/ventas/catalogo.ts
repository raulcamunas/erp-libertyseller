'use client'

import { useEffect, useState } from 'react'
import type { BsrDelProducto, InventarioDelProducto } from '@/lib/ventas/panel-servidor'

/**
 * VENTAS · EL CATÁLOGO DE CADA CUENTA EN EL NAVEGADOR (títulos, costes, stock, BSR, inventario), compartido entre el tablero, Gráfico y P&L. Antes cada
 * vista lo volvía a pedir al abrirse (ShoesF: 11 MB y varios segundos cada vez). Se guarda 5 minutos; guardar un COGS lo actualiza aquí mismo.
 */
export interface CatalogoDeCuenta {
  titulos: Record<string, { titulo: string | null; asin: string | null }>
  costes: Record<string, number>
  stock?: Record<string, number>
  bsr?: Record<string, BsrDelProducto>
  inventario?: Record<string, InventarioDelProducto>
  [otro: string]: unknown
}

const VIDA = 5 * 60_000
const memoria = new Map<string, { en: number; valor: Promise<CatalogoDeCuenta | null> }>()

export function guardarCatalogo(cuenta: string, catalogo: CatalogoDeCuenta | null) {
  if (catalogo) memoria.set(cuenta, { en: Date.now(), valor: Promise.resolve(catalogo) })
}

/** El catálogo guardado si está fresco (sin pedirlo). null = hay que pedirlo */
export function catalogoGuardado(cuenta: string): Promise<CatalogoDeCuenta | null> | null {
  const c = memoria.get(cuenta)
  return c && Date.now() - c.en < VIDA ? c.valor : null
}

export function catalogoDe(cuenta: string): Promise<CatalogoDeCuenta | null> {
  const guardado = catalogoGuardado(cuenta)
  if (guardado) return guardado
  const valor = fetch(`/api/ventas?que=productos&cuenta=${cuenta}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { productos?: CatalogoDeCuenta } | null) => j?.productos ?? null)
    .catch(() => null)
  memoria.set(cuenta, { en: Date.now(), valor })
  valor.then((v) => !v && memoria.delete(cuenta))
  return valor
}

export function useCatalogo(cuenta: string | null): CatalogoDeCuenta | null {
  const [catalogo, setCatalogo] = useState<{ de: string; c: CatalogoDeCuenta } | null>(null)
  useEffect(() => {
    if (!cuenta) return
    let vivo = true
    catalogoDe(cuenta).then((c) => vivo && c && setCatalogo({ de: cuenta, c }))
    return () => {
      vivo = false
    }
  }, [cuenta])
  return catalogo && catalogo.de === cuenta ? catalogo.c : null
}
