import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/api'
import fs from 'fs'
import path from 'path'

/**
 * DINÁMICA A PROPÓSITO, NO POR CASUALIDAD.
 *
 * Hoy ya lo es: `requireSession()` lee cookies, y eso basta para que Next deje
 * de hornearla. Esta línea no cambia nada de lo que hace la ruta —está
 * comprobado comparando las tablas de rutas de dos builds— y sirve para que
 * siga siendo dinámica el día que alguien mueva la guarda de sitio. Sin ella,
 * la ruta vuelve a hornearse en el build y a servirse congelada, que es
 * exactamente lo que pasaba antes.
 *
 * OJO CON EL FICHERO: `lista_codigos_postales.txt` SÍ hace falta en tiempo de
 * ejecución ahora (antes se leía una vez durante el build). Está en la raíz,
 * `COPY . .` lo mete en la imagen y el .dockerignore no lo excluye. No moverlo
 * ni añadirlo al .dockerignore.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // QUÉ IMPIDE: que esta ruta le conteste a cualquiera de internet. No
    // comprobaba nada, y middleware.ts (línea 41) declara pública toda /api/,
    // así que bastaba un curl SIN cookie para dispararla. Ver lib/auth/api.ts,
    // donde está reproducido con el curl exacto.
    //
    // Lee y devuelve el fichero de códigos postales entero. La llama
    // components/usos-horarios/TimeZonesDashboard.tsx, con sesión.
    //
    // Se pide SESIÓN y nada más —ni rol ni permiso de módulo— a propósito: hoy
    // esta pantalla la abre cualquiera con sesión, y exigir un permiso que hoy
    // no se exige dejaría fuera a alguien que trabaja.
    const sesion = await requireSession()
    if (sesion instanceof NextResponse) return sesion

    const filePath = path.join(process.cwd(), 'lista_codigos_postales.txt')
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ codigos: [] }, { status: 200 })
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    const codigos = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^\d{5}$/.test(line))
    return NextResponse.json({ codigos })
  } catch (e) {
    console.error('Error reading codigos postales:', e)
    return NextResponse.json({ codigos: [] }, { status: 500 })
  }
}
