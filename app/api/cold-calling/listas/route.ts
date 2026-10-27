import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { esUuid, leerFiltroDeLeads } from '@/lib/cold-calling/listas'
import { DEMASIADAS_PETICIONES, SIN_CACHE, dentroDelLimite, leerCuerpoJson, requerirGestorDeListas, respuestaDeError } from '@/lib/cold-calling/listas-rutas'
import {
  archivarLista,
  asignarLista,
  crearLista,
  deshacerMovimiento,
  leerPanel,
  leerPersonas,
  moverLeads,
  movimientosRecientes,
  renombrarLista,
  type PeticionDeMover,
} from '@/lib/cold-calling/listas-servidor'

/**
 * LAS LISTAS DE LEADS DE COLD CALLING: VERLAS Y CAMBIARLAS — SOLO QUIEN GESTIONA LISTAS (administrador, partner o la casilla «Gestión de listas de leads»).
 *
 * GET   el panel entero: las listas registradas, el resumen de lo usadas y llamadas que están, el equipo al que se pueden asignar y el nombre de cada persona, los últimos
 *       movimientos y si falta la migración 257 (en ese caso se ven las listas pero no se puede cambiar nada).
 * POST application/json
 *   { accion: 'crear', nombre, descripcion?, responsable? }                crea una lista (vacía, con su responsable si se dice)
 *   { accion: 'renombrar', id, nombre }                                    cambia el nombre de una lista y el de todos sus leads
 *   { accion: 'archivar', id, archivada? }                                 archiva (o, con archivada: false, desarchiva)
 *   { accion: 'asignar_lista', id, dueno, alcance }                        la lista pasa a una persona (o a nadie); alcance = ninguno | sin_dueno | pendientes | todos
 *   { accion: 'mover', ids | (todos: true, filtro, excluidos), lista?, dueno? }   cambia la lista y/o el dueño de unos leads: los de `ids`, o todos los que cumplen `filtro`
 *                                                                          menos `excluidos`. Una clave que no está no se toca; `lista: null` los saca de toda lista y `dueno: null` los deja sin dueño
 *   { accion: 'deshacer', movimiento }                                     devuelve unos leads a como estaban antes de un movimiento (dentro de las dos semanas)
 *
 * Todo lo que cambia datos queda apuntado en `cold_lead_movimientos` con quién lo hizo. Las frases de error son las de la base (escritas para enseñarse tal cual) o una
 * genérica: nunca el texto técnico de una excepción.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET() {
  const gestor = await requerirGestorDeListas()
  if (gestor instanceof NextResponse) return gestor
  if (!dentroDelLimite(`listas-leer:${gestor.userId}`, 120)) return fail(429, DEMASIADAS_PETICIONES)
  try {
    const [panel, personas] = await Promise.all([leerPanel(gestor.service), leerPersonas(gestor.service)])
    const movimientos = panel.migracion ? await movimientosRecientes(gestor.service, 60).catch(() => []) : []
    return NextResponse.json({ ok: true, ...panel, ...personas, movimientos, yo: gestor.userId }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeError('Cold Calling · listas: leer el panel', error)
  }
}

/** Lo que llega para mover leads, saneado: una clave que falta no se toca; una que viene con null es «ninguna» */
function peticionDeMover(cuerpo: Record<string, unknown>): PeticionDeMover | string {
  const p: PeticionDeMover = {}
  if (cuerpo.todos === true) {
    p.filtro = leerFiltroDeLeads(cuerpo.filtro)
    p.excluidos = Array.isArray(cuerpo.excluidos) ? cuerpo.excluidos.filter(esUuid) : []
  } else if (Array.isArray(cuerpo.ids)) {
    p.ids = cuerpo.ids as string[]
  }
  if ('lista' in cuerpo) {
    if (cuerpo.lista !== null && typeof cuerpo.lista !== 'string') return 'La lista no es válida.'
    p.lista = cuerpo.lista as string | null
  }
  if ('dueno' in cuerpo) {
    if (cuerpo.dueno !== null && typeof cuerpo.dueno !== 'string') return 'La persona no es válida.'
    p.dueno = cuerpo.dueno === '' ? null : (cuerpo.dueno as string | null)
  }
  return p
}

export async function POST(request: NextRequest) {
  const gestor = await requerirGestorDeListas()
  if (gestor instanceof NextResponse) return gestor
  if (!dentroDelLimite(`listas-cambiar:${gestor.userId}`, 60)) return fail(429, DEMASIADAS_PETICIONES)
  const cuerpo = await leerCuerpoJson(request)
  if (cuerpo instanceof NextResponse) return cuerpo

  const { service, userId } = gestor
  try {
    switch (cuerpo.accion) {
      case 'crear':
        return NextResponse.json({ ok: true, ...(await crearLista(service, userId, { nombre: cuerpo.nombre, descripcion: cuerpo.descripcion, responsable: cuerpo.responsable })) }, { headers: SIN_CACHE })
      case 'renombrar':
        return NextResponse.json({ ok: true, ...(await renombrarLista(service, userId, cuerpo.id, cuerpo.nombre)) }, { headers: SIN_CACHE })
      case 'archivar':
        return NextResponse.json({ ok: true, ...(await archivarLista(service, userId, cuerpo.id, cuerpo.archivada !== false)) }, { headers: SIN_CACHE })
      case 'asignar_lista':
        return NextResponse.json({ ok: true, ...(await asignarLista(service, userId, cuerpo.id, cuerpo.dueno, cuerpo.alcance)) }, { headers: SIN_CACHE })
      case 'mover': {
        const peticion = peticionDeMover(cuerpo)
        if (typeof peticion === 'string') return fail(400, peticion)
        return NextResponse.json({ ok: true, ...(await moverLeads(service, userId, peticion)) }, { headers: SIN_CACHE })
      }
      case 'deshacer':
        return NextResponse.json({ ok: true, ...(await deshacerMovimiento(service, userId, cuerpo.movimiento)) }, { headers: SIN_CACHE })
      default:
        return fail(400, 'No se entiende qué hacer.')
    }
  } catch (error) {
    return respuestaDeError('Cold Calling · listas: cambiar', error)
  }
}
