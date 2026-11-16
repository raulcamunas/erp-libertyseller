import type { SeccionCliente, VistaRemesas } from '@/components/remesas/comun/tipos-ui'
import { ESTADOS_ENVIO } from './vista'
import type { EstadoRemesa } from './flujo'

/**
 * QUÉ PANTALLA ABRE UNA URL DE REMESAS A FBA (spec remesas-pro §1.2 y §11 D37).
 * PURA: sin base de datos ni red. Se comprueba con vista-url.prueba.ts.
 *
 * Una sola ruta, `/dashboard/remesas`, con la vista en `?vista=` y, dentro de «cliente», la sección en `?seccion=`.
 * Los enlaces viejos los siguen mandando las alertas, la campana y los correos, así que se traducen aquí y en ningún otro sitio:
 *
 *   ?vista=envios      → cliente · envios
 *   ?vista=propuestas  → cliente · propuestas
 *   ?vista=inventario  → cliente · stock
 *   ?vista=base        → cliente · base        (si el cliente no tiene catálogo, la página cae a «envios»)
 *   ?vista=fases       → tablero · modo fases
 *   ?cliente=X sin vista            → cliente · envios (como hasta ahora)
 *   ?ia=1                           → cliente del enlace y se abre «Propuesta a medida (IA)» (solo agencia)
 *   ?remesa=R sin vista             → cliente, en «propuestas» o «envios» según el estado de la remesa
 *   ?envio=E                        → plan, con el envío propuesto abierto (solo agencia)
 *   sin nada                        → hoy (agencia) o cliente · resumen (cliente externo: «Mi stock»)
 *
 * El cliente externo no puede pedir hoy, plan, alertas ni la sección reposicion: se le lleva a su vista «cliente».
 * Sí conserva un tablero reducido de sus cuentas (D39), pero solo en modo envíos (sin fases).
 *
 * Lo que esta función NO comprueba: que el cliente de la URL exista y esté permitido, ni que tenga catálogo para «base».
 * Eso lo sabe la página, que tiene la lista de clientes de la sesión.
 */

export interface VistaPedida {
  vista: VistaRemesas
  seccion?: SeccionCliente
  clienteId?: string
  remesaId?: string
  envioId?: string
  abrirIa: boolean
  modo?: 'fases'
}

type Params = Record<string, string | string[] | undefined>

const VISTAS: readonly VistaRemesas[] = ['hoy', 'plan', 'cliente', 'tablero', 'alertas']
const SECCIONES: readonly SeccionCliente[] = ['resumen', 'stock', 'ventas', 'reposicion', 'envios', 'lotes', 'propuestas', 'base']

/** Los valores viejos de `?vista=` que eran secciones de un cliente */
const VISTAS_VIEJAS: Readonly<Record<string, SeccionCliente>> = {
  envios: 'envios',
  propuestas: 'propuestas',
  inventario: 'stock',
  base: 'base',
}

/** Lo que el cliente externo no puede abrir */
const VISTAS_SOLO_AGENCIA: readonly VistaRemesas[] = ['hoy', 'plan', 'alertas']
const SECCIONES_SOLO_AGENCIA: readonly SeccionCliente[] = ['reposicion']

/** El primer valor de un parámetro, recortado; vacío = no está */
function uno(v: string | string[] | undefined): string | undefined {
  const s = (Array.isArray(v) ? v[0] : v)?.trim()
  return s ? s : undefined
}

function esVista(v: string | undefined): v is VistaRemesas {
  return v !== undefined && (VISTAS as readonly string[]).includes(v)
}
function esSeccion(v: string | undefined): v is SeccionCliente {
  return v !== undefined && (SECCIONES as readonly string[]).includes(v)
}

/** Sección de una remesa por su estado: lo enviado está en «envios» y lo que se trabaja, en «propuestas» (como EspacioRemesas) */
export function seccionDeRemesa(estadoRemesa: string | null | undefined): SeccionCliente {
  if (!estadoRemesa) return 'envios'
  return (ESTADOS_ENVIO as readonly string[]).includes(estadoRemesa as EstadoRemesa) ? 'envios' : 'propuestas'
}

/**
 * Traduce los parámetros de la URL a la pantalla que hay que abrir.
 * `estadoRemesa` es el estado de la remesa de `?remesa=` si la página ya lo sabe (para elegir propuestas o envíos).
 */
export function vistaDesdeUrl(
  params: Params,
  actor: 'agencia' | 'cliente',
  estadoRemesa?: string | null,
): VistaPedida {
  const esCliente = actor === 'cliente'
  const vistaTxt = uno(params.vista)
  const seccionTxt = uno(params.seccion)
  const clienteId = uno(params.cliente)
  const remesaId = uno(params.remesa)
  const envioId = uno(params.envio)
  const modoTxt = uno(params.modo)
  const pideIa = uno(params.ia) === '1'

  const base = {
    ...(clienteId ? { clienteId } : {}),
    ...(remesaId ? { remesaId } : {}),
  }

  /** La sección pedida si es válida para quien mira; si no, la de por defecto */
  const seccionPara = (porDefecto: SeccionCliente): SeccionCliente => {
    const s = esSeccion(seccionTxt) ? seccionTxt : porDefecto
    return esCliente && SECCIONES_SOLO_AGENCIA.includes(s) ? 'resumen' : s
  }
  const aCliente = (porDefecto: SeccionCliente, abrirIa = false): VistaPedida => ({
    vista: 'cliente',
    seccion: seccionPara(porDefecto),
    ...base,
    abrirIa,
  })

  // 1. Un envío propuesto (la campana, el chat, el push): el plan con su panel abierto. Solo agencia.
  if (envioId && !esCliente) {
    return { vista: 'plan', ...(clienteId ? { clienteId } : {}), envioId, abrirIa: false }
  }

  // 2. «Propuesta a medida (IA)» desde una alerta: la pantalla del cliente con el diálogo abierto. El cliente externo no la ve.
  if (pideIa) {
    return aCliente(remesaId ? seccionDeRemesa(estadoRemesa) : 'propuestas', !esCliente)
  }

  // 3. Los enlaces viejos, que eran secciones del cliente
  if (vistaTxt && VISTAS_VIEJAS[vistaTxt]) {
    const s = VISTAS_VIEJAS[vistaTxt]
    return { vista: 'cliente', seccion: esCliente && SECCIONES_SOLO_AGENCIA.includes(s) ? 'resumen' : s, ...base, abrirIa: false }
  }
  if (vistaTxt === 'fases') {
    return esCliente ? { vista: 'tablero', ...base, abrirIa: false } : { vista: 'tablero', ...base, abrirIa: false, modo: 'fases' }
  }

  // 4. Las vistas de ahora
  if (esVista(vistaTxt)) {
    if (esCliente && VISTAS_SOLO_AGENCIA.includes(vistaTxt)) return aCliente('resumen')
    if (vistaTxt === 'cliente') return aCliente(remesaId ? seccionDeRemesa(estadoRemesa) : 'resumen')
    if (vistaTxt === 'tablero') {
      return !esCliente && modoTxt === 'fases' ? { vista: 'tablero', ...base, abrirIa: false, modo: 'fases' } : { vista: 'tablero', ...base, abrirIa: false }
    }
    return { vista: vistaTxt, ...base, abrirIa: false }
  }

  // 5. Sin vista (o una que no existe): lo que pida el resto de la URL
  if (remesaId) return aCliente(seccionDeRemesa(estadoRemesa))
  if (clienteId) return aCliente('envios')
  if (esSeccion(seccionTxt)) return aCliente('resumen')

  // 6. Sin nada: la pantalla de entrada de cada uno
  return esCliente ? aCliente('resumen') : { vista: 'hoy', abrirIa: false }
}
