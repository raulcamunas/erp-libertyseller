/**
 * AMAZON ADS · DEL LOG DEL ERP AL «LOGS MARKETING» DEL SOP (el Google Sheets de cada cliente). PURO.
 *
 * El SOP pide pegar cada cambio con SEIS columnas exactas y un desplegable cerrado: `Keyword · Tipo de Campaña · Acción · Valor anterior · Nuevo valor · Fecha`, con «No inventes valores fuera de esas
 * listas. Si una acción no encaja (por ejemplo pausar, que hoy no está), dilo en vez de forzarla». Así que esto:
 *
 *   · traduce lo que el ERP apunta (negativizar, promover, puja, presupuesto, activar, crear) a ese vocabulario;
 *   · deja FUERA, con su motivo, lo que no encaja (pausar, deshacer, cambios de modo…) para que la pantalla lo diga;
 *   · solo copia los cambios que Amazon ACEPTÓ: «pegar en el Log solo las filas aceptadas».
 */

import type { EntradaDeLog } from './cuenta'
import { partesDeNombre } from './reglas'

export const TIPOS_DE_CAMPANA_SOP = ['AUTO RADAR', 'AMPLIA', 'EXACTA ESTABILIDAD', 'EXACTA DOMINIO', 'ATAQUE ASIN'] as const
export const ACCIONES_SOP = ['Subir puja', 'Bajar puja', 'Negativizar', 'Pasado a otra campaña', 'Añadir', 'Campaña Nueva Creada', 'Renombrar', 'Reactivación', 'Subir presupuesto', 'Bajar presupuesto'] as const

export interface FilaDelLogSop {
  keyword: string
  tipoCampana: (typeof TIPOS_DE_CAMPANA_SOP)[number] | ''
  accion: (typeof ACCIONES_SOP)[number]
  valorAnterior: string
  nuevoValor: string
  /** DD/MM/AAAA, en hora de España */
  fecha: string
}

const TIPO_POR_ROL: Record<string, FilaDelLogSop['tipoCampana']> = {
  'AUTO RADAR': 'AUTO RADAR',
  'MANUAL AMPLIA': 'AMPLIA',
  'MANUAL EXACTA / DOMINIO': 'EXACTA DOMINIO',
  'MANUAL EXACTA / ESTABILIDAD': 'EXACTA ESTABILIDAD',
  'ATAQUE ASIN': 'ATAQUE ASIN',
}

export const tipoDeCampanaSop = (nombre: string | null): FilaDelLogSop['tipoCampana'] => {
  const rol = nombre ? partesDeNombre(nombre)?.rol : null
  return (rol && TIPO_POR_ROL[rol]) || ''
}

/** La fecha del SOP en hora de Madrid (un cambio a las 00:30 de España es del día de España, no del de Greenwich) */
export function fechaSop(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
}

/** «0,62» → 0.62. null si no es un número */
const numero = (t: string | null): number | null => {
  if (!t) return null
  // El ERP apunta con coma decimal («0,62»); si viniera con punto («0.62») se lee tal cual
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : null
}

/** El texto entre «comillas» de un campo o un motivo («puja de «jamon serrano»» → jamon serrano) */
const entreComillas = (t: string | null): string | null => (t ? (/«([^»]+)»/.exec(t)?.[1] ?? null) : null)

export type ResultadoLogSop = { fila: FilaDelLogSop } | { fuera: string }

export function aLogSop(e: Pick<EntradaDeLog, 'creadoAt' | 'entidad' | 'accion' | 'campo' | 'valorAnterior' | 'valorNuevo' | 'motivo' | 'nombreCampana' | 'ok'>): ResultadoLogSop {
  if (!e.ok) return { fuera: 'Amazon lo rechazó: no se pega en el Log' }
  const fecha = fechaSop(e.creadoAt)
  const tipoCampana = tipoDeCampanaSop(e.nombreCampana)
  const campo = e.campo ?? ''
  if (campo === 'deshacer') return { fuera: 'Deshacer no está en el vocabulario del Log: apúntalo a mano si hace falta' }
  if (/modo del motor|umbrales/.test(campo)) return { fuera: 'Ajuste del motor, no un cambio de campaña' }

  switch (e.accion) {
    case 'negativizar':
      return { fila: { keyword: e.valorNuevo ?? '', tipoCampana, accion: 'Negativizar', valorAnterior: '', nuevoValor: campo.includes('productos') ? 'Negativa de producto' : 'Negativa exacta', fecha } }
    case 'promover': {
      // valorNuevo = «término → ROL DESTINO»; la campaña apuntada ya es la de destino
      const [termino, destino] = (e.valorNuevo ?? '').split('→').map((x) => x.trim())
      return { fila: { keyword: termino ?? '', tipoCampana, accion: 'Pasado a otra campaña', valorAnterior: TIPO_POR_ROL[e.valorAnterior ?? ''] || (e.valorAnterior ?? ''), nuevoValor: TIPO_POR_ROL[destino ?? ''] || (destino ?? ''), fecha } }
    }
    case 'activar':
      return { fila: { keyword: entreComillas(campo) ?? entreComillas(e.motivo) ?? '', tipoCampana, accion: 'Reactivación', valorAnterior: e.valorAnterior ?? '', nuevoValor: e.valorNuevo ?? '', fecha } }
    case 'pausar':
      return { fuera: 'Pausar no está en el vocabulario del Log del SOP: apúntalo a mano o pide que se añada' }
    case 'crear':
      if (e.entidad === 'campaña') return { fila: { keyword: '', tipoCampana, accion: 'Campaña Nueva Creada', valorAnterior: '', nuevoValor: e.nombreCampana ?? e.valorNuevo ?? '', fecha } }
      if (e.entidad === 'keyword' || e.entidad === 'target') return { fila: { keyword: e.valorNuevo ?? '', tipoCampana, accion: 'Añadir', valorAnterior: '', nuevoValor: e.valorNuevo ?? '', fecha } }
      return { fuera: 'Parte del montaje de una campaña (grupo, anuncio): ya va en «Campaña Nueva Creada»' }
    case 'cambiar': {
      const antes = numero(e.valorAnterior)
      const despues = numero(e.valorNuevo)
      if (/presupuesto/.test(campo)) {
        if (antes == null || despues == null || antes === despues) return { fuera: 'Cambio de presupuesto sin los dos valores' }
        return { fila: { keyword: '', tipoCampana, accion: despues > antes ? 'Subir presupuesto' : 'Bajar presupuesto', valorAnterior: e.valorAnterior ?? '', nuevoValor: e.valorNuevo ?? '', fecha } }
      }
      if (/puja/.test(campo)) {
        if (antes == null || despues == null || antes === despues) return { fuera: 'Cambio de puja sin los dos valores' }
        return { fila: { keyword: entreComillas(campo) ?? entreComillas(e.motivo) ?? '', tipoCampana, accion: despues > antes ? 'Subir puja' : 'Bajar puja', valorAnterior: e.valorAnterior ?? '', nuevoValor: e.valorNuevo ?? '', fecha } }
      }
      return { fuera: `«${campo || 'cambio'}» no está en el vocabulario del Log` }
    }
    default:
      return { fuera: `«${e.accion}» no está en el vocabulario del Log` }
  }
}

/** Las filas listas para pegar en el Google Sheets (tabuladas, sin cabecera, en el orden del Log), de la más antigua a la más nueva, y lo que se queda fuera */
export function textoParaPegar(entradas: ReadonlyArray<Parameters<typeof aLogSop>[0]>): { texto: string; filas: number; fuera: Array<{ que: string; motivo: string }> } {
  const filas: FilaDelLogSop[] = []
  const fuera: Array<{ que: string; motivo: string }> = []
  for (const e of [...entradas].sort((a, b) => a.creadoAt.localeCompare(b.creadoAt))) {
    const r = aLogSop(e)
    if ('fila' in r) filas.push(r.fila)
    else if (!/Ajuste del motor|montaje de una campaña/.test(r.fuera)) fuera.push({ que: `${e.accion} ${e.entidad}${e.campo ? ` · ${e.campo}` : ''}`, motivo: r.fuera })
  }
  // Un tabulador o salto dentro de una celda rompería las columnas al pegar
  const limpio = (t: string) => t.replace(/[\t\r\n]+/g, ' ').trim()
  const texto = filas.map((f) => [f.keyword, f.tipoCampana, f.accion, f.valorAnterior, f.nuevoValor, f.fecha].map(limpio).join('\t')).join('\n')
  return { texto, filas: filas.length, fuera }
}
