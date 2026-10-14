require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const db = require('./config/database');
const { runSeed } = require('./seed');
const { initRealtime } = require('./services/realtime.service');
const apiRoutes = require('./routes/api.routes');

const app = express();
const server = http.createServer(app);

// Configuração de CORS permissivo (para extensões de navegador e conexões remotas)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Arquivos estáticos (Interface Web)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Socket.io com CORS habilitado
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
initRealtime(io);

// Rotas da API
app.use('/api', apiRoutes);

// Fallback SPA para interface web
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    console.log('🚀 Inicializando Sistema de Controle de Estoque...');
    await db.initDatabase();
    await runSeed();

    server.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(`✨ SISTEMA DE CONTROLE DE ESTOQUE PRO PRONTO!`);
      console.log(`🌐 Acesso Web: http://localhost:${PORT}`);
      console.log(`⚡ WebSocket / Tempo Real: Conectado`);
      console.log(`💾 Banco de Dados ativo: ${db.getDbType().toUpperCase()}`);
      console.log(`👤 Usuário Admin: admin@estoque.com | Senha: admin123`);
      console.log(`👤 Usuário Comum: usuario@estoque.com | Senha: user123`);
      console.log(`🧩 Extensão de Navegador disponível na pasta /extension`);
      console.log(`=======================================================`);
    });
  } catch (err) {
    console.error('❌ Falha crítica ao inicializar o servidor:', err);
    process.exit(1);
  }
}

startServer();
