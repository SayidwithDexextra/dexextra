import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    // Test the live quotes API with ETH
    const testResponse = await fetch(`${request.nextUrl.origin}/api/live-quotes?symbol=ETH&convert=USD`)
    
    if (!testResponse.ok) {
      return NextResponse.json({
        success: false,
        error: `API test failed: ${testResponse.status}`,
        timestamp: new Date().toISOString()
      })
    }

    const testData = await testResponse.json()

    return NextResponse.json({
      success: true,
      message: 'Live quotes API is working correctly',
      testData,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: `Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      timestamp: new Date().toISOString()
    })
  }
} 