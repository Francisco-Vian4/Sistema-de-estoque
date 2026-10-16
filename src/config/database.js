const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const initSqlJs = require('sql.js');

let dbType = 'sqlite';
let pgPool = null;
let sqlJsDb = null;
let SQL = null;
// SQLITE_PATH permite apontar para outro arquivo (ex.: rodar testes sem tocar no banco de desenvolvimento)
const dbFilePath = process.env.SQLITE_PATH || path.join(__dirname, '../../data/estoque.db');

function saveSqliteDisk() {
  if (sqlJsDb) {
    try {
      const data = sqlJsDb.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbFilePath, buffer);
    } catch (err) {
      console.error('Erro ao salvar estoque.db em disco:', err.message);
    }
  }
}

async function initDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://'))) {
    try {
      console.log('🔄 Conectando ao PostgreSQL / Supabase...');
      pgPool = new Pool({
        connectionString: databaseUrl,
        ssl: databaseUrl.includes('supabase.co') || process.env.DB_SSL === 'true'
          ? { rejectUnauthorized: false }
          : false,
        connectionTimeoutMillis: 5000
      });

      // Testa conexão
      const client = await pgPool.connect();
      await client.query('SELECT 1');
      client.release();

      dbType = 'postgres';
      console.log('✅ Conectado com sucesso ao PostgreSQL / Supabase!');
      await runMigrations();
      return { dbType, pool: pgPool };
    } catch (err) {
      console.warn('⚠️ Falha ao conectar ao PostgreSQL (' + err.message + '). Alternando para SQLite local...');
      dbType = 'sqlite';
    }
  }

  // Inicializa SQLite via sql.js
  console.log('💾 Inicializando banco de dados local SQLite (sql.js)...');
  SQL = await initSqlJs();

  if (fs.existsSync(dbFilePath)) {
    const fileBuffer = fs.readFileSync(dbFilePath);
    sqlJsDb = new SQL.Database(fileBuffer);
    console.log('📂 Banco SQLite carregado a partir de:', dbFilePath);
  } else {
    sqlJsDb = new SQL.Database();
    console.log('✨ Novo banco SQLite criado.');
    saveSqliteDisk();
  }

  dbType = 'sqlite';
  await runMigrations();
  return { dbType, sqlJsDb };
}

// Converter queries entre $1, $2 (PG) e ?, ? (SQLite)
function convertParamsForSqlite(sql, params = []) {
  const convertedSql = sql.replace(/\$\d+/g, () => '?');
  return { sql: convertedSql, params };
}

async function query(sql, params = []) {
  if (dbType === 'postgres') {
    const result = await pgPool.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount
    };
  }

  // SQLite execution
  const { sql: sqliteSql, params: sqliteParams } = convertParamsForSqlite(sql, params);
  const trimmed = sqliteSql.trim();
  const isSelect = /^SELECT/i.test(trimmed) || /^PRAGMA/i.test(trimmed);

  try {
    if (isSelect) {
      const stmt = sqlJsDb.prepare(sqliteSql);
      stmt.bind(sqliteParams);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return { rows, rowCount: rows.length };
    } else {
      // INSERT, UPDATE, DELETE, CREATE, etc.
      sqlJsDb.run(sqliteSql, sqliteParams);
      saveSqliteDisk();

      let lastId = null;
      let changes = 0;
      try {
        const idRes = sqlJsDb.exec('SELECT last_insert_rowid() as id, changes() as changes');
        if (idRes.length > 0 && idRes[0].values && idRes[0].values.length > 0) {
          lastId = idRes[0].values[0][0];
          changes = idRes[0].values[0][1];
        }
      } catch (e) {}

      return {
        rows: lastId ? [{ id: lastId }] : [],
        rowCount: changes || 1
      };
    }
  } catch (err) {
    console.error('Erro na query SQLite:', err.message, '\nSQL:', sqliteSql, '\nParams:', sqliteParams);
    throw err;
  }
}

async function runMigrations() {
  console.log(`🔨 Verificando e criando tabelas (${dbType})...`);

  if (dbType === 'postgres') {
    await query(`
      CREATE TABLE IF NOT EXISTS produtos (
        id SERIAL PRIMARY KEY,
        codigo VARCHAR(50) UNIQUE NOT NULL,
        categoria VARCHAR(100),
        produto VARCHAR(255) NOT NULL,
        marca VARCHAR(100),
        modelo VARCHAR(255),
        descricao TEXT,
        unidade VARCHAR(20) DEFAULT 'UN',
        qtd_estoque INTEGER DEFAULT 0,
        estoque_minimo INTEGER DEFAULT 0,
        estoque_maximo INTEGER DEFAULT 0,
        preco_custo NUMERIC(10,2) DEFAULT 0,
        preco_venda NUMERIC(10,2) DEFAULT 0,
        margem_percent NUMERIC(6,2) DEFAULT 0,
        valor_total_estoque NUMERIC(12,2) DEFAULT 0,
        fornecedor VARCHAR(200),
        localizacao VARCHAR(100),
        data_entrada VARCHAR(50),
        status VARCHAR(50) DEFAULT 'OK',
        imagem_url TEXT,
        observacoes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        senha_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
        id SERIAL PRIMARY KEY,
        produto_id INTEGER NOT NULL,
        tipo VARCHAR(20) NOT NULL,
        quantidade INTEGER NOT NULL,
        quantidade_anterior INTEGER NOT NULL,
        quantidade_nova INTEGER NOT NULL,
        motivo TEXT,
        usuario_id INTEGER,
        usuario_nome VARCHAR(100),
        data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } else {
    // SQLite
    sqlJsDb.run(`
      CREATE TABLE IF NOT EXISTS produtos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT UNIQUE NOT NULL,
        categoria TEXT,
        produto TEXT NOT NULL,
        marca TEXT,
        modelo TEXT,
        descricao TEXT,
        unidade TEXT DEFAULT 'UN',
        qtd_estoque INTEGER DEFAULT 0,
        estoque_minimo INTEGER DEFAULT 0,
        estoque_maximo INTEGER DEFAULT 0,
        preco_custo REAL DEFAULT 0,
        preco_venda REAL DEFAULT 0,
        margem_percent REAL DEFAULT 0,
        valor_total_estoque REAL DEFAULT 0,
        fornecedor TEXT,
        localizacao TEXT,
        data_entrada TEXT,
        status TEXT DEFAULT 'OK',
        imagem_url TEXT,
        observacoes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        senha_hash TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_id INTEGER NOT NULL,
        tipo TEXT NOT NULL,
        quantidade INTEGER NOT NULL,
        quantidade_anterior INTEGER NOT NULL,
        quantidade_nova INTEGER NOT NULL,
        motivo TEXT,
        usuario_id INTEGER,
        usuario_nome TEXT,
        data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    saveSqliteDisk();
  }

  console.log('✅ Tabelas verificadas e prontas!');
}

function getDbType() {
  return dbType;
}

module.exports = {
  initDatabase,
  query,
  getDbType,
  saveSqliteDisk
};
