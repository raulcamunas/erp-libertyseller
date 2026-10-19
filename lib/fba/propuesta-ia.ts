import { createServiceClient } from '@/lib/supabase/service'
import { construirIndice } from './catalogo/indice'
import { listarCatalogo } from './catalogo/servidor'
import { esClienteConCatalogo } from './catalogo/tipos'
import { construirMensajes, type ExtraCatalogo } from './ia-prompt'
import { pedirPropuestaIa } from './ia-reposicion'
import { enviosDelCliente, inventarioDeCliente } from './inventario-datos'
import {
  ajustarATope,
  combinarConIa,
  plazoDeEnvios,
  seleccionarCandidatas,
  type DescartadaGenerada,
  type LineaGenerada,
  type ParametrosReposicion,
  type PlazoDeEnvios,
} from './reposicion'

/**
 * UNA PROPUESTA DE REPOSICIÓN, DE PUNTA A PUNTA.
 * ==============================================
 * SOLO SERVIDOR. Junta las piezas —cada una se prueba sola—:
 *
 *   inventario (lib/fba/inventario.ts)         qué hay, qué se vende, qué lleva parado
 *   candidatas (lib/fba/reposicion.ts)         qué referencias merece la pena analizar
 *   la IA      (lib/fba/ia-reposicion.ts)      qué haría un planificador con criterio
 *   la mezcla  (lib/fba/reposicion.ts)         lo que diga la IA, comprobado
 *
 * y devuelve la propuesta LISTA PARA REVISAR: no escribe nada en la base. Crear la remesa
 * es otro paso, y es de la persona que ha mirado las líneas y ha corregido lo que no le
 * convence (la pantalla de revisión). Una IA que crea envíos sin que nadie los vea sería
 * muy rápida y muy poco de fiar.
 */

export class ErrorDePropuesta extends Error {
  constructor(
    message: string,
    readonly estado = 400
  ) {
    super(message)
    this.name = 'ErrorDePropuesta'
  }
}

export interface PropuestaGenerada {
  clienteId: string
  hoy: string
  /** ISO */
  generadaEn: string
  lineas: LineaGenerada[]
  descartadas: DescartadaGenerada[]
  resumen: string | null
  estrategia: string | null
  riesgos: string[]
  dudas: string[]
  /** Cosas que decir sobre cómo se ha montado: recortes, tope, referencias sin comentario */
  notas: string[]
  ia: { usada: boolean; modelo: string | null; aviso: string | null; tokens: { entrada: number; salida: number } | null }
  parametros: ParametrosReposicion
  plazo: PlazoDeEnvios
  /** Referencias que se han analizado, las que tienen stock y no hace falta reponer, y las que no han cabido */
  analizadas: number
  sinNecesidad: number
  quedanFuera: number
  libro: 'ok' | 'corto' | 'sin_leer'
  /** Hasta qué día llegan las ventas con las que se ha calculado ('YYYY-MM-DD'). Lo posterior no cuenta */
  leidoHasta: string | null
  avisosInventario: string[]
}

export async function generarPropuestaIa(entrada: {
  clienteId: string
  clienteNombre: string
  parametros: ParametrosReposicion
  hoy: string
  usarIa?: boolean
}): Promise<PropuestaGenerada> {
  const service = createServiceClient()
  const { clienteId, clienteNombre, parametros, hoy } = entrada

  const inventario = await inventarioDeCliente(clienteId, { hoy })
  if (!inventario.conectado) {
    throw new ErrorDePropuesta('Este cliente no tiene la cuenta de Amazon conectada: sin ella no hay inventario ni ventas con las que proponer nada.', 409)
  }
  if (inventario.libro === 'sin_leer') {
    throw new ErrorDePropuesta(
      'Todavía no se ha leído el libro mayor de Amazon de este cliente: sin las ventas no se puede calcular qué reponer. Se lee solo una vez al día; si acaba de conectarse, espera a la siguiente lectura.',
      409
    )
  }

  const envios = await enviosDelCliente(service, clienteId)
  const plazo = plazoDeEnvios(envios)
  const seleccion = seleccionarCandidatas(inventario, parametros)

  /* ---------- lo que sabe de las referencias el catálogo propio del cliente (ShoesF) ---------- */
  const extras = new Map<string, ExtraCatalogo>()
  const fichas = new Map<string, { ref: string; nombre: string; talla: string; ean: string | null; fnsku: string | null; asin: string | null }>()
  if (esClienteConCatalogo(clienteNombre)) {
    const { filas } = await listarCatalogo(service, clienteId)
    const indice = construirIndice(filas)
    for (const c of seleccion.candidatas) {
      const f = indice.porSku.get(c.sku.sku)
      if (!f) continue
      extras.set(c.sku.sku, { modelo: `${f.ref} ${f.nombre}`.trim(), talla: f.talla, continuidad: f.continuidad })
      fichas.set(c.sku.sku, { ref: f.ref, nombre: f.nombre, talla: f.talla, ean: f.ean, fnsku: f.fnsku, asin: f.asin })
    }
  }

  /* ---------- la IA, si se pide y hay algo que analizar ---------- */
  let respuesta = null as Awaited<ReturnType<typeof pedirPropuestaIa>>['respuesta']
  let modelo: string | null = null
  let aviso: string | null = null
  let tokens: { entrada: number; salida: number } | null = null
  if (entrada.usarIa !== false && seleccion.candidatas.length > 0) {
    const mensajes = construirMensajes({ clienteNombre, hoy, inventario, seleccion, parametros, plazo, extras })
    const r = await pedirPropuestaIa(mensajes)
    respuesta = r.respuesta
    modelo = r.modelo
    aviso = r.aviso
    tokens = r.tokens
  } else if (entrada.usarIa === false) {
    aviso = 'Propuesta calculada sin la IA, como se pidió.'
  }

  /* ---------- la IA propone, el cálculo comprueba ---------- */
  const mezcla = combinarConIa(seleccion.candidatas, respuesta, parametros)
  const tope = ajustarATope(mezcla.lineas, parametros.topeUnidades, parametros.multiplo)
  const notas = [...mezcla.notas]
  if (tope.nota) notas.push(tope.nota)
  if (seleccion.quedanFuera > 0) {
    notas.push(`Hay ${seleccion.quedanFuera} referencias más que también piden envío y no han cabido en el análisis: se miran en el siguiente.`)
  }

  /* ---------- las líneas, con los datos que necesita una remesa ---------- */
  const lineas = tope.lineas.map((l) => {
    const f = fichas.get(l.sku)
    return f
      ? { ...l, referencia: f.ref, nombre: f.nombre, variante: f.talla, ean: f.ean, fnsku: f.fnsku ?? l.fnsku, asin: f.asin ?? l.asin }
      : l
  })

  return {
    clienteId,
    hoy,
    generadaEn: new Date().toISOString(),
    lineas,
    descartadas: [...mezcla.descartadas, ...tope.fuera],
    resumen: respuesta?.resumen || null,
    estrategia: respuesta?.estrategia || null,
    riesgos: respuesta?.riesgos ?? [],
    dudas: respuesta?.dudas ?? [],
    notas,
    ia: { usada: respuesta !== null, modelo: respuesta ? modelo : null, aviso, tokens },
    parametros,
    plazo,
    analizadas: seleccion.candidatas.length,
    sinNecesidad: seleccion.sinNecesidad,
    quedanFuera: seleccion.quedanFuera,
    libro: inventario.libro,
    leidoHasta: inventario.leidoHasta,
    avisosInventario: inventario.avisos,
  }
}
