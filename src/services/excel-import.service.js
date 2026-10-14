const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const db = require('../config/database');

function calculateStatus(qtd, min, max) {
  const q = Number(qtd) || 0;
  const mMin = Number(min) || 0;
  const mMax = Number(max) || 0;

  if (q <= 0) return 'SEM ESTOQUE';
  if (mMin > 0 && q <= mMin) return 'ESTOQUE BAIXO';
  if (mMax > 0 && q > mMax) return 'EXCESSO';
  return 'OK';
}

function calculateMargem(custo, venda) {
  const c = Number(custo) || 0;
  const v = Number(venda) || 0;
  if (c <= 0) return 0;
  return Number((((v - c) / c) * 100).toFixed(2));
}

function calculateValorTotal(qtd, custo) {
  const q = Number(qtd) || 0;
  const c = Number(custo) || 0;
  return Number((q * c).toFixed(2));
}

async function importExcelFile(customFilePath = null) {
  const defaultPath = path.join(__dirname, '../../data/controle_estoque_assistencia_tecnica.xlsx');
  const targetPath = customFilePath || defaultPath;

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Arquivo Excel não encontrado em: ${targetPath}`);
  }

  const wb = xlsx.readFile(targetPath);
  const sheetName = wb.SheetNames.includes('Estoque') ? 'Estoque' : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });

  let headerIndex = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    if (rows[i] && rows[i].some(col => String(col).toLowerCase().includes('código') || String(col).toLowerCase().includes('codigo'))) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error('Cabeçalho com coluna "Código" não encontrado na planilha.');
  }

  const productsToInsert = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0] || String(row[0]).trim() === '') continue;

    const codigo = String(row[0]).trim();
    const categoria = row[1] ? String(row[1]).trim() : 'Geral';
    const produto = row[2] ? String(row[2]).trim() : 'Produto sem nome';
    const marca = row[3] ? String(row[3]).trim() : '';
    const modelo = row[4] ? String(row[4]).trim() : '';
    const descricao = row[5] ? String(row[5]).trim() : '';
    const unidade = row[6] ? String(row[6]).trim() : 'UN';
    const qtd_estoque = parseInt(row[7], 10) || 0;
    const estoque_minimo = parseInt(row[8], 10) || 0;
    const estoque_maximo = parseInt(row[9], 10) || 0;
    const preco_custo = parseFloat(row[10]) || 0;
    const preco_venda = parseFloat(row[11]) || 0;

    let margem_percent = 0;
    if (row[12] !== undefined && row[12] !== null && row[12] !== '') {
      const rawMargem = parseFloat(row[12]);
      margem_percent = rawMargem <= 1 && rawMargem > 0 ? Number((rawMargem * 100).toFixed(2)) : Number(rawMargem.toFixed(2));
    } else {
      margem_percent = calculateMargem(preco_custo, preco_venda);
    }

    const valor_total_estoque = row[13] ? parseFloat(row[13]) : calculateValorTotal(qtd_estoque, preco_custo);
    const fornecedor = row[14] ? String(row[14]).trim() : '';
    const localizacao = row[15] ? String(row[15]).trim() : '';
    const data_entrada = row[16] ? String(row[16]).trim() : new Date().toLocaleDateString('pt-BR');
    const status = row[17] ? String(row[17]).trim() : calculateStatus(qtd_estoque, estoque_minimo, estoque_maximo);
    const imagem_url = row[18] ? String(row[18]).trim() : '';
    const observacoes = row[19] ? String(row[19]).trim() : '';

    productsToInsert.push({
      codigo,
      categoria,
      produto,
      marca,
      modelo,
      descricao,
      unidade,
      qtd_estoque,
      estoque_minimo,
      estoque_maximo,
      preco_custo,
      preco_venda,
      margem_percent,
      valor_total_estoque,
      fornecedor,
      localizacao,
      data_entrada,
      status,
      imagem_url,
      observacoes
    });
  }

  console.log(`📦 Carregando ${productsToInsert.length} produtos do Excel para o banco de dados...`);

  let inserted = 0;
  let updated = 0;

  for (const p of productsToInsert) {
    const existing = await db.query('SELECT id FROM produtos WHERE codigo = $1', [p.codigo]);

    if (existing.rows.length > 0) {
      await db.query(
        `UPDATE produtos SET 
          categoria = $1, produto = $2, marca = $3, modelo = $4, descricao = $5, unidade = $6,
          qtd_estoque = $7, estoque_minimo = $8, estoque_maximo = $9, preco_custo = $10,
          preco_venda = $11, margem_percent = $12, valor_total_estoque = $13, fornecedor = $14,
          localizacao = $15, data_entrada = $16, status = $17, imagem_url = $18, observacoes = $19,
          updated_at = CURRENT_TIMESTAMP
        WHERE codigo = $20`,
        [
          p.categoria, p.produto, p.marca, p.modelo, p.descricao, p.unidade,
          p.qtd_estoque, p.estoque_minimo, p.estoque_maximo, p.preco_custo,
          p.preco_venda, p.margem_percent, p.valor_total_estoque, p.fornecedor,
          p.localizacao, p.data_entrada, p.status, p.imagem_url, p.observacoes,
          p.codigo
        ]
      );
      updated++;
    } else {
      await db.query(
        `INSERT INTO produtos (
          codigo, categoria, produto, marca, modelo, descricao, unidade,
          qtd_estoque, estoque_minimo, estoque_maximo, preco_custo, preco_venda,
          margem_percent, valor_total_estoque, fornecedor, localizacao,
          data_entrada, status, imagem_url, observacoes
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        )`,
        [
          p.codigo, p.categoria, p.produto, p.marca, p.modelo, p.descricao, p.unidade,
          p.qtd_estoque, p.estoque_minimo, p.estoque_maximo, p.preco_custo, p.preco_venda,
          p.margem_percent, p.valor_total_estoque, p.fornecedor, p.localizacao,
          p.data_entrada, p.status, p.imagem_url, p.observacoes
        ]
      );
      inserted++;
    }
  }

  console.log(`✅ Importação concluída! Novos inseridos: ${inserted}, Atualizados: ${updated}.`);
  return { total: productsToInsert.length, inserted, updated };
}

module.exports = {
  importExcelFile,
  calculateStatus,
  calculateMargem,
  calculateValorTotal
};
