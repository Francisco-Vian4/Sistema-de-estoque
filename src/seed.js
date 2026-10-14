const bcrypt = require('bcryptjs');
const db = require('./config/database');
const { importExcelFile } = require('./services/excel-import.service');

async function runSeed() {
  console.log('🌱 Iniciando seed e configuração inicial...');

  // 1. Criar usuários padrão
  const users = [
    {
      nome: 'Administrador do Sistema',
      email: 'admin@estoque.com',
      senha: 'admin123',
      role: 'admin'
    },
    {
      nome: 'Operador de Estoque',
      email: 'usuario@estoque.com',
      senha: 'user123',
      role: 'user'
    }
  ];

  for (const u of users) {
    const existing = await db.query('SELECT id FROM usuarios WHERE email = $1', [u.email]);
    if (existing.rows.length === 0) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(u.senha, salt);
      await db.query(
        'INSERT INTO usuarios (nome, email, senha_hash, role) VALUES ($1, $2, $3, $4)',
        [u.nome, u.email, hash, u.role]
      );
      console.log(`👤 Usuário criado: ${u.email} (${u.role})`);
    } else {
      console.log(`👤 Usuário já existe: ${u.email}`);
    }
  }

  // 2. Verificar se há produtos cadastrados
  const prodsCount = await db.query('SELECT COUNT(*) as total FROM produtos');
  const total = parseInt(prodsCount.rows[0].total || prodsCount.rows[0]['count(*)'] || 0, 10);

  if (total === 0) {
    console.log('📦 Tabela de produtos vazia. Importando planilha Excel inicial...');
    try {
      const result = await importExcelFile();
      console.log(`🎉 Planilha importada com sucesso: ${result.total} itens cadastrados!`);
    } catch (err) {
      console.error('⚠️ Falha ao importar planilha no seed:', err.message);
    }
  } else {
    console.log(`📦 Produtos já cadastrados no banco: ${total} itens encontrados.`);
  }

  console.log('✅ Seed finalizado com sucesso!');
}

if (require.main === module) {
  require('dotenv').config();
  db.initDatabase()
    .then(() => runSeed())
    .then(() => {
      console.log('Processo encerrado.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Erro no seed:', err);
      process.exit(1);
    });
}

module.exports = { runSeed };
