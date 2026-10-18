/**
 * Dados de DEMONSTRAÇÃO para o Painel Geral: gera ~12 meses de movimentações coerentes.
 *
 *   npm run seed:demo             gera o histórico (aborta se já houver movimentações)
 *   npm run seed:demo -- --limpar apaga as movimentações existentes e gera de novo
 *
 * O que ele faz:
 *  - Mantém o saldo ATUAL de cada produto exatamente como está. O histórico é construído de trás para a
 *    frente, então a soma das movimentações sempre termina no saldo que o produto já tem.
 *  - Reescreve `created_at` e `data_entrada` dos produtos para datas compatíveis com o histórico gerado.
 *  - Cria três perfis: produtos que vendem bem (ranking e gráfico), produtos que pararam de vender há
 *    2 a 4 meses e produtos que nunca saíram (lista "Itens sem saída").
 *
 * Segurança: só roda em SQLite local (recusa DATABASE_URL), recusa rodar com o servidor ligado na mesma
 * base e faz backup do arquivo antes de gravar (data/estoque.bak-AAAAMMDD-HHMMSS.db, ignorado pelo Git).
 * Para voltar atrás, basta copiar o backup por cima de data/estoque.db com o servidor parado.
 */
require('dotenv').config();
const fs = require('fs');
const net = require('net');
const path = require('path');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const pad = n => String(n).padStart(2, '0');
const stampUtc = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const brDate = ms => { const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };

// Gerador pseudoaleatório com semente fixa: rodar duas vezes gera o mesmo histórico
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261015);
const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));

// Intensidade de vendas por mês (do mais antigo para o atual): cresce com sazonalidade, como no layout alvo
const MONTH_FACTORS = [0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.85, 0.70, 1.05, 1.45, 1.50];
const AVG_SALE_QTY = 3;

function portInUse(port) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

// Saídas (vendas) de um produto entre entryMs e endMs, distribuídas mês a mês
function generateSales(base, maxQty, entryMs, endMs, now) {
  const sales = [];
  for (let i = 0; i < MONTH_FACTORS.length; i++) {
    const monthsAgo = MONTH_FACTORS.length - 1 - i;
    const monthStart = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1).getTime();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - monthsAgo + 1, 1).getTime();
    const from = Math.max(monthStart, entryMs + DAY);
    const to = Math.min(monthEnd - 1, endMs);
    if (to <= from) continue;

    const share = (to - from) / (monthEnd - monthStart); // mês parcial vende proporcionalmente
    const units = base * MONTH_FACTORS[i] * share;
    const n = Math.max(0, Math.round(units / AVG_SALE_QTY + (rand() - 0.5) * 1.5));
    for (let k = 0; k < n; k++) {
      const d = new Date(from + rand() * (to - from));
      d.setHours(8 + Math.floor(rand() * 10), Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
      if (d.getTime() > endMs || d.getTime() < from) continue;
      sales.push({ ts: d.getTime(), q: 1 + Math.floor(Math.pow(rand(), 1.5) * maxQty) });
    }
  }
  return sales.sort((a, b) => a.ts - b.ts);
}

// Constrói o histórico de trás para a frente: termina exatamente no saldo atual do produto.
// Quando o saldo "de antes" ficaria alto demais, insere uma reposição (ENTRADA) antes da venda.
function buildHistory(product, sales, entryMs, recentRestock = null) {
  const final = Number(product.qtd_estoque) || 0;
  // O estoque oscila em torno do saldo atual (reposição quando está baixo): evita que o painel mostre uma queda artificial de valor
  const ceiling = final + Math.max(5, Math.ceil(final * 0.3));
  const events = [];
  let balance = final;

  // Reposição recente (últimas horas): faz o feed "Últimas movimentações" misturar entradas e saídas
  if (recentRestock && recentRestock.q <= final - 1) {
    events.push({ ts: recentRestock.ts, tipo: 'ENTRADA', q: recentRestock.q, ant: final - recentRestock.q, nov: final });
    balance = final - recentRestock.q;
  }

  for (let i = sales.length - 1; i >= 0; i--) {
    const s = sales[i];
    const before = balance + s.q;
    events.push({ ts: s.ts, tipo: 'SAIDA', q: s.q, ant: before, nov: balance });
    balance = before;

    if (balance > ceiling) {
      const prevTs = i > 0 ? sales[i - 1].ts : entryMs;
      if (s.ts - prevTs > 60000) {
        const low = Math.min(Math.floor(final * 0.35) + randInt(0, 1), final);
        if (balance - low > 0) {
          const ts = prevTs + (s.ts - prevTs) * (0.25 + 0.5 * rand());
          events.push({ ts, tipo: 'ENTRADA', q: balance - low, ant: low, nov: balance });
          balance = low;
        }
      }
    }
  }
  return events.sort((a, b) => a.ts - b.ts);
}

async function main() {
  const db = require('./config/database');
  const { runSeed } = require('./seed');
  const limpar = process.argv.includes('--limpar');

  if (process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL está definido: este script só gera dados de demonstração em SQLite local.');
    process.exitCode = 1;
    return;
  }
  const dbFile = process.env.SQLITE_PATH || path.join(__dirname, '../data/estoque.db');
  if (!process.env.SQLITE_PATH) {
    const port = Number(process.env.PORT) || 3000;
    if (await portInUse(port)) {
      console.error(`❌ Há um servidor rodando na porta ${port}. Ele mantém o banco em memória e sobrescreveria estes dados.`);
      console.error('   Pare o servidor (Ctrl+C), rode "npm run seed:demo" e suba de novo com "npm start".');
      process.exitCode = 1;
      return;
    }
  }

  await db.initDatabase();
  await runSeed();

  const existing = Number((await db.query('SELECT COUNT(*) AS total FROM movimentacoes_estoque')).rows[0].total);
  if (existing > 0 && !limpar) {
    console.error(`❌ Já existem ${existing} movimentações. Use "npm run seed:demo -- --limpar" para apagar e gerar de novo.`);
    process.exitCode = 1;
    return;
  }

  if (fs.existsSync(dbFile)) {
    const now = new Date();
    const backup = path.join(path.dirname(dbFile), `estoque.bak-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.db`);
    fs.copyFileSync(dbFile, backup);
    console.log(`💾 Backup salvo em ${backup}`);
  }
  if (existing > 0) await db.query('DELETE FROM movimentacoes_estoque');

  const products = (await db.query('SELECT * FROM produtos ORDER BY id ASC')).rows;
  const admin = (await db.query("SELECT id, nome FROM usuarios WHERE role = 'admin' ORDER BY id ASC LIMIT 1")).rows[0];
  const now = new Date();
  const nowMs = now.getTime();

  // Sorteia o perfil de cada produto (embaralhamento determinístico)
  const order = products.map(p => p.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const nActive = Math.round(products.length * 0.5);
  const nStopped = Math.round(products.length * 0.23);
  const profile = new Map();
  order.forEach((id, i) => profile.set(id, i < nActive ? 'ativo' : i < nActive + nStopped ? 'parou' : 'nunca'));

  let rankActive = 0;
  let rankStopped = 0;
  let rankNever = 0;
  let recentRestocks = 0;
  let totalMovs = 0;
  const stats = { ativo: 0, parou: 0, nunca: 0 };

  for (const p of products) {
    const kind = profile.get(p.id);
    stats[kind]++;
    const cheap = Number(p.preco_venda) < 80;
    const maxQty = cheap ? 7 : 3;
    let entryMs;
    let events = [];

    if (kind === 'ativo') {
      rankActive++;
      entryMs = nowMs - randInt(120, 360) * DAY;
      const base = 38 / Math.pow(rankActive, 0.85); // unidades/mês na intensidade 1,0: forma um ranking nítido
      const final = Number(p.qtd_estoque) || 0;
      const recent = recentRestocks < 3 && final >= 8
        ? { ts: nowMs - [3, 11, 27][recentRestocks++] * HOUR, q: randInt(4, Math.min(30, final - 1)) }
        : null;
      events = buildHistory(p, generateSales(base, maxQty, entryMs, nowMs - 42 * HOUR, now), entryMs, recent);
    } else if (kind === 'parou') {
      rankStopped++;
      entryMs = nowMs - randInt(200, 360) * DAY;
      const lastSale = nowMs - (62 + (rankStopped - 1) * 8 + randInt(0, 5)) * DAY; // 62 a ~125 dias sem vender
      events = buildHistory(p, generateSales(14, maxQty, entryMs, lastSale, now), entryMs);
    } else {
      rankNever++;
      // 3 chegaram há pouco (ainda não contam como parados); os demais estão no estoque há 40 a 118 dias
      entryMs = nowMs - (rankNever <= 3 ? randInt(8, 25) : randInt(40, 118)) * DAY;
    }

    for (const e of events) {
      const entrada = e.tipo === 'ENTRADA';
      const motivo = entrada
        ? (rand() < 0.5 ? 'Entrada / Compra' : `Compra NF-e ${randInt(1000, 9999)}`)
        : (rand() < 0.7 ? `Venda #${randInt(1000, 1999)}` : `Ordem de serviço #${randInt(100, 999)}`);
      await db.query(
        `INSERT INTO movimentacoes_estoque
           (produto_id, tipo, quantidade, quantidade_anterior, quantidade_nova, motivo, usuario_id, usuario_nome, data_hora)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [p.id, e.tipo, e.q, e.ant, e.nov, motivo, admin.id, admin.nome, stampUtc(e.ts)]
      );
      totalMovs++;
    }

    await db.query('UPDATE produtos SET created_at = $1, data_entrada = $2 WHERE id = $3', [stampUtc(entryMs), brDate(entryMs), p.id]);
  }

  console.log(`✅ ${totalMovs} movimentações geradas para ${products.length} produtos`);
  console.log(`   perfis: ${stats.ativo} vendendo, ${stats.parou} pararam de vender, ${stats.nunca} sem nenhuma saída`);
  console.log('   Saldos atuais dos produtos NÃO foram alterados.');
}

main().catch(err => {
  console.error('❌ Falha ao gerar dados de demonstração:', err);
  process.exitCode = 1;
});
