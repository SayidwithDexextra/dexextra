import { NextRequest, NextResponse } from 'next/server';
import { getPusherServer } from '@/lib/pusher-server';

export async function POST(request: NextRequest) {
  try {
    const { socket_id, channel_name } = await request.json();

    if (!socket_id || !channel_name) {
      return NextResponse.json(
        { error: 'Missing socket_id or channel_name' },
        { status: 400 }
      );
    }

    // Create a temporary Pusher instance for authentication
    const Pusher = (await import('pusher')).default;
    const pusher = new Pusher({
      appId: process.env.PUSHER_APP_ID!,
      key: process.env.PUSHER_KEY!,
      secret: process.env.PUSHER_SECRET!,
      cluster: process.env.PUSHER_CLUSTER || 'us2',
      useTLS: true,
    });
    
    // For now, we'll allow all private channel subscriptions
    // In production, you'd want to add proper authentication logic here
    // For example: check if user is authenticated and has permission for this channel
    
    // Extract user address from channel name for user-specific channels
    if (channel_name.startsWith('private-user-')) {
      const userAddress = channel_name.replace('private-user-', '');
      
      // TODO: Add authentication logic here
      // - Verify JWT token or session
      // - Check if the requesting user matches the channel's user address
      // - For now, we'll allow all requests for development
      
       console.log(`🔐 Authenticating private channel for user: ${userAddress}`);
    }

    // Authenticate the user for the private channel
    const authData = pusher.authorizeChannel(socket_id, channel_name);

    return NextResponse.json(authData);

  } catch (error) {
    console.error('Pusher auth error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 403 }
    );
  }
} 