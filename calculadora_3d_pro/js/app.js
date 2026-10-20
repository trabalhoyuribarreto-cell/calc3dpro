/**
 * Orquestração da aplicação: abas, orçamento, CRUD, histórico, config.
 */
(function () {
  'use strict';

  const { Toast, Modal, escapeHtml, moeda, formatarData } = window.UI;
  const { Parsers } = window;
  const { Store } = window;

  let chartInstance = null;
  const state = {
    filamentoTemp: null, // dados extraídos do arquivo (pré-selecionar tipo)
  };

  // ============================================================
  // Helpers de DOM
  // ============================================================
  const $ = (id) => document.getElementById(id);

  function optsFrom(list, labelFn) {
    return list.map(x => `<option value="${x.id}">${escapeHtml(labelFn(x))}</option>`).join('');
  }

  // ============================================================
  // Abas
  // ============================================================
  function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    const target = $(`tab-${tabId}`);
    const btn = document.querySelector(`.tab-btn[data-target="${tabId}"]`);
    if (target) target.classList.remove('hidden');
    if (btn) btn.classList.add('active');

    if (tabId === 'producao') { renderDropdowns(); calcularOrcamento(); }
    if (tabId === 'filamentos') renderFilamentos();
    if (tabId === 'maquinas') renderMaquinas();
    if (tabId === 'historico') renderHistorico();
    if (tabId === 'config') $('cfg-energia').value = Store.data.energia;
  }

  // ============================================================
  // Dropdowns
  // ============================================================
  function renderDropdowns() {
    const fSel = $('prod-filamento');
    const mSel = $('prod-maquina');

    const prevF = fSel.value;
    const prevM = mSel.value;

    if (Store.data.filamentos.length === 0) {
      fSel.innerHTML = '<option value="">— Cadastre um filamento —</option>';
      fSel.disabled = true;
    } else {
      fSel.disabled = false;
      fSel.innerHTML = optsFrom(Store.data.filamentos, f => `${f.nome} (${moeda(f.precoKg)}/kg)`);
      if (prevF && Store.data.filamentos.some(x => String(x.id) === prevF)) fSel.value = prevF;
    }

    if (Store.data.maquinas.length === 0) {
      mSel.innerHTML = '<option value="">— Cadastre uma máquina —</option>';
      mSel.disabled = true;
    } else {
      mSel.disabled = false;
      mSel.innerHTML = optsFrom(Store.data.maquinas, m => m.nome);
      if (prevM && Store.data.maquinas.some(x => String(x.id) === prevM)) mSel.value = prevM;
    }
  }

  // ============================================================
  // Cálculo
  // ============================================================
  function calcularOrcamento() {
    const tempo = parseFloat($('prod-tempo').value) || 0;
    const peso = parseFloat($('prod-peso').value) || 0;
    const filId = $('prod-filamento').value;
    const maqId = $('prod-maquina').value;
    const margem = Math.max(0, parseFloat($('prod-margem').value) || 0);
    const falha = Math.max(0, parseFloat($('prod-falha').value) || 0);

    const filamento = Store.data.filamentos.find(f => String(f.id) === String(filId));
    const maquina = Store.data.maquinas.find(m => String(m.id) === String(maqId));

    if (!filamento || !maquina) {
      ['res-material','res-maquina','res-energia','res-falha','res-custo','res-lucro','res-preco']
        .forEach(id => $(id).textContent = moeda(0));
      renderChart([0,0,0,0,0]);
      return;
    }

    // Material
    const custoMaterial = (peso / 1000) * filamento.precoKg;

    // Máquina
    const horas = tempo / 60;
    const custoHoraDepreciacao = maquina.valor / Math.max(1, maquina.vidaUtilHoras);
    const horasUsoAno = Math.max(1, maquina.vidaUtilHoras / 3);
    const custoHoraManutencao = maquina.manutAnual / horasUsoAno;
    const custoMaquina = horas * (custoHoraDepreciacao + custoHoraManutencao);

    // Energia
    const consumoKW = maquina.watts / 1000;
    const custoEnergia = consumoKW * horas * Store.data.energia;

    // Fechamento
    const custoParcial = custoMaterial + custoMaquina + custoEnergia;
    const fundoFalha = custoParcial * (falha / 100);
    const custoTotalBase = custoParcial + fundoFalha;
    const valorLucro = custoTotalBase * (margem / 100);
    const precoFinal = custoTotalBase + valorLucro;

    $('res-material').textContent = moeda(custoMaterial);
    $('res-maquina').textContent = moeda(custoMaquina);
    $('res-energia').textContent = moeda(custoEnergia);
    $('res-falha').textContent = moeda(fundoFalha);
    $('res-custo').textContent = moeda(custoTotalBase);
    $('res-lucro').textContent = moeda(valorLucro);
    $('res-preco').textContent = moeda(precoFinal);

    renderChart([custoMaterial, custoMaquina, custoEnergia, fundoFalha, valorLucro]);
  }

  function renderChart(dados) {
    const canvas = $('chart-custos');
    if (!canvas) return;
    const soma = dados.reduce((a, b) => a + b, 0);

    if (chartInstance) {
      chartInstance.data.datasets[0].data = dados;
      chartInstance.update('none');
      return;
    }
    if (soma === 0) return;

    chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Material', 'Máquina', 'Energia', 'Falhas', 'Lucro'],
        datasets: [{
          data: dados,
          backgroundColor: ['#3b82f6', '#a855f7', '#eab308', '#ef4444', '#22c55e'],
          borderWidth: 2, borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => ` ${moeda(ctx.raw)}` } }
        },
        cutout: '65%'
      }
    });
  }

  // ============================================================
  // Upload (Drop Zone)
  // ============================================================
  function setupDropZone() {
    const dz = $('drop-zone');
    const input = $('file-input');
    const icon = $('drop-icon');
    const text = $('drop-text');

    const reset = () => {
      dz.classList.remove('success', 'error', 'dragover');
      icon.className = 'fa-solid fa-file-export';
      text.textContent = 'Arraste seu G-Code ou 3MF aqui';
    };

    const feedback = (msg, ok) => {
      dz.classList.remove('success', 'error', 'dragover');
      dz.classList.add(ok ? 'success' : 'error');
      icon.className = ok ? 'fa-solid fa-circle-check' : 'fa-solid fa-triangle-exclamation';
      text.textContent = msg;
      setTimeout(reset, 4000);
    };

    dz.addEventListener('click', () => input.click());
    dz.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      if (e.dataTransfer.files.length) processFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', (e) => {
      if (e.target.files.length) processFile(e.target.files[0]);
      input.value = '';
    });

    async function processFile(file) {
      // Nome sugerido (não sobrescreve se usuário já digitou)
      if (!$('prod-nome').value.trim()) {
        $('prod-nome').value = file.name.replace(/\.(gcode|3mf|gco|g)$/i, '').replace(/[_-]+/g, ' ').trim();
      }
      text.textContent = 'Lendo arquivo...';
      icon.className = 'fa-solid fa-spinner fa-spin';

      try {
        const r = await Parsers.parseFile(file);
        if (r.peso > 0) $('prod-peso').value = r.peso.toFixed(1);
        if (r.tempoMin > 0) $('prod-tempo').value = r.tempoMin;

        if (r.peso > 0 || r.tempoMin > 0) {
          const extra = r.fatiador && r.fatiador !== 'desconhecido' ? ` (${r.fatiador})` : '';
          feedback(`Sincronizado${extra}!`, true);
          Toast.success(`Peso: ${r.peso.toFixed(1)}g · Tempo: ${r.tempoMin}min`);
        } else {
          feedback('Arquivo lido, mas sem metadados. Preencha manualmente.', false);
          Toast.info('Metadados não encontrados — preencha manualmente.');
        }
        calcularOrcamento();
      } catch (err) {
        feedback(err.message || 'Erro ao processar arquivo', false);
        Toast.error(err.message || 'Erro ao processar arquivo');
      }
    }
  }

  // ============================================================
  // Salvar orçamento
  // ============================================================
  function salvarOrcamento() {
    const nome = $('prod-nome').value.trim();
    if (!nome) { Toast.error('Dê um nome ao projeto.'); $('prod-nome').focus(); return; }

    const peso = parseFloat($('prod-peso').value);
    const tempo = parseFloat($('prod-tempo').value);
    if (!(peso > 0)) { Toast.error('Preencha o peso (g).'); $('prod-peso').focus(); return; }
    if (!(tempo > 0)) { Toast.error('Preencha o tempo (min).'); $('prod-tempo').focus(); return; }

    const filId = $('prod-filamento').value;
    const maqId = $('prod-maquina').value;
    const filamento = Store.data.filamentos.find(f => String(f.id) === String(filId));
    const maquina = Store.data.maquinas.find(m => String(m.id) === String(maqId));
    if (!filamento) { Toast.error('Selecione um filamento.'); return; }
    if (!maquina) { Toast.error('Selecione uma máquina.'); return; }

    const custo = parseFloat($('res-custo').textContent.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
    const venda = parseFloat($('res-preco').textContent.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
    const lucro = parseFloat($('res-lucro').textContent.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

    Store.addProjeto({
      nome,
      dataISO: new Date().toISOString(),
      peso, tempo, custo, venda, lucro,
      maquinaNome: maquina.nome,
      filamentoNome: `${filamento.nome} (${filamento.cor || 's/ cor'})`,
      margem: parseFloat($('prod-margem').value) || 0,
      falha: parseFloat($('prod-falha').value) || 0
    });

    Toast.success(`Orçamento "${nome}" salvo.`);
    $('prod-nome').value = '';
    $('prod-peso').value = '';
    $('prod-tempo').value = '';
    calcularOrcamento();
  }

  // ============================================================
  // CRUD Filamentos
  // ============================================================
  function renderFilamentos() {
    const list = $('lista-filamentos');
    if (!list) return;
    if (Store.data.filamentos.length === 0) {
      list.innerHTML = '<p class="empty">Nenhum filamento cadastrado.</p>';
      return;
    }
    list.innerHTML = Store.data.filamentos.map(f => `
      <div class="list-item">
        <div>
          <strong>${escapeHtml(f.nome)}</strong>
          <div class="meta">${escapeHtml(f.cor || 'sem cor')}</div>
        </div>
        <div class="value mono">${moeda(f.precoKg)}/kg</div>
        <div class="actions">
          <button class="btn-icon" data-edit-fil="${f.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon" data-del-fil="${f.id}" title="Excluir"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`).join('');

    list.querySelectorAll('[data-edit-fil]').forEach(b => b.onclick = () => editFilamento(b.dataset.editFil));
    list.querySelectorAll('[data-del-fil]').forEach(b => b.onclick = () => deleteFilamento(b.dataset.delFil));
  }

  function filamentoFields(f = {}) {
    return [
      { name: 'nome', label: 'Nome', value: f.nome || '', required: true, placeholder: 'PLA Preto' },
      { name: 'cor', label: 'Cor', value: f.cor || '' },
      { name: 'precoKg', label: 'Preço por Kg (R$)', type: 'number', min: 0, step: '0.01', value: f.precoKg ?? '', required: true }
    ];
  }

  function editFilamento(id) {
    const f = Store.data.filamentos.find(x => String(x.id) === String(id));
    if (!f) return;
    Modal.open({
      title: 'Editar Filamento',
      fields: filamentoFields(f),
      onSubmit: (data) => {
        Store.updateFilamento(f.id, { nome: data.nome, cor: data.cor, precoKg: parseFloat(data.precoKg) });
        Toast.success('Filamento atualizado.');
        renderFilamentos(); renderDropdowns(); calcularOrcamento();
      }
    });
  }

  function novoFilamento() {
    Modal.open({
      title: 'Novo Filamento',
      fields: filamentoFields(),
      onSubmit: (data) => {
        Store.addFilamento({ nome: data.nome, cor: data.cor, precoKg: parseFloat(data.precoKg) });
        Toast.success('Filamento criado.');
        renderFilamentos(); renderDropdowns();
      }
    });
  }

  function deleteFilamento(id) {
    const f = Store.data.filamentos.find(x => String(x.id) === String(id));
    if (!f) return;
    Modal.confirm({
      title: 'Excluir Filamento',
      message: `Excluir "${f.nome}"?`,
      danger: true, confirmLabel: 'Excluir',
      onConfirm: () => {
        Store.removeFilamento(f.id);
        Toast.success('Filamento excluído.');
        renderFilamentos(); renderDropdowns(); calcularOrcamento();
      }
    });
  }

  // ============================================================
  // CRUD Máquinas
  // ============================================================
  function renderMaquinas() {
    const list = $('lista-maquinas');
    if (!list) return;
    if (Store.data.maquinas.length === 0) {
      list.innerHTML = '<p class="empty">Nenhuma máquina cadastrada.</p>';
      return;
    }
    list.innerHTML = Store.data.maquinas.map(m => `
      <div class="list-item">
        <div>
          <strong>${escapeHtml(m.nome)}</strong>
          <div class="meta">${m.watts}W · Deprecia ${moeda(m.valor)} em ${m.vidaUtilHoras}h · Manut. ${moeda(m.manutAnual)}/ano</div>
        </div>
        <div class="actions">
          <button class="btn-icon" data-edit-maq="${m.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon" data-del-maq="${m.id}" title="Excluir"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`).join('');

    list.querySelectorAll('[data-edit-maq]').forEach(b => b.onclick = () => editMaquina(b.dataset.editMaq));
    list.querySelectorAll('[data-del-maq]').forEach(b => b.onclick = () => deleteMaquina(b.dataset.delMaq));
  }

  function maquinaFields(m = {}) {
    return [
      { name: 'nome', label: 'Nome', value: m.nome || '', required: true, placeholder: 'Bambu A1' },
      { name: 'valor', label: 'Valor de Compra (R$)', type: 'number', min: 0, step: '0.01', value: m.valor ?? '', required: true },
      { name: 'manutAnual', label: 'Manutenção Anual (R$)', type: 'number', min: 0, step: '0.01', value: m.manutAnual ?? 0 },
      { name: 'watts', label: 'Consumo (W)', type: 'number', min: 0, step: '1', value: m.watts ?? 0, required: true },
      { name: 'vidaUtilHoras', label: 'Vida Útil (horas)', type: 'number', min: 1, step: '1', value: m.vidaUtilHoras ?? 4000, required: true }
    ];
  }

  function editMaquina(id) {
    const m = Store.data.maquinas.find(x => String(x.id) === String(id));
    if (!m) return;
    Modal.open({
      title: 'Editar Máquina',
      fields: maquinaFields(m),
      onSubmit: (data) => {
        Store.updateMaquina(m.id, {
          nome: data.nome, valor: +data.valor, manutAnual: +data.manutAnual,
          watts: +data.watts, vidaUtilHoras: +data.vidaUtilHoras
        });
        Toast.success('Máquina atualizada.');
        renderMaquinas(); renderDropdowns(); calcularOrcamento();
      }
    });
  }

  function novaMaquina() {
    Modal.open({
      title: 'Nova Máquina',
      fields: maquinaFields(),
      onSubmit: (data) => {
        Store.addMaquina({
          nome: data.nome, valor: +data.valor, manutAnual: +data.manutAnual,
          watts: +data.watts, vidaUtilHoras: +data.vidaUtilHoras
        });
        Toast.success('Máquina criada.');
        renderMaquinas(); renderDropdowns();
      }
    });
  }

  function deleteMaquina(id) {
    const m = Store.data.maquinas.find(x => String(x.id) === String(id));
    if (!m) return;
    Modal.confirm({
      title: 'Excluir Máquina',
      message: `Excluir "${m.nome}"?`,
      danger: true, confirmLabel: 'Excluir',
      onConfirm: () => {
        Store.removeMaquina(m.id);
        Toast.success('Máquina excluída.');
        renderMaquinas(); renderDropdowns(); calcularOrcamento();
      }
    });
  }

  // ============================================================
  // Histórico
  // ============================================================
  function renderHistorico() {
    const list = $('lista-historico');
    const badge = $('badge-total-projetos');
    if (!list) return;
    badge.textContent = `${Store.data.historico.length} projeto${Store.data.historico.length === 1 ? '' : 's'}`;

    if (Store.data.historico.length === 0) {
      list.innerHTML = '<p class="empty" style="grid-column:1/-1">Nenhum projeto salvo ainda.</p>';
      return;
    }

    list.innerHTML = Store.data.historico.map(p => `
      <div class="hist-card">
        <button class="btn-icon delete" data-del-proj="${p.id}" title="Excluir"><i class="fa-solid fa-trash"></i></button>
        <div class="date"><i class="fa-regular fa-calendar"></i> ${formatarData(p.dataISO)}</div>
        <h3>${escapeHtml(p.nome)}</h3>
        <div class="info">
          <div><i class="fa-solid fa-weight-scale"></i> ${p.peso.toFixed(1)}g</div>
          <div><i class="fa-solid fa-clock"></i> ${Math.round(p.tempo)}min</div>
          <div style="grid-column:1/-1"><i class="fa-solid fa-print"></i> ${escapeHtml(p.maquinaNome)}</div>
          <div style="grid-column:1/-1"><i class="fa-solid fa-layer-group"></i> ${escapeHtml(p.filamentoNome)}</div>
        </div>
        <div class="footer">
          <div>
            <div class="label">Custo</div>
            <div class="custo mono">${moeda(p.custo)}</div>
          </div>
          <div style="text-align:right">
            <div class="label" style="color:var(--green-dark)">Venda</div>
            <div class="venda mono">${moeda(p.venda)}</div>
          </div>
        </div>
      </div>`).join('');

    list.querySelectorAll('[data-del-proj]').forEach(b => b.onclick = () => deleteProjeto(b.dataset.delProj));
  }

  function deleteProjeto(id) {
    Modal.confirm({
      title: 'Excluir Projeto',
      message: 'Deseja apagar este projeto do histórico?',
      danger: true, confirmLabel: 'Excluir',
      onConfirm: () => {
        Store.removeProjeto(id);
        Toast.success('Projeto excluído.');
        renderHistorico();
      }
    });
  }

  // ============================================================
  // CSV export
  // ============================================================
  function exportCSV() {
    const rows = Store.data.historico;
    if (rows.length === 0) { Toast.error('Nada a exportar.'); return; }

    const header = ['Data', 'Projeto', 'Máquina', 'Filamento', 'Peso (g)', 'Tempo (min)', 'Margem (%)', 'Falha (%)', 'Custo (R$)', 'Venda (R$)', 'Lucro (R$)'];
    const escapeCSV = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [header.join(';')];
    rows.forEach(p => {
      lines.push([
        formatarData(p.dataISO),
        escapeCSV(p.nome),
        escapeCSV(p.maquinaNome),
        escapeCSV(p.filamentoNome),
        p.peso.toFixed(1),
        Math.round(p.tempo),
        p.margem,
        p.falha,
        p.custo.toFixed(2).replace('.', ','),
        p.venda.toFixed(2).replace('.', ','),
        p.lucro.toFixed(2).replace('.', ',')
      ].join(';'));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `historico_3d_${new Date().toISOString().slice(0,10)}.csv`);
    Toast.success('CSV exportado.');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ============================================================
  // Backup JSON
  // ============================================================
  function exportJSON() {
    const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    downloadBlob(blob, `backup_gestao3d_${new Date().toISOString().slice(0,10)}.json`);
    Toast.success('Backup exportado.');
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        Store.importJSON(reader.result);
        Toast.success('Backup importado.');
        init();
      } catch (e) {
        Toast.error('JSON inválido: ' + e.message);
      }
    };
    reader.onerror = () => Toast.error('Falha ao ler arquivo.');
    reader.readAsText(file);
  }

  // ============================================================
  // Config
  // ============================================================
  function bindConfig() {
    $('btn-salvar-energia').onclick = () => {
      const v = parseFloat($('cfg-energia').value);
      if (!(v >= 0)) { Toast.error('Informe um valor válido.'); return; }
      Store.setEnergia(v);
      Toast.success('Tarifa atualizada.');
      calcularOrcamento();
    };
    $('btn-export-json').onclick = exportJSON;
    $('btn-import-json').onclick = () => $('import-file').click();
    $('import-file').onchange = (e) => {
      if (e.target.files.length) importJSON(e.target.files[0]);
      e.target.value = '';
    };
    $('btn-export-csv').onclick = exportCSV;
    $('btn-reset').onclick = () => {
      Modal.confirm({
        title: 'Restaurar Padrões',
        message: 'Isso apagará todos os cadastros, histórico e configurações. Continuar?',
        danger: true, confirmLabel: 'Apagar tudo',
        onConfirm: () => { Store.reset(); Toast.success('Dados restaurados.'); init(); }
      });
    };
  }

  // ============================================================
  // Init
  // ============================================================
  function bindTabs() {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.onclick = () => switchTab(b.dataset.target);
    });
  }

  function bindProduction() {
    ['prod-tempo', 'prod-peso', 'prod-margem', 'prod-falha', 'prod-filamento', 'prod-maquina']
      .forEach(id => $(id).addEventListener('input', calcularOrcamento));
    $('prod-maquina').addEventListener('change', calcularOrcamento);
    $('prod-filamento').addEventListener('change', calcularOrcamento);
    $('btn-salvar').onclick = salvarOrcamento;
    $('btn-novo-filamento').onclick = novoFilamento;
    $('btn-nova-maquina').onclick = novaMaquina;
  }

  function init() {
    Store.load();
    bindTabs();
    bindProduction();
    bindConfig();
    setupDropZone();
    switchTab('producao');
    calcularOrcamento();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
