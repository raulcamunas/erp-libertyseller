'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AlertTriangle, Banknote, FileEdit, FilePlus2, History, Link2, Mail, Receipt, Search, Send, Trash2, type LucideIcon } from 'lucide-react'
import { Avatar } from '@/components/rendimiento/ui'
import { BOTON, CAMPO, TARJETA, TEXTO, TIPO, type TonoEstado } from '@/lib/estilo/denso'
import { ETIQUETA_REGISTRO, type FilaRegistro, type TipoRegistro } from '@/lib/facturacion/tipos'
import { Aviso, Dialogo, dinero, EsqueletoDePestana, pedir, tonoComoEstilo } from './comun'

/** Lo que la ruta devuelve como mucho: si se llega, hay que decir que lo anterior no está aquí */
const TOPE_DEL_REGISTRO = 200

const ESTILO_TIPO: Record<TipoRegistro, { icono: LucideIcon; tono: TonoEstado }> = {
  borrador: { icono: FilePlus2, tono: 'azul' },
  borrador_editado: { icono: FileEdit, tono: 'azul' },
  borrador_borrado: { icono: Trash2, tono: 'gris' },
  envio: { icono: Send, tono: 'cian' },
  cobro: { icono: Banknote, tono: 'verde' },
  gasto: { icono: Receipt, tono: 'magenta' },
  plantilla: { icono: Mail, tono: 'violeta' },
  contacto: { icono: Link2, tono: 'ambar' },
}

const FILTROS: { id: string; nombre: string; tipos: TipoRegistro[]; icono: LucideIcon; tono: TonoEstado }[] = [
  { id: 'envios', nombre: 'Envíos', tipos: ['envio'], icono: Send, tono: 'cian' },
  { id: 'cobros', nombre: 'Cobros', tipos: ['cobro'], icono: Banknote, tono: 'verde' },
  { id: 'gastos', nombre: 'Gastos', tipos: ['gasto'], icono: Receipt, tono: 'magenta' },
  { id: 'borradores', nombre: 'Borradores', tipos: ['borrador', 'borrador_editado', 'borrador_borrado'], icono: FileEdit, tono: 'azul' },
  { id: 'plantillas', nombre: 'Plantillas', tipos: ['plantilla'], icono: Mail, tono: 'violeta' },
  { id: 'clientes', nombre: 'Clientes', tipos: ['contacto'], icono: Link2, tono: 'ambar' },
]

function resumen(f: FilaRegistro): string {
  const d = f.detalle as { para?: string[]; referencia?: string | null; accion?: string; tipo?: string | null; plantillaNombre?: string | null }
  if (f.tipo === 'envio') return [d.para?.join(', '), d.plantillaNombre].filter(Boolean).join(' · ')
  if (f.tipo === 'cobro') return d.referencia ? `Referencia ${d.referencia}` : ''
  if (f.tipo === 'gasto') return d.tipo ?? ''
  if (f.tipo === 'plantilla') return d.accion ?? ''
  if (esCorreccion(f)) {
    const antes = (f.detalle as { antes?: { total?: number } }).antes?.total
    return typeof antes === 'number' && f.importe != null ? `Antes ${antes.toFixed(2)} → ahora ${Number(f.importe).toFixed(2)}` : ''
  }
  return ''
}

/** Un «borrador editado» que en realidad era una factura enviada (corregida desde el 11 nov 2026) */
const esCorreccion = (f: FilaRegistro) => f.tipo === 'borrador_editado' && (f.detalle as { enviada?: boolean }).enviada === true

const claveDeDia = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

function nombreDelDia(iso: string): string {
  const d = new Date(iso)
  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  if (claveDeDia(d) === claveDeDia(new Date())) return 'Hoy'
  if (claveDeDia(d) === claveDeDia(ayer)) return 'Ayer'
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** Quién hizo qué y cuándo, día a día, y el correo tal como salió */
export function PestanaRegistro() {
  const [filas, setFilas] = useState<FilaRegistro[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [correo, setCorreo] = useState<FilaRegistro | null>(null)
  const [filtro, setFiltro] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    pedir<{ filas: FilaRegistro[] }>('/api/facturacion/registro')
      .then((d) => setFilas(d.filas))
      .catch((e: Error) => setError(e.message))
  }, [])

  const dias = useMemo(() => {
    const tipos = FILTROS.find((x) => x.id === filtro)?.tipos
    const texto = busqueda.trim().toLowerCase()
    const grupos: { dia: string; filas: FilaRegistro[] }[] = []
    for (const f of filas ?? []) {
      if (tipos && !tipos.includes(f.tipo)) continue
      if (texto && ![f.numero, f.cliente, f.hecho_por_nombre, resumen(f)].some((c) => c?.toLowerCase().includes(texto))) continue
      const dia = claveDeDia(new Date(f.creado_en))
      const ultimo = grupos[grupos.length - 1]
      if (ultimo?.dia === dia) ultimo.filas.push(f)
      else grupos.push({ dia, filas: [f] })
    }
    return grupos
  }, [filas, filtro, busqueda])

  if (error) {
    return (
      <Aviso tono="ambar" icono={AlertTriangle}>
        {error}
      </Aviso>
    )
  }
  if (!filas) return <EsqueletoDePestana etiqueta="Leyendo el registro" />

  const verCorreo = correo?.detalle as { asunto?: string; cuerpo?: string; para?: string[]; cc?: string[] } | undefined
  let escalon = 0

  return (
    <div className="flex flex-col gap-2">
      <div className="fac-entra flex flex-wrap items-center gap-1.5">
        <button type="button" aria-pressed={filtro === null} onClick={() => setFiltro(null)} className="fac-chip" style={tonoComoEstilo('naranja')}>
          <History className="h-3 w-3" /> Todo <span className="tabular-nums">{filas.length}</span>
        </button>
        {FILTROS.map((x) => {
          const cuantas = filas.filter((f) => x.tipos.includes(f.tipo)).length
          if (cuantas === 0) return null
          const Icono = x.icono
          return (
            <button key={x.id} type="button" aria-pressed={filtro === x.id} onClick={() => setFiltro(filtro === x.id ? null : x.id)} className="fac-chip" style={tonoComoEstilo(x.tono)}>
              <Icono className="h-3 w-3" /> {x.nombre} <span className="tabular-nums">{cuantas}</span>
            </button>
          )
        })}
        <label className="relative ml-auto w-full max-w-[240px]">
          <span className="sr-only">Buscar en el registro</span>
          <Search className={`pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 ${TEXTO.t4}`} />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Cliente, factura, correo…" className={`${CAMPO.input} pl-[26px]`} />
        </label>
      </div>

      {dias.length === 0 ? (
        <div className={`${TARJETA.base} py-12 text-center ${TIPO.s} ${TEXTO.t3}`}>{filas.length === 0 ? 'Todavía no se ha hecho nada desde esta pantalla.' : 'Nada coincide con lo que buscas.'}</div>
      ) : (
        dias.map(({ dia, filas: delDia }, d) => (
          <section key={dia} className={`${TARJETA.base} fac-entra overflow-hidden`} style={{ '--d': Math.min(d, 4) + 1 } as CSSProperties}>
            <div className={TARJETA.cabecera}>
              <span className={`text-[12.5px] font-semibold first-letter:uppercase ${TEXTO.t1}`}>{nombreDelDia(delDia[0].creado_en)}</span>
              <span className="fac-contador" style={tonoComoEstilo('gris')}>
                {delDia.length}
              </span>
            </div>
            <ul>
              {delDia.map((f) => {
                const { icono: Icono, tono } = ESTILO_TIPO[f.tipo]
                const detalle = resumen(f)
                return (
                  <li key={f.id} className="fac-evento flex min-h-[44px] items-center gap-2.5 border-b border-[var(--ls-linea)] py-1.5 pl-3 pr-3 last:border-b-0" style={{ ...tonoComoEstilo(tono), '--i': escalon++ } as CSSProperties}>
                    <time dateTime={f.creado_en} className={`w-[34px] shrink-0 text-right text-[11px] tabular-nums ${TEXTO.t4}`}>
                      {new Date(f.creado_en).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                    </time>
                    <span className="fac-icono">
                      <Icono className="h-3 w-3" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`truncate text-[12.5px] ${TEXTO.t1}`}>
                        <span className="font-medium">{esCorreccion(f) ? 'Factura enviada corregida' : ETIQUETA_REGISTRO[f.tipo]}</span>
                        {f.cliente ? <span className={TEXTO.t2}> · {f.cliente}</span> : null}
                      </span>
                      {(f.numero || detalle) && (
                        <span className={`truncate text-[11px] ${TEXTO.t3}`} title={[f.numero, detalle].filter(Boolean).join(' · ')}>
                          {[f.numero, detalle].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                    {f.tipo === 'envio' && (
                      <button type="button" onClick={() => setCorreo(f)} className={`${BOTON.base} ${BOTON.secundario} shrink-0`}>
                        <Mail className="h-3 w-3" /> Ver correo
                      </button>
                    )}
                    {f.importe != null && <span className={`w-[84px] shrink-0 text-right text-[12.5px] font-semibold tabular-nums ${TEXTO.t1}`}>{dinero(f.importe, f.moneda ?? 'EUR')}</span>}
                    <span className="flex w-[140px] shrink-0 items-center gap-1.5" title={f.hecho_por_nombre ?? undefined}>
                      <Avatar id={f.hecho_por_nombre ?? '—'} nombre={f.hecho_por_nombre ?? '—'} tamano={20} />
                      <span className={`truncate text-[11px] ${TEXTO.t3}`}>{f.hecho_por_nombre ?? '—'}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}

      {filas.length >= TOPE_DEL_REGISTRO && <p className={`text-center ${TIPO.s} ${TEXTO.t4}`}>Se muestran las últimas {TOPE_DEL_REGISTRO} acciones.</p>}

      {correo && verCorreo && (
        <Dialogo titulo={verCorreo.asunto ?? 'Correo enviado'} tono="cian" icono={Mail} caja="h-[85vh] max-w-[760px]" onCerrar={() => setCorreo(null)}>
          <p className={`px-3 py-1.5 ${TIPO.s} ${TEXTO.t3}`}>
            Para {verCorreo.para?.join(', ')}
            {verCorreo.cc?.length ? ` · copia a ${verCorreo.cc.join(', ')}` : ''}
          </p>
          <iframe srcDoc={verCorreo.cuerpo ?? ''} sandbox="" title="Correo enviado" className="min-h-0 w-full flex-1 border-0 bg-white" />
        </Dialogo>
      )}
    </div>
  )
}
