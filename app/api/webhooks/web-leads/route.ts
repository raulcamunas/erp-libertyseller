import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validar campos requeridos (aceptar tanto 'nombre' como 'name', y 'telefono' como 'phone')
    const nombre = body.nombre || body.name
    const email = body.email
    const telefono = body.telefono || body.phone

    if (!nombre || !email) {
      return NextResponse.json(
        { error: 'Los campos "nombre" (o "name") y "email" son requeridos' },
        { status: 400 }
      )
    }

    // Crear cliente de Supabase público (sin autenticación para webhook)
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    // Construir mensaje con información adicional del formulario
    let mensaje = body.mensaje || ''
    const mensajeParts: string[] = []
    
    if (body.vendeEnAmazon) {
      mensajeParts.push(`Vende en Amazon: ${body.vendeEnAmazon}`)
    }
    if (body.sellingDuration) {
      mensajeParts.push(`Tiempo vendiendo: ${body.sellingDuration}`)
    }
    if (body.monthlyRevenue) {
      mensajeParts.push(`Facturación mensual: ${body.monthlyRevenue}`)
    }
    if (body.source) {
      mensajeParts.push(`Fuente: ${body.source}`)
    }
    
    if (mensajeParts.length > 0) {
      mensaje = mensajeParts.join('\n') + (mensaje ? '\n\n' + mensaje : '')
    }

    // Mapear campos del webhook a la tabla
    const leadData = {
      nombre: nombre,
      email: email,
      telefono: telefono || null,
      empresa: body.empresa || null,
      mensaje: mensaje || null,
      ingresos: body.ingresos || body.monthlyRevenue || null,
      status: 'registrado' // Estado inicial
    }

    // Insertar el lead en la base de datos
    const { data, error } = await supabase
      .from('web_leads')
      .insert([leadData])
      .select()
      .single()

    if (error) {
      console.error('Error inserting web lead:', error)
      return NextResponse.json(
        { error: 'Error al guardar el lead', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Lead creado exitosamente',
        data,
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('Error processing webhook:', error)
    return NextResponse.json(
      { error: 'Error al procesar la solicitud', details: error.message },
      { status: 500 }
    )
  }
}

// Método GET para verificar que el endpoint funciona
export async function GET() {
  return NextResponse.json(
    {
      message: 'Webhook endpoint para web leads',
      method: 'POST',
      required_fields: ['nombre (o name)', 'email'],
      optional_fields: [
        'telefono (o phone)',
        'empresa',
        'mensaje',
        'ingresos (o monthlyRevenue)',
        'vendeEnAmazon',
        'sellingDuration',
        'source',
        'timestamp'
      ],
      example: {
        nombre: 'Pepe',
        email: 'pepe@example.com',
        telefono: '678112754',
        vendeEnAmazon: 'Sí',
        sellingDuration: '0-1 año',
        monthlyRevenue: '0-5k',
        source: 'Hero Form'
      }
    },
    { status: 200 }
  )
}

