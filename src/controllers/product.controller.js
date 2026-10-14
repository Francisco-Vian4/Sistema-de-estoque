const db = require('../config/database');
const { calculateStatus, calculateMargem, calculateValorTotal } = require('../services/excel-import.service');
const { notifyStockUpdate } = require('../services/realtime.service');

// Listar produtos com busca e filtros
async function list(req, res) {
  try {
    const { q, categoria, status, sort, order } = req.query;
    let sql = 'SELECT * FROM produtos WHERE 1=1';
    const params = [];
    let pIdx = 1;

    if (q) {
      sql += ` AND (LOWER(codigo) LIKE $${pIdx} OR LOWER(produto) LIKE $${pIdx} OR LOWER(marca) LIKE $${pIdx} OR LOWER(modelo) LIKE $${pIdx} OR LOWER(fornecedor) LIKE $${pIdx} OR LOWER(localizacao) LIKE $${pIdx})`;
      params.push(`%${q.trim().toLowerCase()}%`);
      pIdx++;
    }

    if (categoria && categoria !== 'TODAS') {
      sql += ` AND categoria = $${pIdx}`;
      params.push(categoria);
      pIdx++;
    }

    if (status && status !== 'TODOS') {
      sql += ` AND status = $${pIdx}`;
      params.push(status);
      pIdx++;
    }

    const sortColumn = ['codigo', 'produto', 'categoria', 'qtd_estoque', 'preco_venda', 'valor_total_estoque', 'status'].includes(sort)
      ? sort
      : 'codigo';
    const sortOrder = order && order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    sql += ` ORDER BY ${sortColumn} ${sortOrder}`;

    const result = await db.query(sql, params);

    // Se o usuário não for admin, podemos omitir dados sigilosos ou exibir normalmente
    const rows = result.rows.map(r => ({
      ...r,
      qtd_estoque: Number(r.qtd_estoque),
      estoque_minimo: Number(r.estoque_minimo),
      estoque_maximo: Number(r.estoque_maximo),
      preco_custo: Number(r.preco_custo),
      preco_venda: Number(r.preco_venda),
      margem_percent: Number(r.margem_percent),
      valor_total_estoque: Number(r.valor_total_estoque)
    }));

    return res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('Erro ao listar produtos:', err);
    return res.status(500).json({ success: false, error: 'Erro ao listar produtos.' });
  }
}

// Obter produto por ID
async function getById(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM produtos WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Produto não encontrado.' });
    }
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erro ao buscar produto.' });
  }
}

// Cadastrar novo produto
async function create(req, res) {
  try {
    const body = req.body;

    if (!body.codigo || !body.produto) {
      return res.status(400).json({ success: false, error: 'Código e Nome do Produto são obrigatórios.' });
    }

    const existing = await db.query('SELECT id FROM produtos WHERE codigo = $1', [body.codigo.trim()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, error: `Já existe um produto com o código "${body.codigo}".` });
    }

    const qtd = parseInt(body.qtd_estoque, 10) || 0;
    const estMin = parseInt(body.estoque_minimo, 10) || 0;
    const estMax = parseInt(body.estoque_maximo, 10) || 0;
    const custo = parseFloat(body.preco_custo) || 0;
    const venda = parseFloat(body.preco_venda) || 0;

    const margem = body.margem_percent !== undefined && body.margem_percent !== ''
      ? parseFloat(body.margem_percent)
      : calculateMargem(custo, venda);

    const valorTotal = calculateValorTotal(qtd, custo);
    const status = body.status || calculateStatus(qtd, estMin, estMax);
    const dataEntrada = body.data_entrada || new Date().toLocaleDateString('pt-BR');

    const result = await db.query(
      `INSERT INTO produtos (
        codigo, categoria, produto, marca, modelo, descricao, unidade,
        qtd_estoque, estoque_minimo, estoque_maximo, preco_custo, preco_venda,
        margem_percent, valor_total_estoque, fornecedor, localizacao,
        data_entrada, status, imagem_url, observacoes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      )`,
      [
        body.codigo.trim(),
        body.categoria ? body.categoria.trim() : 'Geral',
        body.produto.trim(),
        body.marca ? body.marca.trim() : '',
        body.modelo ? body.modelo.trim() : '',
        body.descricao ? body.descricao.trim() : '',
        body.unidade ? body.unidade.trim() : 'UN',
        qtd,
        estMin,
        estMax,
        custo,
        venda,
        margem,
        valorTotal,
        body.fornecedor ? body.fornecedor.trim() : '',
        body.localizacao ? body.localizacao.trim() : '',
        dataEntrada,
        status,
        body.imagem_url ? body.imagem_url.trim() : '',
        body.observacoes ? body.observacoes.trim() : ''
      ]
    );

    const newProd = (await db.query('SELECT * FROM produtos WHERE codigo = $1', [body.codigo.trim()])).rows[0];

    // Transmite via WebSocket em tempo real para web e extensão
    notifyStockUpdate('PRODUCT_CREATED', newProd);

    return res.status(201).json({
      success: true,
      message: 'Produto cadastrado com sucesso!',
      data: newProd
    });
  } catch (err) {
    console.error('Erro ao cadastrar produto:', err);
    return res.status(500).json({ success: false, error: 'Erro interno ao cadastrar produto.' });
  }
}

// Atualizar produto existente (Admin)
async function update(req, res) {
  try {
    const { id } = req.params;
    const body = req.body;

    const currentResult = await db.query('SELECT * FROM produtos WHERE id = $1', [id]);
    if (currentResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Produto não encontrado.' });
    }
    const current = currentResult.rows[0];

    // Verificar se novo código colide com outro produto
    if (body.codigo && body.codigo.trim() !== current.codigo) {
      const codeCheck = await db.query('SELECT id FROM produtos WHERE codigo = $1 AND id != $2', [body.codigo.trim(), id]);
      if (codeCheck.rows.length > 0) {
        return res.status(400).json({ success: false, error: `O código "${body.codigo}" já está em uso por outro produto.` });
      }
    }

    const codigo = body.codigo ? body.codigo.trim() : current.codigo;
    const categoria = body.categoria !== undefined ? body.categoria.trim() : current.categoria;
    const produto = body.produto !== undefined ? body.produto.trim() : current.produto;
    const marca = body.marca !== undefined ? body.marca.trim() : current.marca;
    const modelo = body.modelo !== undefined ? body.modelo.trim() : current.modelo;
    const descricao = body.descricao !== undefined ? body.descricao.trim() : current.descricao;
    const unidade = body.unidade !== undefined ? body.unidade.trim() : current.unidade;

    const qtd = body.qtd_estoque !== undefined ? (parseInt(body.qtd_estoque, 10) || 0) : current.qtd_estoque;
    const estMin = body.estoque_minimo !== undefined ? (parseInt(body.estoque_minimo, 10) || 0) : current.estoque_minimo;
    const estMax = body.estoque_maximo !== undefined ? (parseInt(body.estoque_maximo, 10) || 0) : current.estoque_maximo;
    const custo = body.preco_custo !== undefined ? (parseFloat(body.preco_custo) || 0) : current.preco_custo;
    const venda = body.preco_venda !== undefined ? (parseFloat(body.preco_venda) || 0) : current.preco_venda;

    const margem = calculateMargem(custo, venda);
    const valorTotal = calculateValorTotal(qtd, custo);
    const status = body.status || calculateStatus(qtd, estMin, estMax);

    const fornecedor = body.fornecedor !== undefined ? body.fornecedor.trim() : current.fornecedor;
    const localizacao = body.localizacao !== undefined ? body.localizacao.trim() : current.localizacao;
    const dataEntrada = body.data_entrada !== undefined ? body.data_entrada.trim() : current.data_entrada;
    const imagemUrl = body.imagem_url !== undefined ? body.imagem_url.trim() : current.imagem_url;
    const observacoes = body.observacoes !== undefined ? body.observacoes.trim() : current.observacoes;

    await db.query(
      `UPDATE produtos SET
        codigo = $1, categoria = $2, produto = $3, marca = $4, modelo = $5,
        descricao = $6, unidade = $7, qtd_estoque = $8, estoque_minimo = $9,
        estoque_maximo = $10, preco_custo = $11, preco_venda = $12, margem_percent = $13,
        valor_total_estoque = $14, fornecedor = $15, localizacao = $16, data_entrada = $17,
        status = $18, imagem_url = $19, observacoes = $20, updated_at = CURRENT_TIMESTAMP
      WHERE id = $21`,
      [
        codigo, categoria, produto, marca, modelo, descricao, unidade,
        qtd, estMin, estMax, custo, venda, margem, valorTotal,
        fornecedor, localizacao, dataEntrada, status, imagemUrl, observacoes,
        id
      ]
    );

    const updatedProd = (await db.query('SELECT * FROM produtos WHERE id = $1', [id])).rows[0];

    // Transmite em tempo real
    notifyStockUpdate('PRODUCT_UPDATED', updatedProd);

    return res.json({
      success: true,
      message: 'Produto atualizado com sucesso!',
      data: updatedProd
    });
  } catch (err) {
    console.error('Erro ao atualizar produto:', err);
    return res.status(500).json({ success: false, error: 'Erro ao atualizar produto.' });
  }
}

// Excluir produto (Admin)
async function remove(req, res) {
  try {
    const { id } = req.params;
    const existing = await db.query('SELECT * FROM produtos WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Produto não encontrado.' });
    }

    await db.query('DELETE FROM produtos WHERE id = $1', [id]);

    notifyStockUpdate('PRODUCT_DELETED', { id: Number(id), codigo: existing.rows[0].codigo });

    return res.json({ success: true, message: 'Produto excluído com sucesso!' });
  } catch (err) {
    console.error('Erro ao excluir produto:', err);
    return res.status(500).json({ success: false, error: 'Erro ao excluir produto.' });
  }
}

// Obter estatísticas do painel / Dashboard
async function getStats(req, res) {
  try {
    const prodsResult = await db.query('SELECT * FROM produtos');
    const items = prodsResult.rows;

    const totalItens = items.length;
    let totalQtd = 0;
    let totalCusto = 0;
    let totalVenda = 0;
    let okCount = 0;
    let baixoCount = 0;
    let semEstoqueCount = 0;
    let excessoCount = 0;

    const categoryMap = {};

    for (const item of items) {
      const qtd = Number(item.qtd_estoque) || 0;
      const custo = Number(item.preco_custo) || 0;
      const venda = Number(item.preco_venda) || 0;

      totalQtd += qtd;
      totalCusto += (qtd * custo);
      totalVenda += (qtd * venda);

      const st = String(item.status || '').toUpperCase();
      if (st === 'OK') okCount++;
      else if (st === 'ESTOQUE BAIXO' || st === 'BAIXO') baixoCount++;
      else if (st === 'SEM ESTOQUE' || st === 'CRÍTICO' || st === 'ZERADO') semEstoqueCount++;
      else excessoCount++;

      const cat = item.categoria || 'Outros';
      categoryMap[cat] = (categoryMap[cat] || 0) + 1;
    }

    const margemMedia = totalCusto > 0 ? Number((((totalVenda - totalCusto) / totalCusto) * 100).toFixed(2)) : 0;
    const precoMedioVenda = totalItens > 0 ? Number((items.reduce((acc, curr) => acc + Number(curr.preco_venda || 0), 0) / totalItens).toFixed(2)) : 0;

    const categories = Object.keys(categoryMap).map(name => ({
      categoria: name,
      total_itens: categoryMap[name]
    })).sort((a, b) => b.total_itens - a.total_itens);

    return res.json({
      success: true,
      stats: {
        total_itens: totalItens,
        total_quantidade: totalQtd,
        valor_total_custo: Number(totalCusto.toFixed(2)),
        valor_total_venda: Number(totalVenda.toFixed(2)),
        margem_media_percent: margemMedia,
        preco_medio_venda: precoMedioVenda,
        status: {
          ok: okCount,
          baixo: baixoCount,
          sem_estoque: semEstoqueCount,
          excesso: excessoCount
        },
        categorias: categories
      }
    });
  } catch (err) {
    console.error('Erro ao calcular estatísticas:', err);
    return res.status(500).json({ success: false, error: 'Erro ao obter estatísticas.' });
  }
}

// Obter lista única de categorias
async function getCategories(req, res) {
  try {
    const result = await db.query('SELECT DISTINCT categoria FROM produtos WHERE categoria IS NOT NULL ORDER BY categoria ASC');
    const categories = result.rows.map(r => r.categoria);
    return res.json({ success: true, categories });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erro ao listar categorias.' });
  }
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  getStats,
  getCategories
};
