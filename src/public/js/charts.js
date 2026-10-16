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
 * Gráfico mensal do Estoque Pro (SVG puro). Uma série = linha com área preenchida;
 * duas ou mais = linhas distintas com legenda e sem preenchimento.
 *
 * @param {HTMLElement} container  elemento com altura definida (.chart-wrap)
 * @param {Object[]} data          pontos mensais: { label, ano?, ...campos numéricos }
 * @param {{
 *   series?: {key:string, label?:string, color?:string}[],
 *   formatValue?: (n:number)=>string,   texto do valor no tooltip
 *   formatAxis?: (n:number)=>string,    rótulos do eixo Y
 *   animate?: boolean, emptyText?: string, ariaLabel?: string,
 *   onSelect?: (index:number)=>void     habilita clique/Enter no ponto
 * }} opts
 */
function renderAreaChart(container, data, opts = {}) {
  const {
    series = [{ key: 'valor', label: '', color: '#2563EB' }],
    formatValue = v => v.toLocaleString('pt-BR'),
    formatAxis = v => String(v),
    animate = false,
    emptyText = 'Sem dados no período',
    ariaLabel = 'Gráfico mensal',
    onSelect = null
  } = opts;
  const W = container.clientWidth;
  const H = container.clientHeight;
  if (!W || !H) return; // aba oculta: será desenhado de novo quando ficar visível

  const multi = series.length > 1;
  const valueOf = (d, s) => Number(d[s.key]) || 0;
  const maxVal = Math.max(0, ...data.flatMap(d => series.map(s => valueOf(d, s))));
  const scale = niceScale(maxVal);
  const ticks = [];
  for (let v = 0; v <= scale.max + 1e-9; v += scale.step) ticks.push(v);
  const axisLabels = ticks.map(formatAxis);

  // Margem esquerda acompanha o rótulo mais largo (ex.: "R$ 30 mil"); com legenda, sobra espaço no topo
  const m = {
    top: multi ? 32 : 12,
    right: 20,
    bottom: 28,
    left: Math.max(40, Math.ceil(Math.max(...axisLabels.map(t => t.length)) * 6.4) + 20)
  };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const inset = 16;
  const n = data.length;
  const xAt = i => m.left + inset + (n === 1 ? (plotW - inset * 2) / 2 : (i * (plotW - inset * 2)) / (n - 1));
  const yAt = v => m.top + plotH - (v / scale.max) * plotH;
  const baseY = m.top + plotH;

  const colors = series.map(s => s.color || '#2563EB');
  const points = series.map(s => data.map((d, i) => ({ x: xAt(i), y: yAt(valueOf(d, s)) })));
  const gid = `chartFill${++chartGradientSeq}`;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${ariaLabel}">`;
  if (!multi) {
    svg += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${colors[0]}" stop-opacity="0.28"/><stop offset="100%" stop-color="${colors[0]}" stop-opacity="0"/></linearGradient></defs>`;
  }

  // Rótulos do eixo Y e linhas verticais tracejadas por ponto (como no layout alvo)
  ticks.forEach((v, k) => {
    svg += `<text x="${m.left - 12}" y="${yAt(v) + 4}" text-anchor="end" font-size="11" fill="#94A3B8">${axisLabels[k]}</text>`;
  });
  data.forEach((d, i) => {
    svg += `<line x1="${xAt(i)}" x2="${xAt(i)}" y1="${m.top}" y2="${baseY}" stroke="#E2E8F0" stroke-dasharray="3 4"/>`;
    svg += `<text x="${xAt(i)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#94A3B8">${d.label}</text>`;
  });

  series.forEach((s, k) => {
    const pts = points[k];
    const line = monotonePath(pts);
    if (!multi && n > 1) {
      const area = `${line} L${pts[n - 1].x},${baseY} L${pts[0].x},${baseY} Z`;
      svg += `<path class="chart-area${animate ? ' animate' : ''}" d="${area}" fill="url(#${gid})"/>`;
    }
    svg += `<path class="chart-line${animate ? ' animate' : ''}" d="${line}" pathLength="1" fill="none" stroke="${colors[k]}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  series.forEach((s, k) => {
    points[k].forEach((p, i) => {
      svg += `<circle class="chart-dot" data-i="${i}" cx="${p.x}" cy="${p.y}" r="4" fill="${colors[k]}" stroke="#fff" stroke-width="2"/>`;
    });
  });

  // Faixas invisíveis para o hover (uma por mês)
  const band = n > 1 ? (plotW - inset * 2) / (n - 1) : plotW;
  data.forEach((d, i) => {
    const a11y = onSelect ? ` tabindex="0" role="button" aria-label="Ver vendas de ${d.label}"` : '';
    svg += `<rect class="chart-hit${onSelect ? ' clickable' : ''}" data-i="${i}"${a11y} x="${xAt(i) - band / 2}" y="${m.top}" width="${band}" height="${plotH}" fill="transparent"/>`;
  });
  svg += '</svg>';

  const legend = multi
    ? `<div class="chart-legend">${series.map((s, k) => `<span class="legend-item"><i class="legend-line" style="background:${colors[k]}"></i>${s.label || s.key}</span>`).join('')}</div>`
    : '';
  container.innerHTML = svg + legend + '<div class="chart-tooltip" role="status"></div>';
  if (maxVal === 0) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
  }

  const tip = container.querySelector('.chart-tooltip');
  const dots = container.querySelectorAll('.chart-dot');
  const highlight = index => dots.forEach(dot => dot.setAttribute('r', Number(dot.dataset.i) === index ? 6 : 4));

  container.querySelectorAll('.chart-hit').forEach(hit => {
    hit.addEventListener('pointerenter', () => {
      const i = Number(hit.dataset.i);
      highlight(i);
      const title = `<strong>${data[i].label}${data[i].ano ? ' ' + data[i].ano : ''}</strong>`;
      const rows = series.map((s, k) => {
        const text = formatValue(valueOf(data[i], s));
        return multi
          ? `<span class="tt-row"><i class="tt-dot" style="background:${colors[k]}"></i>${s.label || s.key}: ${text}</span>`
          : `<span>${text}</span>`;
      }).join('');
      tip.innerHTML = `${title}${rows}${onSelect ? '<em>Clique para ver os itens</em>' : ''}`;
      tip.style.left = `${xAt(i)}px`;
      tip.style.top = `${Math.min(...points.map(pts => pts[i].y)) - 12}px`;
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
      highlight(-1);
      tip.classList.remove('show');
    });
  });
}
