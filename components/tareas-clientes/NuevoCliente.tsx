'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { COLORES_NOTION, ETIQUETA_DE_GRUPO, type ClienteTC, type GrupoDeCliente } from '@/lib/tareas-clientes/tipos'
import { BASE, pedir } from './api'

const GRUPOS: GrupoDeCliente[] = ['agencia', 'marcas_eeuu', 'otros']
const ICONOS = ['🏢', '🛒', '📦', '🚀', '💡', '🎯', '🧸', '👟', '🍷', '💻', '🌿', '⭐']

/** Crear un cliente nuevo, solo en el ERP (sin base de Notion). */
export function NuevoCliente({ onCerrar, onCreado }: { onCerrar: () => void; onCreado: (c: ClienteTC) => void }) {
  const [nombre, setNombre] = useState('')
  const [grupo, setGrupo] = useState<GrupoDeCliente>('agencia')
  const [icono, setIcono] = useState('🏢')
  const [color, setColor] = useState('orange')
  const [guardando, setGuardando] = useState(false)

  async function crear() {
    if (!nombre.trim()) return toast.error('Ponle un nombre al cliente')
    setGuardando(true)
    try {
      const r = await pedir<{ cliente: ClienteTC }>(`${BASE}/clientes`, { metodo: 'POST', cuerpo: { nombre, grupo, icono, color } })
      toast.success(`Cliente «${r.cliente.nombre}» creado`)
      onCreado(r.cliente)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido crear el cliente')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Nuevo cliente" onClick={onCerrar}>
      <div className="w-full max-w-[460px] rounded-[18px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-[var(--ls-t1)]">Nuevo cliente</h2>
          <button type="button" aria-label="Cerrar" onClick={onCerrar}>
            <X className="h-4 w-4 text-[var(--ls-t3)]" />
          </button>
        </div>
        <label className="block text-[12px] text-[var(--ls-t3)]">
          Nombre
          <input
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void crear()}
            maxLength={120}
            className="mt-1 h-10 w-full rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-[14px] text-[var(--ls-t1)] outline-none focus:border-[var(--tc-orange)] [@media(pointer:coarse)]:text-[16px]"
            placeholder="Nombre del cliente"
          />
        </label>
        <p className="mb-1 mt-4 text-[12px] text-[var(--ls-t3)]">Grupo</p>
        <div className="flex flex-wrap gap-2">
          {GRUPOS.map((g) => (
            <button key={g} type="button" aria-pressed={grupo === g} onClick={() => setGrupo(g)} className="tc-ini-chip" data-on={grupo === g ? 'true' : undefined}>
              {ETIQUETA_DE_GRUPO[g]}
            </button>
          ))}
        </div>
        <p className="mb-1 mt-4 text-[12px] text-[var(--ls-t3)]">Icono</p>
        <div className="flex flex-wrap gap-2">
          {ICONOS.map((i) => (
            <button key={i} type="button" aria-pressed={icono === i} onClick={() => setIcono(i)} className="flex h-9 w-9 items-center justify-center rounded-[10px] border text-[18px]" style={{ borderColor: icono === i ? 'var(--tc-orange)' : 'var(--ls-linea)' }}>
              {i}
            </button>
          ))}
        </div>
        <p className="mb-1 mt-4 text-[12px] text-[var(--ls-t3)]">Color</p>
        <div className="flex flex-wrap gap-2">
          {COLORES_NOTION.filter((c) => c !== 'default').map((c) => (
            <button key={c} type="button" aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)} className="h-7 w-7 rounded-full border-2" style={{ background: `var(--tc-${c})`, borderColor: color === c ? 'var(--ls-t1)' : 'transparent' }} />
          ))}
        </div>
        <p className="mt-4 text-[12px] leading-[1.5] text-[var(--ls-t4)]">Se crea solo en el ERP, sin Notion. Empieza con los estados y departamentos de siempre; luego se pueden ajustar.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className="tc-boton-cristal">
            Cancelar
          </button>
          <button type="button" onClick={() => void crear()} disabled={guardando} className="tc-boton-primario">
            {guardando ? 'Creando…' : 'Crear cliente'}
          </button>
        </div>
      </div>
    </div>
  )
}
