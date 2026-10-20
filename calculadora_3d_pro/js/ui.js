/**
 * Utilitários de UI: toasts, modal, formatação, escape.
 */
(function (global) {
  'use strict';

  const Toast = {
    show(msg, type = 'info', durationMs = 3500) {
      const root = document.getElementById('toast-root');
      if (!root) return;
      const el = document.createElement('div');
      el.className = `toast ${type}`;
      const icon = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' }[type] || 'fa-circle-info';
      el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeHtml(msg)}</span>`;
      root.appendChild(el);
      setTimeout(() => {
        el.style.opacity = '0';
        el.style.transition = 'opacity .3s';
        setTimeout(() => el.remove(), 300);
      }, durationMs);
    },
    success(m) { this.show(m, 'success'); },
    error(m)   { this.show(m, 'error'); },
    info(m)    { this.show(m, 'info'); }
  };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function moeda(v) {
    const n = Number(v) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatarData(iso) {
    try {
      return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return ''; }
  }

  // Modal genérico
  const Modal = {
    open({ title, fields, onSubmit }) {
      const dlg = document.getElementById('modal');
      const form = document.getElementById('modal-form');
      const titleEl = document.getElementById('modal-title');
      const fieldsEl = document.getElementById('modal-fields');
      const submitBtn = document.getElementById('modal-submit');
      const cancelBtn = document.getElementById('modal-cancel');

      titleEl.textContent = title;
      fieldsEl.innerHTML = fields.map(f => {
        const id = `mf-${f.name}`;
        const req = f.required ? 'required' : '';
        let input;
        if (f.type === 'select') {
          const opts = (f.options || []).map(o => `<option value="${escapeHtml(o.value)}"${o.selected?' selected':''}>${escapeHtml(o.label)}</option>`).join('');
          input = `<select id="${id}" name="${escapeHtml(f.name)}" ${req}>${opts}</select>`;
        } else {
          input = `<input id="${id}" name="${escapeHtml(f.name)}" type="${f.type || 'text'}" value="${escapeHtml(f.value ?? '')}" placeholder="${escapeHtml(f.placeholder || '')}" ${req} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.step ? `step="${f.step}"` : ''}>`;
        }
        return `<div class="field"><label for="${id}">${escapeHtml(f.label)}${f.required?' <span class="req">*</span>':''}</label>${input}</div>`;
      }).join('');

      const close = () => { dlg.close(); form.onsubmit = null; cancelBtn.onclick = null; };
      cancelBtn.onclick = close;
      dlg.oncancel = close;

      form.onsubmit = (e) => {
        e.preventDefault();
        const data = {};
        fields.forEach(f => {
          const el = form.querySelector(`[name="${f.name}"]`);
          data[f.name] = el ? el.value : '';
        });
        try {
          onSubmit(data);
          close();
        } catch (err) {
          Toast.error(err.message || 'Erro ao salvar');
        }
      };

      dlg.showModal();
      const first = fieldsEl.querySelector('input, select');
      if (first) first.focus();
    },
    confirm({ title, message, onConfirm, confirmLabel = 'Confirmar', danger = false }) {
      const dlg = document.getElementById('modal');
      const form = document.getElementById('modal-form');
      const titleEl = document.getElementById('modal-title');
      const fieldsEl = document.getElementById('modal-fields');
      const submitBtn = document.getElementById('modal-submit');
      const cancelBtn = document.getElementById('modal-cancel');

      titleEl.textContent = title;
      fieldsEl.innerHTML = `<p>${escapeHtml(message)}</p>`;
      submitBtn.textContent = confirmLabel;
      submitBtn.className = danger ? 'btn-danger' : 'btn-primary';

      const close = () => {
        dlg.close();
        form.onsubmit = null;
        cancelBtn.onclick = null;
        submitBtn.textContent = 'Salvar';
        submitBtn.className = 'btn-primary';
      };
      cancelBtn.onclick = close;
      dlg.oncancel = close;
      form.onsubmit = (e) => {
        e.preventDefault();
        try { onConfirm(); close(); }
        catch (err) { Toast.error(err.message || 'Erro'); }
      };
      dlg.showModal();
    }
  };

  global.UI = { Toast, Modal, escapeHtml, moeda, formatarData };
})(window);
