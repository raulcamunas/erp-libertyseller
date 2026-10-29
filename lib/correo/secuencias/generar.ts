import type { AmazonSupabase } from '@/lib/amazon/api'
import type { createServiceClient } from '@/lib/supabase/service'
import type { FilaDeBuzon } from '../almacen'
import { contextoParaIa, esPartnerParaIa, MENSAJE_PARTNER_SIN_IA } from '../ia-contexto'
import { cargarCorreosDelLead, cargarLead, cargarLlamadas, cargarNotas, direccionesDeLead } from '../ia-servidor'
import { textoSinFirma } from '../plantillas'
import type { ClienteDeCorreoIa } from '../ia-generar'
import type { AlmacenDeSecuencias } from './almacen'
import { diaDeMadrid, sumarDiasHabiles } from './fechas'
import { asuntoDeSeguimiento } from './inscripcion'
import { escribirSeguimientos } from './ia'
import { construirEncargoDeSeguimientos } from './seguimientos'

/**
 * ESCRIBIR LOS SEGUIMIENTOS DE UN LEAD CON LA IA — SOLO SERVIDOR.
 * ===============================================================
 * La llamada que hace el cuadro de Correo cuando el comercial quiere programar seguimientos para el correo que acaba de escribir (o de pedirle a la IA).
 * Lee el lead con la SESIÓN de quien pide (si no es suyo ni lo supervisa, no existe), igual que «Redactar con IA»; la IA no recibe nunca la facturación
 * ni los teléfonos ni los correos del lead (lib/correo/ia-contexto.ts), y lo que devuelve se revisa (seguimientos.ts) antes de enseñárselo a nadie.
 */

type Servicio = ReturnType<typeof createServiceClient>

export interface SeguimientoGenerado {
  orden: number
  dias: number
  /** El día en que saldría, calculado desde hoy (aproximado: la hora y el día exactos los reparte el motor al enviar) */
  diaAprox: string
  asunto: string
  texto: string
}

export type ResultadoDeGenerar = { ok: true; seguimientos: SeguimientoGenerado[]; modelo: string; aviso: string | null } | { ok: false; estado: number; mensaje: string }

export async function generarSeguimientosDeUnLead(p: {
  sesion: AmazonSupabase
  service: Servicio
  almacen: AlmacenDeSecuencias
  buzon: FilaDeBuzon
  leadId: string
  asunto: string
  /** El correo tal y como está en el cuadro: con la firma del buzón debajo */
  texto: string
  indicaciones: string | null
  ahora?: number
  cliente?: ClienteDeCorreoIa
}): Promise<ResultadoDeGenerar> {
  const ahora = p.ahora ?? Date.now()
  const [lectura, base] = await Promise.all([p.almacen.leerAjustes(), p.almacen.secuenciaBase()])
  if (!lectura || !base) return { ok: false, estado: 409, mensaje: 'Los seguimientos automáticos no están disponibles todavía.' }

  const primero = textoSinFirma(p.texto, p.buzon.firma).trim()
  if (primero.length < 40) return { ok: false, estado: 400, mensaje: 'Escribe primero el correo: los seguimientos se escriben a partir de él.' }

  const lead = await cargarLead(p.sesion, p.leadId)
  if (!lead) return { ok: false, estado: 404, mensaje: 'No se encuentra ese lead, o no es tuyo.' }
  if (esPartnerParaIa(lead)) return { ok: false, estado: 409, mensaje: MENSAJE_PARTNER_SIN_IA }
  const [notas, llamadas, correos] = await Promise.all([
    cargarNotas(p.sesion, p.leadId),
    cargarLlamadas(p.sesion, p.leadId),
    cargarCorreosDelLead(p.service, p.buzon.id, direccionesDeLead(lead)),
  ])
  const encargo = construirEncargoDeSeguimientos({
    contexto: contextoParaIa({ lead, notas, llamadas, correos, ahora }),
    primerCorreo: { asunto: p.asunto.trim() || 'Sin asunto', texto: primero },
    pasos: base.pasos.map((x) => ({ orden: x.orden, dias: x.dias })),
    indicaciones: p.indicaciones,
    miNombre: p.buzon.nombre,
    tieneFirma: Boolean(p.buzon.firma?.trim()),
  })
  const r = await escribirSeguimientos(encargo, base.pasos.length, primero, p.cliente ? { cliente: p.cliente } : {})
  console.log('[secuencias-ia] seguimientos', { modelo: r.modelo, ok: r.textos !== null, llamadas: r.llamadas, tokens: r.tokens })
  if (!r.textos) return { ok: false, estado: r.problemas.some((x) => x.includes('dinero')) ? 422 : 503, mensaje: r.aviso ?? 'No se han podido escribir los seguimientos.' }

  const hoy = diaDeMadrid(ahora)
  return {
    ok: true,
    modelo: r.modelo,
    aviso: r.aviso,
    seguimientos: r.textos.map((texto, i) => ({
      orden: base.pasos[i].orden,
      dias: base.pasos[i].dias,
      diaAprox: sumarDiasHabiles(hoy, base.pasos[i].dias, lectura.ajustes.festivos),
      asunto: asuntoDeSeguimiento(p.asunto),
      texto,
    })),
  }
}
