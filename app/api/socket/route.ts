import { NextRequest, NextResponse } from 'next/server';
import { initSocketServer, NextApiResponseWithSocket } from '@/lib/websocket';

export async function GET(req: NextRequest, res: NextApiResponseWithSocket) {
  try {
    initSocketServer(res);
    return NextResponse.json({ message: 'Socket server initialized' });
  } catch (error) {
    console.error('Socket initialization error:', error);
    return NextResponse.json(
      { error: 'Failed to initialize socket server' },
      { status: 500 }
    );
  }
}

// Configure socket route
export const config = {
  api: {
    bodyParser: false,
  },
};
