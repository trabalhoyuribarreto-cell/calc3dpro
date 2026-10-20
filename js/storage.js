/**
 * Camada de persistência + modelo padrão.
 * Separa I/O de localStorage da lógica de UI.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = '3dGestaoPro_v2';
  const SCHEMA_VERSION = 2;

  const DEFAULT_DATA = {
    version: SCHEMA_VERSION,
    filamentos: [
      { id: 1, nome: 'PLA Genérico', precoKg: 120, cor: 'Preto' },
      { id: 2, nome: 'PETG Premium', precoKg: 145, cor: 'Branco' }
    ],
    maquinas: [
      { id: 1, nome: 'Bambu Lab A1', valor: 3500, manutAnual: 300, watts: 200, vidaUtilHoras: 5000 },
      { id: 2, nome: 'Ender 3 V3', valor: 1800, manutAnual: 200, watts: 150, vidaUtilHoras: 4000 }
    ],
    historico: [],
    energia: 0.95
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function sanitize(raw) {
    const base = clone(DEFAULT_DATA);
    if (!raw || typeof raw !== 'object') return base;

    // Migração de versão anterior (v1) — histórico sem versão
    if (!raw.version) {
      base.filamentos = Array.isArray(raw.filamentos) ? raw.filamentos : base.filamentos;
      base.maquinas = Array.isArray(raw.maquinas) ? raw.maquinas : base.maquinas;
      base.historico = Array.isArray(raw.historico) ? raw.historico.map(migrateHistoricoV1) : [];
      base.energia = typeof raw.energia === 'number' && raw.energia > 0 ? raw.energia : base.energia;
      return base;
    }

    base.filamentos = Array.isArray(raw.filamentos) ? raw.filamentos.map(validateFilamento).filter(Boolean) : base.filamentos;
    base.maquinas  = Array.isArray(raw.maquinas)  ? raw.maquinas.map(validateMaquina).filter(Boolean)   : base.maquinas;
    base.historico = Array.isArray(raw.historico) ? raw.historico.map(validateProjeto).filter(Boolean) : [];
    base.energia   = (typeof raw.energia === 'number' && isFinite(raw.energia) && raw.energia >= 0)
                     ? raw.energia : base.energia;
    return base;
  }

  // Histórico v1 armazenava strings formatadas — converter para numérico
  function migrateHistoricoV1(p) {
    const parseMoney = (s) => {
      if (typeof s === 'number') return s;
      if (typeof s !== 'string') return 0;
      const n = parseFloat(s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
      return isFinite(n) ? n : 0;
    };
    return {
      id: p.id || Date.now() + Math.random(),
      nome: String(p.nome || 'Sem nome').slice(0, 200),
      dataISO: new Date().toISOString(),
      peso: parseFloat(p.peso) || 0,
      tempo: parseFloat(p.tempo) || 0,
      custo: parseMoney(p.custo),
      venda: parseMoney(p.venda),
      lucro: parseMoney(p.lucro),
      maquinaNome: String(p.maquina || ''),
      filamentoNome: String(p.filamento || ''),
      margem: 0, falha: 0
    };
  }

  function validateFilamento(f) {
    if (!f || typeof f !== 'object') return null;
    const id = Number(f.id) || Date.now() + Math.random();
    const nome = String(f.nome || '').trim();
    if (!nome) return null;
    return {
      id,
      nome: nome.slice(0, 80),
      precoKg: Number(f.precoKg) || 0,
      cor: String(f.cor || '').slice(0, 40)
    };
  }

  function validateMaquina(m) {
    if (!m || typeof m !== 'object') return null;
    const id = Number(m.id) || Date.now() + Math.random();
    const nome = String(m.nome || '').trim();
    if (!nome) return null;
    return {
      id,
      nome: nome.slice(0, 80),
      valor: Math.max(0, Number(m.valor) || 0),
      manutAnual: Math.max(0, Number(m.manutAnual) || 0),
      watts: Math.max(0, Number(m.watts) || 0),
      vidaUtilHoras: Math.max(1, Number(m.vidaUtilHoras) || 1000)
    };
  }

  function validateProjeto(p) {
    if (!p || typeof p !== 'object') return null;
    return {
      id: p.id || Date.now() + Math.random(),
      nome: String(p.nome || 'Sem nome').slice(0, 200),
      dataISO: p.dataISO || new Date().toISOString(),
      peso: Number(p.peso) || 0,
      tempo: Number(p.tempo) || 0,
      custo: Number(p.custo) || 0,
      venda: Number(p.venda) || 0,
      lucro: Number(p.lucro) || 0,
      maquinaNome: String(p.maquinaNome || ''),
      filamentoNome: String(p.filamentoNome || ''),
      margem: Number(p.margem) || 0,
      falha: Number(p.falha) || 0
    };
  }

  const Store = {
    data: clone(DEFAULT_DATA),

    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        this.data = raw ? sanitize(JSON.parse(raw)) : clone(DEFAULT_DATA);
      } catch (e) {
        console.warn('Falha ao ler localStorage, usando padrões.', e);
        this.data = clone(DEFAULT_DATA);
      }
      return this.data;
    },

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        return true;
      } catch (e) {
        console.error('Falha ao salvar localStorage.', e);
        return false;
      }
    },

    reset() {
      this.data = clone(DEFAULT_DATA);
      this.save();
    },

    exportJSON() {
      return JSON.stringify(this.data, null, 2);
    },

    importJSON(text) {
      const parsed = JSON.parse(text);
      const clean = sanitize(parsed);
      this.data = clean;
      this.save();
      return clean;
    },

    // Operações de domínio
    addFilamento(f) { const v = validateFilamento({ ...f, id: Date.now() }); if (!v) throw new Error('Dados inválidos'); this.data.filamentos.push(v); this.save(); return v; },
    updateFilamento(id, f) { const i = this.data.filamentos.findIndex(x => x.id === id); if (i < 0) return null; const v = validateFilamento({ ...f, id }); if (!v) throw new Error('Dados inválidos'); this.data.filamentos[i] = v; this.save(); return v; },
    removeFilamento(id) { this.data.filamentos = this.data.filamentos.filter(x => x.id !== id); this.save(); },

    addMaquina(m) { const v = validateMaquina({ ...m, id: Date.now() }); if (!v) throw new Error('Dados inválidos'); this.data.maquinas.push(v); this.save(); return v; },
    updateMaquina(id, m) { const i = this.data.maquinas.findIndex(x => x.id === id); if (i < 0) return null; const v = validateMaquina({ ...m, id }); if (!v) throw new Error('Dados inválidos'); this.data.maquinas[i] = v; this.save(); return v; },
    removeMaquina(id) { this.data.maquinas = this.data.maquinas.filter(x => x.id !== id); this.save(); },

    addProjeto(p) {
      const v = validateProjeto({ ...p, id: Date.now() });
      if (!v) throw new Error('Projeto inválido');
      this.data.historico.unshift(v);
      this.save();
      return v;
    },
    removeProjeto(id) { this.data.historico = this.data.historico.filter(x => x.id !== id); this.save(); },

    setEnergia(v) { this.data.energia = Math.max(0, Number(v) || 0); this.save(); }
  };

  global.Store = Store;
})(window);
