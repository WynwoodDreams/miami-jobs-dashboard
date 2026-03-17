/* ═══════════════════════════════════════════════════════════════
   South Florida Pulse — Dashboard Script
   Modular, clean architecture with improved chart configs
═══════════════════════════════════════════════════════════════ */

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MON_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/* ── Chart.js global defaults for dark theme ── */
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.color = '#64748b';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';

/* Chart registry for range button updates */
const REGISTRY = {};

/* Tooltip presets */
const ttDark = {
  backgroundColor: 'rgba(15,23,42,0.95)',
  borderColor: 'rgba(255,255,255,0.1)',
  borderWidth: 1,
  titleColor: '#f1f5f9',
  bodyColor: '#94a3b8',
  padding: 12,
  cornerRadius: 10,
  titleFont: { weight: '700', size: 12 },
  bodyFont: { size: 11 },
  displayColors: true,
  boxPadding: 4
};

const gridDark = { color: 'rgba(255,255,255,0.04)' };
const ticksDark = { color: '#475569', maxTicksLimit: 10, maxRotation: 0 };

/* ── Lazy tab tracking ── */
const tabBuilt = { dashboard: true, national: false, signals: false, ai: false };

/* ── Tab switching (with lazy chart building) ── */
function switchTab(tab) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + tab).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

  // Close mobile menu
  document.querySelector('.nav-tabs').classList.remove('open');

  // Lazy-build charts for this tab on first visit
  if (!tabBuilt[tab] && window._dashData) {
    const { uData, nuData } = window._dashData;
    if (tab === 'national' && nuData) buildNationSection(uData, nuData);
    if (tab === 'signals') buildSignalsCharts();
    if (tab === 'ai') buildAICharts();
    tabBuilt[tab] = true;
  }
}

/* ── Mobile menu toggle ── */
function toggleMobileMenu() {
  document.querySelector('.nav-tabs').classList.toggle('open');
}

/* ── Role card toggle ── */
function toggleCard(role) {
  const card = document.getElementById('rc-' + role);
  card.classList.toggle('open');
}

/* ── Role filter ── */
function filterRoles(role) {
  document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-role="${role}"]`).classList.add('active');
  document.querySelectorAll('.role-card').forEach(card => {
    if (role === 'all' || card.dataset.role === role) {
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
  });
}

/* ── Formatters ── */
const fmtPeriod = p => {
  const [y, m] = p.split('-');
  return `${MON[+m - 1]} ${y}`;
};

const fmtEmp = v => {
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toLocaleString();
};

/* ── Animated number counter ── */
function animateValue(el, end, suffix, decimals = 1) {
  const duration = 800;
  const start = 0;
  const startTime = performance.now();

  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = start + (end - start) * eased;
    el.textContent = current.toFixed(decimals) + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

/* ── KPIs ── */
function setKPIs(uData, eData) {
  const lu = uData.at(-1), pu = uData.at(-2);
  const le = eData.at(-1), pe = eData.at(-2);

  const uEl = document.getElementById('kpi-unemp');
  animateValue(uEl, lu.value, '%', 1);
  document.getElementById('kpi-unemp-period').textContent =
    fmtPeriod(lu.period) + (lu.footnotes.length ? ' · Preliminary' : '');

  if (pu) {
    const d = lu.value - pu.value;
    const el = document.getElementById('kpi-unemp-delta');
    el.textContent = `${d > 0 ? '▲' : d < 0 ? '▼' : '→'} ${d > 0 ? '+' : ''}${d.toFixed(1)} pp vs prior month`;
    el.className = `kpi-delta ${d < 0 ? 'up' : d > 0 ? 'down' : 'flat'}`;
  }

  document.getElementById('kpi-emp').textContent = fmtEmp(le.value);
  document.getElementById('kpi-emp-period').textContent =
    fmtPeriod(le.period) + (le.footnotes.length ? ' · Preliminary' : '');

  if (pe) {
    const d = le.value - pe.value;
    const el = document.getElementById('kpi-emp-delta');
    el.textContent = `${d > 0 ? '▲' : d < 0 ? '▼' : '→'} ${d > 0 ? '+' : ''}${fmtEmp(Math.abs(d))} vs prior month`;
    el.className = `kpi-delta ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}`;
  }

  const last12 = uData.slice(-12).map(d => d.value);
  const avg = last12.reduce((a, b) => a + b, 0) / last12.length;
  document.getElementById('kpi-avg').textContent = avg.toFixed(2) + '%';
  document.getElementById('kpi-avg-period').textContent =
    `${fmtPeriod(uData.at(-12).period)} – ${fmtPeriod(lu.period)}`;

  const peak = uData.reduce((a, b) => b.value > a.value ? b : a);
  document.getElementById('kpi-peak').textContent = peak.value.toFixed(1) + '%';
  document.getElementById('kpi-peak-when').textContent = fmtPeriod(peak.period);
}

const slice = (data, r) => r === 'all' ? data : data.slice(-parseInt(r));

/* ── Chart builders ── */
function buildUnemp(all) {
  const ctx = document.getElementById('c-unemp').getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 270);
  grad.addColorStop(0, 'rgba(34,211,238,.2)');
  grad.addColorStop(1, 'rgba(34,211,238,0)');

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: all.map(d => fmtPeriod(d.period)),
      datasets: [{
        data: all.map(d => d.value),
        borderColor: '#22d3ee',
        backgroundColor: grad,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: '#22d3ee',
        pointHoverBorderColor: '#0a0e1a',
        pointHoverBorderWidth: 2,
        fill: true,
        tension: 0.35
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { ...ttDark, callbacks: { label: c => ` ${c.parsed.y.toFixed(1)}%` } }
      },
      scales: {
        x: { grid: gridDark, ticks: ticksDark },
        y: {
          grid: gridDark,
          ticks: { ...ticksDark, callback: v => v + '%' },
          title: { display: true, text: 'Rate (%)', color: '#475569', font: { size: 11 } }
        }
      }
    }
  });
  REGISTRY['unemp'] = { chart, all };
}

function buildEmp(all) {
  const ctx = document.getElementById('c-emp').getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 270);
  grad.addColorStop(0, 'rgba(52,211,153,.2)');
  grad.addColorStop(1, 'rgba(52,211,153,0)');

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: all.map(d => fmtPeriod(d.period)),
      datasets: [{
        data: all.map(d => d.value),
        borderColor: '#34d399',
        backgroundColor: grad,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: '#34d399',
        pointHoverBorderColor: '#0a0e1a',
        pointHoverBorderWidth: 2,
        fill: true,
        tension: 0.35
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { ...ttDark, callbacks: { label: c => ` ${fmtEmp(c.parsed.y)} persons` } }
      },
      scales: {
        x: { grid: gridDark, ticks: ticksDark },
        y: {
          grid: gridDark,
          ticks: { ...ticksDark, callback: v => fmtEmp(v) },
          title: { display: true, text: 'Persons', color: '#475569', font: { size: 11 } }
        }
      }
    }
  });
  REGISTRY['emp'] = { chart, all };
}

function buildDual(uAll, eAll) {
  const ctx = document.getElementById('c-dual').getContext('2d');
  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: uAll.map(d => fmtPeriod(d.period)),
      datasets: [
        {
          label: 'Unemployment Rate (%)',
          data: uAll.map(d => d.value),
          borderColor: '#22d3ee',
          backgroundColor: 'rgba(34,211,238,.06)',
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.35,
          yAxisID: 'y'
        },
        {
          label: 'Employment Level',
          data: eAll.map(d => d.value),
          borderColor: '#34d399',
          backgroundColor: 'rgba(52,211,153,.06)',
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.35,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: '#94a3b8', boxWidth: 12, padding: 16, font: { size: 12 } }
        },
        tooltip: {
          ...ttDark,
          callbacks: {
            label: c => c.datasetIndex === 0
              ? ` Unemp: ${c.parsed.y.toFixed(1)}%`
              : ` Employed: ${fmtEmp(c.parsed.y)}`
          }
        }
      },
      scales: {
        x: { grid: gridDark, ticks: { ...ticksDark, maxTicksLimit: 12 } },
        y: {
          position: 'left',
          grid: gridDark,
          ticks: { ...ticksDark, callback: v => v + '%' },
          title: { display: true, text: 'Unemployment Rate (%)', color: '#22d3ee', font: { size: 11 } }
        },
        y1: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { ...ticksDark, callback: v => fmtEmp(v) },
          title: { display: true, text: 'Employment Level', color: '#34d399', font: { size: 11 } }
        }
      }
    }
  });
  REGISTRY['dual'] = { chart, uAll, eAll };
}

function buildYoY(uData) {
  const pts = [];
  for (const cur of uData) {
    const prior = uData.find(d => d.year === cur.year - 1 && d.month === cur.month);
    if (prior) pts.push({ period: cur.period, value: +(cur.value - prior.value).toFixed(2) });
  }

  const ctx = document.getElementById('c-yoy').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: pts.map(d => fmtPeriod(d.period)),
      datasets: [{
        data: pts.map(d => d.value),
        backgroundColor: pts.map(d => d.value < 0 ? 'rgba(52,211,153,.65)' : 'rgba(251,113,133,.65)'),
        borderColor: pts.map(d => d.value < 0 ? '#34d399' : '#fb7185'),
        borderWidth: 1,
        borderRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { ...ttDark, callbacks: { label: c => ` ${c.parsed.y > 0 ? '+' : ''}${c.parsed.y.toFixed(2)} pp` } }
      },
      scales: {
        x: { grid: gridDark, ticks: ticksDark },
        y: { grid: gridDark, ticks: { ...ticksDark, callback: v => (v > 0 ? '+' : '') + v + ' pp' } }
      }
    }
  });
}

function buildSeasonal(uData) {
  const byMon = Array.from({ length: 12 }, (_, i) => {
    const vals = uData.filter(d => d.month === i + 1).map(d => d.value);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });

  const min = Math.min(...byMon.filter(Boolean));
  const max = Math.max(...byMon.filter(Boolean));

  const ctx = document.getElementById('c-seasonal').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: MON,
      datasets: [{
        data: byMon,
        backgroundColor: byMon.map(v => {
          if (!v) return 'rgba(255,255,255,.05)';
          const t = (v - min) / (max - min || 1);
          // Gradient from cyan to rose
          return `rgba(${Math.round(34 + t * 217)},${Math.round(211 - t * 98)},${Math.round(238 - t * 105)},0.7)`;
        }),
        borderRadius: 5,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...ttDark, callbacks: { label: c => ` Avg: ${c.parsed.y.toFixed(2)}%` } }
      },
      scales: {
        x: { grid: gridDark, ticks: { color: '#475569' } },
        y: {
          grid: gridDark,
          ticks: { ...ticksDark, callback: v => v + '%' },
          suggestedMin: 0
        }
      }
    }
  });
}

/* ── Range button handler ── */
document.addEventListener('click', e => {
  const btn = e.target.closest('.btn-r');
  if (!btn) return;

  const key = btn.dataset.chart, r = btn.dataset.range;
  if (!key || !r) return;

  btn.closest('.range-btns').querySelectorAll('.btn-r').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const reg = REGISTRY[key];
  if (!reg) return;

  if (key === 'dual') {
    const us = slice(reg.uAll, r), es = slice(reg.eAll, r);
    reg.chart.data.labels = us.map(d => fmtPeriod(d.period));
    reg.chart.data.datasets[0].data = us.map(d => d.value);
    reg.chart.data.datasets[1].data = es.map(d => d.value);
  } else if (key === 'n-unemp') {
    const s = r === 'all' ? reg.shared : reg.shared.slice(-parseInt(r));
    const mMap = {};
    reg.mAll.forEach(d => mMap[d.period] = d.value);
    reg.chart.data.labels = s.map(d => fmtPeriod(d.period));
    reg.chart.data.datasets[0].data = s.map(d => mMap[d.period]);
    reg.chart.data.datasets[1].data = s.map(d => d.value);
  } else if (key === 'n-index') {
    const s = r === 'all' ? reg.shared : reg.shared.slice(-parseInt(r));
    const mMap = {};
    reg.mAll.forEach(d => mMap[d.period] = d.value);
    reg.chart.data.labels = s.map(d => fmtPeriod(d.period));
    reg.chart.data.datasets[0].data = s.map(d => d.value > 0 ? +((mMap[d.period] / d.value) * 100).toFixed(1) : null);
    reg.chart.data.datasets[1].data = s.map(() => 100);
  } else {
    const s = slice(reg.all, r);
    reg.chart.data.labels = s.map(d => fmtPeriod(d.period));
    reg.chart.data.datasets[0].data = s.map(d => d.value);
  }

  reg.chart.update('active');
});

/* ── Data table builder ── */
function buildTable(uData, eData) {
  const eMap = {}, uMap = {};
  eData.forEach(d => eMap[d.period] = d);
  uData.forEach(d => uMap[d.period] = d);
  const tbody = document.getElementById('tbl-body');
  tbody.innerHTML = '';

  [...uData].slice(-24).reverse().forEach(u => {
    const e = eMap[u.period];
    const py = `${u.year - 1}-${String(u.month).padStart(2, '0')}`;
    const pu = uMap[py], pe = eMap[py];
    const uYoY = pu ? +(u.value - pu.value).toFixed(2) : null;
    const eYoY = (e && pe) ? e.value - pe.value : null;
    const prelim = u.footnotes.some(f => f.toLowerCase().includes('prelim'));
    const uColor = uYoY === null ? '' : uYoY < 0 ? 'color:#34d399' : uYoY > 0 ? 'color:#fb7185' : '';
    const eColor = eYoY === null ? '' : eYoY > 0 ? 'color:#34d399' : eYoY < 0 ? 'color:#fb7185' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="mono">${u.period}</td><td>${MON_FULL[u.month - 1]} ${u.year}${prelim ? '<span class="tag-p">P</span>' : ''}</td><td class="mono">${u.value.toFixed(1)}%</td><td class="mono">${e ? fmtEmp(e.value) : '—'}</td><td class="mono" style="${uColor}">${uYoY !== null ? (uYoY > 0 ? '+' : '') + uYoY + ' pp' : '—'}</td><td class="mono" style="${eColor}">${eYoY !== null ? (eYoY > 0 ? '+' : '') + fmtEmp(Math.abs(eYoY)) : '—'}</td><td style="color:var(--text-muted);font-size:.72rem">${prelim ? 'Preliminary' : 'Final'}</td>`;
    tbody.appendChild(tr);
  });
}

/* ── National comparison section ── */
function buildNationSection(mData, nuData) {
  const lm = mData.at(-1);
  const lu = nuData.at(-1);

  document.getElementById('n-miami-unemp').textContent = lm.value.toFixed(1) + '%';
  document.getElementById('n-miami-unemp-period').textContent = fmtPeriod(lm.period);
  document.getElementById('n-us-unemp').textContent = lu.value.toFixed(1) + '%';
  document.getElementById('n-us-unemp-period').textContent = fmtPeriod(lu.period) + ' · SA';
  document.getElementById('n-miami-emp').textContent = fmtEmp(lm.value);
  document.getElementById('n-miami-emp-period').textContent = fmtPeriod(lm.period);

  const matchedUS = nuData.find(d => d.period === lm.period) || lu;
  const spread = +(lm.value - matchedUS.value).toFixed(2);
  const spreadEl = document.getElementById('n-spread');
  spreadEl.textContent = (spread > 0 ? '+' : '') + spread + ' pp';
  spreadEl.className = 'nation-kpi-value ' + (spread < 0 ? 'emerald' : spread > 0 ? 'rose' : 'amber');

  const badgeEl = document.getElementById('n-spread-badge');
  if (spread < 0) {
    badgeEl.textContent = '▼ Miami below US — outperforming';
    badgeEl.className = 'nation-kpi-delta better';
  } else if (spread > 0) {
    badgeEl.textContent = '▲ Miami above US — lagging';
    badgeEl.className = 'nation-kpi-delta worse';
  } else {
    badgeEl.textContent = '→ At parity with US';
    badgeEl.className = 'nation-kpi-delta same';
  }

  const mMap = {};
  mData.forEach(d => mMap[d.period] = d.value);
  const uMap = {};
  nuData.forEach(d => uMap[d.period] = d.value);
  const shared = nuData.filter(d => mMap[d.period] !== undefined);

  const sharedLabels = shared.map(d => fmtPeriod(d.period));
  const mVals = shared.map(d => mMap[d.period]);
  const uVals = shared.map(d => d.value);
  const spreadVals = shared.map(d => +(mMap[d.period] - d.value).toFixed(2));
  const indexVals = shared.map(d => d.value > 0 ? +((mMap[d.period] / d.value) * 100).toFixed(1) : null);

  const mYoY = [], uYoY = [], yoyLabels = [];
  for (const d of shared) {
    const py = `${d.year - 1}-${String(d.month).padStart(2, '0')}`;
    const pm = mMap[py], pu = uMap[py];
    if (pm !== undefined && pu !== undefined) {
      mYoY.push(+(mMap[d.period] - pm).toFixed(2));
      uYoY.push(+(d.value - pu).toFixed(2));
      yoyLabels.push(fmtPeriod(d.period));
    }
  }

  /* Chart 1 — Dual line (Miami vs US) */
  const ctx1 = document.getElementById('c-n-unemp').getContext('2d');
  const c1 = new Chart(ctx1, {
    type: 'line',
    data: {
      labels: sharedLabels,
      datasets: [
        {
          label: 'Miami',
          data: mVals,
          borderColor: '#22d3ee',
          backgroundColor: 'rgba(34,211,238,.08)',
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.35
        },
        {
          label: 'US National',
          data: uVals,
          borderColor: '#34d399',
          backgroundColor: 'rgba(52,211,153,.04)',
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
          tension: 0.35
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { color: '#94a3b8', boxWidth: 12, padding: 14, font: { size: 11 } } },
        tooltip: { ...ttDark, callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}%` } }
      },
      scales: {
        x: { grid: gridDark, ticks: ticksDark },
        y: { grid: gridDark, ticks: { ...ticksDark, callback: v => v + '%' } }
      }
    }
  });
  REGISTRY['n-unemp'] = { chart: c1, shared, mAll: mData };

  /* Chart 2 — Spread bars */
  const ctx2 = document.getElementById('c-n-spread').getContext('2d');
  new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: sharedLabels,
      datasets: [{
        data: spreadVals,
        backgroundColor: spreadVals.map(v => v < 0 ? 'rgba(52,211,153,.6)' : 'rgba(251,113,133,.6)'),
        borderColor: spreadVals.map(v => v < 0 ? '#34d399' : '#fb7185'),
        borderWidth: 1,
        borderRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { ...ttDark, callbacks: { label: c => ` Spread: ${c.parsed.y > 0 ? '+' : ''}${c.parsed.y.toFixed(2)} pp` } }
      },
      scales: {
        x: { grid: gridDark, ticks: ticksDark },
        y: { grid: gridDark, ticks: { ...ticksDark, callback: v => (v > 0 ? '+' : '') + v + ' pp' } }
      }
    }
  });

  /* Chart 3 — Index */
  const ctx3 = document.getElementById('c-n-index').getContext('2d');
  const c3 = new Chart(ctx3, {
    type: 'line',
    data: {
      labels: sharedLabels,
      datasets: [
        {
          label: 'Miami Index',
          data: indexVals,
          borderColor: '#fbbf24',
          backgroundColor: 'rgba(251,191,36,.06)',
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.35
        },
        {
          label: 'US = 100',
          data: sharedLabels.map(() => 100),
          borderColor: 'rgba(255,255,255,.15)',
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { color: '#94a3b8', boxWidth: 12, padding: 14, font: { size: 11 } } },
        tooltip: {
          ...ttDark,
          callbacks: {
            label: c => c.datasetIndex === 0 ? ` Miami Index: ${c.parsed.y.toFixed(1)}` : ` US Baseline: 100`
          }
        }
      },
      scales: {
        x: { grid: gridDark, ticks: ticksDark },
        y: { grid: gridDark, ticks: ticksDark }
      }
    }
  });
  REGISTRY['n-index'] = { chart: c3, shared, mAll: mData };

  /* Chart 4 — YoY comparison */
  const ctx4 = document.getElementById('c-n-yoy').getContext('2d');
  new Chart(ctx4, {
    type: 'bar',
    data: {
      labels: yoyLabels,
      datasets: [
        { label: 'Miami YoY', data: mYoY, backgroundColor: 'rgba(34,211,238,.5)', borderColor: '#22d3ee', borderWidth: 1, borderRadius: 3 },
        { label: 'US YoY', data: uYoY, backgroundColor: 'rgba(52,211,153,.4)', borderColor: '#34d399', borderWidth: 1, borderRadius: 3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { color: '#94a3b8', boxWidth: 12, padding: 14, font: { size: 11 } } },
        tooltip: { ...ttDark, callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y > 0 ? '+' : ''}${c.parsed.y.toFixed(2)} pp` } }
      },
      scales: {
        x: { grid: gridDark, ticks: ticksDark },
        y: { grid: gridDark, ticks: { ...ticksDark, callback: v => (v > 0 ? '+' : '') + v + ' pp' } }
      }
    }
  });
}

/* ── Hiring Signals Charts ── */
function buildSignalsCharts() {
  const gradientColors = ['#22d3ee', '#34d399', '#3b82f6', '#a78bfa', '#fbbf24', '#fb7185', '#06b6d4'];

  new Chart(document.getElementById('c-sig-sector'), {
    type: 'bar',
    data: {
      labels: ['Tech/SaaS', 'Logistics', 'Transport', 'E-Commerce', 'Spatial Comp', 'Real Estate', 'Hospitality'],
      datasets: [{
        label: 'Active Signals',
        data: [3, 1, 1, 1, 1, 1, 1],
        backgroundColor: gradientColors.map(c => c + 'aa'),
        borderColor: gradientColors,
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { ...ttDark, callbacks: { label: ctx => ` ${ctx.raw} signal${ctx.raw > 1 ? 's' : ''}` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#475569', font: { size: 11 } } },
        y: { grid: gridDark, ticks: { ...ticksDark, stepSize: 1 }, beginAtZero: true }
      }
    }
  });

  new Chart(document.getElementById('c-sig-roles'), {
    type: 'bar',
    data: {
      labels: ['Engineering', 'Operations', 'Sales', 'Product', 'Data/Analytics', 'Cybersecurity', 'Logistics', 'UX/Design'],
      datasets: [{
        label: 'Companies Hiring',
        data: [9, 6, 7, 5, 4, 3, 2, 3],
        backgroundColor: 'rgba(52,211,153,.65)',
        borderColor: '#34d399',
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { ...ttDark, callbacks: { label: ctx => ` ${ctx.raw} companies` } }
      },
      scales: {
        x: { grid: gridDark, beginAtZero: true, ticks: { ...ticksDark, stepSize: 1 } },
        y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } }
      }
    }
  });
}

/* ── AI Exposure Visualizations ── */
function buildAICharts() {
  /* 1. Horizontal Bar */
  const hbarRoles = [
    'Customer Service Reps', 'Public Relations Specialists', 'Counter & Rental Clerks',
    'Personal Financial Advisors', 'Management Analysts', 'Market Research Analysts',
    'Loan Officers', 'Insurance Agents', 'Accountants & Auditors', 'Software Developers'
  ];
  const hbarScores = [44, 36, 36, 35, 35, 33, 31, 30, 28, 18];
  const hbarColors = hbarScores.map(s =>
    s >= 40 ? 'rgba(251,113,133,.7)' : s >= 30 ? 'rgba(251,191,36,.65)' : 'rgba(52,211,153,.65)'
  );

  new Chart(document.getElementById('c-ai-hbar').getContext('2d'), {
    type: 'bar',
    data: {
      labels: hbarRoles,
      datasets: [{
        data: hbarScores,
        backgroundColor: hbarColors,
        borderColor: hbarColors.map(c => c.replace(/[\d.]+\)/, '1)')),
        borderWidth: 1,
        borderRadius: 5
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...ttDark, callbacks: { label: c => ` Exposure: ${c.parsed.x}%` } }
      },
      scales: {
        x: { grid: gridDark, ticks: { ...ticksDark, callback: v => v + '%' }, max: 50, title: { display: true, text: 'AI Exposure Score (%)', color: '#475569', font: { size: 11 } } },
        y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } }
      }
    }
  });

  /* 2. Bubble Chart */
  const bubbleData = [
    { label: 'Customer Svc Reps', x: 42460, y: 44, r: 28, color: 'rgba(251,113,133,.6)' },
    { label: 'Management Analysts', x: 107670, y: 35, r: 14, color: 'rgba(251,191,36,.6)' },
    { label: 'Counter Clerks', x: 49340, y: 36, r: 9, color: 'rgba(251,191,36,.6)' },
    { label: 'Financial Advisors', x: 169270, y: 35, r: 8, color: 'rgba(251,191,36,.6)' },
    { label: 'PR Specialists', x: 72880, y: 36, r: 7, color: 'rgba(251,191,36,.6)' },
    { label: 'Loan Officers', x: 82450, y: 31, r: 10, color: 'rgba(52,211,153,.6)' },
    { label: 'Accountants', x: 78320, y: 28, r: 12, color: 'rgba(52,211,153,.6)' },
    { label: 'Software Devs', x: 118940, y: 18, r: 11, color: 'rgba(59,130,246,.6)' }
  ];

  new Chart(document.getElementById('c-ai-bubble').getContext('2d'), {
    type: 'bubble',
    data: {
      datasets: bubbleData.map(d => ({
        label: d.label,
        data: [{ x: d.x, y: d.y, r: d.r }],
        backgroundColor: d.color,
        borderColor: d.color.replace('.6)', '.9)'),
        borderWidth: 1.5,
        hoverBackgroundColor: d.color.replace('.6)', '.8)')
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...ttDark,
          callbacks: {
            label: c => [
              ` ${c.dataset.label}`,
              ` Avg Wage: $${c.parsed.x.toLocaleString()}`,
              ` Exposure: ${c.parsed.y}%`
            ]
          }
        }
      },
      scales: {
        x: { grid: gridDark, ticks: { ...ticksDark, callback: v => '$' + (v / 1000).toFixed(0) + 'K' }, title: { display: true, text: 'Average Annual Wage', color: '#475569', font: { size: 11 } } },
        y: { grid: gridDark, ticks: { ...ticksDark, callback: v => v + '%' }, title: { display: true, text: 'AI Exposure Score (%)', color: '#475569', font: { size: 11 } }, min: 10, max: 50 }
      }
    }
  });

  /* 3. Donut */
  new Chart(document.getElementById('c-ai-donut').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['High Exposure', 'Medium Exposure', 'Lower Exposure', 'Minimal / No Exposure'],
      datasets: [{
        data: [127260, 198400, 312000, 1584340],
        backgroundColor: ['rgba(251,113,133,.7)', 'rgba(251,191,36,.65)', 'rgba(52,211,153,.65)', 'rgba(100,116,139,.35)'],
        borderColor: ['#fb7185', '#fbbf24', '#34d399', '#475569'],
        borderWidth: 2,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 12, padding: 14, font: { size: 11 } } },
        tooltip: { ...ttDark, callbacks: { label: c => ` ${c.label}: ${c.parsed.toLocaleString()} workers (${((c.parsed / 2222000) * 100).toFixed(1)}%)` } }
      }
    }
  });

  /* 4. Radar */
  new Chart(document.getElementById('c-ai-radar').getContext('2d'), {
    type: 'radar',
    data: {
      labels: ['AI Exposure', 'Worker Count', 'Wage Level', 'Task Repeatability', 'Digital Touchpoints', 'Growth Trajectory'],
      datasets: [
        { label: 'Hospitality & Tourism', data: [82, 90, 30, 85, 65, 55], backgroundColor: 'rgba(251,113,133,.1)', borderColor: '#fb7185', borderWidth: 2, pointBackgroundColor: '#fb7185', pointRadius: 3 },
        { label: 'Financial Services', data: [75, 55, 80, 70, 90, 60], backgroundColor: 'rgba(251,191,36,.1)', borderColor: '#fbbf24', borderWidth: 2, pointBackgroundColor: '#fbbf24', pointRadius: 3 },
        { label: 'Technology / Software', data: [35, 40, 90, 40, 95, 90], backgroundColor: 'rgba(59,130,246,.1)', borderColor: '#3b82f6', borderWidth: 2, pointBackgroundColor: '#3b82f6', pointRadius: 3 },
        { label: 'Construction & Trades', data: [15, 75, 55, 25, 20, 70], backgroundColor: 'rgba(52,211,153,.1)', borderColor: '#34d399', borderWidth: 2, pointBackgroundColor: '#34d399', pointRadius: 3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 10, padding: 12, font: { size: 10 } } },
        tooltip: ttDark
      },
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: { stepSize: 25, font: { size: 9 }, color: '#475569', backdropColor: 'transparent' },
          grid: { color: 'rgba(255,255,255,.06)' },
          pointLabels: { font: { size: 10 }, color: '#94a3b8' },
          angleLines: { color: 'rgba(255,255,255,.06)' }
        }
      }
    }
  });

  /* 5. Stacked Bar */
  const sectors = ['Hospitality', 'Healthcare', 'Construction', 'Finance', 'BPO/Contact', 'Real Estate', 'Tech/Software', 'Creative/Media'];
  const highRisk = [168000, 22000, 9000, 57000, 65550, 13500, 5500, 24000];
  const medRisk = [84000, 66000, 27000, 28500, 0, 18000, 22000, 5500];
  const lowerRisk = [28000, 132000, 144000, 9500, 0, 13500, 27500, 500];

  new Chart(document.getElementById('c-ai-stacked').getContext('2d'), {
    type: 'bar',
    data: {
      labels: sectors,
      datasets: [
        { label: 'High Exposure', data: highRisk, backgroundColor: 'rgba(251,113,133,.65)', borderColor: '#fb7185', borderWidth: 1, borderRadius: { topLeft: 3, topRight: 3 } },
        { label: 'Medium Exposure', data: medRisk, backgroundColor: 'rgba(251,191,36,.55)', borderColor: '#fbbf24', borderWidth: 1 },
        { label: 'Lower Exposure', data: lowerRisk, backgroundColor: 'rgba(52,211,153,.5)', borderColor: '#34d399', borderWidth: 1 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: '#94a3b8', boxWidth: 12, padding: 16, font: { size: 12 } } },
        tooltip: { ...ttDark, callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toLocaleString()} workers` } }
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: '#475569' } },
        y: { stacked: true, grid: gridDark, ticks: { ...ticksDark, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v } }
      }
    }
  });
}

/* ── Main init (guarded against double calls) ── */
let initPromise = null;

function init() {
  if (initPromise) return initPromise;
  initPromise = _doInit();
  return initPromise;
}

async function _doInit() {
  try {
    const resp = await fetch('jobs_data.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const keys = Object.keys(data.series);

    const miamiKeys = keys.filter(k => (data.series[k].scope || 'miami') === 'miami');
    const uKey = miamiKeys.find(k => data.series[k].label.toLowerCase().includes('unemployment'));
    const eKey = miamiKeys.find(k => data.series[k].label.toLowerCase().includes('employment') && !data.series[k].label.toLowerCase().includes('unemployment'));
    if (!uKey || !eKey) throw new Error('Required Miami series not found');

    const uData = data.series[uKey].data;
    const eData = data.series[eKey].data;
    if (!uData.length || !eData.length) throw new Error('No data records found');

    /* Resolve national data for lazy tab building */
    const nKeys = keys.filter(k => data.series[k].scope === 'national');
    const nuKey = nKeys.find(k => data.series[k].label.toLowerCase().includes('unemployment'));
    const nuData = nuKey ? data.series[nuKey].data : null;

    /* Store data globally so switchTab() can lazy-build charts */
    window._dashData = { uData, eData, nuData };

    const ts = new Date(data.metadata.last_updated);
    document.getElementById('last-updated').textContent = `Updated ${ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    /* Build only the overview tab (visible on load) */
    setKPIs(uData, eData);
    buildUnemp(uData);
    buildEmp(eData);
    buildDual(uData, eData);
    buildYoY(uData);
    buildSeasonal(uData);
    buildTable(uData, eData);

    /* National, Signals, and AI charts are built lazily in switchTab() */

    const ov = document.getElementById('loading');
    ov.classList.add('out');
    setTimeout(() => ov.remove(), 450);
  } catch (err) {
    console.error(err);
    document.getElementById('loading').classList.add('out');
    const box = document.getElementById('error-box');
    box.style.display = 'block';
    box.innerHTML = `<strong>Failed to load data:</strong> ${err.message}`;
  }
}

init();
