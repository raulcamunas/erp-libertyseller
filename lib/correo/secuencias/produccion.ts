import type { createServiceClient } from '@/lib/supabase/service'
import { escribirAvisosDeCorreo } from '../campana-servidor'
import type { EntradaDeEnvio } from '../enviar'
import { cargarBuzon, enviarDesdeBuzon, sincronizarBuzonPorId } from '../servidor'
import { verificadorParaElMotor } from '../verificacion/pago-servidor'
import { almacenDeSecuencias } from './almacen'
import { clasificarRespuestaConIa, redactarConIa, revisarConIa } from './ia'
import type { CodigoDeFalloDeEnvio, DependenciasDelMotor, ResultadoDelEnvio } from './motor'

/**
 * LO QUE EL MOTOR DE SECUENCIAS USA DE VERDAD: EL ALMACÉN, LA LECTURA DEL BUZÓN, EL ENVÍO Y LA IA (REVISAR SEGUIMIENTOS Y LEER RESPUESTAS) — SOLO SERVIDOR.
 * ================================================================================================================
 * El motor (motor.ts) no sabe de correos ni de OpenAI: recibe estas piezas. Aquí se conectan a las de siempre del módulo de correo
 * (lib/correo/servidor.ts), de modo que un seguimiento sale por el MISMO camino que un correo que escribe una persona: el mismo servidor SMTP del
 * buzón, la misma copia en Enviados, el mismo guardado en el hilo.
 */

type Servicio = ReturnType<typeof createServiceClient>

/** Cuánto se le da a la lectura del buzón justo antes de decidir un envío */
const LECTURA_PREVIA_MS = 25_000

/** Traduce el fallo del módulo de correo a los pocos casos que distingue el motor */
function codigoDeFallo(codigo: string): CodigoDeFalloDeEnvio {
  switch (codigo) {
    case 'credenciales':
    case 'contrasena':
      return 'credenciales'
    case 'rechazado':
      return 'rechazado'
    case 'limite':
      return 'limite'
    case 'base':
      return 'base'
    case 'red':
    case 'tls':
    case 'servidor_no_resuelve':
    case 'sin_enviados':
    case 'ocupado':
      return 'red'
    default:
      return 'otro'
  }
}

export function dependenciasDeProduccion(service: Servicio): DependenciasDelMotor {
  const almacen = almacenDeSecuencias(service)
  return {
    almacen,
    async sincronizar(buzonId) {
      await sincronizarBuzonPorId(service, buzonId, { presupuestoMs: LECTURA_PREVIA_MS })
    },
    async enviar(e): Promise<ResultadoDelEnvio> {
      const buzon = await cargarBuzon(service, e.buzonId)
      if (!buzon) return { ok: false, codigo: 'otro', mensaje: 'El buzón ya no existe.' }
      const entrada: EntradaDeEnvio = {
        para: [{ nombre: '', direccion: e.para }],
        cc: [],
        asunto: e.asunto,
        texto: e.texto,
        // Se contesta al último correo de la secuencia, con la cadena de References entera, y sin citar nada debajo: un seguimiento corto no necesita el eco
        respuesta: e.enRespuestaA ? { messageId: e.enRespuestaA, referencias: e.referencias, cita: null } : null,
      }
      const r = await enviarDesdeBuzon(service, buzon, entrada, { id: e.id })
      if (r.tipo === 'enviado') return { ok: true, messageId: r.resultado.messageId, fecha: r.resultado.fecha.getTime(), copiadoAEnviados: r.resultado.copiadoAEnviados }
      return { ok: false, codigo: codigoDeFallo(r.codigo), mensaje: r.mensaje }
    },
    // Las direcciones que no se comprobaron antes de programar los seguimientos se comprueban (una vez) justo antes de enviar. Como mucho 5 llamadas por pasada
    verificarDireccion: verificadorParaElMotor(service),
    revisar: (mensajes, original) => revisarConIa(mensajes, original),
    clasificar: (mensajes) => clasificarRespuestaConIa(mensajes),
    redactar: (mensajes, anteriores) => redactarConIa(mensajes, anteriores),
    // Lo que una persona tiene que atender de sus seguimientos llega a su campana (la migración 251; sin ella no se escribe y todo sigue igual)
    avisar: async (aviso) => {
      await escribirAvisosDeCorreo(service, [aviso])
    },
  }
}
