'use client'

import { useEffect, useState } from 'react'
import { Bot, ClipboardSignature, LayoutDashboard, ListTree, Megaphone, Package, Rocket, ScrollText, Sparkles } from 'lucide-react'
import { CAMPO } from '@/lib/estilo/denso'
import { CabeceraDeModulo, EstadoVacio, Insignia, Pestanas } from '@/components/ui-ls'
import { nombreDePais } from '@/lib/ads/paises'
import { BarraDeClientes, type ClienteDeBarra } from './BarraDeClientes'
import { bandera } from './piezas'
import { PestanaResumen } from './PestanaResumen'
import { PestanaAgente } from './PestanaAgente'
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
  { id: 'agente', nombre: 'Agente', icono: Bot },
  { id: 'campanas', nombre: 'Campañas', icono: ListTree },
  { id: 'propuestas', nombre: 'Propuestas', icono: Sparkles },
  { id: 'ficha', nombre: 'Ficha de cuenta', icono: ClipboardSignature },
  { id: 'productos', nombre: 'Productos', icono: Package },
  { id: 'crear', nombre: 'Crear campañas', icono: Rocket },
  { id: 'log', nombre: 'Log de cambios', icono: ScrollText },
] as const

type IdPestana = (typeof PESTANAS)[number]['id']

/**
 * MARKETING TEST — el armazón: cliente y cuenta de anunciante (país) arriba, y las pestañas (la segunda, «Agente», es el agente PPC). Funciona como Growth Partner: lo elegido viaja en la dirección (?c=cliente&p=cuenta&t=pestaña)
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
    if (t === activa) return
    setActiva(t as IdPestana)
    escribirUrl(cliente.slug, cuenta?.id ?? null, t)
  }

  // Alto fijo y scroll interno solo desde lg (escritorio). Por debajo todo fluye con el scroll de la ventana (ver app/dashboard/marketing-test/page.tsx): una caja con scroll
  // propio dentro de una página que también se desliza es lo que en el móvil «se pillaba»
  return (
    <div className="flex min-w-0 gap-3 lg:h-full lg:min-h-0">
      <BarraDeClientes clientes={clientes} clienteSlug={cliente.slug} cuentaId={cuenta?.id ?? null} colapsada={colapsada} alternar={alternarBarra} elegir={elegir} />

      <div className="flex min-w-0 flex-1 flex-col lg:h-full lg:min-h-0">
        {/* ---- la cabecera del módulo (kit): quién y dónde, y las pestañas con su indicador animado ---- */}
        <div className="shrink-0 lg:pr-36">
          <CabeceraDeModulo
            icono={Megaphone}
            acento="marketing"
            pegajosa={false}
            className="!mb-3"
            titulo={cliente.nombre}
            subtitulo={
              cuenta ? (
                <span className="inline-flex min-w-0 flex-wrap items-center gap-[6px]">
                  <span aria-hidden>{bandera(cuenta.pais)}</span>
                  <span className="font-medium text-[var(--ls-t2)]">{nombreDePais(cuenta.pais)}</span>
                  {cuenta.moneda && <span className="text-[var(--ls-t4)]">· {cuenta.moneda}</span>}
                  {cuenta.nombre && <span className="truncate text-[var(--ls-t4)]">· Cuenta {cuenta.nombre}</span>}
                </span>
              ) : (
                'Sin cuenta de anunciante en uso'
              )
            }
            junto={<Insignia tono="naranja" tamano="sm" variante="contorno">PPC · Amazon Ads</Insignia>}
            debajo={
              <>
                {/* En el móvil la barra de clientes no cabe: estos dos desplegables hacen su papel */}
                <div className="mb-3 flex w-full flex-wrap gap-2 md:hidden">
                  <select value={cliente.slug} onChange={(e) => elegir(e.target.value, clientes.find((c) => c.slug === e.target.value)?.cuentas[0]?.id ?? null)} className={`${CAMPO.input} min-h-[44px] min-w-0 flex-1 text-[14px]`} aria-label="Cliente">
                    {clientes.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                  {cliente.cuentas.length > 1 && (
                    <select value={cuenta?.id ?? ''} onChange={(e) => elegir(cliente.slug, e.target.value)} className={`${CAMPO.input} min-h-[44px] w-[140px] text-[14px]`} aria-label="País">
                      {cliente.cuentas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {nombreDePais(c.pais)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <Pestanas etiqueta="PPC · Amazon Ads" acento="marketing" idPanel="panel-ppc" opciones={PESTANAS.map((p) => ({ id: p.id, texto: p.nombre, icono: p.icono }))} valor={activa} onCambio={irAPestana} />
              </>
            }
          />
        </div>

        <div className="min-w-0 flex-1 pt-1 lg:min-h-0 lg:overflow-auto" id="panel-ppc" role="tabpanel">
          {!cuenta ? (
            <EstadoVacio icono={Megaphone} acento="marketing" titulo="Este cliente no tiene ninguna cuenta de anunciante en uso" descripcion="Se encienden («Se usa») en Amazon API · Publicidad." />
          ) : activa === 'resumen' ? (
            <PestanaResumen key={cuenta.id} perfilId={cuenta.id} moneda={cuenta.moneda} irA={irAPestana} />
          ) : activa === 'agente' ? (
            <PestanaAgente key={cuenta.id} perfilId={cuenta.id} moneda={cuenta.moneda} irA={irAPestana} />
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
            <PestanaLog key={cuenta.id} perfilId={cuenta.id} irA={irAPestana} />
          )}
        </div>
      </div>
    </div>
  )
}
