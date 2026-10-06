const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const { ensureConversationLinks, notifyNewMessage } = require('./messagingService');

let io = null;

function initSocket(server, supabaseUrl, supabaseServiceKey) {
  // Accepte plusieurs origines séparées par une virgule dans FRONTEND_URL
  const rawOrigins = process.env.FRONTEND_URL || 'http://localhost:5173';
  const allowedOrigins = rawOrigins.split(',').map(o => o.trim());

  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        // Autoriser les requêtes sans origin (ex : Postman, curl) et les origines listées
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS bloqué pour l'origine : ${origin}`));
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  supabaseAdmin
    .channel('notifications-broadcast')
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'notifications',
    }, ({ new: notification }) => {
      if (notification?.user_id) {
        io.to(`user:${notification.user_id}`).emit('notification:new', notification);
      }
    })
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'notifications',
    }, ({ new: notification }) => {
      if (notification?.user_id) {
        io.to(`user:${notification.user_id}`).emit('notification:changed', notification);
      }
    })
    .on('postgres_changes', {
      event: 'DELETE', schema: 'public', table: 'notifications',
    }, ({ old: notification }) => {
      if (notification?.user_id) {
        io.to(`user:${notification.user_id}`).emit('notification:changed', notification);
      }
    })
    .subscribe((status, error) => {
      if (error) console.error('❌ Realtime notifications indisponible:', error.message);
      else if (status === 'SUBSCRIBED') console.log('✅ Realtime notifications activé.');
    });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connecté : ${socket.id}`);

    socket.on('join:user', (userId) => {
      if (userId) {
        socket.join(`user:${userId}`);
        console.log(`👤 Socket ${socket.id} rejoint user:${userId}`);
      }
    });

    socket.on('join:staff', () => {
      socket.join('staff');
      console.log(`🏢 Socket ${socket.id} rejoint staff`);
    });

    socket.on('join:conversation', (conversationId) => {
      if (conversationId) {
        socket.join(`conv:${conversationId}`);
        console.log(`💬 Socket ${socket.id} rejoint conv:${conversationId}`);
      }
    });

    socket.on('leave:conversation', (conversationId) => {
      if (conversationId) {
        socket.leave(`conv:${conversationId}`);
      }
    });

    socket.on('message:send', async ({ conversationId, content, senderId }) => {
      if (!conversationId || !content || !senderId) return;

      const { data: message, error } = await supabaseAdmin
        .from('messages')
        .insert({ conversation_id: conversationId, sender_id: senderId, content: content.trim() })
        .select('*, profiles!sender_id (id, nom, prenom, photo_url, role)')
        .single();

      if (error) {
        socket.emit('message:error', { error: error.message });
        return;
      }

      await supabaseAdmin
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);

      const { data: senderProfile } = await supabaseAdmin
        .from('profiles')
        .select('tenant_id')
        .eq('id', senderId)
        .single();

      const { added } = await ensureConversationLinks(supabaseAdmin, conversationId, senderProfile?.tenant_id || null);
      added.forEach(staffId => {
        io.to(`user:${staffId}`).emit('conversation:update', {
          conversation_id: conversationId,
          last_message: { id: message.id, content: message.content, sender_id: senderId, created_at: message.created_at },
        });
      });

      io.to(`conv:${conversationId}`).emit('message:received', {
        conversation_id: conversationId,
        message,
      });

      const { data: members } = await supabaseAdmin
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .neq('user_id', senderId);

      (members || []).forEach(m => {
        io.to(`user:${m.user_id}`).emit('conversation:update', {
          conversation_id: conversationId,
          last_message: { id: message.id, content: message.content, sender_id: senderId, created_at: message.created_at },
        });
      });

      await notifyNewMessage(supabaseAdmin, conversationId, message, senderId);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket déconnecté : ${socket.id}`);
    });
  });

  console.log('✅ Socket.io initialisé.');
  return io;
}

function getIO() {
  return io;
}

function emitToUser(userId, event, data) {
  if (io) io.to(`user:${userId}`).emit(event, data);
}

function emitToStaff(event, data) {
  if (io) io.to('staff').emit(event, data);
}

function emitSessionStarted(sessionData) {
  emitToUser(sessionData.user_id, 'session:started', sessionData);
  emitToStaff('session:started', sessionData);
}

function emitSessionEnded(sessionData) {
  emitToUser(sessionData.user_id, 'session:ended', sessionData);
  emitToStaff('session:ended', sessionData);
}

function emitSessionOvertime(sessionData) {
  emitToUser(sessionData.user_id, 'session:overtime', sessionData);
  emitToStaff('session:overtime', sessionData);
}

function emitSessionAlert15Min(sessionData) {
  emitToUser(sessionData.user_id, 'session:alert-15min', sessionData);
  emitToStaff('session:alert-15min', sessionData);
}

function emitTimerUpdate(userId, timerData) {
  emitToUser(userId, 'session:timer', timerData);
}

function emitMessageReceived(conversationId, message) {
  if (io) io.to(`conv:${conversationId}`).emit('message:received', { conversation_id: conversationId, message });
}

function emitConversationUpdate(userId, data) {
  emitToUser(userId, 'conversation:update', data);
}

function emitNotification(userId, notification) {
  if (io && userId) {
    io.to(`user:${userId}`).emit('notification:new', notification);
  }
}

module.exports = {
  initSocket,
  getIO,
  emitToUser,
  emitToStaff,
  emitSessionStarted,
  emitSessionEnded,
  emitSessionOvertime,
  emitSessionAlert15Min,
  emitTimerUpdate,
  emitMessageReceived,
  emitConversationUpdate,
  emitNotification,
};
