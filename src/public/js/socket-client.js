let socket = null;

function initSocketClient() {
  if (typeof io === 'undefined') {
    console.warn('Socket.io client library não carregada.');
    return;
  }

  socket = io();

  const statusEl = document.getElementById('socketStatusText');

  socket.on('connect', () => {
    console.log('⚡ Conectado ao servidor de tempo real (Socket.io)!');
    if (statusEl) statusEl.textContent = 'Tempo Real Ativo';
  });

  socket.on('disconnect', () => {
    console.warn('⚡ Desconectado do servidor de tempo real.');
    if (statusEl) statusEl.textContent = 'Reconectando...';
  });

  socket.on('stock_updated', (eventData) => {
    console.log('🔔 Evento em tempo real recebido:', eventData);

    const { type, data } = eventData;

    if (type === 'PRODUCT_CREATED') {
      showToast(`📦 Novo produto cadastrado: ${data.codigo} - ${data.produto}`, 'info');
    } else if (type === 'PRODUCT_UPDATED') {
      showToast(`✏️ Produto atualizado: ${data.codigo} - ${data.produto}`, 'info');
    } else if (type === 'PRODUCT_DELETED') {
      showToast(`🗑️ Produto excluído: ${data.codigo}`, 'info');
    } else if (type === 'STOCK_MOVEMENT') {
      const mov = data.movimentacao;
      const prod = data.produto;
      const icon = mov.tipo === 'ENTRADA' ? '📥' : mov.tipo === 'SAIDA' ? '📤' : '⚖️';
      showToast(`${icon} Movimentação (${mov.tipo}): ${prod.codigo} - Qtd: ${mov.quantidade} (Novo saldo: ${prod.qtd_estoque})`, 'success');
    }

    // Atualiza automaticamente as telas abertas sem precisar dar F5!
    if (window.loadDashboard) window.loadDashboard(false);
    if (window.loadProducts) window.loadProducts(false);
    if (window.loadMovements) window.loadMovements();
  });
}
