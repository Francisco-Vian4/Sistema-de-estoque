let io = null;

function initRealtime(serverIo) {
  io = serverIo;

  io.on('connection', (socket) => {
    console.log(`🔌 Novo cliente conectado via WebSocket: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`🔌 Cliente desconectado: ${socket.id}`);
    });

    socket.on('ping_check', (data) => {
      socket.emit('pong_check', { time: new Date().toISOString(), ...data });
    });
  });

  return io;
}

function getIo() {
  return io;
}

function broadcastEvent(eventName, data) {
  if (io) {
    io.emit(eventName, {
      ...data,
      timestamp: new Date().toISOString()
    });
  }
}

function notifyStockUpdate(type, data) {
  broadcastEvent('stock_updated', { type, data });
}

module.exports = {
  initRealtime,
  getIo,
  broadcastEvent,
  notifyStockUpdate
};
