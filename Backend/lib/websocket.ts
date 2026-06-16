import { Server as NetServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { NextApiResponse } from 'next';
import { AuthService } from './auth';
import { prisma } from './prisma';

export type NextApiResponseWithSocket = NextApiResponse & {
  socket: {
    server: NetServer & {
      io?: SocketIOServer;
    };
  };
};

export const initSocketServer = (res: NextApiResponseWithSocket) => {
  if (!res.socket.server.io) {
    console.log('Initializing Socket.IO server...');
    
    const io = new SocketIOServer(res.socket.server, {
      path: '/api/socket',
      addTrailingSlash: false,
      cors: {
        origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Authentication middleware
    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication required'));
        }

        const user = await AuthService.verifyToken(token);
        if (!user) {
          return next(new Error('Invalid token'));
        }

        socket.data.user = user;
        next();
      } catch (error) {
        next(new Error('Authentication failed'));
      }
    });

    // Connection handler
    io.on('connection', (socket) => {
      const user = socket.data.user;
      console.log(`User connected: ${user.email} (${socket.id})`);

      // Join user's personal room
      socket.join(`user:${user.userId}`);

      // Join role-based rooms
      if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
        socket.join('admin');
      }

      // Handle song progress subscription
      socket.on('subscribe:song', (songId: string) => {
        socket.join(`song:${songId}`);
        console.log(`Subscribed to song ${songId}`);
      });

      socket.on('unsubscribe:song', (songId: string) => {
        socket.leave(`song:${songId}`);
        console.log(`Unsubscribed from song ${songId}`);
      });

      // Admin: subscribe to system metrics
      socket.on('subscribe:system', () => {
        if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
          socket.join('system');
        }
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        console.log(`User disconnected: ${user.email} - Reason: ${reason}`);
      });

      // Handle errors
      socket.on('error', (error) => {
        console.error(`Socket error for user ${user.email}:`, error);
      });
    });

    // Set up periodic system metrics emission
    setInterval(async () => {
      try {
        const metrics = await getSystemMetrics();
        io.to('admin').emit('system:metrics', metrics);
      } catch (error) {
        console.error('Error sending system metrics:', error);
      }
    }, 5000); // Every 5 seconds

    res.socket.server.io = io;
  }

  return res.socket.server.io;
};

// Helper to emit song progress
export const emitSongProgress = (
  io: SocketIOServer,
  songId: string,
  userId: string,
  progress: number,
  status: string
) => {
  io.to(`song:${songId}`).emit('song:progress', {
    songId,
    progress,
    status,
    timestamp: new Date().toISOString(),
  });

  io.to(`user:${userId}`).emit('song:update', {
    songId,
    progress,
    status,
    timestamp: new Date().toISOString(),
  });
};

// Helper to emit system metrics
const getSystemMetrics = async () => {
  try {
    const [
      activeJobs,
      queueSize,
      totalSongs,
      activeUsers,
    ] = await Promise.all([
      prisma.job.count({ where: { status: 'processing' } }),
      prisma.job.count({ where: { status: 'pending' } }),
      prisma.song.count(),
      prisma.session.count({
        where: { expiresAt: { gt: new Date() } },
      }),
    ]);

    return {
      activeJobs,
      queueSize,
      totalSongs,
      activeUsers,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error getting system metrics:', error);
    return null;
  }
};

// Helper to emit to specific user
export const emitToUser = (
  io: SocketIOServer,
  userId: string,
  event: string,
  data: any
) => {
  io.to(`user:${userId}`).emit(event, data);
};

// Helper to broadcast to admins
export const emitToAdmins = (
  io: SocketIOServer,
  event: string,
  data: any
) => {
  io.to('admin').emit(event, data);
};
