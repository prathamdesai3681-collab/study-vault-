/* ==========================================================================
   GARAGE'S STUDY VAULT v4.1 — STAGE 2: FILE LIBRARY UI CONTROLLER
   File: js/files-ui.js
   Connects exclusively to window.StudyVaultFilesDB (StudyVaultFilesDB v1).
   Zero access to StudyVaultDB or localStorage. Zero external dependencies.
   Safe DOM rendering via createElement + textContent only.
   ========================================================================== */

(function (global) {
  'use strict';

  if (global.StudyVaultFilesUI) {
    console.warn('[StudyVaultFilesUI] Already initialized; skipping duplicate load.');
    return;
  }

  var DB = global.StudyVaultFilesDB;

  // =========================================================================
  // 1. UI STATE & LIFECYCLE TRACKING
  // =========================================================================

  var uiState = {
    initialized: false,
    prefsLoaded: false,
    viewMode: 'library', // 'library' | 'trash'
    currentFolderId: null,
    searchQuery: '',
    sortBy: 'updatedAt',
    sortDir: 'desc',
    isBusy: false,
    renderToken: 0,
    cachedFolders: [],
    cachedFiles: [],
    nameModalContext: null,
    moveModalContext: null,
    confirmModalContext: null
  };

  var searchDebounceTimer = null;
  var activeObjectUrls = new Set();

  function trackObjectUrl(url) {
    activeObjectUrls.add(url);
    global.setTimeout(function () {
      if (activeObjectUrls.has(url)) {
        try {
          global.URL.revokeObjectURL(url);
        } catch (e) {
          // Ignore revoke errors
        }
        activeObjectUrls.delete(url);
      }
    }, 15000);
  }

  function revokeAllObjectUrls() {
    activeObjectUrls.forEach(function (url) {
      try {
        global.URL.revokeObjectURL(url);
      } catch (e) {
        // Ignore revoke errors
      }
    });
    activeObjectUrls.clear();
  }

  // =========================================================================
  // 2. DOM HELPERS (STRICTLY SAFE — NO UNTRUSTED innerHTML)
  // =========================================================================

  function byId(id) {
    return document.getElementById(id);
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function iconEl(iconName, className) {
    var i = document.createElement('i');
    i.setAttribute('data-lucide', iconName);
    if (className) i.className = className;
    return i;
  }

  function refreshIcons() {
    if (typeof global.lucide !== 'undefined' && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  function formatBytes(bytes) {
    var num = Number(bytes);
    if (!isFinite(num) || num <= 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var idx = 0;
    while (num >= 1024 && idx < units.length - 1) {
      num /= 1024;
      idx++;
    }
    var rounded = idx === 0 ? Math.round(num) : Math.round(num * 10) / 10;
    return rounded + ' ' + units[idx];
  }

  function formatDate(ts) {
    var num = Number(ts);
    if (!isFinite(num) || num <= 0) return 'Unknown date';
    try {
      return new Date(num).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (e) {
      return new Date(num).toDateString();
    }
  }

  function getCategoryIconName(category) {
    switch (category) {
      case 'pdf':
        return 'file-text';
      case 'image':
        return 'image';
      case 'office':
        return 'file-spreadsheet';
      case 'text':
      default:
        return 'file-code';
    }
  }

  function formatErrorMessage(err, fallback) {
    if (!err) return fallback || 'An unexpected error occurred.';
    if (err.code === 'QUOTA_EXCEEDED') {
      return 'Storage quota exceeded. Remove unneeded files from Trash or free device storage and try again.';
    }
    return err.message || fallback || 'Operation failed.';
  }

  // =========================================================================
  // 3. STATUS BANNER & LOADING / EMPTY STATES
  // =========================================================================

  function showStatus(tone, message) {
    var banner = byId('filesStatusBanner');
    var msgEl = byId('filesStatusMessage');
    if (!banner || !msgEl) return;

    banner.classList.remove('hidden', 'is-success', 'is-warning', 'is-danger');
    if (tone === 'success') banner.classList.add('is-success');
    else if (tone === 'warning') banner.classList.add('is-warning');
    else if (tone === 'danger') banner.classList.add('is-danger');

    msgEl.textContent = String(message || '');
  }

  function hideStatus() {
    var banner = byId('filesStatusBanner');
    var msgEl = byId('filesStatusMessage');
    if (banner) banner.classList.add('hidden');
    if (msgEl) msgEl.textContent = '';
  }

  function setLoadingState(isLoading) {
    var loadingEl = byId('filesLoadingState');
    var listEl = byId('filesListContainer');
    var emptyEl = byId('filesEmptyState');
    if (!loadingEl) return;

    if (isLoading) {
      loadingEl.classList.remove('hidden');
      if (emptyEl) emptyEl.classList.add('hidden');
      if (listEl) listEl.classList.add('hidden');
    } else {
      loadingEl.classList.add('hidden');
      if (listEl) listEl.classList.remove('hidden');
    }
  }

  function setBusy(busy) {
    uiState.isBusy = Boolean(busy);
    var uploadBtn = byId('filesUploadBtn');
    var newFolderBtn = byId('filesNewFolderBtn');
    var emptyTrashBtn = byId('filesEmptyTrashBtn');
    if (uploadBtn) uploadBtn.disabled = uiState.isBusy;
    if (newFolderBtn) newFolderBtn.disabled = uiState.isBusy;
    if (emptyTrashBtn && uiState.isBusy) emptyTrashBtn.disabled = true;
  }

  // =========================================================================
  // 4. STORAGE ESTIMATE, PERSISTENCE & HEALTH CHECK
  // =========================================================================

  function refreshStorageStatus() {
    if (!DB) return Promise.resolve();

    return Promise.all([
      DB.getStorageEstimate(),
      DB.getPersistenceStatus()
    ]).then(function (results) {
      var est = results[0];
      var pers = results[1];

      var libTextEl = byId('filesLibraryUsageText');
      var quotaTextEl = byId('filesQuotaEstimateText');
      var badgeEl = byId('filesPersistenceBadge');
      var protectBtn = byId('filesProtectStorageBtn');
      var noteEl = byId('filesStorageNote');

      if (libTextEl) {
        var libSummary = 'Library: ' + formatBytes(est.libraryTotalBytes);
        if (est.libraryTrashedBytes > 0) {
          libSummary += ' (' + formatBytes(est.libraryActiveBytes) + ' active, ' + formatBytes(est.libraryTrashedBytes) + ' in Trash)';
        }
        libTextEl.textContent = libSummary;
      }

      if (quotaTextEl) {
        if (est.supported && est.usageBytes !== null && est.quotaBytes !== null) {
          var pctStr = est.percentUsed !== null ? ' (' + est.percentUsed + '%)' : '';
          quotaTextEl.textContent = 'Browser Storage: ' + formatBytes(est.usageBytes) + ' / ' + formatBytes(est.quotaBytes) + pctStr;
        } else {
          quotaTextEl.textContent = 'Browser Quota: Unavailable in this browser';
        }
      }

      if (badgeEl) {
        badgeEl.className = 'px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold';
        if (pers.status === 'protected') {
          badgeEl.classList.add('status-success-pill');
          badgeEl.textContent = 'Storage: Protected';
        } else if (pers.status === 'best-effort') {
          badgeEl.classList.add('accent-secondary-pill');
          badgeEl.textContent = 'Storage: Best-Effort';
        } else {
          badgeEl.classList.add('surface-elevated', 'text-sub');
          badgeEl.textContent = 'Storage: Standard';
        }
      }

      if (protectBtn) {
        if (pers.supported && pers.status === 'best-effort') {
          protectBtn.classList.remove('hidden');
        } else {
          protectBtn.classList.add('hidden');
        }
      }

      if (noteEl && pers.message) {
        noteEl.textContent = pers.message;
      }
    }).catch(function (err) {
      var quotaTextEl = byId('filesQuotaEstimateText');
      if (quotaTextEl) {
        quotaTextEl.textContent = 'Storage info unavailable: ' + formatErrorMessage(err, 'Read error');
      }
    });
  }

  function handleRequestProtection() {
    if (!DB) return;
    var protectBtn = byId('filesProtectStorageBtn');
    if (protectBtn) protectBtn.disabled = true;

    DB.requestPersistentStorage().then(function (res) {
      var tone = res.persisted === true ? 'success' : 'warning';
      showStatus(tone, res.message);
      return refreshStorageStatus();
    }).catch(function (err) {
      showStatus('danger', formatErrorMessage(err, 'Could not request persistent storage.'));
    }).then(function () {
      if (protectBtn) protectBtn.disabled = false;
    });
  }

  function handleHealthCheck() {
    if (!DB) return;
    var healthBtn = byId('filesHealthCheckBtn');
    if (healthBtn) healthBtn.disabled = true;

    DB.runIntegrityScan().then(function (scan) {
      if (!scan.complete) {
        showStatus('danger', 'Health check incomplete: ' + (scan.error || 'No records were modified.'));
        return;
      }
      var totals = scan.totals;
      if (scan.healthy) {
        showStatus(
          'success',
          'Library Health OK — ' + totals.folders + ' folder(s), ' +
          totals.filesMeta + ' file(s), ' + totals.validFileBlobs + ' verified file payload(s), 0 issues found.'
        );
      } else {
        showStatus(
          'warning',
          'Health check found ' + totals.issues + ' issue(s) across ' +
          totals.folders + ' folder(s) and ' + totals.filesMeta + ' file(s). No records were modified.'
        );
      }
    }).catch(function (err) {
      showStatus('danger', formatErrorMessage(err, 'Health check failed.'));
    }).then(function () {
      if (healthBtn) healthBtn.disabled = false;
    });
  }

  // =========================================================================
  // 5. BREADCRUMBS, FOLDER PATHS & SORT CONTROLS
  // =========================================================================

  function buildFolderLookup(folders) {
    var map = Object.create(null);
    for (var i = 0; i < folders.length; i++) {
      map[folders[i].id] = folders[i];
    }
    return map;
  }

  function getBreadcrumbTrail(folderId, folderMap) {
    var trail = [];
    var visited = Object.create(null);
    var curr = folderId;

    while (curr !== null && curr !== undefined) {
      if (visited[curr]) break;
      visited[curr] = true;
      var folder = folderMap[curr];
      if (!folder || folder.deletedAt !== null) break;
      trail.unshift(folder);
      curr = folder.parentId;
    }
    return trail;
  }

  function renderBreadcrumbs(folderMap) {
    var bar = byId('filesBreadcrumbs');
    if (!bar) return;
    clearNode(bar);

    if (uiState.viewMode === 'trash') {
      var backBtn = el('button', 'files-crumb-btn', 'Back to Library');
      backBtn.type = 'button';
      backBtn.setAttribute('data-action', 'exit-trash');
      bar.appendChild(backBtn);

      bar.appendChild(el('span', 'text-xs text-muted px-0.5', '/'));

      var trashLabel = el('span', 'files-crumb-btn is-current', 'Trash');
      bar.appendChild(trashLabel);
      return;
    }

    var isAtRoot = uiState.currentFolderId === null && !uiState.searchQuery;
    var rootBtn = el('button', 'files-crumb-btn' + (isAtRoot ? ' is-current' : ''), 'Root');
    rootBtn.type = 'button';
    rootBtn.setAttribute('data-action', 'nav-folder');
    rootBtn.setAttribute('data-folder-id', '');
    bar.appendChild(rootBtn);

    if (uiState.currentFolderId !== null) {
      var trail = getBreadcrumbTrail(uiState.currentFolderId, folderMap);
      for (var i = 0; i < trail.length; i++) {
        bar.appendChild(el('span', 'text-xs text-muted px-0.5', '/'));
        var isLast = i === trail.length - 1 && !uiState.searchQuery;
        var crumbBtn = el('button', 'files-crumb-btn' + (isLast ? ' is-current' : ''), trail[i].name);
        crumbBtn.type = 'button';
        crumbBtn.setAttribute('data-action', 'nav-folder');
        crumbBtn.setAttribute('data-folder-id', trail[i].id);
        bar.appendChild(crumbBtn);
      }
    }

    if (uiState.searchQuery) {
      bar.appendChild(el('span', 'text-xs text-muted px-0.5', '/'));
      bar.appendChild(el('span', 'files-crumb-btn is-current', 'Search: "' + uiState.searchQuery + '"'));
    }
  }

  function syncSortControls() {
    var sortSelect = byId('filesSortBySelect');
    var dirIcon = byId('filesSortDirIcon');
    var dirLabel = byId('filesSortDirLabel');

    if (sortSelect) sortSelect.value = uiState.sortBy;
    if (dirIcon) {
      dirIcon.setAttribute('data-lucide', uiState.sortDir === 'asc' ? 'arrow-up' : 'arrow-down');
    }
    if (dirLabel) {
      dirLabel.textContent = uiState.sortDir === 'asc' ? 'Asc' : 'Desc';
    }
  }

  function persistSortPrefs() {
    if (!DB) return;
    DB.setSetting('uiSortPrefs', {
      sortBy: uiState.sortBy,
      sortDir: uiState.sortDir
    }).catch(function () {
      // Non-critical preference write failure
    });
  }

  // =========================================================================
  // 6. MAIN DATA LOAD & SAFE DOM LIST RENDERING
  // =========================================================================

  function refresh() {
    if (!DB) {
      showStatus('danger', 'File storage engine (js/files-db.js) did not load.');
      return Promise.resolve();
    }

    var token = ++uiState.renderToken;
    setLoadingState(true);

    var isTrash = uiState.viewMode === 'trash';
    var trimmedSearch = uiState.searchQuery.trim();

    var allActiveFoldersPromise = DB.listFolders();
    var trashedFoldersPromise = DB.listFolders({ onlyTrashed: true });
    var trashedFilesPromise = DB.listFiles({ onlyTrashed: true });

    return Promise.all([
      allActiveFoldersPromise,
      trashedFoldersPromise,
      trashedFilesPromise
    ]).then(function (baseData) {
      if (token !== uiState.renderToken) return null;

      var allActiveFolders = baseData[0];
      var allTrashedFolders = baseData[1];
      var allTrashedFiles = baseData[2];
      var activeFolderMap = buildFolderLookup(allActiveFolders);

      // Update Trash badge count
      var trashBadge = byId('filesTrashCountBadge');
      var totalTrashed = allTrashedFolders.length + allTrashedFiles.length;
      if (trashBadge) {
        trashBadge.textContent = String(totalTrashed);
      }

      // If current active folder no longer exists or was trashed, fall back cleanly to Root
      if (!isTrash && uiState.currentFolderId !== null) {
        var currFolder = activeFolderMap[uiState.currentFolderId];
        if (!currFolder || currFolder.deletedAt !== null) {
          uiState.currentFolderId = null;
        }
      }

      var fileQueryOpts = isTrash
        ? { onlyTrashed: true, search: trimmedSearch, sortBy: uiState.sortBy, sortDir: uiState.sortDir }
        : trimmedSearch
          ? { search: trimmedSearch, sortBy: uiState.sortBy, sortDir: uiState.sortDir }
          : { folderId: uiState.currentFolderId, sortBy: uiState.sortBy, sortDir: uiState.sortDir };

      return DB.listFiles(fileQueryOpts).then(function (files) {
        if (token !== uiState.renderToken) return null;

        var visibleFolders;
        if (isTrash) {
          visibleFolders = trimmedSearch
            ? allTrashedFolders.filter(function (f) {
                return f.nameLower.indexOf(trimmedSearch.toLowerCase()) !== -1;
              })
            : allTrashedFolders;
        } else if (trimmedSearch) {
          visibleFolders = allActiveFolders.filter(function (f) {
            return f.nameLower.indexOf(trimmedSearch.toLowerCase()) !== -1;
          });
        } else {
          visibleFolders = allActiveFolders.filter(function (f) {
            return f.parentId === uiState.currentFolderId;
          });
        }

        uiState.cachedFolders = visibleFolders;
        uiState.cachedFiles = files;

        syncViewModeChrome(totalTrashed);
        renderBreadcrumbs(activeFolderMap);
        renderItemsList(visibleFolders, files, activeFolderMap, buildFolderLookup(allTrashedFolders));
        setLoadingState(false);
        refreshIcons();
        return refreshStorageStatus();
      });
    }).catch(function (err) {
      if (token !== uiState.renderToken) return;
      setLoadingState(false);
      showStatus('danger', formatErrorMessage(err, 'Failed to load File Library.'));
    });
  }

  function syncViewModeChrome(totalTrashedCount) {
    var isTrash = uiState.viewMode === 'trash';
    var toggleBtn = byId('filesViewToggleBtn');
    var toggleIcon = byId('filesViewToggleIcon');
    var toggleLabel = byId('filesViewToggleLabel');
    var uploadBtn = byId('filesUploadBtn');
    var newFolderBtn = byId('filesNewFolderBtn');
    var trashToolbar = byId('filesTrashToolbar');
    var emptyTrashBtn = byId('filesEmptyTrashBtn');

    if (toggleBtn) {
      toggleBtn.classList.toggle('status-warning-btn', isTrash);
      toggleBtn.classList.toggle('surface-elevated-btn', !isTrash);
    }
    if (toggleIcon) {
      toggleIcon.setAttribute('data-lucide', isTrash ? 'folder-open' : 'trash-2');
    }
    if (toggleLabel) {
      toggleLabel.textContent = isTrash ? 'Library' : 'Trash';
    }
    if (uploadBtn) {
      uploadBtn.classList.toggle('hidden', isTrash);
    }
    if (newFolderBtn) {
      newFolderBtn.classList.toggle('hidden', isTrash);
    }
    if (trashToolbar) {
      trashToolbar.classList.toggle('hidden', !isTrash);
    }
    if (emptyTrashBtn) {
      emptyTrashBtn.disabled = uiState.isBusy || totalTrashedCount === 0;
    }
  }

  function makeActionBtn(label, iconName, action, itemType, itemId, extraClass) {
    var btn = el('button', 'files-action-btn ' + (extraClass || 'surface-elevated-btn'));
    btn.type = 'button';
    btn.setAttribute('data-action', action);
    btn.setAttribute('data-item-type', itemType);
    btn.setAttribute('data-item-id', itemId);
    if (iconName) {
      btn.appendChild(iconEl(iconName, 'w-3.5 h-3.5 shrink-0'));
    }
    btn.appendChild(el('span', '', label));
    return btn;
  }

  function renderItemsList(folders, files, activeFolderMap, trashedFolderMap) {
    var container = byId('filesListContainer');
    var emptyState = byId('filesEmptyState');
    var emptyIcon = byId('filesEmptyIcon');
    var emptyTitle = byId('filesEmptyTitle');
    var emptyDesc = byId('filesEmptyDesc');
    var emptyActionBtn = byId('filesEmptyActionBtn');
    var countLabel = byId('filesItemCountLabel');

    if (!container) return;
    clearNode(container);

    var totalItems = folders.length + files.length;
    if (countLabel) {
      countLabel.textContent = totalItems + (totalItems === 1 ? ' item' : ' items');
    }

    var isTrash = uiState.viewMode === 'trash';
    var hasSearch = uiState.searchQuery.trim().length > 0;

    if (totalItems === 0) {
      if (emptyState) emptyState.classList.remove('hidden');
      if (emptyIcon) {
        emptyIcon.setAttribute('data-lucide', isTrash ? 'trash-2' : (hasSearch ? 'search' : 'folder-open'));
      }
      if (emptyTitle) {
        if (isTrash) emptyTitle.textContent = hasSearch ? 'No matching items in Trash' : 'Trash is empty';
        else if (hasSearch) emptyTitle.textContent = 'No matching files or folders';
        else emptyTitle.textContent = 'This folder is empty';
      }
      if (emptyDesc) {
        if (isTrash) {
          emptyDesc.textContent = hasSearch
            ? 'Try a different search term or clear the search box.'
            : 'Files and folders you move to Trash will appear here so you can restore or permanently delete them.';
        } else if (hasSearch) {
          emptyDesc.textContent = 'No active files or folders matched "' + uiState.searchQuery.trim() + '".';
        } else {
          emptyDesc.textContent = 'Upload PDFs, images, plain text, Markdown, or Office files, or create a subfolder.';
        }
      }
      if (emptyActionBtn) {
        emptyActionBtn.classList.toggle('hidden', isTrash || hasSearch);
      }
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    // 1. Render Folders
    for (var i = 0; i < folders.length; i++) {
      var folder = folders[i];
      var fRow = el('div', 'files-item-row');

      var fLeft = el('div', 'flex items-start sm:items-center gap-3 min-w-0 flex-1');
      var fIconBox = el('div', 'w-9 h-9 rounded-xl surface-inset flex items-center justify-center shrink-0 mt-0.5 sm:mt-0');
      fIconBox.appendChild(iconEl('folder', 'w-4 h-4 accent-text'));
      fLeft.appendChild(fIconBox);

      var fInfo = el('div', 'min-w-0 flex-1');
      if (!isTrash) {
        var openTitleBtn = el('button', 'text-left text-xs sm:text-sm font-semibold text-main hover:underline files-item-name block');
        openTitleBtn.type = 'button';
        openTitleBtn.setAttribute('data-action', 'open-folder');
        openTitleBtn.setAttribute('data-folder-id', folder.id);
        openTitleBtn.textContent = folder.name;
        fInfo.appendChild(openTitleBtn);
      } else {
        fInfo.appendChild(el('div', 'text-xs sm:text-sm font-semibold text-main files-item-name', folder.name));
      }

      var fMetaLine = 'Folder • Updated ' + formatDate(folder.updatedAt);
      if (isTrash && folder.parentId && trashedFolderMap[folder.parentId]) {
        fMetaLine += ' • Inside trashed "' + trashedFolderMap[folder.parentId].name + '"';
      } else if (!isTrash && hasSearch && folder.parentId && activeFolderMap[folder.parentId]) {
        fMetaLine += ' • In "' + activeFolderMap[folder.parentId].name + '"';
      }
      fInfo.appendChild(el('div', 'text-[11px] font-mono text-muted mt-0.5', fMetaLine));
      fLeft.appendChild(fInfo);
      fRow.appendChild(fLeft);

      var fActions = el('div', 'flex flex-wrap items-center gap-1.5 justify-end shrink-0');
      if (!isTrash) {
        fActions.appendChild(makeActionBtn('Open', 'folder-open', 'open-folder', 'folder', folder.id, 'surface-elevated-btn accent-text'));
        fActions.appendChild(makeActionBtn('Rename', 'edit-2', 'rename-folder', 'folder', folder.id));
        fActions.appendChild(makeActionBtn('Move', 'folder-input', 'move-folder', 'folder', folder.id));
        fActions.appendChild(makeActionBtn('Trash', 'trash-2', 'trash-folder', 'folder', folder.id, 'status-warning-btn'));
      } else {
        fActions.appendChild(makeActionBtn('Restore', 'rotate-ccw', 'restore-folder', 'folder', folder.id, 'surface-elevated-btn status-success'));
        fActions.appendChild(makeActionBtn('Delete Forever', 'x-circle', 'purge-folder', 'folder', folder.id, 'status-danger-btn'));
      }
      fRow.appendChild(fActions);
      container.appendChild(fRow);
    }

    // 2. Render Files
    for (var j = 0; j < files.length; j++) {
      var file = files[j];
      var mRow = el('div', 'files-item-row');

      var mLeft = el('div', 'flex items-start sm:items-center gap-3 min-w-0 flex-1');
      var mIconBox = el('div', 'w-9 h-9 rounded-xl surface-inset flex items-center justify-center shrink-0 mt-0.5 sm:mt-0');
      mIconBox.appendChild(iconEl(getCategoryIconName(file.category), 'w-4 h-4 accent-secondary-text'));
      mLeft.appendChild(mIconBox);

      var mInfo = el('div', 'min-w-0 flex-1');
      mInfo.appendChild(el('div', 'text-xs sm:text-sm font-semibold text-main files-item-name', file.name));

      var mMeta = el('div', 'flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono text-muted mt-0.5');
      mMeta.appendChild(el('span', 'uppercase font-semibold accent-text', '.' + (file.ext || 'file')));
      mMeta.appendChild(el('span', '', '•'));
      mMeta.appendChild(el('span', '', formatBytes(file.size)));
      mMeta.appendChild(el('span', '', '•'));
      mMeta.appendChild(el('span', '', formatDate(file.updatedAt)));

      if (!isTrash && hasSearch) {
        var locName = file.folderId && activeFolderMap[file.folderId] ? activeFolderMap[file.folderId].name : 'Root';
        mMeta.appendChild(el('span', '', '•'));
        mMeta.appendChild(el('span', 'text-sub', 'In: ' + locName));
      } else if (isTrash && file.trashBatchId) {
        mMeta.appendChild(el('span', '', '•'));
        mMeta.appendChild(el('span', 'text-sub', 'Folder batch'));
      }

      mInfo.appendChild(mMeta);
      mLeft.appendChild(mInfo);
      mRow.appendChild(mLeft);

      var mActions = el('div', 'flex flex-wrap items-center gap-1.5 justify-end shrink-0');
      if (!isTrash) {
        mActions.appendChild(makeActionBtn('Download', 'download', 'download-file', 'file', file.id, 'surface-elevated-btn accent-text'));
        mActions.appendChild(makeActionBtn('Rename', 'edit-2', 'rename-file', 'file', file.id));
        mActions.appendChild(makeActionBtn('Move', 'folder-input', 'move-file', 'file', file.id));
        mActions.appendChild(makeActionBtn('Trash', 'trash-2', 'trash-file', 'file', file.id, 'status-warning-btn'));
      } else {
        mActions.appendChild(makeActionBtn('Restore', 'rotate-ccw', 'restore-file', 'file', file.id, 'surface-elevated-btn status-success'));
        mActions.appendChild(makeActionBtn('Delete Forever', 'x-circle', 'purge-file', 'file', file.id, 'status-danger-btn'));
      }
      mRow.appendChild(mActions);
      container.appendChild(mRow);
    }
  }

  // =========================================================================
  // 7. FILE UPLOAD & DOWNLOAD HANDLERS
  // =========================================================================

  function handleFilesSelected(fileList) {
    if (!DB || !fileList || fileList.length === 0) return;

    var count = fileList.length;
    setBusy(true);
    showStatus('info', 'Validating and uploading ' + count + (count === 1 ? ' file...' : ' files...'));

    DB.uploadFiles(fileList, { folderId: uiState.currentFolderId }).then(function (report) {
      var okCount = report.succeeded.length;
      var failCount = report.failed.length;

      if (failCount === 0) {
        showStatus('success', 'Uploaded ' + okCount + (okCount === 1 ? ' file.' : ' files.'));
      } else {
        var lines = [];
        if (okCount > 0) {
          lines.push('Uploaded ' + okCount + ' of ' + report.total + ' files. ' + failCount + ' rejected:');
        } else {
          lines.push('Could not upload ' + failCount + (failCount === 1 ? ' file:' : ' files:'));
        }
        var maxShown = Math.min(failCount, 5);
        for (var i = 0; i < maxShown; i++) {
          var item = report.failed[i];
          lines.push('• ' + item.fileName + ': ' + item.message);
        }
        if (failCount > maxShown) {
          lines.push('• ...and ' + (failCount - maxShown) + ' more.');
        }
        showStatus(okCount > 0 ? 'warning' : 'danger', lines.join('\n'));
      }

      return refresh();
    }).catch(function (err) {
      showStatus('danger', formatErrorMessage(err, 'Upload failed.'));
    }).then(function () {
      setBusy(false);
    });
  }

  function handleDownloadFile(fileId) {
    if (!DB) return;
    var metaMatch = uiState.cachedFiles.find(function (f) { return f.id === fileId; });

    Promise.all([
      metaMatch ? Promise.resolve(metaMatch) : DB.getFileMeta(fileId),
      DB.getFileBlob(fileId)
    ]).then(function (pair) {
      var meta = pair[0];
      var blob = pair[1];
      if (!meta) {
        throw new Error('File metadata not found.');
      }

      var url = global.URL.createObjectURL(blob);
      trackObjectUrl(url);

      var a = document.createElement('a');
      a.href = url;
      a.download = meta.name || 'download';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Update lastOpenedAt non-destructively
      DB.markFileOpened(fileId).catch(function () {
        // Non-fatal metadata update
      });
    }).catch(function (err) {
      showStatus('danger', formatErrorMessage(err, 'Could not download file.'));
    });
  }

  // =========================================================================
  // 8. MODALS: CREATE/RENAME, MOVE DESTINATION & EXPLICIT CONFIRMATION
  // =========================================================================

  function openModalBox(modalId) {
    var modal = byId(modalId);
    if (modal) modal.classList.remove('hidden');
  }

  function closeModalBox(modalId) {
    var modal = byId(modalId);
    if (modal) modal.classList.add('hidden');
  }

  function openNameModal(context) {
    uiState.nameModalContext = context;
    var titleEl = byId('fileNameModalTitle');
    var labelEl = byId('fileNameModalLabel');
    var inputEl = byId('fileNameModalInput');
    var hintEl = byId('fileNameModalHint');
    var errEl = byId('fileNameModalError');
    var submitBtn = byId('fileNameModalSubmitBtn');

    if (errEl) {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    }

    if (context.mode === 'create-folder') {
      if (titleEl) titleEl.textContent = 'New Folder';
      if (labelEl) labelEl.textContent = 'Folder Name';
      if (inputEl) {
        inputEl.value = '';
        inputEl.placeholder = 'e.g. Anatomy Unit 1';
      }
      if (hintEl) hintEl.textContent = 'Creates an active subfolder inside your current location (max 120 characters).';
      if (submitBtn) submitBtn.textContent = 'Create Folder';
    } else if (context.mode === 'rename-folder') {
      if (titleEl) titleEl.textContent = 'Rename Folder';
      if (labelEl) labelEl.textContent = 'New Folder Name';
      if (inputEl) {
        inputEl.value = context.currentName || '';
        inputEl.placeholder = 'Folder name';
      }
      if (hintEl) hintEl.textContent = 'Enter a new name for this folder.';
      if (submitBtn) submitBtn.textContent = 'Save Name';
    } else if (context.mode === 'rename-file') {
      if (titleEl) titleEl.textContent = 'Rename File';
      if (labelEl) labelEl.textContent = 'New File Name';
      if (inputEl) {
        inputEl.value = context.currentName || '';
        inputEl.placeholder = 'File name';
      }
      if (hintEl) {
        hintEl.textContent = 'The original ".' + (context.ext || '') + '" file extension is preserved automatically.';
      }
      if (submitBtn) submitBtn.textContent = 'Save Name';
    }

    openModalBox('fileNameModal');
    if (inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  }

  function submitNameModal() {
    var ctx = uiState.nameModalContext;
    if (!ctx || !DB) return;

    var inputEl = byId('fileNameModalInput');
    var errEl = byId('fileNameModalError');
    var submitBtn = byId('fileNameModalSubmitBtn');
    var rawValue = inputEl ? inputEl.value : '';

    if (submitBtn) submitBtn.disabled = true;
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    }

    var opPromise;
    if (ctx.mode === 'create-folder') {
      opPromise = DB.createFolder({ name: rawValue, parentId: uiState.currentFolderId }).then(function (folder) {
        showStatus('success', 'Created folder "' + folder.name + '".');
      });
    } else if (ctx.mode === 'rename-folder') {
      opPromise = DB.renameFolder(ctx.id, rawValue).then(function (folder) {
        showStatus('success', 'Renamed folder to "' + folder.name + '".');
      });
    } else if (ctx.mode === 'rename-file') {
      opPromise = DB.renameFile(ctx.id, rawValue).then(function (file) {
        showStatus('success', 'Renamed file to "' + file.name + '".');
      });
    } else {
      opPromise = Promise.reject(new Error('Unknown modal action.'));
    }

    opPromise.then(function () {
      uiState.nameModalContext = null;
      closeModalBox('fileNameModal');
      return refresh();
    }).catch(function (err) {
      if (errEl) {
        errEl.textContent = formatErrorMessage(err, 'Invalid name.');
        errEl.classList.remove('hidden');
      }
    }).then(function () {
      if (submitBtn) submitBtn.disabled = false;
    });
  }

  function collectSubtreeIds(rootId, allFolders) {
    var excluded = Object.create(null);
    var queue = [rootId];
    excluded[rootId] = true;

    while (queue.length > 0) {
      var curr = queue.shift();
      for (var i = 0; i < allFolders.length; i++) {
        if (allFolders[i].parentId === curr && !excluded[allFolders[i].id]) {
          excluded[allFolders[i].id] = true;
          queue.push(allFolders[i].id);
        }
      }
    }
    return excluded;
  }

  function buildFullFolderPath(folder, folderMap) {
    var parts = [];
    var visited = Object.create(null);
    var curr = folder;
    while (curr && !visited[curr.id]) {
      visited[curr.id] = true;
      parts.unshift(curr.name);
      curr = curr.parentId ? folderMap[curr.parentId] : null;
    }
    return 'Root / ' + parts.join(' / ');
  }

  function openMoveModal(itemType, itemId) {
    if (!DB) return;

    DB.listFolders().then(function (allFolders) {
      var folderMap = buildFolderLookup(allFolders);
      var itemName = '';
      var currentParentId = null;
      var excludedSet = Object.create(null);

      if (itemType === 'folder') {
        var targetFolder = folderMap[itemId];
        if (!targetFolder) {
          showStatus('danger', 'Folder not found.');
          return;
        }
        itemName = targetFolder.name;
        currentParentId = targetFolder.parentId;
        excludedSet = collectSubtreeIds(itemId, allFolders);
      } else {
        var targetFile = uiState.cachedFiles.find(function (f) { return f.id === itemId; });
        if (!targetFile) {
          showStatus('danger', 'File not found.');
          return;
        }
        itemName = targetFile.name;
        currentParentId = targetFile.folderId;
      }

      var destinations = [
        { id: null, label: 'Root (Top Level)' }
      ];

      var sortedFolders = allFolders.slice().sort(function (a, b) {
        return buildFullFolderPath(a, folderMap).localeCompare(buildFullFolderPath(b, folderMap));
      });

      for (var i = 0; i < sortedFolders.length; i++) {
        var f = sortedFolders[i];
        if (!excludedSet[f.id]) {
          destinations.push({
            id: f.id,
            label: buildFullFolderPath(f, folderMap)
          });
        }
      }

      var defaultSelection = currentParentId !== null ? null : (destinations.length > 1 ? destinations[1].id : null);

      uiState.moveModalContext = {
        itemType: itemType,
        itemId: itemId,
        itemName: itemName,
        currentParentId: currentParentId,
        selectedDestId: defaultSelection
      };

      var titleEl = byId('fileMoveModalTitle');
      var subEl = byId('fileMoveModalSubtitle');
      var errEl = byId('fileMoveModalError');

      if (titleEl) titleEl.textContent = itemType === 'folder' ? 'Move Folder' : 'Move File';
      if (subEl) subEl.textContent = 'Select destination for "' + itemName + '":';
      if (errEl) {
        errEl.textContent = '';
        errEl.classList.add('hidden');
      }

      renderMoveDestinations(destinations);
      openModalBox('fileMoveModal');
      refreshIcons();
    }).catch(function (err) {
      showStatus('danger', formatErrorMessage(err, 'Could not load destination folders.'));
    });
  }

  function renderMoveDestinations(destinations) {
    var listEl = byId('fileMoveDestList');
    var ctx = uiState.moveModalContext;
    if (!listEl || !ctx) return;
    clearNode(listEl);

    for (var i = 0; i < destinations.length; i++) {
      var dest = destinations[i];
      var isCurrent = dest.id === ctx.currentParentId;
      var isSelected = dest.id === ctx.selectedDestId;

      var btn = el('button', 'files-dest-option' + (isSelected ? ' is-selected' : ''));
      btn.type = 'button';
      btn.setAttribute('data-dest-id', dest.id === null ? '' : dest.id);
      if (isCurrent) {
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
      }

      btn.appendChild(iconEl(dest.id === null ? 'hard-drive' : 'folder', 'w-4 h-4 shrink-0 accent-text'));
      var labelSpan = el('span', 'flex-1 min-w-0', dest.label + (isCurrent ? ' (Current)' : ''));
      btn.appendChild(labelSpan);
      listEl.appendChild(btn);
    }
  }

  function submitMoveModal() {
    var ctx = uiState.moveModalContext;
    if (!ctx || !DB) return;

    var errEl = byId('fileMoveModalError');
    var submitBtn = byId('fileMoveModalSubmitBtn');

    if (ctx.selectedDestId === ctx.currentParentId) {
      if (errEl) {
        errEl.textContent = 'Please select a different destination folder.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    if (submitBtn) submitBtn.disabled = true;
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    }

    var movePromise = ctx.itemType === 'folder'
      ? DB.moveFolder(ctx.itemId, ctx.selectedDestId)
      : DB.moveFile(ctx.itemId, ctx.selectedDestId);

    movePromise.then(function () {
      var movedName = ctx.itemName;
      uiState.moveModalContext = null;
      closeModalBox('fileMoveModal');
      showStatus('success', 'Moved "' + movedName + '".');
      return refresh();
    }).catch(function (err) {
      if (errEl) {
        errEl.textContent = formatErrorMessage(err, 'Could not move item.');
        errEl.classList.remove('hidden');
      }
    }).then(function () {
      if (submitBtn) submitBtn.disabled = false;
    });
  }

  function openConfirmModal(context) {
    uiState.confirmModalContext = context;
    var titleTextEl = byId('fileConfirmModalTitleText');
    var msgEl = byId('fileConfirmModalMessage');
    var warnEl = byId('fileConfirmModalWarning');
    var submitBtn = byId('fileConfirmModalSubmitBtn');

    if (titleTextEl) titleTextEl.textContent = context.title || 'Confirm Permanent Deletion';
    if (msgEl) msgEl.textContent = context.message || '';
    if (warnEl) {
      warnEl.textContent = context.warning || 'This permanently deletes the selected data from StudyVaultFilesDB and cannot be undone.';
    }
    if (submitBtn) submitBtn.textContent = context.confirmLabel || 'Delete Permanently';

    openModalBox('fileConfirmModal');
  }

  function submitConfirmModal() {
    var ctx = uiState.confirmModalContext;
    if (!ctx || !DB) return;

    var submitBtn = byId('fileConfirmModalSubmitBtn');
    if (submitBtn) submitBtn.disabled = true;

    var opPromise;
    if (ctx.action === 'purge-file') {
      opPromise = DB.permanentlyDeleteFile(ctx.id).then(function () {
        showStatus('success', 'Permanently deleted "' + ctx.name + '".');
      });
    } else if (ctx.action === 'purge-folder') {
      opPromise = DB.permanentlyDeleteTrashedItems({ folderIds: [ctx.id] }).then(function (res) {
        showStatus(
          'success',
          'Permanently deleted "' + ctx.name + '" (' + res.deletedFolders + ' folder(s), ' + res.deletedFiles + ' file(s)).'
        );
      });
    } else if (ctx.action === 'empty-trash') {
      opPromise = DB.emptyTrash().then(function (res) {
        showStatus(
          'success',
          'Emptied Trash (' + res.deletedFolders + ' folder(s) and ' + res.deletedFiles + ' file(s) permanently deleted).'
        );
      });
    } else {
      opPromise = Promise.reject(new Error('Unknown confirmation action.'));
    }

    opPromise.then(function () {
      uiState.confirmModalContext = null;
      closeModalBox('fileConfirmModal');
      return refresh();
    }).catch(function (err) {
      uiState.confirmModalContext = null;
      closeModalBox('fileConfirmModal');
      showStatus('danger', formatErrorMessage(err, 'Permanent deletion failed.'));
    }).then(function () {
      if (submitBtn) submitBtn.disabled = false;
    });
  }

  // =========================================================================
  // 9. TRASH & RESTORE ACTIONS
  // =========================================================================

  function handleTrashFile(fileId) {
    if (!DB) return;
    DB.trashFile(fileId).then(function (file) {
      showStatus('success', 'Moved "' + file.name + '" to Trash.');
      return refresh();
    }).catch(function (err) {
      showStatus('danger', formatErrorMessage(err, 'Could not move file to Trash.'));
    });
  }

  function handleRestoreFile(fileId) {
    if (!DB) return;
    DB.restoreFile(fileId).then(function (res) {
      var msg = 'Restored "' + res.file.name + '"';
      msg += res.restoredToRoot ? ' to Root (its original folder no longer exists).' : '.';
      showStatus('success', msg);
      return refresh();
    }).catch(function (err) {
      showStatus('danger', formatErrorMessage(err, 'Could not restore file.'));
    });
  }

  function handleTrashFolder(folderId) {
    if (!DB) return;
    DB.trashFolderSubtree(folderId).then(function (res) {
      showStatus(
        'success',
        'Moved folder to Trash (' + res.trashedFolders + ' folder(s) and ' + res.trashedFiles + ' file(s)).'
      );
      return refresh();
    }).catch(function (err) {
      showStatus('danger', formatErrorMessage(err, 'Could not move folder to Trash.'));
    });
  }

  function handleRestoreFolder(folderId) {
    if (!DB) return;
    DB.restoreFolderSubtree(folderId).then(function (res) {
      var msg = 'Restored ' + res.restoredFolders + ' folder(s) and ' + res.restoredFiles + ' file(s)';
      msg += res.restoredToRoot ? ' to Root.' : '.';
      showStatus('success', msg);
      return refresh();
    }).catch(function (err) {
      showStatus('danger', formatErrorMessage(err, 'Could not restore folder.'));
    });
  }

  // =========================================================================
  // 10. SINGLE-BIND EVENT DELEGATION & INITIALIZATION
  // =========================================================================

  function bindEventsOnce() {
    var uploadBtn = byId('filesUploadBtn');
    var uploadInput = byId('filesUploadInput');
    var emptyActionBtn = byId('filesEmptyActionBtn');
    var newFolderBtn = byId('filesNewFolderBtn');
    var viewToggleBtn = byId('filesViewToggleBtn');
    var emptyTrashBtn = byId('filesEmptyTrashBtn');
    var searchInput = byId('filesSearchInput');
    var clearSearchBtn = byId('filesClearSearchBtn');
    var sortBySelect = byId('filesSortBySelect');
    var sortDirBtn = byId('filesSortDirBtn');
    var dismissStatusBtn = byId('filesDismissStatusBtn');
    var protectStorageBtn = byId('filesProtectStorageBtn');
    var healthCheckBtn = byId('filesHealthCheckBtn');
    var breadcrumbs = byId('filesBreadcrumbs');
    var listContainer = byId('filesListContainer');

    if (uploadBtn && uploadInput) {
      uploadBtn.addEventListener('click', function () {
        uploadInput.click();
      });
      uploadInput.addEventListener('change', function () {
        if (uploadInput.files && uploadInput.files.length > 0) {
          var selected = Array.prototype.slice.call(uploadInput.files);
          uploadInput.value = '';
          handleFilesSelected(selected);
        }
      });
    }

    if (emptyActionBtn && uploadInput) {
      emptyActionBtn.addEventListener('click', function () {
        uploadInput.click();
      });
    }

    if (newFolderBtn) {
      newFolderBtn.addEventListener('click', function () {
        openNameModal({ mode: 'create-folder' });
      });
    }

    if (viewToggleBtn) {
      viewToggleBtn.addEventListener('click', function () {
        uiState.viewMode = uiState.viewMode === 'trash' ? 'library' : 'trash';
        hideStatus();
        refresh();
      });
    }

    if (emptyTrashBtn) {
      emptyTrashBtn.addEventListener('click', function () {
        openConfirmModal({
          action: 'empty-trash',
          title: 'Empty Trash Permanently',
          message: 'Permanently delete ALL folders and files currently in Trash?',
          warning: 'Every trashed folder, file metadata record, and binary file payload in StudyVaultFilesDB will be permanently erased. Active files are untouched.',
          confirmLabel: 'Empty Trash'
        });
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        uiState.searchQuery = searchInput.value || '';
        if (clearSearchBtn) {
          clearSearchBtn.classList.toggle('hidden', uiState.searchQuery.length === 0);
        }
        if (searchDebounceTimer) global.clearTimeout(searchDebounceTimer);
        searchDebounceTimer = global.setTimeout(function () {
          refresh();
        }, 160);
      });
    }

    if (clearSearchBtn && searchInput) {
      clearSearchBtn.addEventListener('click', function () {
        searchInput.value = '';
        uiState.searchQuery = '';
        clearSearchBtn.classList.add('hidden');
        refresh();
      });
    }

    if (sortBySelect) {
      sortBySelect.addEventListener('change', function () {
        uiState.sortBy = sortBySelect.value || 'updatedAt';
        persistSortPrefs();
        refresh();
      });
    }

    if (sortDirBtn) {
      sortDirBtn.addEventListener('click', function () {
        uiState.sortDir = uiState.sortDir === 'asc' ? 'desc' : 'asc';
        syncSortControls();
        refreshIcons();
        persistSortPrefs();
        refresh();
      });
    }

    if (dismissStatusBtn) {
      dismissStatusBtn.addEventListener('click', hideStatus);
    }

    if (protectStorageBtn) {
      protectStorageBtn.addEventListener('click', handleRequestProtection);
    }

    if (healthCheckBtn) {
      healthCheckBtn.addEventListener('click', handleHealthCheck);
    }

    // Breadcrumb event delegation
    if (breadcrumbs) {
      breadcrumbs.addEventListener('click', function (event) {
        var btn = event.target.closest('button[data-action]');
        if (!btn) return;
        var action = btn.getAttribute('data-action');
        if (action === 'exit-trash') {
          uiState.viewMode = 'library';
          hideStatus();
          refresh();
        } else if (action === 'nav-folder') {
          var rawId = btn.getAttribute('data-folder-id');
          uiState.currentFolderId = rawId ? rawId : null;
          uiState.searchQuery = '';
          if (searchInput) searchInput.value = '';
          if (clearSearchBtn) clearSearchBtn.classList.add('hidden');
          hideStatus();
          refresh();
        }
      });
    }

    // List item action delegation
    if (listContainer) {
      listContainer.addEventListener('click', function (event) {
        var btn = event.target.closest('button[data-action]');
        if (!btn) return;
        var action = btn.getAttribute('data-action');
        var itemId = btn.getAttribute('data-item-id') || btn.getAttribute('data-folder-id');
        if (!itemId) return;

        if (action === 'open-folder') {
          uiState.currentFolderId = itemId;
          uiState.searchQuery = '';
          if (searchInput) searchInput.value = '';
          if (clearSearchBtn) clearSearchBtn.classList.add('hidden');
          hideStatus();
          refresh();
        } else if (action === 'rename-folder') {
          var folderObj = uiState.cachedFolders.find(function (f) { return f.id === itemId; });
          if (folderObj) {
            openNameModal({ mode: 'rename-folder', id: folderObj.id, currentName: folderObj.name });
          }
        } else if (action === 'move-folder') {
          openMoveModal('folder', itemId);
        } else if (action === 'trash-folder') {
          handleTrashFolder(itemId);
        } else if (action === 'restore-folder') {
          handleRestoreFolder(itemId);
        } else if (action === 'purge-folder') {
          var trashedFolder = uiState.cachedFolders.find(function (f) { return f.id === itemId; });
          var fName = trashedFolder ? trashedFolder.name : 'this folder';
          openConfirmModal({
            action: 'purge-folder',
            id: itemId,
            name: fName,
            title: 'Delete Folder Permanently',
            message: 'Permanently delete trashed folder "' + fName + '" and its trashed contents?',
            warning: 'This permanently erases the folder and its trashed files from browser storage and cannot be undone.',
            confirmLabel: 'Delete Permanently'
          });
        } else if (action === 'download-file') {
          handleDownloadFile(itemId);
        } else if (action === 'rename-file') {
          var fileObj = uiState.cachedFiles.find(function (f) { return f.id === itemId; });
          if (fileObj) {
            openNameModal({ mode: 'rename-file', id: fileObj.id, currentName: fileObj.name, ext: fileObj.ext });
          }
        } else if (action === 'move-file') {
          openMoveModal('file', itemId);
        } else if (action === 'trash-file') {
          handleTrashFile(itemId);
        } else if (action === 'restore-file') {
          handleRestoreFile(itemId);
        } else if (action === 'purge-file') {
          var trashedFile = uiState.cachedFiles.find(function (f) { return f.id === itemId; });
          var mName = trashedFile ? trashedFile.name : 'this file';
          openConfirmModal({
            action: 'purge-file',
            id: itemId,
            name: mName,
            title: 'Delete File Permanently',
            message: 'Permanently delete "' + mName + '"?',
            warning: 'Both the file record and its stored file data will be permanently erased and cannot be undone.',
            confirmLabel: 'Delete Permanently'
          });
        }
      });
    }

    // Name Modal controls
    var nameCloseBtn = byId('fileNameModalCloseBtn');
    var nameCancelBtn = byId('fileNameModalCancelBtn');
    var nameSubmitBtn = byId('fileNameModalSubmitBtn');
    var nameInput = byId('fileNameModalInput');

    if (nameCloseBtn) nameCloseBtn.addEventListener('click', function () { closeModalBox('fileNameModal'); });
    if (nameCancelBtn) nameCancelBtn.addEventListener('click', function () { closeModalBox('fileNameModal'); });
    if (nameSubmitBtn) nameSubmitBtn.addEventListener('click', submitNameModal);
    if (nameInput) {
      nameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitNameModal();
        }
      });
    }

    // Move Modal controls
    var moveCloseBtn = byId('fileMoveModalCloseBtn');
    var moveCancelBtn = byId('fileMoveModalCancelBtn');
    var moveSubmitBtn = byId('fileMoveModalSubmitBtn');
    var moveDestList = byId('fileMoveDestList');

    if (moveCloseBtn) moveCloseBtn.addEventListener('click', function () { closeModalBox('fileMoveModal'); });
    if (moveCancelBtn) moveCancelBtn.addEventListener('click', function () { closeModalBox('fileMoveModal'); });
    if (moveSubmitBtn) moveSubmitBtn.addEventListener('click', submitMoveModal);
    if (moveDestList) {
      moveDestList.addEventListener('click', function (event) {
        var opt = event.target.closest('button[data-dest-id]');
        if (!opt || opt.disabled || !uiState.moveModalContext) return;
        var rawDest = opt.getAttribute('data-dest-id');
        uiState.moveModalContext.selectedDestId = rawDest ? rawDest : null;
        var allOpts = moveDestList.querySelectorAll('button[data-dest-id]');
        for (var i = 0; i < allOpts.length; i++) {
          allOpts[i].classList.toggle('is-selected', allOpts[i] === opt);
        }
      });
    }

    // Confirm Modal controls
    var confirmCloseBtn = byId('fileConfirmModalCloseBtn');
    var confirmCancelBtn = byId('fileConfirmModalCancelBtn');
    var confirmSubmitBtn = byId('fileConfirmModalSubmitBtn');

    if (confirmCloseBtn) confirmCloseBtn.addEventListener('click', function () { closeModalBox('fileConfirmModal'); });
    if (confirmCancelBtn) confirmCancelBtn.addEventListener('click', function () { closeModalBox('fileConfirmModal'); });
    if (confirmSubmitBtn) confirmSubmitBtn.addEventListener('click', submitConfirmModal);

    // Revoke any remaining temporary ObjectURLs on page unload
    global.addEventListener('pagehide', revokeAllObjectUrls);
    global.addEventListener('beforeunload', revokeAllObjectUrls);
  }

  function init() {
    if (uiState.initialized) return;
    uiState.initialized = true;
    bindEventsOnce();
    syncSortControls();
  }

  function onTabActivated() {
    if (!uiState.initialized) {
      init();
    }

    if (!DB) {
      showStatus('danger', 'File storage engine (js/files-db.js) failed to load.');
      return;
    }

    if (!uiState.prefsLoaded) {
      uiState.prefsLoaded = true;
      DB.getSetting('uiSortPrefs', null).then(function (prefs) {
        if (prefs && typeof prefs === 'object') {
          var allowedSort = ['updatedAt', 'createdAt', 'name', 'size', 'type'];
          if (allowedSort.indexOf(prefs.sortBy) !== -1) uiState.sortBy = prefs.sortBy;
          if (prefs.sortDir === 'asc' || prefs.sortDir === 'desc') uiState.sortDir = prefs.sortDir;
          syncSortControls();
        }
      }).catch(function () {
        // Ignore preference read error on first load
      }).then(function () {
        refresh();
      });
    } else {
      refresh();
    }
  }

  // =========================================================================
  // 11. PUBLIC FROZEN API
  // =========================================================================

  global.StudyVaultFilesUI = Object.freeze({
    init: init,
    onTabActivated: onTabActivated,
    refresh: refresh
  });
})(window);
