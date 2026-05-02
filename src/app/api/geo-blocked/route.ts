import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      error: 'Access denied',
      message: 'This service is not available in your region.',
      code: 'GEO_RESTRICTED',
    },
    {
      status: 403,
      headers: {
        'X-Geo-Blocked': 'true',
      },
    }
  );
}

export async function POST() {
  return NextResponse.json(
    {
      error: 'Access denied',
      message: 'This service is not available in your region.',
      code: 'GEO_RESTRICTED',
    },
    {
      status: 403,
      headers: {
        'X-Geo-Blocked': 'true',
      },
    }
  );
}

export async function PUT() {
  return NextResponse.json(
    {
      error: 'Access denied',
      message: 'This service is not available in your region.',
      code: 'GEO_RESTRICTED',
    },
    {
      status: 403,
      headers: {
        'X-Geo-Blocked': 'true',
      },
    }
  );
}

export async function DELETE() {
  return NextResponse.json(
    {
      error: 'Access denied',
      message: 'This service is not available in your region.',
      code: 'GEO_RESTRICTED',
    },
    {
      status: 403,
      headers: {
        'X-Geo-Blocked': 'true',
      },
    }
  );
}

export async function PATCH() {
  return NextResponse.json(
    {
      error: 'Access denied',
      message: 'This service is not available in your region.',
      code: 'GEO_RESTRICTED',
    },
    {
      status: 403,
      headers: {
        'X-Geo-Blocked': 'true',
      },
    }
  );
}
