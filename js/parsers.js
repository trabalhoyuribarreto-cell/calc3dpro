/**
 * Parsers de G-code e 3MF.
 * Objetivo: extrair { peso (g), tempoMin (min), fatiador, meta }.
 * Todos os parsers são tolerantes e retornam {peso:0, tempoMin:0} em falha.
 */
(function (global) {
  'use strict';

  // ============================================================
  // Utilitários de tempo
  // ============================================================
  function parseDuracaoHumana(str) {
    // Aceita "1d 2h 3m 4s", "2h 15m", "45s", "1 hour 30 minutes", "2h", etc.
    if (!str) return 0;
    const s = String(str).toLowerCase();

    // Formato compacto "1d2h3m4s"
    const compact = s.match(/^(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?\s*$/);
    if (compact && (compact[1] || compact[2] || compact[3] || compact[4])) {
      return (+(compact[1] || 0) * 1440) + (+(compact[2] || 0) * 60) + (+(compact[3] || 0)) + Math.round(+(compact[4] || 0) / 60);
    }

    // Formato por extenso: "1 hour 30 minutes 20 seconds"
    let total = 0;
    const days = s.match(/(\d+)\s*(?:d|day|dias?)\b/);
    const hours = s.match(/(\d+)\s*(?:h|hour|horas?)\b/);
    const mins = s.match(/(\d+)\s*(?:m|min|minutos?|minutes?)\b/);
    const secs = s.match(/(\d+)\s*(?:s|seg|segundos?|seconds?)\b/);
    if (days) total += +days[1] * 1440;
    if (hours) total += +hours[1] * 60;
    if (mins) total += +mins[1];
    if (secs) total += Math.round(+secs[1] / 60);
    return total;
  }

  // ============================================================
  // G-code (texto)
  // ============================================================
  function parseGcode(text) {
    const result = { peso: 0, tempoMin: 0, fatiador: 'desconhecido', meta: {} };
    if (!text || typeof text !== 'string') return result;

    // Amostra para performance (G-codes enormes: só primeiras 100k e últimas 100k linhas)
    const head = text.slice(0, 200000);
    const tail = text.slice(-200000);

    // ---------- PESO ----------
    // Padrões comuns (prioridade: total > único)
    const pesoPatterns = [
      /total filament used \[g\]\s*=\s*([\d.]+)/i,
      /filament used \[g\]\s*=\s*([\d.]+)/i,
      /filament used:\s*([\d.]+)\s*g\b/i,
      /filament_weight_total\s*=\s*([\d.]+)/i,
      /;\s*filament used\s*=\s*([\d.]+)\s*g/i
    ];
    for (const re of pesoPatterns) {
      const m = text.match(re);
      if (m) { result.peso = parseFloat(m[1]); break; }
    }

    // Fallback: comprimento em metros → PLA ~2.98 g/m
    if (!result.peso) {
      const comp = text.match(/Filament used:\s*([\d.]+)\s*m\b/i) ||
                   text.match(/total filament length \[mm\]\s*=\s*([\d.]+)/i);
      if (comp) {
        const mm = comp[0].includes('mm') ? parseFloat(comp[1]) : parseFloat(comp[1]) * 1000;
        result.peso = (mm / 1000) * 2.98;
      }
    }

    // ---------- TEMPO ----------
    const tempoPatterns = [
      /estimated (?:printing )?time(?:[^=\n]*)?=\s*([0-9dhms\s]+)/i,
      /total estimated time:\s*([0-9dhms\s]+)/i,
      /;\s*TIME:\s*(\d+)/i,                          // Cura (segundos)
      /;TIME_ELAPSED:(\d+)/i,
      /print_time\s*=\s*([\d.]+)/i                   // alguns fatiadores (segundos)
    ];
    for (const re of tempoPatterns) {
      const m = text.match(re);
      if (m) {
        const raw = m[1].trim();
        if (/^\d+$/.test(raw)) {
          // Número puro — provavelmente segundos
          result.tempoMin = Math.round(parseInt(raw, 10) / 60);
        } else {
          result.tempoMin = parseDuracaoHumana(raw);
        }
        if (result.tempoMin > 0) break;
      }
    }

    // ---------- FATIADOR (detecta pelo header) ----------
    if (/prusaslicer/i.test(head)) result.fatiador = 'PrusaSlicer';
    else if (/orca\s*slicer/i.test(head)) result.fatiador = 'OrcaSlicer';
    else if (/bambu\s*studio/i.test(head)) result.fatiador = 'Bambu Studio';
    else if (/cura/i.test(head)) result.fatiador = 'Cura';
    else if (/superslicer/i.test(head)) result.fatiador = 'SuperSlicer';

    return result;
  }

  // ============================================================
  // 3MF (ZIP)
  // ============================================================
  async function parse3MF(file) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip não carregado');
    const zip = await JSZip.loadAsync(file);
    const names = Object.keys(zip.files);

    // Estratégia 1: G-code embarcado
    const gcodeKey = names.find(k => /\.gcode$/i.test(k));
    if (gcodeKey) {
      const gcode = await zip.files[gcodeKey].async('string');
      const r = parseGcode(gcode);
      r.source = 'gcode-em-3mf';
      return r;
    }

    // Estratégia 2: slice_info.config (Bambu Studio / Orca)
    const sliceKey = names.find(k => /slice_info\.config$/i.test(k));
    if (sliceKey) {
      const xml = await zip.files[sliceKey].async('string');
      return parseSliceInfoXML(xml);
    }

    // Estratégia 3: metadata/Slic3r_PE_model.config (Prusa)
    const metaKey = names.find(k => /Slic3r_PE_model\.config$/i.test(k));
    if (metaKey) {
      const xml = await zip.files[metaKey].async('string');
      return parsePrusaModelXML(xml);
    }

    throw new Error('Nenhum metadado de fatiamento encontrado no 3MF.');
  }

  function parseSliceInfoXML(xml) {
    const result = { peso: 0, tempoMin: 0, fatiador: 'Bambu/Orca', meta: {}, source: 'slice_info.config' };

    // Peso: weight="12.34" (por filamento) ou total
    const weightMatches = [...xml.matchAll(/weight="([\d.]+)"/gi)].map(m => parseFloat(m[1]));
    if (weightMatches.length) result.peso = weightMatches.reduce((a, b) => a + b, 0);

    // Tempo: print_time="3600" (segundos)
    const tMatch = xml.match(/print_time="(\d+)"/i);
    if (tMatch) result.tempoMin = Math.round(parseInt(tMatch[1], 10) / 60);

    // Nome do filamento (se houver)
    const typeMatch = xml.match(/type="([^"]+)"/i);
    if (typeMatch) result.meta.filamentoTipo = typeMatch[1];

    return result;
  }

  function parsePrusaModelXML(xml) {
    const result = { peso: 0, tempoMin: 0, fatiador: 'PrusaSlicer', meta: {}, source: 'Slic3r_PE_model' };
    // Prusa raramente expõe peso/tempo no 3MF; retorna zeros e deixa usuário preencher.
    return result;
  }

  // ============================================================
  // Roteador
  // ============================================================
  async function parseFile(file) {
    const name = file.name || '';
    const ext = name.split('.').pop().toLowerCase();

    if (ext === '3mf') return parse3MF(file);
    if (['gcode', 'gco', 'g'].includes(ext)) {
      const text = await file.text();
      const r = parseGcode(text);
      r.source = 'gcode';
      return r;
    }
    if (ext === 'bgcode') {
      throw new Error('Formato binário .bgcode não é suportado. Exporte como .gcode ou .3mf.');
    }
    throw new Error(`Extensão ".${ext}" não suportada.`);
  }

  global.Parsers = { parseFile, parseGcode, parse3MF, parseDuracaoHumana };
})(window);
