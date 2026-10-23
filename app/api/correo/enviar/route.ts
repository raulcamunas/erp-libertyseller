import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { leerLista } from '@/lib/correo/direcciones'
import { MAX_ADJUNTOS, MAX_BYTES_ADJUNTOS, MAX_ENVIOS_POR_MINUTO, MENSAJE_DE_PROBLEMA, comprobarEntrada, type AdjuntoParaEnviar, type EntradaDeEnvio } from '@/lib/correo/enviar'
import { marcarBorradorEnviado } from '@/lib/correo/ia-servidor'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { autorizarBuzon, cargarContextoDeRespuesta, contarEnviosRecientes, enviarDesdeBuzon } from '@/lib/correo/servidor'
import { comprobarTamañoPeticion } from '@/lib/subidas-limite'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * ENVIAR UN CORREO DESDE MI BUZÓN.
 *
 * POST multipart/form-data:
 *   buzonId      el buzón desde el que se envía. Solo su dueño: nadie envía desde la dirección de otro
 *   para, cc     direcciones separadas por comas o saltos de línea
 *   asunto, texto
 *   respondeA    (opcional) id del mensaje al que se contesta o que se reenvía; tiene que ser del mismo buzón
 *   modo         'responder' (por defecto si hay respondeA) o 'reenviar'
 *   sinCita      '1' para no citar el mensaje original al contestar
 *   iaId         (opcional) id del borrador que escribió la IA y que el comercial ha editado y envía: se apunta lo que salió de verdad
 *   adjuntos     uno o varios ficheros
 *
 * Una dirección que no vale NO se descarta en silencio: se devuelve un 400 con la que falla, porque quien envía tiene que
 * saber que «ana@» no ha entrado en la lista antes de que el cliente no conteste.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Los adjuntos admiten MAX_BYTES_ADJUNTOS; el resto del formulario es texto */
const MAX_BYTES_PETICION = MAX_BYTES_ADJUNTOS + 2 * 1024 * 1024
const MAX_CAMPO_DE_TEXTO = 120_000

const texto = (v: FormDataEntryValue | null, maximo: number): string => (typeof v === 'string' ? v.slice(0, maximo) : '')

export async function POST(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  const demasiado = comprobarTamañoPeticion(request, MAX_BYTES_PETICION)
  if (demasiado) return demasiado

  let formulario: FormData
  try {
    formulario = await request.formData()
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }

  const para = leerLista(texto(formulario.get('para'), 4000))
  const cc = leerLista(texto(formulario.get('cc'), 4000))
  const invalidas = [...para.invalidas, ...cc.invalidas]
  if (invalidas.length > 0) return fail(400, `Hay una dirección que no es válida: «${invalidas[0]}».`)

  const ficheros = formulario.getAll('adjuntos').filter((f): f is File => typeof f !== 'string')
  if (ficheros.length > MAX_ADJUNTOS) return fail(400, MENSAJE_DE_PROBLEMA.demasiados_adjuntos)
  if (ficheros.reduce((suma, f) => suma + f.size, 0) > MAX_BYTES_ADJUNTOS) return fail(413, MENSAJE_DE_PROBLEMA.adjuntos_grandes)
  const adjuntos: AdjuntoParaEnviar[] = []
  for (const f of ficheros) adjuntos.push({ nombre: f.name, tipo: f.type, contenido: Buffer.from(await f.arrayBuffer()) })

  const entrada: EntradaDeEnvio = {
    para: para.personas,
    cc: cc.personas,
    asunto: texto(formulario.get('asunto'), 1000).replace(/[\r\n]+/g, ' ').trim(),
    texto: texto(formulario.get('texto'), MAX_CAMPO_DE_TEXTO).replace(/\r\n?/g, '\n'),
    adjuntos,
  }
  const problema = comprobarEntrada(entrada)
  if (problema) return fail(400, MENSAJE_DE_PROBLEMA[problema])

  try {
    const service = createServiceClient()
    const auth = await autorizarBuzon(service, sesion, formulario.get('buzonId'), 'escribir')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)

    if ((await contarEnviosRecientes(service, auth.buzon.id, Date.now() - 60_000)) >= MAX_ENVIOS_POR_MINUTO) {
      return fail(429, 'Estás enviando demasiado rápido. Espera un minuto y vuelve a probar.')
    }

    const respondeA = formulario.get('respondeA')
    if (respondeA !== null && respondeA !== '') {
      const modo = formulario.get('modo') === 'reenviar' ? 'reenviar' : 'responder'
      const contexto = await cargarContextoDeRespuesta(service, auth.buzon.id, respondeA, modo, formulario.get('sinCita') !== '1')
      if (!contexto) return fail(404, 'No se encuentra el mensaje al que contestas.')
      entrada.respuesta = contexto
    }

    const resultado = await enviarDesdeBuzon(service, auth.buzon, entrada)
    if (resultado.tipo === 'error') return fail(resultado.estado, resultado.mensaje)
    const r = resultado.resultado

    // Si el mensaje salió de un borrador de la IA, se apunta lo que salió DE VERDAD (editado) y en qué conversación quedó. Si esto falla no
    // se avisa de nada: el correo ya salió, y el registro solo sirve para medir
    const iaId = formulario.get('iaId')
    if (typeof iaId === 'string' && UUID.test(iaId)) {
      await marcarBorradorEnviado(service, { id: iaId.toLowerCase(), userId: sesion.userId, hiloId: r.hiloId, asunto: entrada.asunto, texto: entrada.texto })
    }
    return NextResponse.json({ ok: true, hiloId: r.hiloId, copiadoAEnviados: r.copiadoAEnviados, rechazados: r.rechazados }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · enviar: fallo', error)
  }
}
