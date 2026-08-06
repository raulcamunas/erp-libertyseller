/**
 * Lo que comparten las dos rutas de sincronización de stock: quién puede
 * entrar, cómo se lee un fichero subido y cómo se pagina Supabase.
 *
 * Está aparte de engine.ts a propósito. El motor es lógica pura que se puede
 * ejecutar con dos buffers y una lista; aquí ya hay cabeceras HTTP, cookies y
 * base de datos. Mezclarlos obligaría a levantar media aplicación para
 * comprobar un cruce.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { StockSyncError, WorkbookInput } from './engine'

export type StockSupabase = Awaited<ReturnType<typeof createClient>>

/**
 * Los mismos roles que public.is_stock_team() de la migración 106. Quien sube
 * el stock a Amazon dos veces por semana es la persona de operaciones y su rol
 * es 'employee': dejarlo fuera cerraría el módulo a quien lo usa.
 *
 * Si esta lista y la del helper de RLS dejan de coincidir, el fallo es de los
 * feos: la ruta contesta 200 y Supabase devuelve cero filas, así que el
 * proceso «funciona» pero genera un fichero vacío que borraría el stock de
 * todos los listings del cliente.
 */
const STOCK_ROLES = new Set(['admin', 'partner', 'employee'])

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Tope de tamaño por fichero. El volcado real del cliente son 21.000 filas y
 * unos 2 MB, y el de EAN 36.000 filas y 2,1 MB; 20 MB deja sitio de sobra
 * para que crezca y a la vez impide que una subida equivocada se coma la
 * memoria del contenedor, que es compartida con el resto del ERP.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/** Supabase corta cualquier consulta a 1000 filas y un .limit() mayor NO lo salta */
const PAGE = 1000

/**
 * Consulta paginada. El orden lo fija quien llama y tiene que terminar
 * siempre en una columna única: .range() sobre un orden con empates puede
 * repetir filas o saltárselas entre tramos, y aquí una fila saltada es un
 * listing que se queda sin actualizar.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw error
    const chunk = (data as T[]) ?? []
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

export interface StockSession {
  supabase: StockSupabase
  userId: string
}

/**
 * Sesión con permiso para el módulo, o la respuesta de error ya montada.
 *
 * Devolver la NextResponse en vez de lanzar deja el `return` en la ruta, que
 * es donde se lee mejor: `if (session instanceof NextResponse) return session`.
 */
export async function requireStockTeam(): Promise<StockSession | NextResponse> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail(401, 'Hay que iniciar sesión para usar la sincronización de stock')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !STOCK_ROLES.has(profile.role)) {
    return fail(403, 'Tu usuario no tiene acceso a la sincronización de stock')
  }

  return { supabase, userId: user.id }
}

export interface StockClientRow {
  id: string
  name: string
  slug: string
  is_active: boolean
}

/** El cliente del formulario, o la respuesta de error con el motivo concreto */
export async function requireClient(
  supabase: StockSupabase,
  clientId: unknown
): Promise<StockClientRow | NextResponse> {
  const id = typeof clientId === 'string' ? clientId.trim() : ''
  if (!id) return fail(400, 'Falta el cliente (client_id)')
  if (!UUID.test(id)) return fail(400, 'El cliente (client_id) no es un identificador válido')

  const { data, error } = await supabase
    .from('stock_clients')
    .select('id, name, slug, is_active')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  // maybeSingle() y no single(): un cliente que no existe es un 404 con
  // mensaje, no la excepción de «se esperaba una fila» que acabaría en 500.
  if (!data) return fail(404, 'Ese cliente no existe en la sincronización de stock')

  return data as StockClientRow
}

/**
 * Primer fichero del formulario que venga con alguno de esos nombres.
 *
 * Se aceptan varios alias porque la pantalla y las rutas se escriben por
 * separado: que el campo se llame `file` en vez de `stock` no debe costar un
 * error incomprensible en producción.
 */
export function fileFromForm(form: FormData, names: string[]): File | null {
  for (const name of names) {
    const value = form.get(name)
    // El File del runtime y el de Node no son la misma clase: se comprueba por
    // forma (tiene arrayBuffer y name) en vez de con instanceof.
    if (value && typeof value !== 'string' && typeof (value as File).arrayBuffer === 'function') {
      const file = value as File
      if (file.size > 0) return file
    }
  }
  return null
}

/** Bytes del fichero, comprobando antes el tamaño para no reservar 200 MB por error */
export async function readUpload(file: File, label: string): Promise<WorkbookInput> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new StockSyncError(
      `${label} ocupa ${megabytes(file.size)} MB y el máximo son ${megabytes(MAX_UPLOAD_BYTES)} MB`
    )
  }
  return await file.arrayBuffer()
}

/**
 * Nombre apto para una cabecera Content-Disposition: sin tildes, espacios ni
 * comillas. Un carácter fuera de latin1 ahí rompe la descarga entera.
 */
export function slug(value: string): string {
  const plain = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return plain || 'cliente'
}

export function fail(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Convierte cualquier fallo en una respuesta con una frase que se pueda leer.
 *
 * Los StockSyncError son problemas del fichero que ha subido la persona («la
 * hoja no tiene la columna St. Real») y se contestan con un 400 y el texto
 * tal cual: se arreglan solos. El resto se registra y sale como 500 genérico,
 * porque el mensaje de un error de Postgres no le dice nada a nadie y a veces
 * lleva dentro nombres de columnas y datos de otro cliente.
 */
export function errorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof StockSyncError) return fail(400, error.message)

  console.error(`${context}:`, error)
  return fail(500, 'No se ha podido completar el proceso. Vuelve a intentarlo y avisa si sigue fallando')
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}
