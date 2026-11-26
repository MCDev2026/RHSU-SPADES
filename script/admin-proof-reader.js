/* RHSU SPADES – Admin Proof Reader
 * Document access is mediated by authenticated Apps Script endpoints.
 * Original uploads and all revisions are retained as separate Drive files.
 */
(function () {
  'use strict';

  const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
  const PREVIEW_ZOOM_MIN = 0.5;
  const PREVIEW_ZOOM_MAX = 2.5;
  const PREVIEW_ZOOM_STEP = 0.1;
  const REMARKS = ['For Revision', 'For Correction', 'Approved', 'Disapproved', 'Disregard'];
  const OPEN_REVIEW_STATUSES = ['Submitted for Proofreading', 'Assigned', 'Under Proofreading', 'Resubmitted for Proofreading'];
  const state = {
    records: [],
    eligibleUsers: [],
    designationOptions: [],
    designatedUsers: [],
    selectedDesignationUsernames: new Set(),
    isAlphaAdmin: false,
    designationSaving: false,
    view: 'submissions',
    current: null,
    currentDocument: null,
    pdfObjectUrl: null,
    pdfDocument: null,
    annotations: [],
    pendingSelection: null,
    editingAnnotationId: '',
    canAnnotate: false,
    previewContent: '',
    previewMode: 'text',
    previewZoom: 1,
    finalEditorVisible: false,
    notificationTimer: null,
    notificationBusy: false,
    loading: false,
    pageLoaded: false,
    pendingSubmissionKey: ''
  };

  function byId(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function displayDate(value) {
    if (!value) return '—';
    const raw = String(value);
    const date = new Date(raw.length === 10 ? raw + 'T00:00:00' : raw);
    return Number.isNaN(date.getTime()) ? raw : date.toLocaleString('en-PH', {dateStyle:'medium', ...(raw.length > 10 ? {timeStyle:'short'} : {})});
  }
  function statusClass(value) {
    const status = String(value || '').toLowerCase();
    if (status.includes('approved')) return 'approved';
    if (status.includes('returned') || status.includes('revision') || status.includes('correction')) return 'returned';
    if (status.includes('disapproved') || status.includes('disregard')) return 'rejected';
    if (status.includes('completed')) return 'completed';
    return 'pending';
  }
  function setMessage(id, message, isError) {
    const element = byId(id);
    if (!element) return;
    element.textContent = message || '';
    element.classList.toggle('is-error', !!isError);
    element.classList.toggle('is-success', !!message && !isError);
  }
  async function api(action, extra) {
    if (typeof spadesAuthenticatedRead !== 'function') throw new Error('SPADES connection is not ready. Refresh the page and try again.');
    const response = await spadesAuthenticatedRead(action, extra || {});
    let result;
    try { result = await response.json(); }
    catch (_) { throw new Error('The server returned an unreadable response. Please try again.'); }
    if (!response.ok || !result || !result.success) throw new Error(result && result.error ? result.error : 'The requested operation could not be completed.');
    return result;
  }
  function modalOpen(id) {
    const modal = byId(id);
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('spades-modal-stack-open');
    window.SPADESModalStack?.refresh?.();
  }
  function modalClose(id) {
    const modal = byId(id);
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    window.SPADESModalStack?.refresh?.();
    if (!document.querySelector('.modal-overlay:not(.hidden), .profile-settings-overlay:not(.hidden)')) {
      document.body.classList.remove('spades-modal-stack-open');
    }
  }
  function getCurrentUsername() { return String(localStorage.getItem('loggedInUser') || '').trim().toLowerCase(); }

  async function readFileAsBase64(file) {
    if (!file) throw new Error('Select a document file.');
    if (file.size <= 0) throw new Error('The selected document is empty.');
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('The selected document exceeds the 10 MB upload limit.');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Unable to read the selected document.'));
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        if (comma < 0) return reject(new Error('The selected document could not be encoded for upload.'));
        resolve({fileName:file.name, mimeType:file.type || 'application/octet-stream', fileBase64:result.slice(comma + 1)});
      };
      reader.readAsDataURL(file);
    });
  }

  function renderSummary(summary) {
    const map = {
      proofReaderStatSubmissions: summary.submissions,
      proofReaderStatAssigned: summary.assigned,
      proofReaderStatPending: summary.pending,
      proofReaderStatReturned: summary.returned,
      proofReaderStatApproved: summary.approved,
      proofReaderStatClosed: summary.closed
    };
    Object.entries(map).forEach(([id, value]) => { if (byId(id)) byId(id).textContent = String(Number(value) || 0); });
  }
  function renderEligibleUsers(users) {
    state.eligibleUsers = Array.isArray(users) ? users : [];
    const select = byId('proofReaderAssignee');
    if (!select) return;
    const previous = select.value;
    const placeholder = state.eligibleUsers.length ? 'Select an ALPHA ADMIN-designated Proof Reader…' : 'No Proof Readers have been designated yet…';
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + state.eligibleUsers
      .filter(user => String(user.username || '').toLowerCase() !== getCurrentUsername())
      .map(user => {
        const display = [user.rank, user.displayName].filter(Boolean).join(' ');
        const details = [display, user.role === 'Admin' ? 'Admin Account' : user.role, user.section, user.designation].filter(Boolean).join(' · ');
        return `<option value="${escapeHtml(user.username)}">${escapeHtml(details || user.username)}</option>`;
      }).join('');
    if (previous && Array.from(select.options).some(option => option.value === previous)) select.value = previous;
  }
  function viewMatches(record) {
    const user = getCurrentUsername();
    const mine = String(record.senderUsername || '').toLowerCase() === user;
    const assigned = String(record.proofReaderUsername || '').toLowerCase() === user;
    switch (state.view) {
      case 'assigned': return assigned && !['Returned for Final Revision','Approved by Proof Reader','Disapproved','Disregarded','Completed'].includes(record.status);
      case 'pending': return assigned && OPEN_REVIEW_STATUSES.includes(record.status);
      case 'returned': return mine && record.status === 'Returned for Final Revision';
      case 'approved': return record.status === 'Approved by Proof Reader';
      case 'closed': return ['Disapproved','Disregarded','Completed'].includes(record.status);
      case 'submissions': default: return mine;
    }
  }
  function proofReaderDateKey(value) {
    if (!value) return '';
    const raw = String(value).trim();
    const isoDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoDate) return isoDate[1];
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function proofReaderViewDescription(view) {
    return ({
      submissions: 'Documents submitted by your account.',
      assigned: 'Active proofreading requests assigned to your account.',
      pending: 'Assigned documents that are awaiting proofreading action.',
      returned: 'Documents returned to your office for final revision.',
      approved: 'Documents marked as approved by the designated Proof Reader.',
      closed: 'Disapproved, disregarded, and completed proofreading requests.'
    })[view] || 'Review and manage your document requests.';
  }

  function renderProofReaderTable() {
    const body = byId('proofReaderTableBody');
    if (!body) return;
    const query = String(byId('proofReaderSearch')?.value || '').trim().toLowerCase();
    const status = String(byId('proofReaderStatusFilter')?.value || '').trim();
    const type = String(byId('proofReaderTypeFilter')?.value || '').trim().toLowerCase();
    const dateFrom = String(byId('proofReaderDateFrom')?.value || '').trim();
    const dateTo = String(byId('proofReaderDateTo')?.value || '').trim();
    const viewRows = state.records.filter(record => viewMatches(record));
    const rows = viewRows.filter(record => {
      if (status && record.status !== status) return false;
      if (type && String(record.documentType || 'Document').trim().toLowerCase() !== type) return false;
      const submittedDate = proofReaderDateKey(record.createdAt || record.submittedAt);
      if (dateFrom && (!submittedDate || submittedDate < dateFrom)) return false;
      if (dateTo && (!submittedDate || submittedDate > dateTo)) return false;
      if (query && ![record.referenceNo,record.title,record.documentType,record.description,record.senderName,record.senderUsername,record.proofReaderName,record.proofReaderUsername,record.status,record.remark].some(value => String(value || '').toLowerCase().includes(query))) return false;
      return true;
    }).sort((a,b) => {
      const aDate = new Date(a.updatedAt || a.createdAt || 0).getTime() || 0;
      const bDate = new Date(b.updatedAt || b.createdAt || 0).getTime() || 0;
      return bDate - aDate;
    });
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" class="proofreader-empty">No proofreading records match the selected view and filters.</td></tr>';
    } else {
      body.innerHTML = rows.map(record => `<tr data-proof-reader-id="${escapeHtml(record.id)}">
        <td><strong>${escapeHtml(record.referenceNo)}</strong></td>
        <td><span class="proofreader-document-title">${escapeHtml(record.title)}</span><small>${escapeHtml(record.documentType || 'Document')}</small></td>
        <td>${escapeHtml(record.senderName || record.senderUsername)}</td>
        <td>${escapeHtml(record.proofReaderName || record.proofReaderUsername)}</td>
        <td>${escapeHtml(displayDate(record.createdAt || record.submittedAt))}</td>
        <td>${escapeHtml(displayDate(record.updatedAt))}</td>
        <td><span class="proofreader-status ${statusClass(record.status)}">${escapeHtml(record.status)}</span></td>
        <td>${escapeHtml(record.remark || '—')}</td>
        <td><div class="proofreader-row-actions"><button class="proofreader-row-open spades-force-icon-only" type="button" title="Open document" aria-label="Open ${escapeHtml(record.title)}" onclick="openProofReaderDocument('${escapeHtml(record.id)}')"><i class="fi fi-rr-eye" aria-hidden="true"></i></button></div></td>
      </tr>`).join('');
    }
    const count = byId('proofReaderTotalRecords');
    if (count) count.textContent = String(state.records.length);
    if (byId('proofReaderListInfo')) byId('proofReaderListInfo').textContent = `${rows.length} shown · ${viewRows.length} in this view`;
  }

  function clearProofReaderFilters() {
    ['proofReaderSearch','proofReaderStatusFilter','proofReaderTypeFilter','proofReaderDateFrom','proofReaderDateTo'].forEach(id => {
      const element = byId(id);
      if (element) element.value = '';
    });
    renderProofReaderTable();
  }

  function setProofReaderView(view) {
    state.view = ['submissions','assigned','pending','returned','approved','closed'].includes(view) ? view : 'submissions';
    const selectedTab = ({submissions:'proofReaderTabSubmissions',assigned:'proofReaderTabAssigned',returned:'proofReaderTabReturned',approved:'proofReaderTabApproved',closed:'proofReaderTabClosed'})[state.view];
    ['proofReaderTabSubmissions','proofReaderTabAssigned','proofReaderTabReturned','proofReaderTabApproved','proofReaderTabClosed'].forEach(id => {
      const element = byId(id);
      if (!element) return;
      const active = id === selectedTab || (state.view === 'pending' && id === 'proofReaderTabAssigned');
      element.classList.toggle('active', active);
      element.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.proofreader-summary-card[data-proofreader-view]').forEach(card => {
      const active = card.getAttribute('data-proofreader-view') === state.view;
      card.classList.toggle('active', active);
      card.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const description = byId('proofReaderActiveViewDescription');
    if (description) description.textContent = proofReaderViewDescription(state.view);
    if (byId('proofReaderStatusFilter')) byId('proofReaderStatusFilter').value = '';
    renderProofReaderTable();
  }

  async function loadProofReaderDashboard(force) {
    if (state.loading) return;
    if (!getCurrentUsername()) return;
    const listViewportSnapshot = window.SPADESListViewport?.capture?.();
    state.loading = true;
    state.isAlphaAdmin = false;
    setVisible('proofReaderSettingsBtn',false);
    const body = byId('proofReaderTableBody');
    if (body && !state.records.length) body.innerHTML = '<tr><td colspan="9" class="proofreader-empty">Loading your proofreading records…</td></tr>';
    try {
      const result = await api('get_proofreader_dashboard');
      state.records = Array.isArray(result.records) ? result.records : [];
      state.isAlphaAdmin = result.isAlphaAdmin === true;
      setVisible('proofReaderSettingsBtn',state.isAlphaAdmin);
      state.designatedUsers = Array.isArray(result.eligibleUsers) ? result.eligibleUsers : [];
      state.designationOptions = state.isAlphaAdmin && Array.isArray(result.designationOptions) ? result.designationOptions : [];
      renderSummary(result.summary || {});
      renderEligibleUsers(state.designatedUsers);
      state.pageLoaded = true;
      renderProofReaderTable();
    } catch (error) {
      if (body) body.innerHTML = `<tr><td colspan="9" class="proofreader-empty proofreader-error">${escapeHtml(error.message)}</td></tr>`;
      if (typeof showNotification === 'function') showNotification('Admin Proof Reader', error.message);
    } finally {
      state.loading = false;
      await window.SPADESListViewport?.restore?.(listViewportSnapshot);
    }
  }

  function updateProofReaderSettingsCounts() {
    const candidateCount = byId('proofReaderSettingsCandidateCount');
    const selectedCount = byId('proofReaderSettingsSelectedCount');
    if (candidateCount) candidateCount.textContent = String(state.designationOptions.length);
    if (selectedCount) selectedCount.textContent = String(state.selectedDesignationUsernames.size);
  }

  function getVisibleProofReaderDesignationOptions() {
    const query = String(byId('proofReaderSettingsSearch')?.value || '').trim().toLowerCase();
    return state.designationOptions.filter(user => {
      const parts = [user.rank,user.displayName,user.section,user.designation,user.username,user.role].join(' ').toLowerCase();
      return !query || parts.includes(query);
    });
  }

  function renderProofReaderDesignationOptions() {
    const list = byId('proofReaderDesignationList');
    if (!list) return;
    const visible = getVisibleProofReaderDesignationOptions();
    if (!state.designationOptions.length) {
      list.innerHTML = '<div class="proofreader-settings-empty"><i class="fi fi-rr-user-time" aria-hidden="true"></i><strong>No eligible personnel accounts found.</strong><span>Only active Personnel records with a matching active SPADES account can be designated. Create or activate the user account first, then refresh this list.</span></div>';
      updateProofReaderSettingsCounts();
      return;
    }
    if (!visible.length) {
      list.innerHTML = '<div class="proofreader-settings-empty"><i class="fi fi-rr-search" aria-hidden="true"></i><strong>No matching personnel.</strong><span>Try another name, section, or username.</span></div>';
      updateProofReaderSettingsCounts();
      return;
    }
    list.innerHTML = visible.map(user => {
      const username = String(user.username || '');
      const key = username.toLowerCase();
      const checked = state.selectedDesignationUsernames.has(key);
      const name = [user.rank,user.displayName].filter(Boolean).join(' ');
      const accountRole = String(user.role || 'Regular User').trim();
      const meta = [accountRole, user.section, user.designation].filter(Boolean).join(' · ') || 'Personnel record linked';
      const accountBadge = accountRole.toLowerCase() === 'admin' ? 'Admin Account' : accountRole.toLowerCase() === 'alpha admin' ? 'ALPHA ADMIN Account' : 'Active Account';
      return `<label class="proofreader-designation-item${checked ? ' selected' : ''}">
        <input type="checkbox" value="${escapeHtml(username)}" data-proofreader-designation="${escapeHtml(key)}" ${checked ? 'checked' : ''}/>
        <span class="proofreader-designation-check"><i class="fi fi-rr-check" aria-hidden="true"></i></span>
        <span class="proofreader-designation-copy"><strong>${escapeHtml(name || username)}</strong><small>${escapeHtml(meta)}</small><span class="proofreader-designation-username"><i class="fi fi-rr-user" aria-hidden="true"></i>${escapeHtml(username)}</span></span>
        <span class="proofreader-account-pill"><i class="fi fi-rr-badge-check" aria-hidden="true"></i> ${escapeHtml(accountBadge)}</span>
      </label>`;
    }).join('');
    list.querySelectorAll('input[data-proofreader-designation]').forEach(input => {
      input.addEventListener('change', () => {
        const key = String(input.dataset.proofreaderDesignation || '').toLowerCase();
        if (!key) return;
        if (input.checked) state.selectedDesignationUsernames.add(key);
        else state.selectedDesignationUsernames.delete(key);
        input.closest('.proofreader-designation-item')?.classList.toggle('selected',input.checked);
        updateProofReaderSettingsCounts();
      });
    });
    updateProofReaderSettingsCounts();
  }

  async function openProofReaderSettings() {
    if (!state.isAlphaAdmin) {
      setMessage('proofReaderSettingsMessage','Only the ALPHA ADMIN can manage Proof Reader designations.',true);
      return;
    }
    const list = byId('proofReaderDesignationList');
    if (list) list.innerHTML = '<div class="proofreader-settings-empty">Loading eligible personnel accounts…</div>';
    if (byId('proofReaderSettingsSearch')) byId('proofReaderSettingsSearch').value = '';
    setMessage('proofReaderSettingsMessage','Loading the latest personnel and account records…',false);
    modalOpen('proofReaderSettingsModal');
    try {
      const result = await api('get_proofreader_settings');
      state.designationOptions = Array.isArray(result.designationOptions) ? result.designationOptions : [];
      state.designatedUsers = Array.isArray(result.designatedUsers) ? result.designatedUsers : [];
      state.selectedDesignationUsernames = new Set(state.designatedUsers.map(user => String(user.username || '').trim().toLowerCase()).filter(Boolean));
      renderProofReaderDesignationOptions();
      setMessage('proofReaderSettingsMessage',`${state.designatedUsers.length} Proof Reader(s) currently designated. Changes apply to new submissions; existing assignments remain unchanged.`,false);
    } catch (error) {
      if (list) list.innerHTML = `<div class="proofreader-settings-empty proofreader-settings-error">${escapeHtml(error.message)}</div>`;
      setMessage('proofReaderSettingsMessage',error.message || 'Unable to load Proof Reader settings.',true);
    }
  }

  function closeProofReaderSettings() { modalClose('proofReaderSettingsModal'); }

  function filterProofReaderDesignationOptions() { renderProofReaderDesignationOptions(); }
  function clearProofReaderDesignationSearch() {
    if (byId('proofReaderSettingsSearch')) byId('proofReaderSettingsSearch').value = '';
    renderProofReaderDesignationOptions();
  }
  function toggleVisibleProofReaderDesignations() {
    const visible = getVisibleProofReaderDesignationOptions();
    if (!visible.length) return;
    const allSelected = visible.every(user => state.selectedDesignationUsernames.has(String(user.username || '').toLowerCase()));
    visible.forEach(user => {
      const key = String(user.username || '').trim().toLowerCase();
      if (!key) return;
      if (allSelected) state.selectedDesignationUsernames.delete(key);
      else state.selectedDesignationUsernames.add(key);
    });
    renderProofReaderDesignationOptions();
  }

  async function saveProofReaderDesignations() {
    if (!state.isAlphaAdmin || state.designationSaving) return;
    const button = byId('proofReaderSaveDesignationsBtn');
    state.designationSaving = true;
    if (button) { button.disabled = true; button.setAttribute('aria-busy','true'); }
    setMessage('proofReaderSettingsMessage','Saving Proof Reader designations…',false);
    try {
      const usernames = Array.from(state.selectedDesignationUsernames);
      const result = await api('save_proofreader_designations',{usernames:usernames});
      state.designatedUsers = Array.isArray(result.designatedUsers) ? result.designatedUsers : [];
      renderEligibleUsers(state.designatedUsers);
      updateProofReaderSettingsCounts();
      setMessage('proofReaderSettingsMessage',result.message || 'Proof Reader designations saved successfully.',false);
      if (typeof showNotification === 'function') showNotification('Proof Reader Settings',`${state.designatedUsers.length} Proof Reader(s) designated.`);
      closeProofReaderSettings();
      await loadProofReaderDashboard(true);
    } catch (error) {
      setMessage('proofReaderSettingsMessage',error.message || 'Unable to save Proof Reader designations.',true);
    } finally {
      state.designationSaving = false;
      if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
    }
  }

  function updateProofReaderSelectedFile() {
    const file = byId('proofReaderUploadFile')?.files?.[0];
    const label = byId('proofReaderSelectedFile');
    if (!label) return;
    if (!file) {
      label.textContent = 'No file selected.';
      setMessage('proofReaderSubmitMessage', '', false);
      return;
    }
    const sizeLabel = `${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} MB`;
    if (file.size > MAX_UPLOAD_BYTES) {
      label.textContent = `${sizeLabel} · exceeds the 10 MB limit`;
      setMessage('proofReaderSubmitMessage', 'The selected document exceeds the 10 MB upload limit. Choose a smaller file.', true);
      return;
    }
    label.textContent = sizeLabel;
    setMessage('proofReaderSubmitMessage', '', false);
  }
  async function openProofReaderSubmitModal() {
    state.pendingSubmissionKey = (window.crypto && typeof window.crypto.randomUUID === 'function') ? window.crypto.randomUUID() : ('pr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,12));
    if (!state.eligibleUsers.length) await loadProofReaderDashboard(true);
    const formIds = ['proofReaderDocTitle','proofReaderDocDescription','proofReaderTargetDate','proofReaderInstructions'];
    formIds.forEach(id => { if (byId(id)) byId(id).value = ''; });
    if (byId('proofReaderDocType')) byId('proofReaderDocType').value = 'Memorandum';
    if (byId('proofReaderUploadFile')) byId('proofReaderUploadFile').value = '';
    if (byId('proofReaderGoogleDocsUrl')) byId('proofReaderGoogleDocsUrl').value = '';
    if (byId('proofReaderAssignee')) byId('proofReaderAssignee').value = '';
    if (byId('proofReaderSelectedFile')) byId('proofReaderSelectedFile').textContent = 'No file selected.';
    setMessage('proofReaderSubmitMessage',state.eligibleUsers.length ? '' : 'No eligible active personnel with a linked SPADES account are currently available as Proof Readers.',!state.eligibleUsers.length);
    modalOpen('proofReaderSubmitModal');
  }
  function closeProofReaderSubmitModal() { modalClose('proofReaderSubmitModal'); }

  async function submitProofReaderRequest() {
    const button = byId('proofReaderSubmitBtn');
    const file = byId('proofReaderUploadFile')?.files?.[0];
    const title = String(byId('proofReaderDocTitle')?.value || '').trim();
    const reviewer = String(byId('proofReaderAssignee')?.value || '').trim();
    if (!title) return setMessage('proofReaderSubmitMessage','Enter the document title.',true);
    if (!reviewer) return setMessage('proofReaderSubmitMessage','Select the designated Proof Reader.',true);
    const googleDocsUrl = String(byId('proofReaderGoogleDocsUrl')?.value || '').trim();
    if (!file && !googleDocsUrl) return setMessage('proofReaderSubmitMessage','Upload a document or provide a Google Docs link.',true);
    if (file && googleDocsUrl) return setMessage('proofReaderSubmitMessage','Choose either a file upload or a Google Docs link, not both.',true);
    if (button?._busy) return;
    try {
      if (button) { button._busy = true; button.disabled = true; button.setAttribute('aria-busy','true'); }
      setMessage('proofReaderSubmitMessage','Preparing document upload…',false);
      const upload = file ? await readFileAsBase64(file) : {googleDocsUrl:googleDocsUrl};
      const payload = {
        title:title,
        description:String(byId('proofReaderDocDescription')?.value || '').trim(),
        documentType:String(byId('proofReaderDocType')?.value || 'Other'),
        proofReaderUsername:reviewer,
        instructions:String(byId('proofReaderInstructions')?.value || '').trim(),
        targetDate:String(byId('proofReaderTargetDate')?.value || ''),
        clientRequestKey:state.pendingSubmissionKey,
        ...upload
      };
      const result = await api('create_proofreading_request', payload);
      setMessage('proofReaderSubmitMessage',`Submitted successfully. Reference: ${result.request?.referenceNo || 'created'}.`,false);
      state.pendingSubmissionKey = '';
      closeProofReaderSubmitModal();
      await loadProofReaderDashboard(true);
      if (typeof showNotification === 'function') showNotification('Document Submitted','Your document has been submitted for proofreading.');
    } catch (error) {
      setMessage('proofReaderSubmitMessage',error.message,true);
    } finally {
      if (button) { button._busy = false; button.disabled = false; button.removeAttribute('aria-busy'); }
    }
  }

  function clearPdfPreview() {
    if (state.pdfObjectUrl) URL.revokeObjectURL(state.pdfObjectUrl);
    state.pdfObjectUrl = null;
    state.pdfDocument = null;
    const frame = byId('proofReaderPdfPreview');
    if (frame) frame.removeAttribute('src');
    const pages = byId('proofReaderPdfPages');
    if (pages) pages.innerHTML = '';
    setVisible('proofReaderPdfFallback',false);
  }
  function setVisible(id, visible) { const element = byId(id); if (element) element.classList.toggle('hidden', !visible); }
  function setText(id, value) { const element = byId(id); if (element) element.textContent = value == null || value === '' ? '—' : String(value); }
  function applyProofReaderZoom() {
    // Scale only the document surface. PDF selection rectangles and page bounds
    // receive the same CSS zoom factor, so their normalized annotation coordinates remain aligned.
    const zoom = String(state.previewZoom || 1);
    const textSurface = byId('proofReaderDocumentZoomSurface');
    const pdfSurface = byId('proofReaderPdfZoomSurface');
    const fallbackFrame = byId('proofReaderPdfPreview');
    if (textSurface) textSurface.style.zoom = zoom;
    if (pdfSurface) pdfSurface.style.zoom = zoom;
    if (fallbackFrame) fallbackFrame.style.zoom = zoom;
    const value = byId('proofReaderZoomValue');
    const zoomOut = byId('proofReaderZoomOut');
    const zoomIn = byId('proofReaderZoomIn');
    if (value) value.textContent = Math.round(state.previewZoom * 100) + '%';
    if (zoomOut) zoomOut.disabled = state.previewZoom <= PREVIEW_ZOOM_MIN;
    if (zoomIn) zoomIn.disabled = state.previewZoom >= PREVIEW_ZOOM_MAX;
  }
  function setProofReaderZoom(value) {
    const numeric = Number(value);
    const clamped = Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, Number.isFinite(numeric) ? numeric : 1));
    state.previewZoom = Math.round(clamped * 100) / 100;
    applyProofReaderZoom();
  }
  function adjustProofReaderZoom(direction) {
    setProofReaderZoom(state.previewZoom + (Number(direction || 0) * PREVIEW_ZOOM_STEP));
  }
  function resetProofReaderZoom() { setProofReaderZoom(1); }
  function setAnnotationButtonLabel(editing) {
    const button = byId('proofReaderAddAnnotationBtn');
    if (button) button.innerHTML = editing ? '<i class="fi fi-rr-disk" aria-hidden="true"></i><span>Save Changes</span>' : '<i class="fi fi-rr-plus" aria-hidden="true"></i><span>Add Note</span>';
  }

  function renderProofReaderTextPreview() {
    const target = byId('proofReaderDocumentPreview');
    if (!target) return;
    const content = String(state.previewContent || '');
    const annotations = (state.annotations || []).filter(item => Number.isInteger(Number(item.startOffset)) && Number.isInteger(Number(item.endOffset)) && Number(item.startOffset) >= 0 && Number(item.endOffset) > Number(item.startOffset) && Number(item.endOffset) <= content.length)
      .sort((a,b) => Number(a.startOffset) - Number(b.startOffset));
    let html = '', cursor = 0;
    annotations.forEach(annotation => {
      const start = Number(annotation.startOffset), end = Number(annotation.endOffset);
      if (start < cursor) return; // Ignore conflicting legacy ranges rather than corrupting preview markup.
      html += escapeHtml(content.slice(cursor,start));
      html += `<mark data-note-id="${escapeHtml(annotation.id)}" data-note-category="${escapeHtml(annotation.category)}" title="${escapeHtml(annotation.category + ': ' + annotation.note)}">${escapeHtml(content.slice(start,end))}</mark>`;
      cursor = end;
    });
    html += escapeHtml(content.slice(cursor));
    target.innerHTML = content
      ? `<div class="proofreader-document-zoom-surface" id="proofReaderDocumentZoomSurface"><pre class="proofreader-preview-text">${html}</pre></div>`
      : '<div class="proofreader-document-zoom-surface" id="proofReaderDocumentZoomSurface"><div class="proofreader-empty">No text content is available for preview. Download the original file to inspect its full layout.</div></div>';
    applyProofReaderZoom();
  }

  function renderProofReaderAnnotationList() {
    const target = byId('proofReaderAnnotationList');
    if (!target) return;
    const items = Array.isArray(state.annotations) ? state.annotations : [];
    setText('proofReaderAnnotationCount',`${items.length} ${items.length === 1 ? 'note' : 'notes'}`);
    if (!items.length) {
      target.innerHTML = '<div class="proofreader-empty">No proofreading notes have been submitted.</div>';
      return;
    }
    target.innerHTML = items.map((item,index) => {
      const reference = item.selectedText ? `“${item.selectedText}”` : (item.pageNumber ? `Page ${item.pageNumber}${item.location ? ' · ' + item.location : ''}` : (item.location || 'General note'));
      const actions = state.canAnnotate ? `<div class="proofreader-annotation-card-actions"><button type="button" title="Edit note" aria-label="Edit note ${index+1}" onclick="editProofReaderAnnotation('${escapeHtml(item.id)}')"><i class="fi fi-rr-edit" aria-hidden="true"></i></button><button type="button" title="Remove note" aria-label="Remove note ${index+1}" onclick="removeProofReaderAnnotation('${escapeHtml(item.id)}')"><i class="fi fi-rr-trash" aria-hidden="true"></i></button></div>` : '';
      return `<article class="proofreader-annotation-card" data-category="${escapeHtml(item.category)}" data-note-card="${escapeHtml(item.id)}"><div class="proofreader-annotation-card-head"><strong>${escapeHtml(item.category || 'Note')}</strong>${actions}</div><blockquote>${escapeHtml(reference)}</blockquote><p>${escapeHtml(item.note || '')}</p>${item.createdBy ? `<small>Added by ${escapeHtml(item.createdBy)}${item.createdAt ? ' · ' + escapeHtml(displayDate(item.createdAt)) : ''}</small>` : ''}</article>`;
    }).join('');
  }

  function captureProofReaderSelection() {
    const selection = window.getSelection && window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      setText('proofReaderSelectionStatus','Select a word, sentence, or paragraph in the document preview first.');
      return false;
    }
    const range = selection.getRangeAt(0);
    const selectedText = selection.toString();
    if (!selectedText || !selectedText.trim()) {
      setText('proofReaderSelectionStatus','The selection is empty. Select readable document text.');
      return false;
    }
    const textPreview = byId('proofReaderDocumentPreview');
    if (state.previewMode === 'text' && textPreview && textPreview.contains(range.commonAncestorContainer)) {
      const root = textPreview.querySelector('.proofreader-preview-text');
      if (!root) return false;
      const beforeStart = document.createRange();
      beforeStart.selectNodeContents(root);
      beforeStart.setEnd(range.startContainer,range.startOffset);
      const beforeEnd = document.createRange();
      beforeEnd.selectNodeContents(root);
      beforeEnd.setEnd(range.endContainer,range.endOffset);
      const startOffset = beforeStart.toString().length;
      const endOffset = beforeEnd.toString().length;
      if (endOffset <= startOffset) return false;
      state.pendingSelection = {selectedText:selectedText,startOffset:startOffset,endOffset:endOffset,pageNumber:null,rects:[],location:''};
    } else if (state.previewMode === 'pdf') {
      const nodeElement = node => node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
      const startPage = nodeElement(range.startContainer)?.closest('.proofreader-pdf-page');
      const endPage = nodeElement(range.endContainer)?.closest('.proofreader-pdf-page');
      if (!startPage || startPage !== endPage || !startPage.querySelector('.proofreader-pdf-text-layer')?.contains(range.commonAncestorContainer)) {
        setText('proofReaderSelectionStatus','Select text within one PDF page at a time, then use the selected-text action.');
        return false;
      }
      const pageRect = startPage.getBoundingClientRect();
      const rects = Array.from(range.getClientRects()).map(rect => {
        const x = Math.max(0,Math.min(1,(rect.left-pageRect.left)/pageRect.width));
        const y = Math.max(0,Math.min(1,(rect.top-pageRect.top)/pageRect.height));
        const right = Math.max(x,Math.min(1,(rect.right-pageRect.left)/pageRect.width));
        const bottom = Math.max(y,Math.min(1,(rect.bottom-pageRect.top)/pageRect.height));
        return {x:x,y:y,width:right-x,height:bottom-y};
      }).filter(rect => rect.width > 0 && rect.height > 0);
      state.pendingSelection = {selectedText:selectedText,startOffset:null,endOffset:null,pageNumber:Number(startPage.dataset.pageNumber || 0),rects:rects,location:''};
    } else {
      setText('proofReaderSelectionStatus','The selected text is outside the active document preview.');
      return false;
    }
    setText('proofReaderSelectedText',selectedText);
    setText('proofReaderSelectionStatus','Selected text is ready. Add a category and note in the notepad.');
    const pageInput = byId('proofReaderAnnotationPage');
    if (pageInput && state.pendingSelection.pageNumber) pageInput.value = String(state.pendingSelection.pageNumber);
    return true;
  }

  function addProofReaderAnnotation() {
    if (!state.canAnnotate) return;
    const category = String(byId('proofReaderAnnotationType')?.value || 'Correction');
    const note = String(byId('proofReaderAnnotationNote')?.value || '').trim();
    const location = String(byId('proofReaderAnnotationLocation')?.value || '').trim().slice(0,240);
    const pageValue = String(byId('proofReaderAnnotationPage')?.value || '').trim();
    const pageNumber = pageValue ? Number(pageValue) : (state.pendingSelection?.pageNumber || null);
    if (!note) return setText('proofReaderWorkspaceNotice','Enter the correction, revision, suggestion, or observation before adding the note.');
    if (state.previewMode === 'pdf' && (!Number.isInteger(pageNumber) || pageNumber < 1 || (state.pdfDocument && pageNumber > state.pdfDocument.numPages))) return setText('proofReaderWorkspaceNotice','Enter a valid PDF page number or select text on a PDF page before adding the note.');
    const selection = state.pendingSelection || {};
    const annotation = {
      id:state.editingAnnotationId || (window.crypto?.randomUUID ? window.crypto.randomUUID() : `pr-${Date.now()}-${Math.random().toString(36).slice(2,9)}`),
      category:category,selectedText:String(selection.selectedText || ''),
      startOffset:Number.isInteger(selection.startOffset) ? selection.startOffset : null,
      endOffset:Number.isInteger(selection.endOffset) ? selection.endOffset : null,
      pageNumber:Number.isInteger(pageNumber) ? pageNumber : null,
      rects:Array.isArray(selection.rects) ? selection.rects : [],location:location,note:note
    };
    if (state.previewMode === 'text' && annotation.startOffset != null) {
      const overlap = state.annotations.some(item => item.id !== state.editingAnnotationId && item.startOffset != null && annotation.startOffset < Number(item.endOffset) && annotation.endOffset > Number(item.startOffset));
      if (overlap) return setText('proofReaderWorkspaceNotice','That text range overlaps an existing highlight. Edit or remove the earlier note before adding another overlapping highlight.');
    }
    if (state.editingAnnotationId) {
      const index = state.annotations.findIndex(item => item.id === state.editingAnnotationId);
      if (index >= 0) state.annotations[index] = annotation;
    } else state.annotations.push(annotation);
    state.editingAnnotationId = '';
    state.pendingSelection = null;
    if (byId('proofReaderAnnotationNote')) byId('proofReaderAnnotationNote').value = '';
    if (byId('proofReaderAnnotationLocation')) byId('proofReaderAnnotationLocation').value = '';
    if (byId('proofReaderAnnotationPage')) byId('proofReaderAnnotationPage').value = '';
    setText('proofReaderSelectedText','No text selected. A general note or page-specific note can still be added.');
    setText('proofReaderSelectionStatus','Note added to the review draft.');
    setText('proofReaderWorkspaceNotice','The note is saved in this review draft and will be stored when you submit the review result.');
    setAnnotationButtonLabel(false);
    setVisible('proofReaderCancelAnnotationEditBtn',false);
    renderProofReaderAnnotationList();
    if (state.previewMode === 'text') renderProofReaderTextPreview();
    else if (state.previewMode === 'pdf') renderProofReaderPdfHighlights();
  }

  function editProofReaderAnnotation(id) {
    if (!state.canAnnotate) return;
    const item = state.annotations.find(annotation => annotation.id === id);
    if (!item) return;
    state.editingAnnotationId = id;
    state.pendingSelection = {selectedText:item.selectedText || '',startOffset:item.startOffset,endOffset:item.endOffset,pageNumber:item.pageNumber,rects:Array.isArray(item.rects)?item.rects:[],location:item.location || ''};
    if (byId('proofReaderAnnotationType')) byId('proofReaderAnnotationType').value = item.category || 'Correction';
    if (byId('proofReaderAnnotationNote')) byId('proofReaderAnnotationNote').value = item.note || '';
    if (byId('proofReaderAnnotationPage')) byId('proofReaderAnnotationPage').value = item.pageNumber || '';
    if (byId('proofReaderAnnotationLocation')) byId('proofReaderAnnotationLocation').value = item.location || '';
    setText('proofReaderSelectedText',item.selectedText || 'No text anchor; this is a general or page-specific note.');
    setAnnotationButtonLabel(true);
    setVisible('proofReaderCancelAnnotationEditBtn',true);
    byId('proofReaderAnnotationNote')?.focus();
  }

  function cancelProofReaderAnnotationEdit() {
    state.editingAnnotationId = '';
    state.pendingSelection = null;
    if (byId('proofReaderAnnotationNote')) byId('proofReaderAnnotationNote').value = '';
    if (byId('proofReaderAnnotationPage')) byId('proofReaderAnnotationPage').value = '';
    if (byId('proofReaderAnnotationLocation')) byId('proofReaderAnnotationLocation').value = '';
    setText('proofReaderSelectedText','No text selected. A general note or page-specific note can still be added.');
    setAnnotationButtonLabel(false);
    setVisible('proofReaderCancelAnnotationEditBtn',false);
  }

  function removeProofReaderAnnotation(id) {
    if (!state.canAnnotate) return;
    state.annotations = state.annotations.filter(item => item.id !== id);
    if (state.editingAnnotationId === id) cancelProofReaderAnnotationEdit();
    renderProofReaderAnnotationList();
    if (state.previewMode === 'text') renderProofReaderTextPreview();
    else if (state.previewMode === 'pdf') renderProofReaderPdfHighlights();
  }

  function openProofReaderAnnotation(id) {
    const noteId = String(id || '');
    const card = Array.from(byId('proofReaderAnnotationList')?.querySelectorAll('[data-note-card]') || [])
      .find(element => element.dataset.noteCard === noteId);
    card?.scrollIntoView({behavior:'smooth',block:'nearest'});
    if (state.previewMode === 'pdf') {
      const annotation = (state.annotations || []).find(item => String(item.id) === noteId);
      const pageNumber = Number(annotation?.pageNumber || 0);
      const page = pageNumber ? byId('proofReaderPdfPages')?.querySelector(`.proofreader-pdf-page[data-page-number="${pageNumber}"]`) : null;
      page?.scrollIntoView({behavior:'smooth',block:'center'});
    }
  }

  function toggleProofReaderFinalEditor() {
    if (!state.currentDocument?.canFinalRevise) return;
    state.finalEditorVisible = !state.finalEditorVisible;
    const currentMode = state.current?.editorMode || 'text';
    if (currentMode === 'pdf') return;
    setVisible('proofReaderDocumentPreviewWrap',!state.finalEditorVisible && state.previewMode === 'text');
    setVisible('proofReaderPdfPreviewWrap',!state.finalEditorVisible && state.previewMode === 'pdf');
    setVisible('proofReaderTextEditorWrap',state.finalEditorVisible);
    setVisible('proofReaderZoomControls',!state.finalEditorVisible && state.previewMode === 'text');
    const button = byId('proofReaderEditFinalToggle');
    if (button) button.innerHTML = state.finalEditorVisible ? '<i class="fi fi-rr-eye" aria-hidden="true"></i><span>View Annotated Document</span>' : '<i class="fi fi-rr-edit" aria-hidden="true"></i><span>Edit Final Revision</span>';
  }

  function renderProofReaderPdfHighlights() {
    const pages = byId('proofReaderPdfPages');
    if (!pages) return;
    pages.querySelectorAll('.proofreader-pdf-annotation-overlay').forEach(node => node.remove());
    pages.querySelectorAll('.proofreader-pdf-page').forEach(page => {
      const pageNumber = Number(page.dataset.pageNumber || 0);
      const overlay = document.createElement('div');
      overlay.className = 'proofreader-pdf-annotation-overlay';
      (state.annotations || []).filter(item => Number(item.pageNumber) === pageNumber && Array.isArray(item.rects)).forEach(item => {
        item.rects.forEach(rect => {
          const mark = document.createElement('div');
          mark.className = 'proofreader-pdf-highlight';
          mark.dataset.noteId = item.id || '';
          mark.dataset.category = item.category || 'Correction';
          mark.title = `${item.category}: ${item.note}`;
          mark.style.left = `${Math.max(0,Number(rect.x)||0)*100}%`;
          mark.style.top = `${Math.max(0,Number(rect.y)||0)*100}%`;
          mark.style.width = `${Math.min(1,Number(rect.width)||0)*100}%`;
          mark.style.height = `${Math.min(1,Number(rect.height)||0)*100}%`;
          overlay.appendChild(mark);
        });
      });
      page.appendChild(overlay);
    });
  }

  let pdfJsLibraryPromise = null;

  async function loadProofReaderPdfJs() {
    if (window.pdfjsLib && typeof window.pdfjsLib.getDocument === 'function' && typeof window.pdfjsLib.TextLayer === 'function') {
      return window.pdfjsLib;
    }
    if (!pdfJsLibraryPromise) {
      pdfJsLibraryPromise = import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.5.438/pdf.min.mjs')
        .then(function(library) {
          if (!library || typeof library.getDocument !== 'function' || typeof library.TextLayer !== 'function') {
            throw new Error('The PDF.js module did not expose the required document and text-layer APIs.');
          }
          library.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.5.438/pdf.worker.min.mjs';
          window.pdfjsLib = library;
          return library;
        })
        .catch(function(error) { pdfJsLibraryPromise = null; throw error; });
    }
    return pdfJsLibraryPromise;
  }

  async function renderProofReaderPdf(base64) {
    const host = byId('proofReaderPdfPages');
    const fallback = byId('proofReaderPdfFallback');
    if (!host || !base64) return;
    host.innerHTML = '';
    const zoomSurface = document.createElement('div');
    zoomSurface.className = 'proofreader-pdf-zoom-surface';
    zoomSurface.id = 'proofReaderPdfZoomSurface';
    host.appendChild(zoomSurface);
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const blob = new Blob([bytes],{type:'application/pdf'});
    try {
      const pdfjsLib = await loadProofReaderPdfJs();
      // PDF.js is pinned to the current stable release. Keep eval-based font compilation
      // disabled as defense-in-depth when rendering untrusted uploaded documents.
      const pdf = await pdfjsLib.getDocument({data:bytes,isEvalSupported:false}).promise;
      state.pdfDocument = pdf;
      const availableWidth = Math.max(360,(host.clientWidth || 700)-32);
      for (let pageNumber=1; pageNumber<=pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const natural = page.getViewport({scale:1});
        const scale = Math.min(1.35,Math.max(.65,availableWidth/natural.width));
        const viewport = page.getViewport({scale:scale});
        const pageWrap = document.createElement('div');
        pageWrap.className = 'proofreader-pdf-page';
        pageWrap.dataset.pageNumber = String(pageNumber);
        pageWrap.style.width = `${viewport.width}px`;
        pageWrap.style.height = `${viewport.height}px`;
        const canvas = document.createElement('canvas');
        const outputScale = Math.max(1,Math.min(2,window.devicePixelRatio || 1));
        canvas.width = Math.floor(viewport.width*outputScale);
        canvas.height = Math.floor(viewport.height*outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        pageWrap.appendChild(canvas);
        const textLayer = document.createElement('div');
        textLayer.className = 'proofreader-pdf-text-layer textLayer';
        textLayer.style.width = `${viewport.width}px`;
        textLayer.style.height = `${viewport.height}px`;
        pageWrap.appendChild(textLayer);
        zoomSurface.appendChild(pageWrap);
        const context = canvas.getContext('2d',{alpha:false});
        context.setTransform(outputScale,0,0,outputScale,0,0);
        await page.render({canvasContext:context,viewport:viewport}).promise;
        // Use the supported TextLayer class and streaming text API for selectable text.
        textLayer.style.setProperty('--scale-factor', String(viewport.scale));
        const textLayerTask = new pdfjsLib.TextLayer({
          textContentSource: page.streamTextContent(),
          container: textLayer,
          viewport: viewport
        });
        await textLayerTask.render();
      }
      setVisible('proofReaderPdfFallback',false);
      renderProofReaderPdfHighlights();
      applyProofReaderZoom();
    } catch (error) {
      console.warn('PDF.js preview unavailable; falling back to native PDF preview:',error);
      host.innerHTML = '';
      state.pdfObjectUrl = URL.createObjectURL(blob);
      const frame = byId('proofReaderPdfPreview');
      if (frame) frame.src = state.pdfObjectUrl;
      setVisible('proofReaderPdfFallback',true);
      applyProofReaderZoom();
    }
  }
  function renderDetailGrid(record, data) {
    const target = byId('proofReaderDetailGrid');
    if (!target) return;
    const items = [
      ['Reference',record.referenceNo],['Document Type',record.documentType],['Sender',record.senderName],
      ['Proof Reader',record.proofReaderName],['Submitted',displayDate(record.createdAt)],
      ['Target Date',displayDate(record.targetDate)],['Status',record.status],
      ['Latest Remark',record.remark || '—'],['Review Comments',record.comments || '—'],
      ['Instructions',record.instructions || '—'],['Revision',`Version ${record.revisionNumber}`]
    ];
    target.innerHTML = items.map(([label,value]) => `<div class="proofreader-detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  }
  function renderHistory(history) {
    const target = byId('proofReaderHistory');
    if (!target) return;
    const items = Array.isArray(history) ? history : [];
    target.innerHTML = items.length ? items.map(item => `<article class="proofreader-history-entry"><span class="proofreader-history-dot"></span><div><strong>${escapeHtml(item.action || 'Updated')}</strong><small>${escapeHtml(item.actor || 'User')} · ${escapeHtml(displayDate(item.createdAt))}</small><p>${escapeHtml([item.remark,item.comments,item.newStatus].filter(Boolean).join(' · '))}</p></div></article>`).join('') : '<div class="proofreader-empty">No history is available.</div>';
  }
  async function openProofReaderDocument(requestId) {
    if (!requestId) return;
    try {
      setText('proofReaderWorkspaceTitle','Loading document…');
      setText('proofReaderWorkspaceSubtitle','Retrieving authorized document details.');
      setVisible('proofReaderReviewActions',false); setVisible('proofReaderSenderActions',false); setVisible('proofReaderReadonlyActions',false);
      setVisible('proofReaderZoomControls',false);
      state.previewZoom = 1;
      applyProofReaderZoom();
      modalOpen('proofReaderWorkspaceModal');
      clearPdfPreview();
      const result = await api('get_proofreading_document',{requestId:requestId});
      state.current = result.request;
      state.currentDocument = result;
      state.annotations = Array.isArray(result.annotations) ? result.annotations : [];
      state.canAnnotate = !!result.canReview;
      state.pendingSelection = null;
      state.editingAnnotationId = '';
      state.finalEditorVisible = false;
      state.previewZoom = 1;
      applyProofReaderZoom();
      const record = result.request;
      setText('proofReaderWorkspaceTitle',record.title);
      setText('proofReaderWorkspaceSubtitle',`${record.referenceNo} · ${record.currentFileName || record.originalFileName || 'Document'}`);
      setText('proofReaderWorkspaceMeta',`${record.status} · Version ${record.revisionNumber}${result.annotationVersion ? ` · Annotations for version ${result.annotationVersion}` : ''}`);
      renderDetailGrid(record,result);
      renderHistory(result.history);
      const editable = !!(result.canReview || result.canFinalRevise);
      const currentMode = record.editorMode === 'pdf' ? 'pdf' : 'text';
      const previewMode = result.annotationEditorMode === 'pdf' || result.annotationEditorMode === 'text' ? result.annotationEditorMode : currentMode;
      const previewContent = result.annotationEditorMode === 'text' && typeof result.annotationContent === 'string' ? result.annotationContent : result.content || '';
      const previewPdf = result.annotationPdfBase64 || result.pdfBase64 || '';
      state.previewMode = previewMode;
      state.previewContent = previewContent;
      setVisible('proofReaderDocumentPreviewWrap',previewMode === 'text');
      setVisible('proofReaderPdfPreviewWrap',previewMode === 'pdf' && !!previewPdf);
      setVisible('proofReaderZoomControls',previewMode === 'text' || (previewMode === 'pdf' && !!previewPdf));
      setVisible('proofReaderTextEditorWrap',false);
      setVisible('proofReaderEditFinalToggle',!!result.canFinalRevise && currentMode === 'text');
      setVisible('proofReaderReviewActions',!!result.canReview);
      setVisible('proofReaderSenderActions',!!result.canFinalRevise);
      setVisible('proofReaderReadonlyActions',!editable);
      setVisible('proofReaderRevisionUploadWrap',!!result.canFinalRevise || (!!result.canReview && currentMode === 'pdf'));
      setVisible('proofReaderAnnotationControls',!!result.canReview);
      if (byId('proofReaderEditor')) {
        byId('proofReaderEditor').value = result.content || '';
        byId('proofReaderEditor').readOnly = !result.canFinalRevise;
        byId('proofReaderEditor').setAttribute('aria-readonly',result.canFinalRevise ? 'false' : 'true');
      }
      if (byId('proofReaderRemark')) byId('proofReaderRemark').value = '';
      if (byId('proofReaderComments')) byId('proofReaderComments').value = '';
      if (byId('proofReaderRevisionUpload')) byId('proofReaderRevisionUpload').value = '';
      if (byId('proofReaderAnnotationNote')) byId('proofReaderAnnotationNote').value = '';
      if (byId('proofReaderAnnotationPage')) byId('proofReaderAnnotationPage').value = '';
      if (byId('proofReaderAnnotationLocation')) byId('proofReaderAnnotationLocation').value = '';
      setText('proofReaderSelectedText','No text selected. A general note or page-specific note can still be added.');
      setAnnotationButtonLabel(false);
      setVisible('proofReaderCancelAnnotationEditBtn',false);
      const originalName = record.originalFileName || 'Original uploaded document';
      const originalExt = (originalName.match(/\.([a-z0-9]+)$/i) || [,'file'])[1].toUpperCase();
      setText('proofReaderOriginalFileName',originalName);
      setText('proofReaderOriginalFileType',originalExt);
      setText('proofReaderOriginalFileTitle',originalExt === 'DOCX' ? 'Original uploaded Word document' : 'Original uploaded file');
      setVisible('proofReaderOriginalFileCard',true);
      setVisible('proofReaderCurrentFileCard',true);
      if (currentMode === 'text') {
        setText('proofReaderCurrentFileTitle','Current editable Word copy');
        setText('proofReaderCurrentFileName',`${record.title || 'Document'} - Current Working Copy.docx`);
        setText('proofReaderCurrentFileType','DOCX');
        setText('proofReaderDownloadBtnLabel','Download Current .DOCX');
      } else {
        setText('proofReaderCurrentFileTitle','Current PDF document');
        setText('proofReaderCurrentFileName',record.currentFileName || record.originalFileName || 'Current PDF document');
        setText('proofReaderCurrentFileType','PDF');
        setText('proofReaderDownloadBtnLabel','Download Current PDF');
      }
      if (previewMode === 'text') {
        setText('proofReaderEditorHeading',result.annotationVersion ? 'Reviewed Document Preview' : 'Document Preview');
        setText('proofReaderEditorMode',state.canAnnotate ? 'Select document text and add linked proofreading notes in the notepad.' : 'Read-only preview with submitted proofreading notes and highlights.');
        setText('proofReaderVersionPill',`Version ${result.annotationVersion || record.revisionNumber} · TEXT`);
        renderProofReaderTextPreview();
      } else {
        setText('proofReaderEditorHeading',result.annotationVersion ? 'Reviewed PDF Preview' : 'PDF Document Preview');
        setText('proofReaderEditorMode',state.canAnnotate ? 'Select PDF text, or add a page-specific note in the notepad.' : 'PDF is preview-only. Submitted highlights and notes are shown when available.');
        setText('proofReaderVersionPill',`Version ${result.annotationVersion || record.revisionNumber} · PDF`);
        await renderProofReaderPdf(previewPdf);
      }
      renderProofReaderAnnotationList();
      const notice = result.canReview ? 'Review the uploaded document, add highlighted corrections or suggestions in the notepad, select a remark, and submit the review result.' : result.canFinalRevise ? 'Review the Proofreader’s annotations. For text documents, use Edit Final Revision when ready; then submit or upload the corrected file.' : 'This record is available for viewing only. Submitted annotations are read-only.';
      setText('proofReaderWorkspaceNotice',notice);
      window.SPADESModalStack?.refresh?.();
    } catch (error) {
      closeProofReaderWorkspace();
      if (typeof customAlert === 'function') customAlert(error.message,'Unable to Open Document');
      else if (typeof showNotification === 'function') showNotification('Unable to Open Document',error.message);
    }
  }
  function closeProofReaderWorkspace() {
    clearPdfPreview();
    state.current = null;
    state.currentDocument = null;
    state.annotations = [];
    state.pendingSelection = null;
    state.editingAnnotationId = '';
    state.canAnnotate = false;
    state.previewContent = '';
    state.finalEditorVisible = false;
    state.previewZoom = 1;
    setVisible('proofReaderZoomControls',false);
    applyProofReaderZoom();
    modalClose('proofReaderWorkspaceModal');
  }
  async function submitProofReaderReview() {
    const record = state.current;
    if (!record) return;
    const button = byId('proofReaderSubmitReviewBtn');
    if (button?._busy) return;
    const remark = String(byId('proofReaderRemark')?.value || '').trim();
    const comments = String(byId('proofReaderComments')?.value || '').trim();
    if (!REMARKS.includes(remark)) return setText('proofReaderWorkspaceNotice','Select a proofreading remark before submitting.');
    if (remark !== 'Approved' && !comments) return setText('proofReaderWorkspaceNotice','Enter explanatory comments for the selected remark.');
    const selectedFile = byId('proofReaderRevisionUpload')?.files?.[0];
    if (record.editorMode === 'pdf' && ['For Revision','For Correction'].includes(remark) && !selectedFile) return setText('proofReaderWorkspaceNotice','Upload the corrected PDF or document file before returning it to the sender.');
    try {
      if (button) { button._busy = true; button.disabled = true; button.setAttribute('aria-busy','true'); }
      setText('proofReaderWorkspaceNotice','Saving proofreading result…');
      const payload = {
        requestId:record.id,remark:remark,comments:comments,
        annotations:(state.annotations || []).map(item => ({
          category:item.category,selectedText:item.selectedText || '',
          startOffset:item.startOffset == null ? null : Number(item.startOffset),
          endOffset:item.endOffset == null ? null : Number(item.endOffset),
          pageNumber:item.pageNumber == null ? null : Number(item.pageNumber),
          rects:Array.isArray(item.rects) ? item.rects : [],location:item.location || '',note:item.note || ''
        }))
      };
      if (selectedFile) Object.assign(payload,await readFileAsBase64(selectedFile));
      const result = await api('submit_proofreading_review',payload);
      setText('proofReaderWorkspaceNotice',`Review saved: ${result.status}.`);
      closeProofReaderWorkspace();
      await loadProofReaderDashboard(true);
      if (typeof showNotification === 'function') showNotification('Proofreading Updated',`The request is now ${result.status}.`);
    } catch (error) {
      setText('proofReaderWorkspaceNotice',error.message);
    } finally {
      if (button) { button._busy = false; button.disabled = false; button.removeAttribute('aria-busy'); }
    }
  }
  async function resubmitProofReaderFinalVersion() {
    const record = state.current;
    if (!record) return;
    const button = byId('proofReaderResubmitBtn');
    if (button?._busy) return;
    const selectedFile = byId('proofReaderRevisionUpload')?.files?.[0];
    if (record.editorMode === 'pdf' && !selectedFile) return setText('proofReaderWorkspaceNotice','Upload the final revised document before resubmitting.');
    try {
      if (button) { button._busy = true; button.disabled = true; button.setAttribute('aria-busy','true'); }
      setText('proofReaderWorkspaceNotice','Submitting final revision…');
      const payload = {requestId:record.id};
      if (selectedFile) Object.assign(payload,await readFileAsBase64(selectedFile));
      else if (record.editorMode === 'text') payload.content = String(byId('proofReaderEditor')?.value || '');
      const result = await api('resubmit_proofreading_final',payload);
      closeProofReaderWorkspace();
      await loadProofReaderDashboard(true);
      if (typeof showNotification === 'function') showNotification('Final Revision Submitted',`The document has been resubmitted. Status: ${result.status}.`);
    } catch (error) {
      setText('proofReaderWorkspaceNotice',error.message);
    } finally {
      if (button) { button._busy = false; button.disabled = false; button.removeAttribute('aria-busy'); }
    }
  }

  async function downloadProofReaderFile(action, buttonId, successPrefix) {
    const record = state.current;
    if (!record) return;
    const button = byId(buttonId);
    if (button?._busy) return;
    try {
      if (button) { button._busy = true; button.disabled = true; button.setAttribute('aria-busy','true'); }
      setText('proofReaderWorkspaceNotice','Preparing the Word/document file…');
      const result = await api(action,{requestId:record.id});
      const bytes = Uint8Array.from(atob(result.fileBase64 || ''), ch => ch.charCodeAt(0));
      if (!bytes.length) throw new Error('The server returned an empty document file.');
      const blob = new Blob([bytes],{type:result.mimeType || 'application/octet-stream'});
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.fileName || 'Proofreading-Document';
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1500);
      setText('proofReaderWorkspaceNotice',`${successPrefix || 'Downloaded'}: ${result.fileName || 'document file'}.`);
    } catch (error) {
      setText('proofReaderWorkspaceNotice',error.message || 'Unable to download this document file.');
    } finally {
      if (button) { button._busy = false; button.disabled = false; button.removeAttribute('aria-busy'); }
    }
  }

  async function downloadProofReaderCurrentDocument() {
    return downloadProofReaderFile('download_proofreading_document','proofReaderDownloadBtn','Current document ready');
  }

  async function downloadProofReaderOriginalDocument() {
    return downloadProofReaderFile('download_proofreading_source_document','proofReaderDownloadOriginalBtn','Original source file ready');
  }

  async function pollProofReaderNotifications() {
    if (state.notificationBusy || !getCurrentUsername() || !localStorage.getItem('loggedCred')) return;
    state.notificationBusy = true;
    try {
      const result = await api('get_proofreader_notifications');
      (result.notifications || []).forEach(notification => {
        if (typeof showNotification === 'function') {
          showNotification('Admin Proof Reader',notification.message,async () => {
            if (typeof switchTab === 'function') switchTab('adminProofReader');
            await loadProofReaderDashboard(true);
            await openProofReaderDocument(notification.requestId);
          });
        }
      });
    } catch (error) {
      // The notification monitor must never interrupt the rest of SPADES.
      console.debug('Admin Proof Reader notification polling:',error.message || error);
    } finally { state.notificationBusy = false; }
  }
  function startProofReaderNotificationMonitor() {
    if (state.notificationTimer) return;
    pollProofReaderNotifications();
    state.notificationTimer = window.setInterval(pollProofReaderNotifications,60000);
  }
  function stopProofReaderNotificationMonitor() {
    if (state.notificationTimer) window.clearInterval(state.notificationTimer);
    state.notificationTimer = null;
    state.notificationBusy = false;
    clearPdfPreview();
  }

  // Expose page actions to the existing inline navigation and modal controls.
  window.setProofReaderView = setProofReaderView;
  window.clearProofReaderFilters = clearProofReaderFilters;
  window.loadProofReaderDashboard = loadProofReaderDashboard;
  window.openProofReaderSettings = openProofReaderSettings;
  window.closeProofReaderSettings = closeProofReaderSettings;
  window.filterProofReaderDesignationOptions = filterProofReaderDesignationOptions;
  window.clearProofReaderDesignationSearch = clearProofReaderDesignationSearch;
  window.toggleVisibleProofReaderDesignations = toggleVisibleProofReaderDesignations;
  window.saveProofReaderDesignations = saveProofReaderDesignations;
  window.openProofReaderSubmitModal = openProofReaderSubmitModal;
  window.closeProofReaderSubmitModal = closeProofReaderSubmitModal;
  window.updateProofReaderSelectedFile = updateProofReaderSelectedFile;
  window.submitProofReaderRequest = submitProofReaderRequest;
  window.openProofReaderDocument = openProofReaderDocument;
  window.closeProofReaderWorkspace = closeProofReaderWorkspace;
  window.submitProofReaderReview = submitProofReaderReview;
  window.captureProofReaderSelection = captureProofReaderSelection;
  window.addProofReaderAnnotation = addProofReaderAnnotation;
  window.editProofReaderAnnotation = editProofReaderAnnotation;
  window.cancelProofReaderAnnotationEdit = cancelProofReaderAnnotationEdit;
  window.removeProofReaderAnnotation = removeProofReaderAnnotation;
  window.openProofReaderAnnotation = openProofReaderAnnotation;
  window.toggleProofReaderFinalEditor = toggleProofReaderFinalEditor;
  window.adjustProofReaderZoom = adjustProofReaderZoom;
  window.resetProofReaderZoom = resetProofReaderZoom;
  window.downloadProofReaderCurrentDocument = downloadProofReaderCurrentDocument;
  window.downloadProofReaderOriginalDocument = downloadProofReaderOriginalDocument;
  window.resubmitProofReaderFinalVersion = resubmitProofReaderFinalVersion;
  window.startProofReaderNotificationMonitor = startProofReaderNotificationMonitor;
  window.stopProofReaderNotificationMonitor = stopProofReaderNotificationMonitor;

  document.addEventListener('DOMContentLoaded', () => {
    // Script is deferred, so DOM is generally already parsed; this hook also covers unusual loads.
    if (byId('proofReaderTableBody')) renderProofReaderTable();
    byId('proofReaderDocumentPreview')?.addEventListener('click',event => {
      const mark = event.target.closest && event.target.closest('mark[data-note-id]');
      if (mark) openProofReaderAnnotation(mark.dataset.noteId);
    });
    byId('proofReaderAnnotationList')?.addEventListener('click',event => {
      const card = event.target.closest && event.target.closest('[data-note-card]');
      if (!card) return;
      const noteId = card.dataset.noteCard;
      if (state.previewMode === 'text') {
        const mark = Array.from(byId('proofReaderDocumentPreview')?.querySelectorAll('mark[data-note-id]') || [])
          .find(element => element.dataset.noteId === noteId);
        mark?.scrollIntoView({behavior:'smooth',block:'center'});
      } else {
        openProofReaderAnnotation(noteId);
      }
    });
  });
})();
