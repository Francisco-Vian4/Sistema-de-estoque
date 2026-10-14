const db = require('../config/database');
const { calculateStatus, calculateValorTotal } = require('../services/excel-import.service');
const { notifyStockUpdate } = require('../services/realtime.service');

// Registrar movimentação de estoque (Admin)
async function createMovement(req, res) {
  try {
    const { produto_id, tipo, quantidade, motivo } = req.body;

    if (!produto_id || !tipo || quantidade === undefined) {
      return res.status(400).json({ success: false, error: 'Produto, tipo de movimentação e quantidade são obrigatórios.' });
    }

    const tipoUpper = String(tipo).toUpperCase();
    if (!['ENTRADA', 'SAIDA', 'AJUSTE'].includes(tipoUpper)) {
      return res.status(400).json({ success: false, error: 'Tipo inválido. Deve ser ENTRADA, SAIDA ou AJUSTE.' });
    }

    const qtdMov = parseInt(quantidade, 10);
    if (isNaN(qtdMov) || qtdMov < 0) {
      return res.status(400).json({ success: false, error: 'Quantidade deve ser um número positivo.' });
    }

    const prodResult = await db.query('SELECT * FROM produtos WHERE id = $1', [produto_id]);
    if (prodResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Produto não encontrado.' });
    }

    const prod = prodResult.rows[0];
    const qtdAnterior = Number(prod.qtd_estoque) || 0;
    let qtdNova = qtdAnterior;

    if (tipoUpper === 'ENTRADA') {
      qtdNova = qtdAnterior + qtdMov;
    } else if (tipoUpper === 'SAIDA') {
      if (qtdMov > qtdAnterior) {
        return res.status(400).json({
          success: false,
          error: `Saldo insuficiente! Saldo atual: ${qtdAnterior}, tentativa de saída: ${qtdMov}.`
        });
      }
      qtdNova = qtdAnterior - qtdMov;
    } else if (tipoUpper === 'AJUSTE') {
      qtdNova = qtdMov;
    }

    const novoStatus = calculateStatus(qtdNova, prod.estoque_minimo, prod.estoque_maximo);
    const novoValorTotal = calculateValorTotal(qtdNova, prod.preco_custo);

    // Atualiza produto
    await db.query(
      `UPDATE produtos SET 
        qtd_estoque = $1, 
        valor_total_estoque = $2, 
        status = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4`,
      [qtdNova, novoValorTotal, novoStatus, prod.id]
    );

    // Registra histórico
    const usuarioId = req.user ? req.user.id : null;
    const usuarioNome = req.user ? req.user.nome : 'Sistema';

    const insertMov = await db.query(
      `INSERT INTO movimentacoes_estoque (
        produto_id, tipo, quantidade, quantidade_anterior, quantidade_nova,
        motivo, usuario_id, usuario_nome
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        prod.id,
        tipoUpper,
        qtdMov,
        qtdAnterior,
        qtdNova,
        motivo || (tipoUpper === 'ENTRADA' ? 'Entrada / Compra' : tipoUpper === 'SAIDA' ? 'Saída / Venda' : 'Ajuste de Balanço'),
        usuarioId,
        usuarioNome
      ]
    );

    const updatedProd = (await db.query('SELECT * FROM produtos WHERE id = $1', [prod.id])).rows[0];

    // Notifica em tempo real
    notifyStockUpdate('STOCK_MOVEMENT', {
      produto: updatedProd,
      movimentacao: {
        tipo: tipoUpper,
        quantidade: qtdMov,
        anterior: qtdAnterior,
        nova: qtdNova,
        motivo,
        usuario: usuarioNome,
        data_hora: new Date().toISOString()
      }
    });

    return res.status(201).json({
      success: true,
      message: `Movimentação de ${tipoUpper} registrada com sucesso! Novo saldo: ${qtdNova}.`,
      data: {
        produto_id: prod.id,
        codigo: prod.codigo,
        produto: prod.produto,
        tipo: tipoUpper,
        quantidade: qtdMov,
        quantidade_anterior: qtdAnterior,
        quantidade_nova: qtdNova,
        status: novoStatus
      }
    });
  } catch (err) {
    console.error('Erro na movimentação:', err);
    return res.status(500).json({ success: false, error: 'Erro ao registrar movimentação de estoque.' });
  }
}

// Histórico de movimentações
async function listMovements(req, res) {
  try {
    const { limit = 50, produto_id } = req.query;
    let sql = `
      SELECT m.*, p.codigo as produto_codigo, p.produto as produto_nome, p.unidade
      FROM movimentacoes_estoque m
      JOIN produtos p ON m.produto_id = p.id
    `;
    const params = [];

    if (produto_id) {
      sql += ' WHERE m.produto_id = $1';
      params.push(produto_id);
    }

    sql += ' ORDER BY m.id DESC LIMIT ' + (parseInt(limit, 10) || 50);

    const result = await db.query(sql, params);
    return res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (err) {
    console.error('Erro ao listar movimentações:', err);
    return res.status(500).json({ success: false, error: 'Erro ao buscar movimentações.' });
  }
}

module.exports = {
  createMovement,
  listMovements
};
