/**
 * Shared invoice generator engine.
 * Driven by a global APP_CONFIG object that each app page (invoice.html,
 * tagore-nagar/index.html, ...) defines inline BEFORE loading this file.
 * Editing this file (or css/invoice-app.css) changes behavior/styling
 * for every app that includes it.
 *
 * Expected APP_CONFIG shape:
 * {
 *   brandEmoji: '🎒',
 *   brandTitle: 'Eurokids VIP Colony',
 *   brandSubtitle: 'Invoice Generator',
 *   signOrgLabel: 'For Eurokids VIP Colony',
 *   footerPhone: '6261474134',
 *   footerWebsite: 'www.eurokidsindia.com',
 *   footerAddress: 'H.no 2, Golden homes, VIP Colony',
 *   lsPrefix: 'ek_vip',
 *   invoicePrefix: 'EK/VIP',
 *   programs: { ...same shape as PROGRAMS below... }
 * }
 */

const PROGRAMS = APP_CONFIG.programs;

let currentFees = [];
let payments = [];
let cloudInvoices = []; // in-memory mirror from sheet (or localStorage fallback)
let scriptUrl = '';

/* ============ SYNC / CLOUD ============ */

const LS_KEYS = {
  SCRIPT_URL: APP_CONFIG.lsPrefix + '_script_url',
  CACHE: APP_CONFIG.lsPrefix + '_invoices_v4_cache'
};

function loadScriptUrl() {
  scriptUrl = localStorage.getItem(LS_KEYS.SCRIPT_URL) || '';
  return scriptUrl;
}

function saveScriptUrl(url) {
  scriptUrl = url.trim();
  if (scriptUrl) localStorage.setItem(LS_KEYS.SCRIPT_URL, scriptUrl);
  else localStorage.removeItem(LS_KEYS.SCRIPT_URL);
}

function setSyncStatus(state, message) {
  const bar = document.getElementById('syncBar');
  const text = document.getElementById('syncText');
  bar.classList.remove('connected', 'syncing', 'error', 'offline');
  if (state) bar.classList.add(state);
  text.textContent = message;
}

function openSettings() {
  document.getElementById('scriptUrlInput').value = scriptUrl || '';
  document.getElementById('settingsModal').classList.add('show');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('show');
}

async function saveSettings() {
  const url = document.getElementById('scriptUrlInput').value.trim();
  if (!url) { alert('Please paste your Apps Script URL.'); return; }
  if (!/^https:\/\/script\.google\.com\//.test(url)) {
    if (!confirm('That URL does not look like a Google Apps Script web app URL. Save anyway?')) return;
  }
  saveScriptUrl(url);
  closeSettings();
  await syncFromCloud();
}

function clearScriptUrl() {
  if (!confirm('Disconnect from Google Sheet? Local cache will stay.')) return;
  saveScriptUrl('');
  setSyncStatus(null, 'Not connected to Google Sheet');
  document.getElementById('settingsModal').classList.remove('show');
}

async function callScript(params, method) {
  if (!scriptUrl) throw new Error('No Apps Script URL configured');
  const isPost = method === 'POST';
  const opts = {
    method: isPost ? 'POST' : 'GET',
    redirect: 'follow'
  };
  let url = scriptUrl;
  if (isPost) {
    // Use text/plain to avoid CORS preflight with Apps Script
    opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
    opts.body = JSON.stringify(params);
  } else {
    const qs = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    url = scriptUrl + (scriptUrl.indexOf('?') >= 0 ? '&' : '?') + qs;
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) {
    throw new Error('Invalid response from server. First 200 chars: ' + text.slice(0, 200));
  }
  if (!json.ok) throw new Error(json.error || 'Unknown server error');
  return json.data;
}

async function syncFromCloud() {
  if (!scriptUrl) {
    // Fall back to local cache
    const cached = localStorage.getItem(LS_KEYS.CACHE);
    cloudInvoices = cached ? JSON.parse(cached) : [];
    setSyncStatus('offline', `Offline mode · ${cloudInvoices.length} cached`);
    renderHistory();
    refreshInvoiceNumber();
    return;
  }
  const ay = document.getElementById('academicYear').value || '2026-2027';
  setSyncStatus('syncing', 'Syncing from Google Sheet...');
  try {
    const data = await callScript({ action: 'list', ay: ay }, 'GET');
    cloudInvoices = data.invoices || [];
    localStorage.setItem(LS_KEYS.CACHE, JSON.stringify(cloudInvoices));
    setSyncStatus('connected', `Connected · ${cloudInvoices.length} invoice${cloudInvoices.length === 1 ? '' : 's'} in sheet (${ay})`);
    renderHistory();
    await refreshInvoiceNumber();
  } catch (err) {
    // Use cache
    console.error('Sync from cloud failed:', err);
    const cached = localStorage.getItem(LS_KEYS.CACHE);
    cloudInvoices = cached ? JSON.parse(cached) : [];
    setSyncStatus('error', 'Sync failed: ' + err.message + ' · using cache');
    renderHistory();
  }
}

async function refreshInvoiceNumber() {
  if (document.getElementById('customInvNo').checked) return;
  const ay = document.getElementById('academicYear').value || '2026-2027';
  if (scriptUrl) {
    try {
      const data = await callScript({ action: 'nextNumber', ay: ay }, 'GET');
      document.getElementById('invNumber').value = data.nextInvoiceNumber;
      return;
    } catch (err) {
      // fall through to local
    }
  }
  document.getElementById('invNumber').value = generateInvoiceNumberLocal();
}

/* ============ INIT ============ */

async function init() {
  applyBranding();
  document.getElementById('invDate').valueAsDate = new Date();
  loadProgram();
  renderPayments();
  loadScriptUrl();
  await syncFromCloud();
}

function applyBranding() {
  document.title = `${APP_CONFIG.brandTitle} – Invoice Generator`;
  const titleEl = document.getElementById('brandTitle');
  if (titleEl) titleEl.textContent = `${APP_CONFIG.brandEmoji} ${APP_CONFIG.brandTitle}`;
  const subEl = document.getElementById('brandSubtitle');
  if (subEl) subEl.textContent = APP_CONFIG.brandSubtitle;
}

function generateInvoiceNumberLocal() {
  const year = new Date().getFullYear();
  const autoNumbers = cloudInvoices.filter(h => !h.customInvNo).map(h => {
    const m = String(h.invNumber || '').match(/(\d+)$/);
    return m ? parseInt(m[1]) : 0;
  });
  const nextNum = autoNumbers.length > 0 ? Math.max(...autoNumbers) + 1 : 1;
  return `${APP_CONFIG.invoicePrefix}/${year}/${String(nextNum).padStart(4, '0')}`;
}

async function handleAcademicYearChange() {
  const ay = document.getElementById('academicYear').value.trim();
  if (!/^\d{4}-\d{4}$/.test(ay)) {
    calcTotal();
    return;
  }
  await syncFromCloud();
  calcTotal();
}

function toggleCustomInvNo() {
  const on = document.getElementById('customInvNo').checked;
  const field = document.getElementById('invNumber');
  if (on) {
    field.removeAttribute('readonly');
    field.oninput = calcTotal;
    field.focus();
    field.select();
  } else {
    field.setAttribute('readonly', true);
    field.oninput = null;
    refreshInvoiceNumber();
    calcTotal();
  }
}

function toggleGst() {
  document.getElementById('gstSection').style.display = document.getElementById('gstEnabled').checked ? 'block' : 'none';
  calcTotal();
}

function toggleTransport() {
  const on = document.getElementById('transportEnabled').checked;
  document.getElementById('transportBody').style.display = on ? 'block' : 'none';
  document.getElementById('transportToggle').classList.toggle('active', on);
  calcTotal();
}

function toggleDaycare() {
  const on = document.getElementById('daycareEnabled').checked;
  document.getElementById('daycareBody').style.display = on ? 'block' : 'none';
  document.getElementById('daycareToggle').classList.toggle('active', on);
  calcTotal();
}

function applyTransportPreset() {
  const sel = document.getElementById('transportZone').value;
  if (!sel) { calcTotal(); return; }
  const [area, rate] = sel.split('|');
  document.getElementById('transportDesc').value = area;
  const currentAmt = parseFloat(document.getElementById('transportAmount').value) || 0;
  if (currentAmt === 0) {
    document.getElementById('transportAmount').value = parseInt(rate) * 12;
    document.getElementById('transportPeriod').value = '12 months';
  }
  calcTotal();
}

function loadProgram() {
  const key = document.getElementById('program').value;
  currentFees = JSON.parse(JSON.stringify(PROGRAMS[key].components));
  renderFees();
  calcTotal();
}

function renderFees() {
  const container = document.getElementById('feeRows');
  container.innerHTML = '';
  currentFees.forEach((f, idx) => {
    const row = document.createElement('div');
    row.className = 'fee-row';
    row.innerHTML = `
      <input type="text" value="${escapeAttr(f.label)}" onchange="updateFee(${idx}, 'label', this.value)">
      <input type="number" value="${f.amount}" onchange="updateFee(${idx}, 'amount', this.value)" oninput="updateFee(${idx}, 'amount', this.value)">
      <button class="btn btn-danger" onclick="removeFee(${idx})" title="Remove">×</button>
    `;
    container.appendChild(row);
  });
}

function updateFee(idx, field, value) {
  if (field === 'amount') currentFees[idx][field] = parseFloat(value) || 0;
  else currentFees[idx][field] = value;
  calcTotal();
}

function removeFee(idx) {
  currentFees.splice(idx, 1);
  renderFees();
  calcTotal();
}

function addFeeRow() {
  currentFees.push({ label: "Custom Item", amount: 0 });
  renderFees();
  calcTotal();
}

function addPaymentRow() {
  payments.push({ date: new Date().toISOString().slice(0, 10), amount: 0, mode: 'Cash', ref: '' });
  renderPayments();
  calcTotal();
}

function renderPayments() {
  const container = document.getElementById('paymentRows');
  container.innerHTML = '';
  document.getElementById('paymentsBadge').textContent = `${payments.length} ${payments.length === 1 ? 'entry' : 'entries'}`;
  if (payments.length === 0) {
    container.innerHTML = '<div class="note-small" style="padding:8px; text-align:center;">No payments added yet</div>';
    return;
  }
  payments.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'payment-row';
    row.innerHTML = `
      <input type="date" value="${p.date}" onchange="updatePayment(${idx}, 'date', this.value)">
      <input type="number" value="${p.amount}" placeholder="Amount" onchange="updatePayment(${idx}, 'amount', this.value)" oninput="updatePayment(${idx}, 'amount', this.value)">
      <select onchange="updatePayment(${idx}, 'mode', this.value)">
        ${['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Card'].map(m =>
          `<option value="${m}" ${p.mode === m ? 'selected' : ''}>${m}</option>`
        ).join('')}
      </select>
      <input type="text" value="${escapeAttr(p.ref)}" placeholder="Txn / Ref ID" onchange="updatePayment(${idx}, 'ref', this.value)">
      <button class="btn btn-danger" onclick="removePayment(${idx})" title="Remove">×</button>
    `;
    container.appendChild(row);
  });
}

function updatePayment(idx, field, value) {
  if (field === 'amount') payments[idx][field] = parseFloat(value) || 0;
  else payments[idx][field] = value;
  calcTotal();
}

function removePayment(idx) {
  payments.splice(idx, 1);
  renderPayments();
  calcTotal();
}

function calcTotal() {
  const feeSum = currentFees.reduce((s, f) => s + (parseFloat(f.amount) || 0), 0);
  const transportOn = document.getElementById('transportEnabled').checked;
  const transportAmt = transportOn ? (parseFloat(document.getElementById('transportAmount').value) || 0) : 0;
  const daycareOn = document.getElementById('daycareEnabled').checked;
  const daycareAmt = daycareOn ? (parseFloat(document.getElementById('daycareAmount').value) || 0) : 0;
  const addonsTotal = transportAmt + daycareAmt;
  const discount = parseFloat(document.getElementById('discount').value) || 0;
  const subtotal = feeSum + addonsTotal;
  const total = subtotal - discount;
  const paid = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const balance = total - paid;

  document.getElementById('feeSubtotal').textContent = fmt(feeSum);
  document.getElementById('addonsTotal').textContent = fmt(addonsTotal);
  document.getElementById('totalDisplay').textContent = fmt(total);
  document.getElementById('paidDisplay').textContent = fmt(paid);
  document.getElementById('balanceDisplay').textContent = fmt(balance);

  document.getElementById('discountLine').style.display = discount > 0 ? 'flex' : 'none';
  document.getElementById('discountTotal').textContent = '− ' + fmt(discount);

  const balLine = document.getElementById('balanceLine');
  balLine.classList.remove('due', 'paid');
  if (balance > 0) balLine.classList.add('due');
  else if (balance <= 0 && paid > 0) balLine.classList.add('paid');

  renderPreview({ feeSum, transportAmt, daycareAmt, discount, subtotal, total, paid, balance });
}

function fmt(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }

/* ====== VALIDATION ====== */
function validateForm() {
  const errors = [];
  const fields = [
    { id: 'invDate', name: 'Invoice Date' },
    { id: 'academicYear', name: 'Academic Year' },
    { id: 'invNumber', name: 'Invoice Number' },
    { id: 'studentName', name: 'Student Name' },
    { id: 'parentName', name: 'Parent / Guardian Name' },
    { id: 'contact', name: 'Contact Number' }
  ];

  // Clear all invalid states first
  document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));

  fields.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el.value.trim()) {
      el.classList.add('invalid');
      errors.push(f.name + ' is required');
    }
  });

  // Contact number basic pattern
  const contactEl = document.getElementById('contact');
  if (contactEl.value.trim() && !/^\d{7,15}$/.test(contactEl.value.replace(/\s+/g, ''))) {
    contactEl.classList.add('invalid');
    errors.push('Contact Number must be digits only (7–15 digits)');
  }

  // Email basic pattern (optional field)
  const emailEl = document.getElementById('parentEmail');
  if (emailEl && emailEl.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value.trim())) {
    emailEl.classList.add('invalid');
    errors.push('Email address is not valid');
  }

  // Transport conditional
  if (document.getElementById('transportEnabled').checked) {
    const td = document.getElementById('transportDesc');
    const ta = document.getElementById('transportAmount');
    if (!td.value.trim()) { td.classList.add('invalid'); errors.push('Transport: Area Description is required'); }
    if (!ta.value || parseFloat(ta.value) <= 0) { ta.classList.add('invalid'); errors.push('Transport: Charge must be greater than 0'); }
  }

  // Daycare conditional
  if (document.getElementById('daycareEnabled').checked) {
    const da = document.getElementById('daycareAmount');
    if (!da.value || parseFloat(da.value) <= 0) { da.classList.add('invalid'); errors.push('Day Care: Charge must be greater than 0'); }
  }

  // GST conditional - if checked, GST number required
  if (document.getElementById('gstEnabled').checked) {
    const gn = document.getElementById('gstNumber');
    if (!gn.value.trim()) { gn.classList.add('invalid'); errors.push('GSTIN is required when GST is enabled'); }
  }

  // Fees - at least one item with amount > 0
  const totalFees = currentFees.reduce((s, f) => s + (parseFloat(f.amount) || 0), 0);
  if (totalFees <= 0) errors.push('Fee components total must be greater than 0');

  const banner = document.getElementById('validationBanner');
  const list = document.getElementById('validationList');
  if (errors.length) {
    list.innerHTML = errors.map(e => `<li>${escapeHtml(e)}</li>`).join('');
    banner.classList.add('show');
    const firstInvalid = document.querySelector('.invalid');
    if (firstInvalid) firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  } else {
    banner.classList.remove('show');
    return true;
  }
}

/* ====== PREVIEW ====== */
function renderPreview(t) {
  const invNumber = document.getElementById('invNumber').value || '—';
  const invDate = document.getElementById('invDate').value;
  const formattedDate = invDate
    ? new Date(invDate).toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'})
    : '';
  const student = document.getElementById('studentName').value || '—';
  const parent = document.getElementById('parentName').value || '—';
  const contact = document.getElementById('contact').value || '—';
  const emailEl = document.getElementById('parentEmail');
  const email = emailEl ? emailEl.value.trim() : '';
  const program = PROGRAMS[document.getElementById('program').value].name;
  const academicYear = document.getElementById('academicYear').value;

  const gstOn = document.getElementById('gstEnabled').checked;
  const gstNo = document.getElementById('gstNumber').value;
  const gstName = document.getElementById('gstName').value;

  const transportOn = document.getElementById('transportEnabled').checked;
  const transportDesc = document.getElementById('transportDesc').value || 'Transportation';
  const transportPeriod = document.getElementById('transportPeriod').value;

  const daycareOn = document.getElementById('daycareEnabled').checked;
  const daycarePeriod = document.getElementById('daycarePeriod').value;

  const discountReason = document.getElementById('discountReason').value;

  let feeTableRows = '';
  currentFees.forEach(f => {
    feeTableRows += `<tr><td>${escapeHtml(f.label)}</td><td class="right">${fmt(f.amount)}</td></tr>`;
  });
  if (transportOn && t.transportAmt > 0) {
    const lbl = `Transportation — ${escapeHtml(transportDesc)}${transportPeriod ? ' (' + escapeHtml(transportPeriod) + ')' : ''}`;
    feeTableRows += `<tr><td>${lbl}</td><td class="right">${fmt(t.transportAmt)}</td></tr>`;
  }
  if (daycareOn && t.daycareAmt > 0) {
    const lbl = `Day Care Facility${daycarePeriod ? ' (' + escapeHtml(daycarePeriod) + ')' : ''} — 1:30 pm to 6:00 pm`;
    feeTableRows += `<tr><td>${lbl}</td><td class="right">${fmt(t.daycareAmt)}</td></tr>`;
  }
  feeTableRows += `<tr class="subtotal"><td>Subtotal</td><td class="right">${fmt(t.subtotal)}</td></tr>`;
  if (t.discount > 0) {
    const drLbl = discountReason ? ` (${escapeHtml(discountReason)})` : '';
    feeTableRows += `<tr class="discount"><td>Less: Discount${drLbl}</td><td class="right">− ${fmt(t.discount)}</td></tr>`;
  }
  feeTableRows += `<tr class="total"><td>TOTAL PAYABLE</td><td class="right">${fmt(t.total)}</td></tr>`;

  let paymentsBlock = '';
  if (payments.length > 0) {
    let pRows = '';
    payments.forEach(p => {
      const pdate = p.date ? new Date(p.date).toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'}) : '—';
      pRows += `<tr><td>${escapeHtml(pdate)}</td><td>${escapeHtml(p.mode)}</td><td>${escapeHtml(p.ref || '—')}</td><td class="right">${fmt(p.amount)}</td></tr>`;
    });
    pRows += `<tr class="subtotal"><td colspan="3">Total Paid</td><td class="right">${fmt(t.paid)}</td></tr>`;
    const balLabel = t.balance > 0 ? 'BALANCE DUE' : (t.balance < 0 ? 'OVERPAID / REFUND DUE' : 'FULLY PAID');
    pRows += `<tr class="total"><td colspan="3">${balLabel}</td><td class="right">${fmt(Math.abs(t.balance))}</td></tr>`;
    paymentsBlock = `
      <div class="inv-section-title accent">Payment History</div>
      <table class="inv-table payments">
        <thead><tr><th>Date</th><th>Mode</th><th>Reference</th><th class="right">Amount</th></tr></thead>
        <tbody>${pRows}</tbody>
      </table>
    `;
  }

  const html = `
    ${buildLetterheadTop()}

    <div class="inv-body">
      <div class="inv-title-bar">
        <div class="inv-title">INVOICE</div>
      </div>

      <div class="inv-sub-block">
        <div class="left">
          <div class="inv-no">${escapeHtml(invNumber)}</div>
          ${gstOn && (gstNo || gstName) ? `
            <div class="inv-gst">
              ${gstNo ? `<strong>GSTIN:</strong> ${escapeHtml(gstNo)}` : ''}
              ${gstName ? `${gstNo ? '<br>' : ''}<strong>Registered Name:</strong> ${escapeHtml(gstName)}` : ''}
            </div>
          ` : ''}
        </div>
        <div class="right">
          <div class="inv-date">Date: ${formattedDate}</div>
        </div>
      </div>

      <div class="inv-meta">
        <div class="box">
          <div class="lbl">Bill To</div>
          <div class="val">${escapeHtml(student)}</div>
          <div class="sub">Parent: ${escapeHtml(parent)}</div>
          <div class="sub">Contact: ${escapeHtml(contact)}</div>
          ${email ? `<div class="sub">Email: ${escapeHtml(email)}</div>` : ''}
        </div>
        <div class="box">
          <div class="lbl">Program Details</div>
          <div class="val">${escapeHtml(program)}</div>
          <div class="sub">Academic Year: ${escapeHtml(academicYear)}</div>
        </div>
      </div>

      <div class="inv-section-title">Fee Breakdown</div>
      <table class="inv-table">
        <thead><tr><th>Description</th><th class="right">Amount</th></tr></thead>
        <tbody>${feeTableRows}</tbody>
      </table>

      ${paymentsBlock}

      <div class="inv-notes">
        <div class="hd">Notes</div>
        • Late fee of ₹30/day is chargeable after September 24th.<br>
        • Access Home Buddy App · User ID: Registered Phone number.<br>
        • Transportation is available as per distance.<br>
        • Fees once paid are non-refundable &amp; non-transferable.
      </div>

      <div class="inv-sign">
        <div class="sign-box"><div class="sign-line">Parent Signature</div></div>
        <div class="sign-box"><div class="sign-line">${escapeHtml(APP_CONFIG.signOrgLabel)}</div></div>
      </div>
    </div>

    ${buildLetterheadBottom()}
  `;

  document.getElementById('invoicePreview').innerHTML = html;
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

function getHistory() {
  return cloudInvoices.slice();
}

async function saveInvoice() {
  if (!validateForm()) return;
  const invNumber = document.getElementById('invNumber').value.trim();
  const snapshot = collectSnapshot();
  const existing = cloudInvoices.findIndex(h => h.invNumber === invNumber);
  if (existing >= 0) {
    if (!confirm(`Invoice ${invNumber} already exists. Overwrite?`)) return;
  }

  if (scriptUrl) {
    setSyncStatus('syncing', 'Saving to Google Sheet...');
    try {
      await callScript({ action: 'save', invoice: snapshot }, 'POST');
      // Re-sync to get the canonical state back
      await syncFromCloud();
      alert('✓ Invoice saved to Google Sheet: ' + invNumber);
    } catch (err) {
      // Save locally as cache, show warning
      console.error('Cloud save failed:', err);
      if (existing >= 0) cloudInvoices[existing] = snapshot;
      else cloudInvoices.unshift(snapshot);
      localStorage.setItem(LS_KEYS.CACHE, JSON.stringify(cloudInvoices));
      renderHistory();
      setSyncStatus('error', 'Cloud save failed: ' + err.message);
      alert('⚠ Cloud save failed:\n\n' + err.message + '\n\nSaved to local cache only. Invoice number: ' + invNumber);
    }
  } else {
    // No cloud configured, just save locally
    if (existing >= 0) cloudInvoices[existing] = snapshot;
    else cloudInvoices.unshift(snapshot);
    localStorage.setItem(LS_KEYS.CACHE, JSON.stringify(cloudInvoices));
    renderHistory();
    alert('✓ Invoice saved locally (offline): ' + invNumber + '\n\nTip: Configure Google Sheet sync in Settings to sync across devices.');
  }
}

function collectSnapshot() {
  const emailEl = document.getElementById('parentEmail');
  return {
    invNumber: document.getElementById('invNumber').value.trim(),
    customInvNo: document.getElementById('customInvNo').checked,
    date: document.getElementById('invDate').value,
    student: document.getElementById('studentName').value,
    parent: document.getElementById('parentName').value,
    contact: document.getElementById('contact').value,
    email: emailEl ? emailEl.value.trim() : '',
    program: document.getElementById('program').value,
    academicYear: document.getElementById('academicYear').value,
    gstEnabled: document.getElementById('gstEnabled').checked,
    gstNumber: document.getElementById('gstNumber').value,
    gstName: document.getElementById('gstName').value,
    fees: JSON.parse(JSON.stringify(currentFees)),
    transport: {
      enabled: document.getElementById('transportEnabled').checked,
      zone: document.getElementById('transportZone').value,
      desc: document.getElementById('transportDesc').value,
      amount: document.getElementById('transportAmount').value,
      period: document.getElementById('transportPeriod').value
    },
    daycare: {
      enabled: document.getElementById('daycareEnabled').checked,
      amount: document.getElementById('daycareAmount').value,
      period: document.getElementById('daycarePeriod').value
    },
    discount: document.getElementById('discount').value,
    discountReason: document.getElementById('discountReason').value,
    payments: JSON.parse(JSON.stringify(payments)),
    total: document.getElementById('totalDisplay').textContent,
    paid: document.getElementById('paidDisplay').textContent,
    balance: document.getElementById('balanceDisplay').textContent,
    savedAt: new Date().toISOString()
  };
}

function renderHistory() {
  // History list UI removed — replaced by student search.
  // This function is kept as a no-op so existing callers don't break.
  // Re-render current search results if any, so saved edits show up.
  if (document.getElementById('searchInput').value.trim()) {
    doSearch();
  }
}

/* ====== STUDENT SEARCH ====== */
function doSearch() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const resultsEl = document.getElementById('searchResults');

  if (!q) {
    resultsEl.classList.remove('show');
    resultsEl.innerHTML = '';
    return;
  }

  // Filter invoices — name, parent, email, or invoice number
  const matches = cloudInvoices.filter(inv => {
    const student = String(inv.student || '').toLowerCase();
    const parent = String(inv.parent || '').toLowerCase();
    const invNo = String(inv.invNumber || '').toLowerCase();
    const contact = String(inv.contact || '').toLowerCase();
    const email = String(inv.email || '').toLowerCase();
    return student.includes(q) || parent.includes(q) || invNo.includes(q) || contact.includes(q) || email.includes(q);
  });

  resultsEl.classList.add('show');

  if (matches.length === 0) {
    resultsEl.innerHTML = `<div class="search-empty">No matches found in ${escapeHtml(document.getElementById('academicYear').value)}</div>`;
    return;
  }

  // Group matches by student name (lowercase key) for student-centric view
  const groups = {};
  matches.forEach(inv => {
    const key = String(inv.student || '').toLowerCase().trim() || '__unknown__';
    if (!groups[key]) groups[key] = { studentName: inv.student || '(no name)', parent: inv.parent, contact: inv.contact, program: inv.program, invoices: [] };
    groups[key].invoices.push(inv);
  });

  const groupKeys = Object.keys(groups);
  let html = '';
  groupKeys.forEach(key => {
    const g = groups[key];
    // Sort invoices by date descending
    g.invoices.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const invoiceCount = g.invoices.length;
    html += `
      <div class="search-result-student">
        <div class="s-info">
          <div class="s-name">${escapeHtml(g.studentName)}</div>
          <div class="s-meta">Parent: ${escapeHtml(g.parent || '—')} · Contact: ${escapeHtml(g.contact || '—')} · ${escapeHtml(PROGRAMS[g.program]?.name || '')} · ${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'}</div>
        </div>
        <button class="btn btn-accent btn-sm" onclick="showStudentPaymentHistory('${escapeAttr(key)}')">💳 View Payments</button>
      </div>
    `;
    g.invoices.forEach(inv => {
      const idx = cloudInvoices.indexOf(inv);
      const bal = parseBalance(inv.balance);
      const balClass = bal > 0 ? 'due' : 'paid';
      const balText = bal > 0 ? `${inv.balance} due` : 'Paid';
      html += `
        <div class="search-result-invoice">
          <div>
            <div class="r-no">${escapeHtml(inv.invNumber)}</div>
            <div class="r-date">${escapeHtml(inv.date || '')}</div>
          </div>
          <div style="font-size:11px; color:#4b5563">Total: <strong>${escapeHtml(String(inv.total || ''))}</strong></div>
          <div class="r-bal ${balClass}">${escapeHtml(balText)}</div>
          <button class="btn btn-primary btn-sm" onclick="loadFromHistory(${idx}); clearSearch();">Load</button>
        </div>
      `;
    });
  });

  resultsEl.innerHTML = html;
}

function parseBalance(balStr) {
  if (balStr == null) return 0;
  const n = parseFloat(String(balStr).replace(/[₹,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').innerHTML = '';
  document.getElementById('searchResults').classList.remove('show');
}

/* ====== STUDENT PAYMENT HISTORY MODAL ====== */
function showStudentPaymentHistory(studentKey) {
  // Collect all invoices for this student (matched by lowercase name)
  const studentInvoices = cloudInvoices.filter(inv => {
    const k = String(inv.student || '').toLowerCase().trim() || '__unknown__';
    return k === studentKey;
  });

  if (studentInvoices.length === 0) return;

  // Sort by date descending
  studentInvoices.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const studentName = studentInvoices[0].student || '(no name)';
  document.getElementById('phModalTitle').textContent = `💳 Payment History — ${studentName}`;

  let grandTotal = 0;
  let grandPaid = 0;

  let html = '';
  studentInvoices.forEach(inv => {
    const payments = inv.payments || [];
    const totalNum = parseBalance(inv.total);
    const paidNum = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    const balNum = totalNum - paidNum;
    grandTotal += totalNum;
    grandPaid += paidNum;

    const balClass = balNum > 0 ? 'due' : 'paid';
    const balLabel = balNum > 0 ? `₹${Math.round(balNum).toLocaleString('en-IN')} due` : (balNum < 0 ? `₹${Math.round(Math.abs(balNum)).toLocaleString('en-IN')} refund` : 'Fully paid');

    let paymentRowsHtml = '';
    if (payments.length === 0) {
      paymentRowsHtml = '<tr><td colspan="4" class="no-payments">No payments recorded yet</td></tr>';
    } else {
      payments.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      payments.forEach(p => {
        paymentRowsHtml += `
          <tr>
            <td>${escapeHtml(formatDisplayDate(p.date))}</td>
            <td>${escapeHtml(p.mode || '—')}</td>
            <td>${escapeHtml(p.ref || '—')}</td>
            <td class="amt">₹${Math.round(parseFloat(p.amount) || 0).toLocaleString('en-IN')}</td>
          </tr>
        `;
      });
    }

    html += `
      <div class="payment-history-section">
        <div class="phs-header">
          <div>
            <div class="phs-inv">${escapeHtml(inv.invNumber)}</div>
            <div class="phs-summary">${escapeHtml(formatDisplayDate(inv.date))} · ${escapeHtml(PROGRAMS[inv.program]?.name || '')} · Total: <strong>₹${Math.round(totalNum).toLocaleString('en-IN')}</strong> · Paid: <strong>₹${Math.round(paidNum).toLocaleString('en-IN')}</strong></div>
          </div>
          <div class="phs-balance ${balClass}">${escapeHtml(balLabel)}</div>
        </div>
        <table class="payment-table">
          <thead>
            <tr><th>Date</th><th>Mode</th><th>Reference</th><th style="text-align:right">Amount</th></tr>
          </thead>
          <tbody>${paymentRowsHtml}</tbody>
        </table>
      </div>
    `;
  });

  const grandBalance = grandTotal - grandPaid;
  const grandBalLabel = grandBalance > 0 ? `₹${Math.round(grandBalance).toLocaleString('en-IN')} due` : (grandBalance < 0 ? `₹${Math.round(Math.abs(grandBalance)).toLocaleString('en-IN')} refund` : 'All settled');

  html += `
    <div class="phs-totals">
      <span class="phs-total-label">Across ${studentInvoices.length} invoice${studentInvoices.length === 1 ? '' : 's'} · Billed: ₹${Math.round(grandTotal).toLocaleString('en-IN')} · Paid: ₹${Math.round(grandPaid).toLocaleString('en-IN')}</span>
      <span class="phs-total-amt">${escapeHtml(grandBalLabel)}</span>
    </div>
  `;

  document.getElementById('phModalBody').innerHTML = html;
  document.getElementById('paymentHistoryModal').classList.add('show');
}

function closePaymentHistory() {
  document.getElementById('paymentHistoryModal').classList.remove('show');
}

function formatDisplayDate(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
  } catch(e) {
    return String(d);
  }
}

function loadFromHistory(i) {
  const h = cloudInvoices[i];
  if (!h) return;
  document.getElementById('customInvNo').checked = !!h.customInvNo;
  // Skip the async refresh in toggle
  if (h.customInvNo) {
    document.getElementById('invNumber').removeAttribute('readonly');
  } else {
    document.getElementById('invNumber').setAttribute('readonly', true);
  }
  document.getElementById('invNumber').value = h.invNumber;
  document.getElementById('invDate').value = h.date;
  document.getElementById('studentName').value = h.student || '';
  document.getElementById('parentName').value = h.parent || '';
  document.getElementById('contact').value = h.contact || '';
  const emailEl = document.getElementById('parentEmail');
  if (emailEl) emailEl.value = h.email || '';
  document.getElementById('program').value = h.program || 'playgroup';
  document.getElementById('academicYear').value = h.academicYear || '2026-2027';
  document.getElementById('gstEnabled').checked = !!h.gstEnabled;
  document.getElementById('gstNumber').value = h.gstNumber || '';
  document.getElementById('gstName').value = h.gstName || '';
  toggleGst();
  currentFees = JSON.parse(JSON.stringify(h.fees || PROGRAMS[h.program || 'playgroup'].components));
  renderFees();
  const t = h.transport || {};
  document.getElementById('transportEnabled').checked = !!t.enabled;
  document.getElementById('transportZone').value = t.zone || '';
  document.getElementById('transportDesc').value = t.desc || '';
  document.getElementById('transportAmount').value = t.amount || 0;
  document.getElementById('transportPeriod').value = t.period || '';
  toggleTransport();
  const d = h.daycare || {};
  document.getElementById('daycareEnabled').checked = !!d.enabled;
  document.getElementById('daycareAmount').value = d.amount || 5000;
  document.getElementById('daycarePeriod').value = d.period || '';
  toggleDaycare();
  document.getElementById('discount').value = h.discount || 0;
  document.getElementById('discountReason').value = h.discountReason || '';
  payments = JSON.parse(JSON.stringify(h.payments || []));
  renderPayments();
  calcTotal();
}

async function deleteHistory(i) {
  const h = cloudInvoices[i];
  if (!h) return;
  if (!confirm(`Delete invoice ${h.invNumber} from Google Sheet? This cannot be undone.`)) return;

  if (scriptUrl) {
    setSyncStatus('syncing', 'Deleting from Google Sheet...');
    try {
      await callScript({ action: 'delete', invNumber: h.invNumber, ay: h.academicYear }, 'POST');
      await syncFromCloud();
    } catch (err) {
      console.error('Cloud delete failed:', err);
      alert('Cloud delete failed:\n\n' + err.message);
      setSyncStatus('error', 'Delete failed: ' + err.message);
      return;
    }
  } else {
    cloudInvoices.splice(i, 1);
    localStorage.setItem(LS_KEYS.CACHE, JSON.stringify(cloudInvoices));
    renderHistory();
  }
}

function resetForm() {
  if (!confirm('Start a new invoice? Unsaved changes will be lost.')) return;
  document.getElementById('customInvNo').checked = false;
  toggleCustomInvNo();
  document.getElementById('studentName').value = '';
  document.getElementById('parentName').value = '';
  document.getElementById('contact').value = '';
  const emailEl = document.getElementById('parentEmail');
  if (emailEl) emailEl.value = '';
  document.getElementById('gstEnabled').checked = false;
  document.getElementById('gstNumber').value = '';
  document.getElementById('gstName').value = '';
  toggleGst();
  document.getElementById('transportEnabled').checked = false;
  document.getElementById('transportZone').value = '';
  document.getElementById('transportDesc').value = '';
  document.getElementById('transportAmount').value = 0;
  document.getElementById('transportPeriod').value = '';
  toggleTransport();
  document.getElementById('daycareEnabled').checked = false;
  document.getElementById('daycareAmount').value = 5000;
  document.getElementById('daycarePeriod').value = '';
  toggleDaycare();
  document.getElementById('discount').value = 0;
  document.getElementById('discountReason').value = '';
  payments = [];
  renderPayments();
  document.getElementById('invDate').valueAsDate = new Date();
  document.getElementById('validationBanner').classList.remove('show');
  document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
  loadProgram();
}

function prepPrintArea() {
  document.getElementById('printArea').innerHTML = document.getElementById('invoicePreview').innerHTML;
}

/* ====== Shared letterhead fragments (branding-aware) ====== */
function buildLetterheadTop() {
  return `
    <div class="inv-letterhead-top">
      <img src="${LOGO_BASE64}" class="logo" alt="Eurokids">
    </div>
  `;
}

function buildLetterheadBottom() {
  return `
    <div class="inv-letterhead-bottom">
      <span class="ft-item">📞 ${escapeHtml(APP_CONFIG.footerPhone)}</span>
      <span class="ft-item">🌐 ${escapeHtml(APP_CONFIG.footerWebsite)}</span>
      <span class="ft-item">📍 ${escapeHtml(APP_CONFIG.footerAddress)}</span>
    </div>
  `;
}

/**
 * Build a single A4-sized DOM page with:
 *   - Letterhead header (always)
 *   - Body content (passed in as HTML string)
 *   - Letterhead footer (always)
 * Used both for measurement and for rendering each PDF page.
 */
function buildPageElement(bodyInnerHtml) {
  const wrap = document.createElement('div');
  wrap.style.cssText = `
    width: 210mm;
    height: 297mm;
    background: white;
    display: flex;
    flex-direction: column;
    font-family: "Helvetica Neue", Arial, sans-serif;
    box-sizing: border-box;
    overflow: hidden;
  `;
  wrap.innerHTML = `
    ${buildLetterheadTop()}
    <div class="inv-body" style="flex:1; overflow:hidden;">
      ${bodyInnerHtml}
    </div>
    ${buildLetterheadBottom()}
  `;
  return wrap;
}

/**
 * Extract just the body innerHTML from the live preview
 * (everything inside .inv-body — the actual invoice content).
 */
function getInvoiceBodyHtml() {
  const preview = document.getElementById('invoicePreview');
  const body = preview.querySelector('.inv-body');
  return body ? body.innerHTML : '';
}

/**
 * Split body HTML into "blocks" — top-level child elements.
 * The signature block (.inv-sign) is identified separately so we can
 * always place it on the last page.
 */
function getBodyBlocks() {
  const preview = document.getElementById('invoicePreview');
  const body = preview.querySelector('.inv-body');
  if (!body) return { blocks: [], signature: null };

  const blocks = [];
  let signature = null;
  const children = Array.from(body.children);

  let i = 0;
  while (i < children.length) {
    const child = children[i];
    if (child.classList && child.classList.contains('inv-sign')) {
      signature = child.outerHTML;
      i++;
      continue;
    }
    // Group a section title with the immediately following table to prevent orphans
    if (child.classList && child.classList.contains('inv-section-title')
        && i + 1 < children.length
        && children[i+1].tagName === 'TABLE') {
      blocks.push(child.outerHTML + children[i+1].outerHTML);
      i += 2;
      continue;
    }
    blocks.push(child.outerHTML);
    i++;
  }
  return { blocks, signature };
}

/**
 * Measure how tall a list of HTML blocks renders inside the page body area.
 * Renders off-screen and returns the actual height in CSS pixels.
 */
async function measureBlocksHeight(blocksHtml) {
  const page = buildPageElement(blocksHtml);
  page.style.position = 'fixed';
  page.style.left = '-9999px';
  page.style.top = '0';
  // Allow content to expand vertically for measurement
  page.style.height = 'auto';
  const bodyEl = page.querySelector('.inv-body');
  bodyEl.style.overflow = 'visible';
  bodyEl.style.flex = 'none';
  document.body.appendChild(page);
  // Wait one frame for layout
  await new Promise(r => requestAnimationFrame(r));
  const bodyHeight = bodyEl.scrollHeight;
  document.body.removeChild(page);
  return bodyHeight;
}

/**
 * Compute the available body height inside an A4 page given the
 * letterhead header + footer sizes by measuring an empty page.
 */
async function getAvailableBodyHeight() {
  const page = buildPageElement('');
  page.style.position = 'fixed';
  page.style.left = '-9999px';
  page.style.top = '0';
  document.body.appendChild(page);
  await new Promise(r => requestAnimationFrame(r));
  const bodyHeight = page.querySelector('.inv-body').clientHeight;
  document.body.removeChild(page);
  return bodyHeight;
}

/**
 * Split blocks into pages so that each page's content fits within
 * the available body height. Signature block goes on the last page only.
 */
async function paginateBlocks(blocks, signatureHtml) {
  const avail = await getAvailableBodyHeight();
  const pages = [];
  let currentPage = [];

  // Helper to measure current candidate
  const measure = async (blocksList) => {
    return await measureBlocksHeight(blocksList.join(''));
  };

  for (let i = 0; i < blocks.length; i++) {
    const candidate = currentPage.concat([blocks[i]]);
    const candidateHeight = await measure(candidate);

    if (candidateHeight <= avail) {
      currentPage = candidate;
    } else {
      // Block doesn't fit — flush current page and start new one
      if (currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [blocks[i]];
      } else {
        // Single block too tall for one page — accept overflow and move on
        pages.push([blocks[i]]);
        currentPage = [];
      }
    }
  }

  if (currentPage.length > 0) pages.push(currentPage);
  if (pages.length === 0) pages.push([]);

  // Add signature to last page (try to fit, else create new page)
  if (signatureHtml) {
    const lastIdx = pages.length - 1;
    const withSig = pages[lastIdx].concat([signatureHtml]);
    const withSigHeight = await measure(withSig);
    if (withSigHeight <= avail) {
      pages[lastIdx] = withSig;
    } else {
      pages.push([signatureHtml]);
    }
  }

  return pages.map(blocks => blocks.join(''));
}

async function downloadPDF() {
  if (!validateForm()) return;

  let pagesContainer = null;
  try {
    const { blocks, signature } = getBodyBlocks();
    const pages = await paginateBlocks(blocks, signature);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = 210, pageH = 297;

    // Render each page off-screen and capture to PDF
    pagesContainer = document.createElement('div');
    pagesContainer.style.position = 'fixed';
    pagesContainer.style.left = '-9999px';
    pagesContainer.style.top = '0';
    document.body.appendChild(pagesContainer);

    for (let i = 0; i < pages.length; i++) {
      const pageEl = buildPageElement(pages[i]);
      pagesContainer.innerHTML = '';
      pagesContainer.appendChild(pageEl);
      // Wait for images / layout
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => setTimeout(r, 50));

      const canvas = await html2canvas(pageEl, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        windowWidth: pageEl.offsetWidth,
        windowHeight: pageEl.offsetHeight
      });
      const imgData = canvas.toDataURL('image/png');

      if (i > 0) pdf.addPage();
      // Map the canvas to exactly A4 — no overflow, no blank page
      pdf.addImage(imgData, 'PNG', 0, 0, pageW, pageH);
    }

    const invNo = (document.getElementById('invNumber').value || 'invoice').replace(/[\/\\:*?"<>|]/g, '-');
    const student = (document.getElementById('studentName').value || 'student').replace(/[\/\\:*?"<>|]/g, '-');
    pdf.save(`${invNo}_${student}.pdf`);
  } catch (e) {
    alert('PDF generation failed: ' + e.message);
  } finally {
    if (pagesContainer && pagesContainer.parentNode) {
      pagesContainer.parentNode.removeChild(pagesContainer);
    }
  }
}

/**
 * For browser Print — we build a multi-page version of the invoice
 * with proper page breaks inserted, so the browser print dialog
 * shows the same layout as the PDF.
 */
async function preparePrintLayout() {
  const { blocks, signature } = getBodyBlocks();
  const pages = await paginateBlocks(blocks, signature);

  const printArea = document.getElementById('printArea');
  printArea.innerHTML = '';

  pages.forEach((pageHtml, idx) => {
    const pageEl = document.createElement('div');
    pageEl.className = 'print-page';
    pageEl.style.cssText = `
      width: 210mm;
      height: 297mm;
      background: white;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      overflow: hidden;
      page-break-after: ${idx < pages.length - 1 ? 'always' : 'auto'};
    `;
    pageEl.innerHTML = `
      ${buildLetterheadTop()}
      <div class="inv-body" style="flex:1; overflow:hidden;">
        ${pageHtml}
      </div>
      ${buildLetterheadBottom()}
    `;
    printArea.appendChild(pageEl);
  });
}

async function printInvoice() {
  if (!validateForm()) return;
  await preparePrintLayout();
  window.print();
}

// beforeprint kept for keyboard Ctrl+P — prepare default single-page if needed
window.addEventListener('beforeprint', () => {
  const printArea = document.getElementById('printArea');
  if (!printArea.innerHTML.trim()) {
    // Fallback: at least copy the preview so something prints
    printArea.innerHTML = document.getElementById('invoicePreview').innerHTML;
  }
});

// Apps dropdown toggle
const appsMenuBtn = document.getElementById('appsMenuBtn');
const appsMenu = document.getElementById('appsMenu');
if (appsMenuBtn && appsMenu) {
  appsMenuBtn.addEventListener('click', () => {
    appsMenu.style.display = appsMenu.style.display === 'block' ? 'none' : 'block';
  });
  document.addEventListener('click', (event) => {
    if (!appsMenuBtn.contains(event.target) && !appsMenu.contains(event.target)) {
      appsMenu.style.display = 'none';
    }
  });
  // Clicking the link for the page you're already on would just reload it —
  // under file:// that reload is blocked by the browser as a self-navigation
  // and logs a scary-looking (but harmless) console warning. Just close the
  // menu instead in that case.
  appsMenu.querySelectorAll('a[href]').forEach(link => {
    link.addEventListener('click', (event) => {
      const linkUrl = new URL(link.getAttribute('href'), window.location.href);
      if (linkUrl.href.split('#')[0] === window.location.href.split('#')[0]) {
        event.preventDefault();
        appsMenu.style.display = 'none';
      }
    });
  });
}

init();
