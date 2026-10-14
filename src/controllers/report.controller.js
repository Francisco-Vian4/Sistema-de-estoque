const PDFDocument = require('pdfkit-table');
const xlsx = require('xlsx');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, BorderStyle } = require('docx');
const db = require('../config/database');

async function getFilteredProducts(query) {
  const { status, categoria, q } = query;
  let sql = 'SELECT * FROM produtos WHERE 1=1';
  const params = [];
  let pIdx = 1;

  if (q) {
    sql += ` AND (LOWER(codigo) LIKE $${pIdx} OR LOWER(produto) LIKE $${pIdx} OR LOWER(categoria) LIKE $${pIdx})`;
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

  sql += ' ORDER BY codigo ASC';
  const result = await db.query(sql, params);
  return result.rows.map(r => ({
    ...r,
    qtd_estoque: Number(r.qtd_estoque),
    estoque_minimo: Number(r.estoque_minimo),
    estoque_maximo: Number(r.estoque_maximo),
    preco_custo: Number(r.preco_custo),
    preco_venda: Number(r.preco_venda),
    margem_percent: Number(r.margem_percent),
    valor_total_estoque: Number(r.valor_total_estoque)
  }));
}

// 1. GERAR RELATÓRIO PDF
async function exportPdf(req, res) {
  try {
    const products = await getFilteredProducts(req.query);
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio-estoque-${Date.now()}.pdf`);
    doc.pipe(res);

    // Cabeçalho estilizado em azul vibrante
    doc.rect(30, 25, 782, 50).fill('#1e40af');
    doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text('SISTEMA DE CONTROLE DE ESTOQUE — ASSISTÊNCIA TÉCNICA', 45, 36);
    doc.fontSize(10).font('Helvetica').text(`Relatório Gerencial Emitido em: ${new Date().toLocaleString('pt-BR')}`, 45, 58);

    doc.moveDown(2);

    // Sumário Executivo
    const totalItens = products.length;
    const totalQtd = products.reduce((acc, curr) => acc + curr.qtd_estoque, 0);
    const totalCusto = products.reduce((acc, curr) => acc + (curr.qtd_estoque * curr.preco_custo), 0);
    const totalVenda = products.reduce((acc, curr) => acc + (curr.qtd_estoque * curr.preco_venda), 0);
    const criticos = products.filter(p => p.status === 'SEM ESTOQUE' || p.status === 'ESTOQUE BAIXO').length;

    doc.fillColor('#1e293b').fontSize(11).font('Helvetica-Bold').text(
      `Total de Itens: ${totalItens}  |  Unidades Totais: ${totalQtd}  |  Valor Custo: R$ ${totalCusto.toFixed(2)}  |  Valor Venda: R$ ${totalVenda.toFixed(2)}  |  Alertas/Críticos: ${criticos}`,
      35,
      88
    );

    // Tabela detalhada
    const tableData = {
      headers: [
        { label: 'Código', property: 'codigo', width: 60, align: 'center' },
        { label: 'Produto / Peça', property: 'produto', width: 170, align: 'left' },
        { label: 'Categoria', property: 'categoria', width: 100, align: 'left' },
        { label: 'Un.', property: 'unidade', width: 35, align: 'center' },
        { label: 'Qtd.', property: 'qtd', width: 40, align: 'center' },
        { label: 'Min.', property: 'min', width: 35, align: 'center' },
        { label: 'Custo R$', property: 'custo', width: 65, align: 'right' },
        { label: 'Venda R$', property: 'venda', width: 65, align: 'right' },
        { label: 'Margem', property: 'margem', width: 55, align: 'right' },
        { label: 'Total R$', property: 'total', width: 75, align: 'right' },
        { label: 'Status', property: 'status', width: 80, align: 'center' }
      ],
      rows: products.map(p => [
        p.codigo,
        p.produto.length > 30 ? p.produto.substring(0, 30) + '...' : p.produto,
        p.categoria || '-',
        p.unidade || 'UN',
        String(p.qtd_estoque),
        String(p.estoque_minimo),
        `R$ ${p.preco_custo.toFixed(2)}`,
        `R$ ${p.preco_venda.toFixed(2)}`,
        `${p.margem_percent.toFixed(1)}%`,
        `R$ ${p.valor_total_estoque.toFixed(2)}`,
        p.status
      ])
    };

    await doc.table(tableData, {
      prepareHeader: () => doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e40af'),
      prepareRow: (row, i) => doc.font('Helvetica').fontSize(8).fillColor(i % 2 === 0 ? '#0f172a' : '#1e293b')
    });

    doc.end();
  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    res.status(500).json({ success: false, error: 'Erro ao gerar relatório PDF.' });
  }
}

// 2. GERAR RELATÓRIO EXCEL (.xlsx)
async function exportExcel(req, res) {
  try {
    const products = await getFilteredProducts(req.query);

    // Monta aba de Estoque com todas as 20 colunas
    const estoqueRows = [
      ['CONTROLE DE ESTOQUE — ASSISTÊNCIA TÉCNICA'],
      [`Gerado em: ${new Date().toLocaleString('pt-BR')}`],
      [],
      [
        'Código', 'Categoria', 'Produto / Peça', 'Marca', 'Modelo / Especificação',
        'Descrição', 'Unidade', 'Qtd. em Estoque', 'Estoque Mínimo', 'Estoque Máximo',
        'Preço de Custo (R$)', 'Preço de Venda (R$)', 'Margem (%)', 'Valor Total em Estoque (R$)',
        'Fornecedor', 'Localização (Prateleira)', 'Data de Entrada', 'Status',
        'Link da Imagem do Produto', 'Observações'
      ]
    ];

    products.forEach(p => {
      estoqueRows.push([
        p.codigo,
        p.categoria,
        p.produto,
        p.marca,
        p.modelo,
        p.descricao,
        p.unidade,
        p.qtd_estoque,
        p.estoque_minimo,
        p.estoque_maximo,
        p.preco_custo,
        p.preco_venda,
        p.margem_percent / 100,
        p.valor_total_estoque,
        p.fornecedor,
        p.localizacao,
        p.data_entrada,
        p.status,
        p.imagem_url,
        p.observacoes
      ]);
    });

    // Monta aba de Resumo
    const totalItens = products.length;
    const totalQtd = products.reduce((acc, curr) => acc + curr.qtd_estoque, 0);
    const totalCusto = products.reduce((acc, curr) => acc + (curr.qtd_estoque * curr.preco_custo), 0);
    const totalVenda = products.reduce((acc, curr) => acc + (curr.qtd_estoque * curr.preco_venda), 0);
    const okCount = products.filter(p => p.status === 'OK').length;
    const baixoCount = products.filter(p => p.status === 'ESTOQUE BAIXO').length;
    const semCount = products.filter(p => p.status === 'SEM ESTOQUE').length;

    const resumoRows = [
      ['RESUMO DO ESTOQUE'],
      [`Exportado em: ${new Date().toLocaleString('pt-BR')}`],
      [],
      ['Total de itens cadastrados', totalItens],
      ['Quantidade total em estoque (unidades)', totalQtd],
      ['Valor total do estoque (custo) (R$)', totalCusto],
      ['Valor total do estoque (venda) (R$)', totalVenda],
      ['Itens com status OK', okCount],
      ['Itens com estoque baixo', baixoCount],
      ['Itens sem estoque', semCount],
      ['Margem média estimada (%)', totalCusto > 0 ? ((totalVenda - totalCusto) / totalCusto) : 0]
    ];

    const wb = xlsx.utils.book_new();
    const wsEstoque = xlsx.utils.aoa_to_sheet(estoqueRows);
    const wsResumo = xlsx.utils.aoa_to_sheet(resumoRows);

    xlsx.utils.book_append_sheet(wb, wsEstoque, 'Estoque');
    xlsx.utils.book_append_sheet(wb, wsResumo, 'Resumo');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio-estoque-${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (err) {
    console.error('Erro ao gerar Excel:', err);
    res.status(500).json({ success: false, error: 'Erro ao gerar relatório Excel.' });
  }
}

// 3. GERAR RELATÓRIO WORD (.docx)
async function exportWord(req, res) {
  try {
    const products = await getFilteredProducts(req.query);

    const totalItens = products.length;
    const totalQtd = products.reduce((acc, curr) => acc + curr.qtd_estoque, 0);
    const totalCusto = products.reduce((acc, curr) => acc + (curr.qtd_estoque * curr.preco_custo), 0);
    const totalVenda = products.reduce((acc, curr) => acc + (curr.qtd_estoque * curr.preco_venda), 0);

    // Tabela Word
    const tableHeaderCells = [
      'Código', 'Produto / Peça', 'Categoria', 'Qtd', 'Custo (R$)', 'Venda (R$)', 'Margem (%)', 'Status', 'Localização'
    ].map(text => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 18 })],
        alignment: AlignmentType.CENTER
      })],
      shading: { fill: '1E40AF' }
    }));

    const tableRows = [
      new TableRow({ children: tableHeaderCells })
    ];

    products.forEach((p, index) => {
      const bgColor = index % 2 === 0 ? 'F8FAFC' : 'FFFFFF';
      const rowCells = [
        p.codigo,
        p.produto,
        p.categoria,
        String(p.qtd_estoque),
        `R$ ${p.preco_custo.toFixed(2)}`,
        `R$ ${p.preco_venda.toFixed(2)}`,
        `${p.margem_percent.toFixed(1)}%`,
        p.status,
        p.localizacao || '-'
      ].map(text => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text, size: 16 })],
          alignment: AlignmentType.LEFT
        })],
        shading: { fill: bgColor }
      }));

      tableRows.push(new TableRow({ children: rowCells }));
    });

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            text: 'RELATÓRIO DE CONTROLE DE ESTOQUE',
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER
          }),
          new Paragraph({
            text: `Assistência Técnica — Emitido em: ${new Date().toLocaleString('pt-BR')}`,
            alignment: AlignmentType.CENTER
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            children: [
              new TextRun({ text: 'RESUMO EXECUTIVO:\n', bold: true, color: '1E40AF', size: 22 }),
              new TextRun({ text: `• Total de Produtos Cadastrados: ${totalItens}\n` }),
              new TextRun({ text: `• Unidades Físicas em Estoque: ${totalQtd}\n` }),
              new TextRun({ text: `• Valor Total de Custo: R$ ${totalCusto.toFixed(2)}\n` }),
              new TextRun({ text: `• Valor Total de Venda: R$ ${totalVenda.toFixed(2)}\n` }),
              new TextRun({ text: `• Lucro Bruto Projetado: R$ ${(totalVenda - totalCusto).toFixed(2)}\n` })
            ]
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            text: 'TABELA DETALHADA DE ITENS',
            heading: HeadingLevel.HEADING_2
          }),
          new Table({
            rows: tableRows,
            width: { size: 100, type: WidthType.PERCENTAGE }
          })
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio-estoque-${Date.now()}.docx`);
    res.send(buffer);
  } catch (err) {
    console.error('Erro ao gerar Word (.docx):', err);
    res.status(500).json({ success: false, error: 'Erro ao gerar relatório Word.' });
  }
}

module.exports = {
  exportPdf,
  exportExcel,
  exportWord
};
