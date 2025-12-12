import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    // Intentar parsear como JSON primero, si falla, intentar como form-data
    let body: any
    const contentType = request.headers.get('content-type') || ''
    
    try {
      if (contentType.includes('application/json')) {
        body = await request.json()
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await request.formData()
        body = Object.fromEntries(formData.entries())
      } else {
        // Intentar JSON por defecto
        body = await request.json()
      }
    } catch (parseError) {
      console.error('Error parsing request body:', parseError)
      return NextResponse.json(
        { error: 'Error al parsear el cuerpo de la solicitud', details: String(parseError) },
        { status: 400 }
      )
    }
    
    // Log para debugging
    console.log('Webhook received:', JSON.stringify(body, null, 2))
    console.log('Content-Type:', contentType)

    // Validar campos requeridos (aceptar tanto 'nombre' como 'name', y 'telefono' como 'phone')
    const nombre = body.nombre || body.name
    const email = body.email
    const telefono = body.telefono || body.phone

    if (!nombre || !email) {
      console.error('Validation error: missing nombre or email', { nombre, email })
      return NextResponse.json(
        { error: 'Los campos "nombre" (o "name") y "email" son requeridos' },
        { status: 400 }
      )
    }

    // Verificar que las variables de entorno estén configuradas
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.error('Missing Supabase environment variables')
      return NextResponse.json(
        { error: 'Error de configuración del servidor' },
        { status: 500 }
      )
    }

    // Crear cliente de Supabase público (sin autenticación para webhook)
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
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

    // Mapear campos del webhook a la tabla web_leads
    const leadData = {
      nombre: nombre.trim(),
      email: email.trim(),
      telefono: telefono ? telefono.trim() : null,
      empresa: body.empresa ? body.empresa.trim() : null,
      mensaje: mensaje || null,
      ingresos: body.ingresos || body.monthlyRevenue || null,
      status: 'registrado' as const // Estado inicial
    }

    console.log('Inserting lead data:', JSON.stringify(leadData, null, 2))

    // Usar función SQL con SECURITY DEFINER para bypassear RLS
    const { data, error } = await supabase.rpc('insert_web_lead', {
      p_nombre: leadData.nombre,
      p_email: leadData.email,
      p_telefono: leadData.telefono,
      p_empresa: leadData.empresa,
      p_mensaje: leadData.mensaje,
      p_ingresos: leadData.ingresos
    })

    if (error) {
      console.error('Error inserting web lead via function:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        leadData
      })
      
      // Si la función no existe, intentar insert directo como fallback
      if (error.code === '42883' || error.message.includes('function') || error.message.includes('does not exist')) {
        console.log('Function not found, trying direct insert...')
        const { data: directData, error: directError } = await supabase
          .from('web_leads')
          .insert([leadData])
          .select()
          .single()
        
        if (directError) {
          console.error('Error with direct insert:', directError)
          return NextResponse.json(
            { 
              error: 'Error al guardar el lead', 
              details: directError.message,
              code: directError.code,
              hint: directError.hint
            },
            { status: 500 }
          )
        }
        
        return NextResponse.json(
          {
            success: true,
            message: 'Lead creado exitosamente',
            data: directData,
          },
          { status: 201 }
        )
      }
      
      return NextResponse.json(
        { 
          error: 'Error al guardar el lead', 
          details: error.message,
          code: error.code,
          hint: error.hint
        },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Lead creado exitosamente',
        data,
      },
      { status: 201 }
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

