'use client'

import { Calendar, CheckSquare, Hash, Link2, List, Mail, Phone, TextCursorInput, Tags } from 'lucide-react'
import type { FechaDePropiedad, PropiedadExtra, TipoDePropiedad } from '@/lib/tareas-clientes/propiedades'
import { Etiqueta } from './ui'

/**
 * LAS COLUMNAS PROPIAS DEL CLIENTE en el panel de una tarea: las que su base de Notion tiene y el ERP no conocía («Prioridad», «Horas», «Revisado»…). Cada una se pinta con el
 * control de su tipo y se guarda al instante; salen a Notion como el resto. Ver lib/tareas-clientes/propiedades.ts.
 */

const ICONO: Record<TipoDePropiedad, typeof Hash> = { select: List, multi_select: Tags, number: Hash, checkbox: CheckSquare, url: Link2, email: Mail, phone_number: Phone, rich_text: TextCursorInput, date: Calendar }

function Campo({ extra, valor, onCambio }: { extra: PropiedadExtra; valor: unknown; onCambio: (v: unknown) => void }) {
  const clave = `${extra.nombre}-${JSON.stringify(valor ?? null)}`
  switch (extra.tipo) {
    case 'checkbox':
      return (
        <label className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[12.5px] text-[var(--ls-t2)]">
          <input type="checkbox" className="tc-casilla" checked={valor === true} onChange={(e) => onCambio(e.target.checked)} /> {valor === true ? 'Sí' : 'No'}
        </label>
      )
    case 'select':
      return (
        <select aria-label={extra.nombre} value={typeof valor === 'string' ? valor : ''} onChange={(e) => onCambio(e.target.value || null)} className="tc-entrada">
          <option value="">—</option>
          {typeof valor === 'string' && valor && !(extra.opciones ?? []).some((o) => o.nombre === valor) && <option value={valor}>{valor}</option>}
          {(extra.opciones ?? []).map((o) => <option key={o.nombre} value={o.nombre}>{o.nombre}</option>)}
        </select>
      )
    case 'multi_select': {
      const elegidas = Array.isArray(valor) ? (valor as string[]) : []
      const todas = [...(extra.opciones ?? []), ...elegidas.filter((v) => !(extra.opciones ?? []).some((o) => o.nombre === v)).map((nombre) => ({ nombre, color: 'default' as const }))]
      return (
        <div className="flex flex-wrap gap-1 px-1 py-0.5">
          {todas.map((o) => {
            const on = elegidas.includes(o.nombre)
            return (
              <button key={o.nombre} type="button" aria-pressed={on} onClick={() => onCambio(on ? elegidas.filter((x) => x !== o.nombre) : [...elegidas, o.nombre])} className="tc-filtro-etiqueta" style={{ '--tono': `var(--tc-${o.color})` } as React.CSSProperties}>{o.nombre}</button>
            )
          })}
          {todas.length === 0 && <Etiqueta color="gray" pequena>Sin opciones</Etiqueta>}
        </div>
      )
    }
    case 'number':
      return <input key={clave} type="number" step="any" defaultValue={typeof valor === 'number' ? valor : ''} aria-label={extra.nombre} onBlur={(e) => { const v = e.target.value.trim(); const n = v === '' ? null : Number(v); if (n !== (typeof valor === 'number' ? valor : null)) onCambio(n) }} className="tc-entrada" />
    case 'date': {
      const f = (valor as FechaDePropiedad | null) ?? null
      return (
        <div className="flex flex-wrap items-center gap-1 px-1">
          <input type="date" aria-label={`${extra.nombre}: desde`} value={f?.start?.slice(0, 10) ?? ''} onChange={(e) => onCambio(e.target.value ? { start: e.target.value, end: f?.end && f.end >= e.target.value ? f.end : null } : null)} className="tc-fecha" />
          <span className="text-[11px] text-[var(--ls-t4)]">→</span>
          <input type="date" aria-label={`${extra.nombre}: hasta`} value={f?.end?.slice(0, 10) ?? ''} min={f?.start?.slice(0, 10)} disabled={!f?.start} onChange={(e) => f?.start && onCambio({ start: f.start, end: e.target.value || null })} className="tc-fecha" />
        </div>
      )
    }
    default:
      return <input key={clave} type={extra.tipo === 'url' ? 'url' : extra.tipo === 'email' ? 'email' : extra.tipo === 'phone_number' ? 'tel' : 'text'} defaultValue={typeof valor === 'string' ? valor : ''} aria-label={extra.nombre} placeholder={extra.tipo === 'url' ? 'https://…' : ''} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (typeof valor === 'string' ? valor : '')) onCambio(v || null) }} className="tc-entrada" />
  }
}

export function PropiedadesPropias({ extras, valores, onCambio }: { extras: readonly PropiedadExtra[]; valores: Record<string, unknown>; onCambio: (nombre: string, valor: unknown) => void }) {
  return (
    <>
      {extras.map((x) => {
        const Icono = ICONO[x.tipo]
        return (
          <div key={x.nombre} className="tc-prop">
            <span className="tc-prop-nombre" title={x.nombre}><Icono className="h-3.5 w-3.5" />{x.nombre}</span>
            <div className="min-w-0 flex-1"><Campo extra={x} valor={valores[x.nombre]} onCambio={(v) => onCambio(x.nombre, v)} /></div>
          </div>
        )
      })}
    </>
  )
}
