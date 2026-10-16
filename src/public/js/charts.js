// Gráfico de área do Estoque Pro (SVG puro, sem biblioteca).
// Especificação do design system: linha #2563EB 2.8px com pontas arredondadas, preenchimento 28% → 0,
// curva monotônica, tooltip com raio 12px e borda #E2E8F0, animação de entrada de 600ms.
let chartGradientSeq = 0;

// Curva monotônica (mesma ideia do monotone da Recharts): nunca "estoura" além dos pontos.
function monotonePath(pts) {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;

  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    m[i] = (pts[i + 1].y - pts[i].y) / dx[i];
  }
  const t = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    t[i] = m[i - 1] * m[i] <= 0
      ? 0
      : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  }

  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i];
    d += ` C${pts[i].x + h / 3},${pts[i].y + (t[i] * h) / 3} ${pts[i + 1].x - h / 3},${pts[i + 1].y - (t[i + 1] * h) / 3} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

// Escala "bonita" (0, 50, 100, 150, 200) com cerca de 4 intervalos.
function niceScale(max) {
  if (max <= 0) return { max: 4, step: 1 };
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  return { max: Math.ceil(max / step) * step, step };
}

/**
 * @param {HTMLElement} container  elemento com altura definida (.chart-wrap)
 * @param {{label:string, valor:number}[]} data
 * @param {{unit?:string, animate?:boolean, emptyText?:string, onSelect?:(index:number)=>void}} opts
 */
function renderAreaChart(container, data, opts = {}) {
  const { unit = 'un.', animate = false, emptyText = 'Sem dados no período', onSelect = null } = opts;
  const W = container.clientWidth;
  const H = container.clientHeight;
  if (!W || !H) return; // aba oculta: será desenhado de novo quando ficar visível

  const m = { top: 12, right: 20, bottom: 28, left: 40 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const inset = 16;

  const maxVal = data.reduce((a, d) => Math.max(a, d.valor), 0);
  const scale = niceScale(maxVal);
  const n = data.length;
  const xAt = i => m.left + inset + (n === 1 ? (plotW - inset * 2) / 2 : (i * (plotW - inset * 2)) / (n - 1));
  const yAt = v => m.top + plotH - (v / scale.max) * plotH;

  const pts = data.map((d, i) => ({ x: xAt(i), y: yAt(d.valor) }));
  const line = monotonePath(pts);
  const baseY = m.top + plotH;
  const area = n > 1 ? `${line} L${pts[n - 1].x},${baseY} L${pts[0].x},${baseY} Z` : '';
  const gid = `chartFill${++chartGradientSeq}`;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de unidades vendidas por mês">`;
  svg += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2563EB" stop-opacity="0.28"/><stop offset="100%" stop-color="#2563EB" stop-opacity="0"/></linearGradient></defs>`;

  // Rótulos do eixo Y e linhas verticais tracejadas por ponto (como no layout alvo)
  for (let v = 0; v <= scale.max + 1e-9; v += scale.step) {
    svg += `<text x="${m.left - 12}" y="${yAt(v) + 4}" text-anchor="end" font-size="11" fill="#94A3B8">${v}</text>`;
  }
  data.forEach((d, i) => {
    svg += `<line x1="${pts[i].x}" x2="${pts[i].x}" y1="${m.top}" y2="${baseY}" stroke="#E2E8F0" stroke-dasharray="3 4"/>`;
    svg += `<text x="${pts[i].x}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#94A3B8">${d.label}</text>`;
  });

  if (area) svg += `<path class="chart-area${animate ? ' animate' : ''}" d="${area}" fill="url(#${gid})"/>`;
  svg += `<path class="chart-line${animate ? ' animate' : ''}" d="${line}" pathLength="1" fill="none" stroke="#2563EB" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  pts.forEach((p, i) => {
    svg += `<circle class="chart-dot" data-i="${i}" cx="${p.x}" cy="${p.y}" r="4" fill="#2563EB" stroke="#fff" stroke-width="2"/>`;
  });

  // Faixas invisíveis para o hover (uma por ponto)
  const band = n > 1 ? (plotW - inset * 2) / (n - 1) : plotW;
  pts.forEach((p, i) => {
    const a11y = onSelect ? ` tabindex="0" role="button" aria-label="Ver vendas de ${data[i].label}"` : '';
    svg += `<rect class="chart-hit${onSelect ? ' clickable' : ''}" data-i="${i}"${a11y} x="${p.x - band / 2}" y="${m.top}" width="${band}" height="${plotH}" fill="transparent"/>`;
  });
  svg += '</svg>';

  container.innerHTML = svg + '<div class="chart-tooltip" role="status"></div>';
  if (maxVal === 0) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
  }

  const tip = container.querySelector('.chart-tooltip');
  const dots = container.querySelectorAll('.chart-dot');
  const fmt = v => v.toLocaleString('pt-BR');

  container.querySelectorAll('.chart-hit').forEach(hit => {
    hit.addEventListener('pointerenter', () => {
      const i = Number(hit.dataset.i);
      dots.forEach((dot, j) => dot.setAttribute('r', j === i ? 6 : 4));
      tip.innerHTML = `<strong>${data[i].label}${data[i].ano ? ' ' + data[i].ano : ''}</strong><span>${fmt(data[i].valor)} ${unit}</span>${onSelect ? '<em>Clique para ver os itens</em>' : ''}`;
      tip.style.left = `${pts[i].x}px`;
      tip.style.top = `${pts[i].y - 12}px`;
      tip.style.transform = 'translate(-50%, -100%)';
      tip.classList.add('show');
    });
    if (onSelect) {
      hit.addEventListener('click', () => onSelect(Number(hit.dataset.i)));
      hit.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(Number(hit.dataset.i)); }
      });
    }
    hit.addEventListener('pointerleave', () => {
      dots.forEach(dot => dot.setAttribute('r', 4));
      tip.classList.remove('show');
    });
  });
}
