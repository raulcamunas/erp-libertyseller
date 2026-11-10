'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FlaskConical, ClipboardSignature, LayoutDashboard, ListTree, Package, Rocket, ScrollText } from 'lucide-react'
import { CAMPO, PANTALLA, TEXTO, TIPO, TITULO, BOTON } from '@/lib/estilo/denso'
import { Vacio } from '@/components/plataforma/comun'
import { PestanaResumen } from './PestanaResumen'
import { PestanaCampanas } from './PestanaCampanas'
import { PestanaFicha } from './PestanaFicha'
import { PestanaProductos } from './PestanaProductos'
import { PestanaCrear } from './PestanaCrear'
import { PestanaLog } from './PestanaLog'

interface Props {
  clientes: Array<{ slug: string; nombre: string }>
  cliente: { slug: string; nombre: string }
  cuentas: Array<{ id: string; pais: string; moneda: string | null; nombre: string | null }>
  cuentaId: string | null
  pestana: string
}

const PESTANAS = [
  { id: 'resumen', nombre: 'Resumen', icono: LayoutDashboard },
  { id: 'campanas', nombre: 'Campañas', icono: ListTree },
  { id: 'ficha', nombre: 'Ficha de cuenta', icono: ClipboardSignature },
  { id: 'productos', nombre: 'Productos', icono: Package },
  { id: 'crear', nombre: 'Crear campañas', icono: Rocket },
  { id: 'log', nombre: 'Log de cambios', icono: ScrollText },
] as const

type IdPestana = (typeof PESTANAS)[number]['id']

/**
 * MARKETING TEST — el armazón: cliente y cuenta de anunciante (país) arriba, y las cuatro pestañas. Funciona como Growth Partner: lo elegido viaja en la dirección (?c=cliente&p=cuenta&t=pestaña)
 * y por eso cambiar de pestaña no olvida sobre quién se trabaja.
 */
export function MarketingTest({ clientes, cliente, cuentas, cuentaId, pestana }: Props) {
  const router = useRouter()
  // La pestaña se cambia SIN pasar por el servidor: la dirección se actualiza a mano y no se vuelve a pedir la página (eso era lo que hacía que todo «parpadeara» al cambiar)
  const [activa, setActiva] = useState<IdPestana>(PESTANAS.some((p) => p.id === pestana) ? (pestana as IdPestana) : 'resumen')
  const irAPestana = (t: string) => {
    if (!PESTANAS.some((p) => p.id === t)) return
    setActiva(t as IdPestana)
    const q = new URLSearchParams(window.location.search)
    q.set('t', t)
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`)
  }
  const cuenta = cuentas.find((c) => c.id === cuentaId) ?? null

  const url = (cambios: { c?: string; p?: string | null; t?: string }) => {
    const q = new URLSearchParams()
    q.set('c', cambios.c ?? cliente.slug)
    const p = cambios.p === undefined ? cuentaId : cambios.p
    if (p) q.set('p', p)
    q.set('t', cambios.t ?? activa)
    return `/dashboard/marketing-test?${q.toString()}`
  }

  return (
    <div className={`${PANTALLA.cuerpo} h-full`}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-[6px] min-w-0 lg:pr-36">
        <h1 className={`${TITULO.pantalla} flex shrink-0 items-center gap-[6px]`}>
          <FlaskConical className="h-4 w-4" /> Marketing Test
        </h1>
        <label className="flex min-w-0 items-center gap-[6px]">
          <span className={`${TIPO.xs} ${TEXTO.t4} shrink-0`}>Cliente</span>
          <select value={cliente.slug} onChange={(e) => router.replace(url({ c: e.target.value, p: null }), { scroll: false })} className={`${CAMPO.input} max-w-[260px]`}>
            {clientes.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        {cuentas.length > 0 && (
          <label className="flex min-w-0 items-center gap-[6px]">
            <span className={`${TIPO.xs} ${TEXTO.t4} shrink-0`}>Cuenta de anunciante</span>
            <select value={cuentaId ?? ''} onChange={(e) => router.replace(url({ p: e.target.value }), { scroll: false })} className={`${CAMPO.input} max-w-[200px]`}>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.pais}
                  {c.moneda ? ` · ${c.moneda}` : ''}
                  {c.nombre ? ` · ${c.nombre}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className={`${TIPO.xs} ${TEXTO.t4}`}>Escribe en la cuenta de publicidad del cliente · solo administradores</span>
      </div>

      <nav className="flex shrink-0 flex-wrap items-center gap-[4px] min-w-0" aria-label="Marketing Test">
        {PESTANAS.map((p) => {
          const Icono = p.icono
          const encendida = p.id === activa
          return (
            <button key={p.id} type="button" onClick={() => irAPestana(p.id)} className={`${BOTON.chip} ${encendida ? BOTON.chipEncendido : ''}`} aria-current={encendida ? 'page' : undefined}>
              <Icono className="h-[13px] w-[13px] shrink-0" />
              {p.nombre}
            </button>
          )
        })}
      </nav>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {!cuenta ? (
          <Vacio icono={<FlaskConical />} titulo="Este cliente no tiene ninguna cuenta de anunciante en uso">
            Se encienden («Se usa») en <strong>Amazon API · Publicidad</strong>.
          </Vacio>
        ) : activa === 'resumen' ? (
          <PestanaResumen key={cuenta.id} perfilId={cuenta.id} moneda={cuenta.moneda} irA={irAPestana} />
        ) : activa === 'campanas' ? (
          <PestanaCampanas key={cuenta.id} perfilId={cuenta.id} moneda={cuenta.moneda} />
        ) : activa === 'ficha' ? (
          <PestanaFicha key={cuenta.id} perfilId={cuenta.id} />
        ) : activa === 'productos' ? (
          <PestanaProductos key={cuenta.id} perfilId={cuenta.id} pais={cuenta.pais} moneda={cuenta.moneda} />
        ) : activa === 'crear' ? (
          <PestanaCrear key={cuenta.id} perfilId={cuenta.id} moneda={cuenta.moneda} irA={irAPestana} />
        ) : (
          <PestanaLog key={cuenta.id} perfilId={cuenta.id} />
        )}
      </div>
    </div>
  )
}
