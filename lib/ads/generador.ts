/**
 * INFORMES DE MARKETING · EL PROCESO QUE LOS PREPARA
 * =================================================
 * SOLO SERVIDOR.
 *
 * Un encargo son varias peticiones a Amazon, y cada una va en tres pasos:
 *
 *     pendiente  ──pedir──▶  pedido  ──preguntar──▶  listo
 *                                    └──────────────▶  error / sin_datos
 *
 * Entre «pedido» y «listo» pasan de diez segundos a varios minutos, así que
 * ninguna petición HTTP puede esperar a que termine. Este fichero da UN EMPUJÓN:
 * mira todas las partes que quedan, pide las que no se han pedido y pregunta por
 * las que sí. Lo llama un cron cada pocos minutos hasta que no queda nada.
 *
 *
 * ============ POR QUÉ UN EMPUJÓN Y NO UN BUCLE QUE ESPERE ============
 *
 * Porque un bucle que espera es un proceso que se cae con el contenedor y deja
 * el encargo colgado sin que nadie sepa por dónde iba. Aquí el estado vive
 * ENTERO en la base: si esto se muere a mitad, la pasada siguiente recoge donde
 * estaba mirando las filas. No hay nada en memoria que perder.
 *
 *
 * ============ LO QUE NO SE GUARDA ============
 *
 * Las filas. Un informe de términos de búsqueda de un mes son decenas de miles,
 * y multiplicado por doce informes y por cada encargo sería llenar la base de
 * copias de algo que Amazon ya tiene.
 *
 * Se guarda el `report_id`. Preguntando por él se obtiene una URL NUEVA cada
 * vez: la URL caduca a los pocos minutos, el informe no. El Excel se arma al
 * descargarlo, con los datos recién traídos — que además es lo correcto, porque
 * Amazon corrige atribuciones hacia atrás durante días.
 */

import { gunzipSync } from 'node:zlib'
import { createServiceClient } from '@/lib/supabase/service'
import { llamarAds } from './datos'
import { AdsError } from './oauth'
import { PLANTILLAS_POR_ID } from './plantillas'

const TIPO_PETICION = 'application/vnd.createasyncreportrequest.v3+json'

/**
 * Cuántas veces se reintenta una parte que da error antes de rendirse.
 *
 * Tres, y no más: los errores de esta API son casi siempre de configuración
 * —una columna que ese tipo de informe no tiene— y reintentar eso cien veces es
 * gastar cupo para recibir el mismo 400. Lo que sí arregla un reintento es un
 * 429 o un corte de red, y para eso tres sobran.
 */
const MAX_INTENTOS = 3

interface FilaParte {
  id: string
  informe_id: string
  plantilla: string
  report_type_id: string
  ad_product: string
  columnas: string[]
  hoja: string
  report_id: string | null
  estado: string
  intentos: number
}

interface FilaInforme {
  id: string
  perfil_id: string
  desde: string
  hasta: string
  plantillas: string[]
  estado: string
}

interface Perfil {
  profile_id: number
  connection_id: string
  nombre: string
  pais: string | null
  moneda: string | null
}

async function perfilDe(perfilId: string): Promise<Perfil> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('ads_profiles')
    .select('profile_id, connection_id, nombre, pais, moneda')
    .eq('id', perfilId)
    .single()
  if (error) throw error
  return data as unknown as Perfil
}

/* ------------------------------------------------------------------ */
/* Encargar                                                            */
/* ------------------------------------------------------------------ */

export async function encargar(params: {
  perfilId: string
  desde: string
  hasta: string
  plantillas: string[]
  usuario: string | null
}): Promise<string> {
  const service = createServiceClient()

  // Se expanden AQUÍ, al encargar, y no al procesar. Ver el comentario de la
  // columna `columnas` en la migración: un encargo tiene que poder explicarse
  // solo aunque mañana se cambie el catálogo.
  const partes: Omit<FilaParte, 'id' | 'informe_id' | 'report_id' | 'estado' | 'intentos'>[] = []
  for (const id of params.plantillas) {
    const p = PLANTILLAS_POR_ID.get(id)
    if (!p || p.imposible) continue
    for (const v of p.variantes) {
      partes.push({
        plantilla: p.id,
        report_type_id: v.reportTypeId,
        ad_product: v.adProduct,
        columnas: v.columns,
        hoja: v.hoja,
      })
    }
  }

  if (partes.length === 0) {
    throw new Error(
      'Ninguna de las plantillas elegidas se puede pedir con las cuentas conectadas. Las de ' +
        'Amazon DSP necesitan otro producto y otra autorización.'
    )
  }

  const { data, error } = await service
    .from('marketing_informes')
    .insert({
      perfil_id: params.perfilId,
      desde: params.desde,
      hasta: params.hasta,
      plantillas: params.plantillas,
      pedido_por: params.usuario,
    })
    .select('id')
    .single()
  if (error) throw error
  const informeId = (data as { id: string }).id

  const { error: errorPartes } = await service
    .from('marketing_informe_partes')
    .insert(partes.map((p) => ({ ...p, informe_id: informeId })))
  if (errorPartes) throw errorPartes

  return informeId
}

/* ------------------------------------------------------------------ */
/* El empujón                                                          */
/* ------------------------------------------------------------------ */

export interface Empujon {
  informes: number
  pedidas: number
  listas: number
  fallidas: number
  esperando: number
}

/**
 * Avanza todo lo que esté a medias.
 *
 * `tope` acota cuántas peticiones NUEVAS se hacen en esta pasada. Existe porque
 * la API de Ads tiene cupo y porque un encargo de quince informes lanzado de
 * golpe se lleva por delante los de los otros clientes que estuvieran en cola.
 * Preguntar por los ya pedidos no cuenta: eso es barato y es lo que hace avanzar
 * lo que ya está en marcha.
 */
export async function empujar(tope = 6): Promise<Empujon> {
  const service = createServiceClient()
  const salida: Empujon = { informes: 0, pedidas: 0, listas: 0, fallidas: 0, esperando: 0 }

  const { data: informes, error } = await service
    .from('marketing_informes')
    .select('id, perfil_id, desde, hasta, plantillas, estado')
    .in('estado', ['pendiente', 'preparando'])
    .order('pedido_at', { ascending: true })
  if (error) throw error

  let presupuesto = tope

  for (const inf of (informes ?? []) as unknown as FilaInforme[]) {
    salida.informes += 1
    const perfil = await perfilDe(inf.perfil_id)

    await service
      .from('marketing_informes')
      .update({ estado: 'preparando', tocado_at: new Date().toISOString() })
      .eq('id', inf.id)

    const { data: partes } = await service
      .from('marketing_informe_partes')
      .select('*')
      .eq('informe_id', inf.id)

    for (const parte of (partes ?? []) as unknown as FilaParte[]) {
      if (parte.estado === 'listo' || parte.estado === 'sin_datos') continue
      if (parte.estado === 'error' && parte.intentos >= MAX_INTENTOS) continue

      /* ---- Todavía no se ha pedido ---- */
      if (!parte.report_id) {
        if (presupuesto <= 0) {
          salida.esperando += 1
          continue
        }
        presupuesto -= 1
        try {
          const reportId = await pedir(perfil, parte, inf.desde, inf.hasta)
          await service
            .from('marketing_informe_partes')
            .update({
              report_id: reportId,
              estado: 'pedido',
              error: null,
              actualizado_at: new Date().toISOString(),
            })
            .eq('id', parte.id)
          salida.pedidas += 1
        } catch (e) {
          await service
            .from('marketing_informe_partes')
            .update({
              estado: 'error',
              error: mensaje(e),
              intentos: parte.intentos + 1,
              actualizado_at: new Date().toISOString(),
            })
            .eq('id', parte.id)
          salida.fallidas += 1
        }
        continue
      }

      /* ---- Ya pedido: ¿está? ---- */
      try {
        const est = await estado(perfil, parte.report_id)
        if (est.estado === 'COMPLETED') {
          await service
            .from('marketing_informe_partes')
            .update({ estado: 'listo', error: null, actualizado_at: new Date().toISOString() })
            .eq('id', parte.id)
          salida.listas += 1
        } else if (est.estado === 'FAILED') {
          await service
            .from('marketing_informe_partes')
            .update({
              estado: 'error',
              error: est.detalle ?? 'Amazon lo ha marcado como fallido sin decir por qué.',
              intentos: parte.intentos + 1,
              // Se borra el identificador para que el próximo empujón lo vuelva
              // a pedir. Preguntar otra vez por un informe fallido da lo mismo
              // para siempre.
              report_id: null,
              actualizado_at: new Date().toISOString(),
            })
            .eq('id', parte.id)
          salida.fallidas += 1
        } else {
          salida.esperando += 1
        }
      } catch (e) {
        salida.esperando += 1
        await service
          .from('marketing_informe_partes')
          .update({ error: mensaje(e), actualizado_at: new Date().toISOString() })
          .eq('id', parte.id)
      }
    }

    /* ---- ¿Está el encargo entero? ---- */
    const { data: despues } = await service
      .from('marketing_informe_partes')
      .select('estado, intentos')
      .eq('informe_id', inf.id)

    const todas = (despues ?? []) as { estado: string; intentos: number }[]
    const acabadas = todas.filter(
      (p) =>
        p.estado === 'listo' ||
        p.estado === 'sin_datos' ||
        (p.estado === 'error' && p.intentos >= MAX_INTENTOS)
    )

    if (acabadas.length === todas.length && todas.length > 0) {
      const utiles = todas.filter((p) => p.estado === 'listo').length
      await service
        .from('marketing_informes')
        .update({
          // Con al menos una parte lista el encargo SIRVE, aunque otras hayan
          // fallado: el Excel sale con las pestañas que hay y la pantalla dice
          // cuáles faltan. Marcarlo entero como error por una parte dejaría sin
          // descargar ocho informes buenos.
          estado: utiles > 0 ? 'listo' : 'error',
          error:
            utiles > 0
              ? null
              : 'Ninguna de las peticiones ha llegado a completarse. Mira el detalle de cada una.',
          listo_at: new Date().toISOString(),
          tocado_at: new Date().toISOString(),
        })
        .eq('id', inf.id)
    }
  }

  return salida
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 500) : 'Error desconocido'
}

/* ------------------------------------------------------------------ */
/* Las tres llamadas a Amazon                                          */
/* ------------------------------------------------------------------ */

async function pedir(
  perfil: Perfil,
  parte: FilaParte,
  desde: string,
  hasta: string
): Promise<string> {
  const cuerpo = {
    name: `${parte.plantilla} ${desde} ${hasta}`,
    startDate: desde,
    endDate: hasta,
    configuration: {
      adProduct: parte.ad_product,
      groupBy: gruposDe(parte),
      columns: parte.columnas,
      reportTypeId: parte.report_type_id,
      timeUnit: 'SUMMARY',
      format: 'GZIP_JSON',
    },
  }

  try {
    const res = await llamarAds<{ reportId?: string }>(
      perfil.connection_id,
      '/reporting/reports',
      {
        perfilId: perfil.profile_id,
        metodo: 'POST',
        cabeceras: { Accept: TIPO_PETICION, 'Content-Type': TIPO_PETICION },
        cuerpo,
      }
    )
    if (!res.reportId) throw new AdsError('Amazon ha aceptado la petición pero no ha dado id.')
    return res.reportId
  } catch (error) {
    /**
     * EL 425 NO ES UN ERROR: ES «ESO YA ME LO HAS PEDIDO».
     *
     * Amazon guarda los informes por su configuración. Pedir otro idéntico
     * —mismas fechas, mismas columnas— contesta 425 con el identificador del que
     * YA existe dentro del detalle. Y aquí pasa constantemente: dos encargos del
     * mismo mes para el mismo perfil son exactamente eso.
     *
     * Es la misma lógica que ya tenía informes.ts para la tabla de campañas;
     * está repetida a propósito y no sacada a un sitio común, porque son ocho
     * líneas y sacarlas ataría este generador al formato de aquella tabla.
     */
    const es425 =
      error instanceof AdsError && (error.estado === 425 || /"425"/.test(error.cuerpo ?? ''))
    if (es425) {
      const ya = (error as AdsError).cuerpo?.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
      )
      if (ya) return ya[0]
    }
    throw error
  }
}

/**
 * `groupBy` sale del catálogo, pero la fila guardada no lo tiene: se guardan las
 * columnas porque son lo que cambia el contenido del Excel, y el agrupamiento se
 * deduce del tipo de informe. Si algún día hacen falta los dos, se añade la
 * columna y este apaño desaparece.
 */
function gruposDe(parte: FilaParte): string[] {
  const p = PLANTILLAS_POR_ID.get(parte.plantilla)
  const v = p?.variantes.find((x) => x.reportTypeId === parte.report_type_id)
  return v?.groupBy ?? ['campaign']
}

async function estado(
  perfil: Perfil,
  reportId: string
): Promise<{ estado: string; url?: string; detalle?: string }> {
  const res = await llamarAds<{ status?: string; url?: string; failureReason?: string }>(
    perfil.connection_id,
    `/reporting/reports/${encodeURIComponent(reportId)}`,
    { perfilId: perfil.profile_id }
  )
  return {
    estado: (res.status ?? 'PENDING').toUpperCase(),
    url: res.url,
    detalle: res.failureReason,
  }
}

/**
 * Trae las filas de una parte YA LISTA.
 *
 * Se pide la URL en el momento —no se guarda— porque caduca a los pocos minutos
 * y guardarla solo serviría para tener una dirección muerta en la base.
 */
export async function filasDe(
  perfilId: string,
  reportId: string
): Promise<Record<string, unknown>[]> {
  const perfil = await perfilDe(perfilId)
  const est = await estado(perfil, reportId)
  if (est.estado !== 'COMPLETED' || !est.url) {
    throw new AdsError(`Ese informe todavía no está listo (${est.estado}).`)
  }

  // La URL es de S3 y va firmada: mandarle nuestras cabeceras la rechaza.
  const res = await fetch(est.url)
  if (!res.ok) throw new AdsError(`No se ha podido descargar el informe (${res.status}).`)

  const crudo = Buffer.from(await res.arrayBuffer())
  let texto: string
  try {
    // Llega GZIP sin `Content-Encoding` que lo diga —es el contenido, no el
    // transporte— así que `fetch` no lo descomprime y hay que hacerlo a mano.
    texto = gunzipSync(crudo).toString('utf8')
  } catch {
    texto = crudo.toString('utf8')
  }

  const filas = JSON.parse(texto) as unknown
  return Array.isArray(filas) ? (filas as Record<string, unknown>[]) : []
}
