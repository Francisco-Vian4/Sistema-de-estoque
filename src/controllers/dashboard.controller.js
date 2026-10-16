const db = require('../config/database');
const { buildOverview, buildMonthSales } = require('../services/dashboard.service');

const PERIODS = [7, 30, 90];
const MONTHS = [3, 6, 12];

function pick(value, allowed, fallback) {
  const n = parseInt(value, 10);
  return allowed.includes(n) ? n : fallback;
}

// Números do Painel Geral: cards com variação, gráfico de vendas, ranking, itens parados e últimas movimentações
async function getOverview(req, res) {
  try {
    const period = pick(req.query.period, PERIODS, 30);
    const months = pick(req.query.months, MONTHS, 6);

    const prods = await db.query('SELECT * FROM produtos');
    const movs = await db.query(`
      SELECT m.*, p.codigo AS produto_codigo, p.produto AS produto_nome, p.unidade, p.fornecedor
      FROM movimentacoes_estoque m
      JOIN produtos p ON m.produto_id = p.id
      ORDER BY m.id ASC
    `);

    const data = buildOverview(prods.rows, movs.rows, {
      period,
      months,
      isAdmin: req.user.role === 'admin'
    });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('Erro ao montar painel:', err);
    return res.status(500).json({ success: false, error: 'Erro ao carregar o painel.' });
  }
}

// Vendas de um mês específico, item a item (abre ao clicar num ponto do gráfico). ?month=AAAA-MM
async function getMonthSales(req, res) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(req.query.month || ''));
  if (!match) {
    return res.status(400).json({ success: false, error: 'Informe o mês no formato AAAA-MM (ex.: 2026-06).' });
  }

  try {
    const prods = await db.query('SELECT * FROM produtos');
    const saidas = await db.query("SELECT * FROM movimentacoes_estoque WHERE tipo = 'SAIDA'");
    const data = buildMonthSales(prods.rows, saidas.rows, {
      year: Number(match[1]),
      month: Number(match[2]) - 1,
      isAdmin: req.user.role === 'admin'
    });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('Erro ao detalhar vendas do mês:', err);
    return res.status(500).json({ success: false, error: 'Erro ao detalhar as vendas do mês.' });
  }
}

module.exports = { getOverview, getMonthSales };
