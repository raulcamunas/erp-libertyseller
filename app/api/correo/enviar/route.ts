import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { leerLista } from '@/lib/correo/direcciones'
import { MAX_ADJUNTOS, MAX_BYTES_ADJUNTOS, MAX_ENVIOS_POR_MINUTO, MENSAJE_DE_PROBLEMA, comprobarEntrada, type AdjuntoParaEnviar, type EntradaDeEnvio } from '@/lib/correo/enviar'
import { marcarBorradorEnviado } from '@/lib/correo/ia-servidor'
import { textoSinFirma } from '@/lib/correo/plantillas'
import { SIN_CACHE, registrar, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { almacenDeSecuencias } from '@/lib/correo/secuencias/almacen'
import { inscribir, type ResultadoDeInscribir } from '@/lib/correo/secuencias/inscripcion'
import { autorizarBuzon, cargarContextoDeRespuesta, contarEnviosRecientes, enviarDesdeBuzon } from '@/lib/correo/servidor'
import { verificarAntesDeEnviar } from '@/lib/correo/verificacion/pago-servidor'
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
 *   secuencia    (opcional) JSON { leadId, seguimientos: [{ texto, asunto? }], iaModelo? }: tras enviar, se programan esos seguimientos automáticos (ver
 *                lib/correo/secuencias). Solo vale para un primer correo a UN destinatario; el correo sale igual aunque no se puedan programar
 *   adjuntos     uno o varios ficheros
 *
 * Una dirección que no vale NO se descarta en silencio: se devuelve un 400 con la que falla, porque quien envía tiene que
 * saber que «ana@» no ha entrado en la lista antes de que el cliente no conteste.
 *
 * ¿EXISTE LA DIRECCIÓN? Si la verificación con MillionVerifier está encendida (Correo → Secuencias → Ajustes), un PRIMER correo (no una respuesta ni un reenvío)
 * pregunta antes de salir si cada dirección de «Para» y «Cc» existe. Si el servicio dice que no, o que es desechable, el correo NO sale: 422 con `codigo: 'direccion_no_valida'`
 * y las direcciones (con la corrección que proponga el servicio). La respuesta se guarda: esa dirección no se vuelve a preguntar ni a pagar, y los seguimientos salen
 * sin consultar. Si el servicio no contesta o no quedan créditos, el correo sale igual (lib/correo/verificacion/pago-servidor.ts). Apagada, o sin la migración 256, no
 * cambia nada.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Los adjuntos admiten MAX_BYTES_ADJUNTOS; el resto del formulario es texto */
const MAX_BYTES_PETICION = MAX_BYTES_ADJUNTOS + 2 * 1024 * 1024
const MAX_CAMPO_DE_TEXTO = 120_000

const texto = (v: FormDataEntryValue | null, maximo: number): string => (typeof v === 'string' ? v.slice(0, maximo) : '')

/** El campo `secuencia` del formulario, si viene y tiene sentido; si no, null (el correo se envía igual, sin seguimientos) */
function leerPeticionDeSecuencia(valor: FormDataEntryValue | null): { leadId: string; seguimientos: Array<{ texto: string; asunto?: string }>; iaModelo: string | null } | null {
  if (typeof valor !== 'string' || valor === '' || valor.length > 60_000) return null
  try {
    const o = JSON.parse(valor) as { leadId?: unknown; seguimientos?: unknown; iaModelo?: unknown }
    if (typeof o.leadId !== 'string' || !UUID.test(o.leadId) || !Array.isArray(o.seguimientos) || o.seguimientos.length === 0 || o.seguimientos.length > 4) return null
    const seguimientos: Array<{ texto: string; asunto?: string }> = []
    for (const s of o.seguimientos as Array<{ texto?: unknown; asunto?: unknown }>) {
      if (!s || typeof s.texto !== 'string') return null
      seguimientos.push({ texto: s.texto.slice(0, 8000), ...(typeof s.asunto === 'string' && s.asunto.trim() !== '' ? { asunto: s.asunto.slice(0, 300) } : {}) })
    }
    return { leadId: o.leadId.toLowerCase(), seguimientos, iaModelo: typeof o.iaModelo === 'string' ? o.iaModelo.slice(0, 60) : null }
  } catch {
    return null
  }
}

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

    // ¿Existe la dirección? Solo en un primer correo. Antes de gastar nada de lo demás (el contexto de una respuesta, el envío)
    const verificacion = respondeA === null || respondeA === '' ? await verificarAntesDeEnviar(service, { para: [...para.personas, ...cc.personas].map((p) => p.direccion), direccionDelBuzon: auth.buzon.direccion, usuarioId: sesion.userId }) : null
    if (verificacion?.bloqueo) {
      return NextResponse.json({ ok: false, error: verificacion.bloqueo.mensaje, codigo: 'direccion_no_valida', direcciones: verificacion.bloqueo.direcciones }, { status: 422, headers: SIN_CACHE })
    }

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

    // Los seguimientos automáticos: el correo YA HA SALIDO, así que pase lo que pase aquí no se devuelve un error de envío
    let secuencia: unknown = undefined
    const pedida = leerPeticionDeSecuencia(formulario.get('secuencia'))
    if (pedida) {
      if (respondeA) secuencia = { ok: false, mensaje: 'Los seguimientos automáticos solo se programan en un primer correo, no al contestar.' }
      else if (para.personas.length !== 1 || cc.personas.length > 0) secuencia = { ok: false, mensaje: 'Los seguimientos automáticos solo se programan cuando el correo va a una sola dirección.' }
      // Una dirección dudosa con el ajuste «enviar sin seguimientos»: el correo sale, los seguimientos no
      else if (verificacion?.sinSeguimientos) secuencia = { ok: false, mensaje: verificacion.sinSeguimientos }
      else {
        try {
          const resultado: ResultadoDeInscribir = await inscribir(
            { almacen: almacenDeSecuencias(service) },
            {
              leadId: pedida.leadId,
              buzonId: auth.buzon.id,
              userId: sesion.userId,
              destinatario: para.personas[0].direccion,
              primerCorreo: { asunto: entrada.asunto, texto: textoSinFirma(entrada.texto, auth.buzon.firma).trim(), messageId: r.messageId, hiloId: r.hiloId, enviadoAt: r.fecha.getTime() },
              seguimientos: pedida.seguimientos,
              iaModelo: pedida.iaModelo,
            }
          )
          secuencia = resultado.ok
            ? { ok: true, aviso: resultado.aviso, pasos: resultado.pasos.map((p) => ({ orden: p.orden, etiqueta: p.etiqueta, programadoAt: p.programadoAt })) }
            : { ok: false, mensaje: resultado.mensaje }
        } catch (error) {
          registrar('Correo · enviar: no se han podido programar los seguimientos', error)
          secuencia = { ok: false, mensaje: 'El correo ha salido, pero no se han podido programar los seguimientos. Vuelve a intentarlo desde la ficha del lead.' }
        }
      }
    }
    // Lo que hay que decirle a quien envía de la verificación (una dirección dudosa, o que esta vez no se pudo comprobar). El de «sin seguimientos» ya viaja en `secuencia`
    const avisos = (verificacion?.avisos ?? []).filter((a) => !(pedida && a === verificacion?.sinSeguimientos))
    return NextResponse.json(
      { ok: true, hiloId: r.hiloId, copiadoAEnviados: r.copiadoAEnviados, rechazados: r.rechazados, ...(secuencia !== undefined ? { secuencia } : {}), ...(avisos.length > 0 ? { avisosDeVerificacion: avisos } : {}) },
      { headers: SIN_CACHE }
    )
  } catch (error) {
    return respuestaDeFallo('Correo · enviar: fallo', error)
  }
}
