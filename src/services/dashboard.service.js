const { calculateStatus } = require('./excel-import.service');

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// SQLite devolve 'YYYY-MM-DD HH:MM:SS' (UTC, sem fuso); o PostgreSQL devolve Date.
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const str = String(value).trim();
  const d = /[zZ]|[+-]\d{2}:?\d{2}$/.test(str) ? new Date(str) : new Date(str.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

// data_entrada é texto livre: aceita dd/mm/aaaa e ISO. Se não entender, usa created_at.
function parseEntrada(product) {
  const raw = String(product.data_entrada || '').trim();
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) {
    const d = new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1])));
    if (!isNaN(d.getTime())) return d;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw.slice(0, 10) + 'T00:00:00Z');
    if (!isNaN(d.getTime())) return d;
  }
  return toDate(product.created_at);
}

function pct(now, before) {
  if (!before) return null;
  return Number((((now - before) / before) * 100).toFixed(1));
}

/**
 * Monta os números do painel (cards, gráfico, ranking, itens parados e últimas movimentações).
 * Função pura: recebe as linhas do banco e devolve o objeto da resposta.
 *
 * O saldo histórico é reconstruído desfazendo as movimentações posteriores à data
 * (delta = quantidade_nova - quantidade_anterior). Custo e preço usam o valor atual,
 * porque o sistema não guarda histórico de preços.
 */
function buildOverview(products, movements, { period = 30, months = 6, now = new Date(), isAdmin = false } = {}) {
  const nowMs = now.getTime();
  const cutoffMs = nowMs - period * DAY_MS;

  const movs = movements.map(m => ({
    ...m,
    ts: (toDate(m.data_hora) || now).getTime(),
    delta: (Number(m.quantidade_nova) || 0) - (Number(m.quantidade_anterior) || 0)
  }));

  const movsByProduct = new Map();
  for (const m of movs) {
    if (!movsByProduct.has(m.produto_id)) movsByProduct.set(m.produto_id, []);
    movsByProduct.get(m.produto_id).push(m);
  }

  const rows = products.map(p => {
    const createdAt = toDate(p.created_at);
    const list = movsByProduct.get(p.id) || [];
    const saidas = list.filter(m => m.tipo === 'SAIDA').map(m => m.ts);
    return {
      p,
      qtd: Number(p.qtd_estoque) || 0,
      min: Number(p.estoque_minimo) || 0,
      max: Number(p.estoque_maximo) || 0,
      custo: Number(p.preco_custo) || 0,
      venda: Number(p.preco_venda) || 0,
      createdMs: createdAt ? createdAt.getTime() : 0,
      entradaMs: (parseEntrada(p) || now).getTime(),
      list,
      saidas
    };
  });

  const qtyAt = (r, t) => r.qtd - r.list.filter(m => m.ts > t).reduce((acc, m) => acc + m.delta, 0);

  // Foto do estoque em um instante t: só produtos que já existiam e saldo reconstruído.
  function snapshot(t) {
    const items = [];
    for (const r of rows) {
      if (t < nowMs && r.createdMs > t) continue;
      const qtd = t >= nowMs ? r.qtd : Math.max(0, qtyAt(r, t));
      items.push({ r, qtd });
    }
    let custo = 0;
    let venda = 0;
    let baixo = 0;
    let semSaida = 0;
    for (const { r, qtd } of items) {
      custo += qtd * r.custo;
      venda += qtd * r.venda;
      const st = calculateStatus(qtd, r.min, r.max);
      if (st === 'ESTOQUE BAIXO' || st === 'SEM ESTOQUE') baixo++;
      if (qtd > 0 && daysIdle(r, t) >= period) semSaida++;
    }
    return {
      existentes: items.length,
      valor: custo,
      margem: custo > 0 ? ((venda - custo) / custo) * 100 : 0,
      temCusto: custo > 0,
      baixo,
      semSaida
    };
  }

  // Dias desde a última saída (ou desde a entrada, se nunca saiu) até o instante t.
  function daysIdle(r, t) {
    const lastSaida = r.saidas.filter(ts => ts <= t).reduce((a, b) => Math.max(a, b), 0);
    const ref = lastSaida || Math.min(r.entradaMs, t);
    return Math.floor((t - ref) / DAY_MS);
  }

  const atual = snapshot(nowMs);
  const anterior = snapshot(cutoffMs);
  const temBase = anterior.existentes > 0;

  const cards = {
    total_itens: products.length,
    total_unidades: rows.reduce((acc, r) => acc + r.qtd, 0),
    itens_sem_saida: { valor: atual.semSaida, delta: temBase ? atual.semSaida - anterior.semSaida : null },
    estoque_baixo: {
      valor: atual.baixo,
      delta: temBase ? atual.baixo - anterior.baixo : null,
      sem_estoque: rows.filter(r => r.qtd <= 0).length
    }
  };
  // Valores financeiros só saem do backend para administradores.
  if (isAdmin) {
    cards.valor_estoque = {
      valor: Number(atual.valor.toFixed(2)),
      delta_percent: temBase ? pct(atual.valor, anterior.valor) : null
    };
    cards.margem_media = {
      valor: Number(atual.margem.toFixed(1)),
      delta_pp: temBase && anterior.temCusto ? Number((atual.margem - anterior.margem).toFixed(1)) : null
    };
  }

  // Gráfico: unidades vendidas (SAIDA) por mês, dos últimos N meses incluindo o atual.
  const serie = [];
  const monthIndex = new Map();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() * 12 + d.getMonth();
    monthIndex.set(key, serie.length);
    serie.push({ label: MONTH_LABELS[d.getMonth()], ano: d.getFullYear(), chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, valor: 0 });
  }
  for (const m of movs) {
    if (m.tipo !== 'SAIDA') continue;
    const d = new Date(m.ts);
    const idx = monthIndex.get(d.getFullYear() * 12 + d.getMonth());
    if (idx !== undefined) serie[idx].valor += Number(m.quantidade) || 0;
  }

  const brief = r => ({
    id: r.p.id,
    codigo: r.p.codigo,
    produto: r.p.produto,
    imagem_url: r.p.imagem_url || null,
    unidade: r.p.unidade || 'UN'
  });

  // Ranking: produtos com mais unidades vendidas no período.
  const vendidos = new Map();
  for (const m of movs) {
    if (m.tipo === 'SAIDA' && m.ts >= cutoffMs) {
      vendidos.set(m.produto_id, (vendidos.get(m.produto_id) || 0) + (Number(m.quantidade) || 0));
    }
  }
  const ranking = rows
    .filter(r => vendidos.has(r.p.id))
    .map(r => ({ ...brief(r), quantidade: vendidos.get(r.p.id) }))
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, 5);

  const semSaida = rows
    .filter(r => r.qtd > 0)
    .map(r => ({ ...brief(r), dias: daysIdle(r, nowMs) }))
    .filter(r => r.dias >= period)
    .sort((a, b) => b.dias - a.dias)
    .slice(0, 5);

  const ultimas = movs
    .slice()
    .sort((a, b) => b.ts - a.ts || Number(b.id) - Number(a.id))
    .slice(0, 5)
    .map(m => ({
      id: m.id,
      tipo: m.tipo,
      produto: m.produto_nome,
      codigo: m.produto_codigo,
      quantidade: Number(m.quantidade) || 0,
      saldo: Number(m.quantidade_nova) || 0,
      unidade: m.unidade || 'UN',
      motivo: m.motivo || null,
      fornecedor: m.fornecedor || null,
      usuario_nome: m.usuario_nome || null,
      data_hora: new Date(m.ts).toISOString()
    }));

  return { periodo_dias: period, meses: months, cards, serie, ranking, sem_saida: semSaida, ultimas };
}

/**
 * Detalhamento das vendas (movimentações SAIDA) de um mês: unidades e valor por item, com totais.
 * month é 0-11 (como Date#getMonth). O valor usa o preço de venda ATUAL do produto (não há histórico de preço)
 * e só é calculado para administradores.
 */
function buildMonthSales(products, saidas, { year, month, isAdmin = false }) {
  const byId = new Map(products.map(p => [p.id, p]));
  const acc = new Map();

  for (const m of saidas) {
    if (m.tipo !== 'SAIDA') continue;
    const when = toDate(m.data_hora);
    if (!when || when.getFullYear() !== year || when.getMonth() !== month) continue;
    const p = byId.get(m.produto_id);
    if (!p) continue;
    if (!acc.has(p.id)) acc.set(p.id, { id: p.id, codigo: p.codigo, produto: p.produto, unidade: p.unidade || 'UN', quantidade: 0, preco: Number(p.preco_venda) || 0 });
    acc.get(p.id).quantidade += Number(m.quantidade) || 0;
  }

  const itens = [...acc.values()]
    .sort((a, b) => b.quantidade - a.quantidade || a.produto.localeCompare(b.produto))
    .map(({ preco, ...item }) => (isAdmin ? { ...item, valor: Number((item.quantidade * preco).toFixed(2)) } : item));

  const total = { quantidade: itens.reduce((sum, i) => sum + i.quantidade, 0) };
  if (isAdmin) total.valor = Number(itens.reduce((sum, i) => sum + i.valor, 0).toFixed(2));

  return { mes: `${year}-${String(month + 1).padStart(2, '0')}`, itens, total };
}

module.exports = { buildOverview, buildMonthSales, toDate, parseEntrada };
