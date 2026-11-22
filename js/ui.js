// Drobní pomocníci pro tvorbu rozhraní bez frameworku.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function mount(el, ...nodes) {
  el.replaceChildren();
  append(el, nodes);
}

// Tvar nese význam: plné kolečko = hotovo/sedí, plný čtverec = problém, čárkované kolečko = rozpracováno
export function mark(kind, extra = '') {
  return h('span', { class: `mark ${kind} ${extra}`, 'aria-hidden': 'true' });
}

export function toast(msg, { action, onAction, timeout = 4000, kind = '' } = {}) {
  const wrap = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, h('span', null, msg));
  let done = false;
  const close = () => { if (!done) { done = true; t.remove(); } };
  if (action) t.appendChild(h('button', { onclick: () => { close(); onAction && onAction(); } }, action));
  wrap.appendChild(t);
  setTimeout(close, timeout);
  return close;
}

export function modal(content, { wide = false, onClose } = {}) {
  const dlg = h('div', { class: `dialog ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true' });
  const ov = h('div', { class: 'overlay' }, dlg);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    ov.remove(); document.removeEventListener('keydown', onKey); onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  mount(dlg, typeof content === 'function' ? content(close) : content);
  document.body.appendChild(ov);
  const f = dlg.querySelector('[autofocus]') || dlg.querySelector('input, textarea, select');
  if (f) setTimeout(() => f.focus(), 30);
  return close;
}

// Otázka s tlačítky. buttons: [{ label, value, kind }] – vrací value, nebo null při zavření.
export function ask(title, text, buttons) {
  return new Promise((resolve) => {
    let val = null;
    modal((close) => [
      h('h2', { class: 'dlg-title' }, title),
      text ? h('p', { class: 'dlg-text' }, text) : null,
      h('div', { class: 'btn-col' }, buttons.map((b) => h('button', {
        class: `btn ${b.kind || ''}`,
        onclick: () => { val = b.value; close(); },
      }, b.label))),
    ], { onClose: () => resolve(val) });
  });
}

export function confirmDialog(title, text, ok = 'Ano', cancel = 'Zpět') {
  return ask(title, text, [{ label: ok, value: true, kind: 'primary' }, { label: cancel, value: false, kind: 'ghost' }])
    .then((v) => v === true);
}

// Formulář v okně. fields: [{ name, label, type, value, required, placeholder, inputmode, hint }]
export function formDialog(title, fields, { ok = 'Uložit', text } = {}) {
  return new Promise((resolve) => {
    let result = null;
    modal((close) => {
      const inputs = {};
      const err = h('p', { class: 'form-err', hidden: true });
      const submit = (e) => {
        e && e.preventDefault();
        const out = {};
        for (const f of fields) {
          const v = inputs[f.name].value.trim();
          if (f.required && !v) {
            err.textContent = `Vyplň: ${f.label}`; err.hidden = false; inputs[f.name].focus(); return;
          }
          out[f.name] = v;
        }
        result = out; close();
      };
      const form = h('form', { class: 'stack-s', onsubmit: submit },
        fields.map((f, i) => {
          const inp = f.type === 'textarea'
            ? h('textarea', { name: f.name, placeholder: f.placeholder || '', rows: 3, autofocus: i === 0 || undefined })
            : h('input', {
              name: f.name, type: f.type || 'text', placeholder: f.placeholder || '',
              inputmode: f.inputmode, autocomplete: 'off', autofocus: i === 0 || undefined,
            });
          inp.value = f.value || '';
          if (f.oninput) inp.addEventListener('input', () => f.oninput(inp.value, inputs));
          inputs[f.name] = inp;
          return h('label', { class: 'field' }, h('span', null, f.label, f.required ? '' : h('em', null, ' (nepovinné)')), inp,
            f.hint ? h('small', { class: 'muted' }, f.hint) : null);
        }),
        err,
        h('div', { class: 'btn-col' },
          h('button', { class: 'btn primary', type: 'submit' }, ok),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, 'Zrušit')));
      return [h('h2', { class: 'dlg-title' }, title), text ? h('p', { class: 'dlg-text' }, text) : null, form];
    }, { onClose: () => resolve(result) });
  });
}

export function normalize(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
// pro hledání třídy: „9.B“, „9 b“ i „9b“ najdou totéž
export function searchKey(s) {
  return normalize(s).replace(/[\s.\-_/]+/g, '');
}

const pad = (n) => String(n).padStart(2, '0');
export const fmt = {
  date(v) { const d = new Date(v); return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`; },
  time(v) { const d = new Date(v); return `${d.getHours()}:${pad(d.getMinutes())}`; },
  dt(v) { return v ? `${fmt.date(v)} ${fmt.time(v)}` : ''; },
  short(v) {
    if (!v) return '';
    const d = new Date(v), now = new Date();
    if (d.toDateString() === now.toDateString()) return `dnes ${fmt.time(v)}`;
    return `${d.getDate()}. ${d.getMonth() + 1}. ${fmt.time(v)}`;
  },
  plural(n, one, few, many) { return n === 1 ? one : (n >= 2 && n <= 4) ? few : many; },
  ks(n) { return `${n} ks`; },
};

export function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 4000);
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function firstName(name) {
  return String(name || '').split(/\s+/)[0] || '';
}
