import { resumenDeAgente } from './agente'
import { nombreDePantalla, type EventoDeActividad } from './linea'

/**
 * UNA FILA DEL REGISTRO, EN PALABRAS. PURO. Se prueba en describir.prueba.ts.
 *
 *   sesion  -> «Abrió el ERP»                    (con el navegador y la IP de donde se abrió)
 *   login   -> «Inició sesión»                   (idem)
 *   pagina  -> «Abrió «Cold Calling»»
 *   clic    -> «Pulsó «Guardar»»  en «Correo»
 *   oculta  -> «Salió de la pestaña»
 *   visible -> «Volvió a la pestaña»
 */
export interface Descripcion {
  texto: string
  /** Lo que se dice en pequeño al lado: dónde pulsó, o con qué se abrió */
  aparte: string | null
}

export function describirEvento(e: EventoDeActividad, conocidas: ReadonlyArray<{ route: string; name: string }>): Descripcion {
  const pantalla = e.ruta ? nombreDePantalla(e.ruta, conocidas) : null
  switch (e.tipo) {
    case 'sesion':
    case 'login': {
      const con = [resumenDeAgente(e.agente), e.ip].filter(Boolean).join(' · ')
      return { texto: e.tipo === 'login' ? 'Inició sesión' : 'Abrió el ERP', aparte: con || null }
    }
    case 'pagina':
      return { texto: `Abrió «${pantalla ?? 'una pantalla'}»`, aparte: null }
    case 'clic':
      return { texto: `Pulsó «${e.detalle ?? '…'}»`, aparte: pantalla ? `en ${pantalla}` : null }
    case 'oculta':
      return { texto: 'Salió de la pestaña', aparte: null }
    case 'visible':
      return { texto: 'Volvió a la pestaña', aparte: null }
    case 'latido':
      return { texto: 'Activo', aparte: null }
  }
}
