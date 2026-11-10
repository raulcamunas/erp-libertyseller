'use client'

import { useEffect, useState } from 'react'
import { FlaskConical, ClipboardSignature, LayoutDashboard, ListTree, Package, Rocket, ScrollText, Sparkles } from 'lucide-react'
import { CAMPO, PANTALLA, TEXTO, TIPO, TITULO, BOTON } from '@/lib/estilo/denso'
import { Vacio } from '@/components/plataforma/comun'
import { nombreDePais } from '@/lib/ads/paises'
import { AvatarDeCliente, BarraDeClientes, type ClienteDeBarra } from './BarraDeClientes'
import { bandera } from './piezas'
import { PestanaResumen } from './PestanaResumen'
import { PestanaCampanas } from './PestanaCampanas'
import { PestanaPropuestas } from './PestanaPropuestas'
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
  { id: 'propuestas', nombre: 'Propuestas', icono: Sparkles },
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

      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {/* ---- la cabecera: quién y dónde ---- */}
        <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 pb-3 lg:pr-36">
          <div className="flex min-w-0 items-center gap-3">
            <AvatarDeCliente slug={cliente.slug} nombre={cliente.nombre} tamano={38} />
            <div className="min-w-0">
              <h1 className="truncate text-[19px] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--ls-t1)]">{cliente.nombre}</h1>
              {cuenta && (
                <div className="mt-[2px] flex flex-wrap items-center gap-[6px] text-[12px] text-[var(--ls-t3)]">
                  <span aria-hidden>{bandera(cuenta.pais)}</span>
                  <span className="font-medium text-[var(--ls-t2)]">{nombreDePais(cuenta.pais)}</span>
                  <span className="text-[var(--ls-t4)]">·</span>
                  <span>{cuenta.moneda ?? ''}</span>
                  {cuenta.nombre && (
                    <>
                      <span className="text-[var(--ls-t4)]">·</span>
                      <span className="truncate">Cuenta {cuenta.nombre}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <span className="inline-flex h-[22px] items-center gap-[5px] rounded-full border border-[var(--ls-linea2)] px-[9px] text-[11px] font-medium text-[var(--ls-t3)]" title="Desde aquí se escribe en la cuenta de publicidad del cliente: solo administradores">
            <FlaskConical className="h-3 w-3" /> En pruebas · solo administradores
          </span>

          {/* En el móvil la barra no cabe: estos dos desplegables hacen su papel */}
          <div className="flex w-full flex-wrap gap-2 md:hidden">
            <select value={cliente.slug} onChange={(e) => elegir(e.target.value, clientes.find((c) => c.slug === e.target.value)?.cuentas[0]?.id ?? null)} className={`${CAMPO.input} max-w-[200px]`} aria-label="Cliente">
              {clientes.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.nombre}
                </option>
              ))}
            </select>
            {cliente.cuentas.length > 1 && (
              <select value={cuenta?.id ?? ''} onChange={(e) => elegir(cliente.slug, e.target.value)} className={`${CAMPO.input} max-w-[160px]`} aria-label="País">
                {cliente.cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nombreDePais(c.pais)}
                  </option>
                ))}
              </select>
            )}
          </div>
        </header>

        {/* ---- las pestañas: subrayadas, como en la consola de Amazon Ads ---- */}
        <nav className="-mx-1 flex shrink-0 items-end gap-1 overflow-x-auto border-b border-[var(--ls-linea)] px-1" aria-label="Marketing Test">
          {PESTANAS.map((p) => {
            const Icono = p.icono
            const encendida = p.id === activa
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => irAPestana(p.id)}
                aria-current={encendida ? 'page' : undefined}
                className={`relative inline-flex h-[38px] shrink-0 items-center gap-[7px] rounded-t-[8px] px-3 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ls-acc-graf)] ${
                  encendida ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]'
                }`}
              >
                <Icono className={`h-[14px] w-[14px] shrink-0 ${encendida ? 'text-[var(--ls-acc)]' : ''}`} />
                {p.nombre}
                {encendida && <span aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[var(--ls-acc-graf)]" />}
              </button>
            )
          })}
        </nav>

        <div className="min-h-0 min-w-0 flex-1 overflow-auto pt-4">
          {!cuenta ? (
            <Vacio icono={<FlaskConical />} titulo="Este cliente no tiene ninguna cuenta de anunciante en uso">
              Se encienden («Se usa») en <strong>Amazon API · Publicidad</strong>.
            </Vacio>
          ) : activa === 'resumen' ? (
            <PestanaResumen key={cuenta.id} perfilId={cuenta.id} moneda={cuenta.moneda} irA={irAPestana} />
          ) : activa === 'campanas' ? (
            <PestanaCampanas key={cuenta.id} perfilId={cuenta.id} moneda={cuenta.moneda} irA={irAPestana} />
          ) : activa === 'propuestas' ? (
            <PestanaPropuestas key={cuenta.id} perfilId={cuenta.id} moneda={cuenta.moneda} irA={irAPestana} />
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
