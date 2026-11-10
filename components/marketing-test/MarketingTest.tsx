'use client'

import { useEffect, useState } from 'react'
import { FlaskConical, ClipboardSignature, LayoutDashboard, ListTree, Package, Rocket, ScrollText } from 'lucide-react'
import { CAMPO, PANTALLA, TEXTO, TIPO, TITULO, BOTON } from '@/lib/estilo/denso'
import { Vacio } from '@/components/plataforma/comun'
import { nombreDePais } from '@/lib/ads/paises'
import { BarraDeClientes, type ClienteDeBarra } from './BarraDeClientes'
import { PestanaResumen } from './PestanaResumen'
import { PestanaCampanas } from './PestanaCampanas'
import { PestanaFicha } from './PestanaFicha'
import { PestanaProductos } from './PestanaProductos'
import { PestanaCrear } from './PestanaCrear'
import { PestanaLog } from './PestanaLog'

interface Props {
  clientes: ClienteDeBarra[]
  clienteInicial: string
  cuentaInicial: string | null
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
export function MarketingTest({ clientes, clienteInicial, cuentaInicial, pestana }: Props) {
  // TODO lo elegido vive aquí y se refleja en la dirección SIN pasar por el servidor: la pantalla ya tiene todos los clientes y sus cuentas, así que cambiar de cliente, de país o de pestaña es instantáneo
  const [clienteSlug, setClienteSlug] = useState(clienteInicial)
  const [cuentaId, setCuentaId] = useState<string | null>(cuentaInicial)
  const [activa, setActiva] = useState<IdPestana>(PESTANAS.some((p) => p.id === pestana) ? (pestana as IdPestana) : 'resumen')
  const [colapsada, setColapsada] = useState(false)

  // La barra plegada se recuerda en este navegador (una comodidad: si no se puede leer o guardar, se queda desplegada)
  useEffect(() => {
    try {
      setColapsada(window.localStorage.getItem('mt-lateral') === '1')
    } catch {
      /* sin almacenamiento: desplegada */
    }
  }, [])
  const alternarBarra = () =>
    setColapsada((v) => {
      try {
        window.localStorage.setItem('mt-lateral', v ? '0' : '1')
      } catch {
        /* nada */
      }
      return !v
    })

  const cliente = clientes.find((c) => c.slug === clienteSlug) ?? clientes[0]
  const cuenta = cliente?.cuentas.find((c) => c.id === cuentaId) ?? cliente?.cuentas[0] ?? null

  const escribirUrl = (c: string, p: string | null, t: string) => {
    const q = new URLSearchParams(window.location.search)
    q.set('c', c)
    if (p) q.set('p', p)
    else q.delete('p')
    q.set('t', t)
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`)
  }
  const elegir = (slug: string, id: string | null) => {
    setClienteSlug(slug)
    setCuentaId(id)
    escribirUrl(slug, id, activa)
  }
  const irAPestana = (t: string) => {
    if (!PESTANAS.some((p) => p.id === t)) return
    setActiva(t as IdPestana)
    escribirUrl(cliente.slug, cuenta?.id ?? null, t)
  }

  return (
    <div className="flex h-full min-h-0 gap-3">
      <BarraDeClientes clientes={clientes} clienteSlug={cliente.slug} cuentaId={cuenta?.id ?? null} colapsada={colapsada} alternar={alternarBarra} elegir={elegir} />

      <div className={`${PANTALLA.cuerpo} h-full flex-1`}>
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-[6px] min-w-0 lg:pr-36">
          <h1 className={`${TITULO.pantalla} flex shrink-0 items-center gap-[6px]`}>
            <FlaskConical className="h-4 w-4 md:hidden" /> {cliente.nombre}
          </h1>
          {cuenta && (
            <span className={`${TIPO.s} ${TEXTO.t3}`}>
              {nombreDePais(cuenta.pais)} · {cuenta.moneda ?? ''}
              {cuenta.nombre ? ` · ${cuenta.nombre}` : ''}
            </span>
          )}
          {/* En el móvil la barra no cabe: estos dos desplegables hacen su papel */}
          <label className="flex min-w-0 items-center gap-[6px] md:hidden">
            <span className={`${TIPO.xs} ${TEXTO.t4} shrink-0`}>Cliente</span>
            <select value={cliente.slug} onChange={(e) => elegir(e.target.value, clientes.find((c) => c.slug === e.target.value)?.cuentas[0]?.id ?? null)} className={`${CAMPO.input} max-w-[200px]`}>
              {clientes.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
          {cliente.cuentas.length > 1 && (
            <label className="flex min-w-0 items-center gap-[6px] md:hidden">
              <span className={`${TIPO.xs} ${TEXTO.t4} shrink-0`}>País</span>
              <select value={cuenta?.id ?? ''} onChange={(e) => elegir(cliente.slug, e.target.value)} className={`${CAMPO.input} max-w-[160px]`}>
                {cliente.cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nombreDePais(c.pais)}
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
            <PestanaCampanas key={cuenta.id} perfilId={cuenta.id} moneda={cuenta.moneda} irA={irAPestana} />
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
    </div>
  )
}
