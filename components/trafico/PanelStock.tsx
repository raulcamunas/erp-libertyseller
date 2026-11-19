'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Loader2, LogOut } from 'lucide-react'
import { TableroAuditorStock } from '@/components/growth/auditor/TableroAuditorStock'
import type { ListaAuditorias } from '@/lib/auditor-stock/consulta'
import { Cabecera, EntrarConClave } from './PanelTrafico'

/**
 * EL AUDITOR DE STOCK PARA EL CLIENTE: la misma pantalla del ERP (auditorías por hora a la izquierda; a la derecha, con stock, entran, salen, cambios de precio,
 * sobreventa, venta perdida y distinta cantidad frente a PrestaShop, por canal), solo para leer, detrás del enlace con clave. Se actualiza sola cada minuto.
 */
const ETIQUETA = 'Stock Amazon y tienda'

export function PanelStock({ token, titulo, autenticado }: { token: string; titulo: string; autenticado: boolean }) {
  const [dentro, setDentro] = useState(autenticado)
  const alSalir = useCallback(() => setDentro(false), [])
  if (!dentro) return <EntrarConClave token={token} titulo={titulo} etiqueta={ETIQUETA} alEntrar={() => setDentro(true)} />
  return <Panel token={token} titulo={titulo} alSalir={alSalir} />
}

function Panel({ token, titulo, alSalir }: { token: string; titulo: string; alSalir: () => void }) {
  const base = `/api/stock-cliente/${token}`
  const [inicial, setInicial] = useState<{ lista: ListaAuditorias; enCurso: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cargar = useCallback(async () => {
    try {
      const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'lista' }) })
      if (r.status === 401) return alSalir()
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'No se han podido leer los datos.')
      setInicial({ lista: j.lista, enCurso: j.enCurso })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido leer los datos.')
    }
  }, [base, alSalir])
  useEffect(() => void cargar(), [cargar])
  const salir = async () => {
    await fetch(`/api/trafico/${token}/entrar`, { method: 'DELETE' }).catch(() => undefined)
    alSalir()
  }
  return (
    <div className="flex min-h-screen flex-col bg-[var(--ls-fondo)] text-[var(--ls-t1)]">
      <Cabecera titulo={titulo} etiqueta={ETIQUETA} subtitulo="Stock de cada producto en Amazon frente a la tienda, revisado cada 20 minutos" derecha={<button type="button" onClick={() => void salir()} title="Salir" className="rounded-lg p-1.5 text-[#B8AE9F] hover:text-white"><LogOut className="h-4 w-4" /></button>} />
      <main className="mx-auto flex w-full min-w-0 max-w-[1700px] flex-1 flex-col p-3 sm:p-5 lg:h-[calc(100vh-150px)]">
        {error ? (
          <p className="flex items-center gap-2 text-[13px] text-[var(--ls-e-rojo)]" role="alert"><AlertCircle className="h-4 w-4" /> {error} <button type="button" onClick={() => void cargar()} className="underline">Reintentar</button></p>
        ) : !inicial ? (
          <div className="mt-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#F26212]" /></div>
        ) : (
          <TableroAuditorStock inicial={inicial.lista} enCursoInicial={inicial.enCurso} publico={{ base, alPerderSesion: alSalir }} />
        )}
      </main>
    </div>
  )
}
