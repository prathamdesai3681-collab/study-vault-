/* ==========================================================================
   GARAGE'S STUDY VAULT v4.1 — STAGE 1: StudyVaultFilesDB ENGINE
   File: js/files-db.js
   Isolated local-first IndexedDB storage, validation, and integrity engine.
   Zero external dependencies. Zero default/dummy records.
   Classic-script IIFE exposing window.StudyVaultFilesDB.
   ========================================================================== */

(function (global) {
  'use strict';

  if (global.StudyVaultFilesDB) {
    console.warn('[StudyVaultFilesDB] Already initialized; skipping duplicate load.');
    return;
  }

  // =========================================================================
  // 1. CONSTANTS & CONFIGURATION
  // =========================================================================

  var DB_NAME = 'StudyVaultFilesDB';
  var DB_VERSION = 1;

  var STORES = Object.freeze({
    FOLDERS: 'folders',
    FILES_META: 'filesMeta',
    FILE_BLOBS: 'fileBlobs',
    FILE_SETTINGS: 'fileSettings'
  });

  // Conservative per-file size ceilings (bytes).
  // Actual usable capacity depends on device RAM, OS limits, and browser quota.
  var SIZE_LIMITS = Object.freeze({
    pdf: 50 * 1024 * 1024,    // 50 MB
    image: 20 * 1024 * 1024,  // 20 MB
    text: 5 * 1024 * 1024,    // 5 MB
    office: 30 * 1024 * 1024  // 30 MB
  });

  var MAX_NAME_LENGTH = 120;
  var TEXT_SAMPLE_BYTES = 8192;
  var ZIP_EOCD_WINDOW = 65557;
  var ZIP_MAX_CD_INSPECT = 2 * 1024 * 1024;

  var BLOCKED_EXTENSIONS = Object.freeze([
    'html', 'htm', 'xhtml', 'svg', 'svgz',
    'js', 'mjs', 'cjs', 'ts',
    'exe', 'dll', 'msi', 'apk', 'dmg', 'app',
    'bat', 'cmd', 'sh', 'ps1', 'vbs', 'jar',
    'docm', 'xlsm', 'pptm'
  ]);

  var ALLOWED_FORMATS = Object.freeze({
    pdf:  { category: 'pdf',    mimeType: 'application/pdf' },
    png:  { category: 'image',  mimeType: 'image/png' },
    jpg:  { category: 'image',  mimeType: 'image/jpeg' },
    jpeg: { category: 'image',  mimeType: 'image/jpeg' },
    webp: { category: 'image',  mimeType: 'image/webp' },
    gif:  { category: 'image',  mimeType: 'image/gif' },
    txt:  { category: 'text',   mimeType: 'text/plain' },
    md:   { category: 'text',   mimeType: 'text/markdown' },
    csv:  { category: 'text',   mimeType: 'text/csv' },
    json: { category: 'text',   mimeType: 'application/json' },
    docx: { category: 'office', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ooxmlPrefix: 'word/' },
    pptx: { category: 'office', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ooxmlPrefix: 'ppt/' },
    xlsx: { category: 'office', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ooxmlPrefix: 'xl/' }
  });

  // =========================================================================
  // 2. STRUCTURED ERRORS & INPUT HELPERS
  // =========================================================================

  function createVaultError(code, message, details) {
    var err = new Error(message);
    err.name = 'FileVaultError';
    err.code = code;
    if (details !== undefined) {
      err.details = details;
    }
    return err;
  }

  function isQuotaError(err) {
    if (!err) return false;
    return err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014;
  }

  function generateId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      var bytes = new Uint8Array(16);
      global.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      var hex = Array.from(bytes, function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
      return (
        hex.slice(0, 8) + '-' +
        hex.slice(8, 12) + '-' +
        hex.slice(12, 16) + '-' +
        hex.slice(16, 20) + '-' +
        hex.slice(20)
      );
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function assertNonEmptyId(id, label) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw createVaultError('INVALID_ID', (label || 'ID') + ' must be a non-empty string.');
    }
    return id.trim();
  }

  function assertNullableId(id, label) {
    if (id === null || id === undefined || id === '') {
      return null;
    }
    return assertNonEmptyId(id, label);
  }

  function sanitizeName(rawName, isFile) {
    if (typeof rawName !== 'string') {
      throw createVaultError('INVALID_NAME', 'Name must be a string.');
    }
    // Strip ASCII control characters, Unicode bidi override/isolate controls, and path separators
    var cleaned = rawName
      .replace(/[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/[\/\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned || cleaned === '.' || cleaned === '..') {
      throw createVaultError('INVALID_NAME', 'Name cannot be empty or reserved ("." or "..").');
    }

    if (cleaned.length > MAX_NAME_LENGTH) {
      if (isFile) {
        var lastDot = cleaned.lastIndexOf('.');
        if (lastDot > 0 && lastDot < cleaned.length - 1) {
          var extPart = cleaned.slice(lastDot);
          var baseLimit = Math.max(1, MAX_NAME_LENGTH - extPart.length);
          cleaned = cleaned.slice(0, baseLimit).trim() + extPart;
        } else {
          cleaned = cleaned.slice(0, MAX_NAME_LENGTH).trim();
        }
      } else {
        cleaned = cleaned.slice(0, MAX_NAME_LENGTH).trim();
      }
    }

    return cleaned;
  }

  function extractExtension(fileName) {
    var lastDot = fileName.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === fileName.length - 1) {
      return '';
    }
    return fileName.slice(lastDot + 1).toLowerCase();
  }

  // =========================================================================
  // 3. DATABASE CONNECTION & TRANSACTION ENGINE (StudyVaultFilesDB v1)
  // =========================================================================

  var dbConnection = null;
  var openPromise = null;

  function initDB() {
    if (dbConnection) {
      return Promise.resolve(dbConnection);
    }
    if (openPromise) {
      return openPromise;
    }

    if (!global.indexedDB) {
      return Promise.reject(
        createVaultError('IDB_UNSUPPORTED', 'IndexedDB is not supported in this browser.')
      );
    }

    openPromise = new Promise(function (resolve, reject) {
      var settled = false;
      var req;

      try {
        req = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        openPromise = null;
        reject(createVaultError('DB_OPEN_FAILED', 'Failed to open ' + DB_NAME + '.', err));
        return;
      }

      req.onupgradeneeded = function (event) {
        var db = event.target.result;

        if (!db.objectStoreNames.contains(STORES.FOLDERS)) {
          var folderStore = db.createObjectStore(STORES.FOLDERS, { keyPath: 'id' });
          folderStore.createIndex('by_parentId', 'parentId', { unique: false });
          folderStore.createIndex('by_deletedAt', 'deletedAt', { unique: false });
          folderStore.createIndex('by_name', 'nameLower', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.FILES_META)) {
          var metaStore = db.createObjectStore(STORES.FILES_META, { keyPath: 'id' });
          metaStore.createIndex('by_folderId', 'folderId', { unique: false });
          metaStore.createIndex('by_deletedAt', 'deletedAt', { unique: false });
          metaStore.createIndex('by_updatedAt', 'updatedAt', { unique: false });
          metaStore.createIndex('by_name', 'nameLower', { unique: false });
          metaStore.createIndex('by_mimeType', 'mimeType', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.FILE_BLOBS)) {
          db.createObjectStore(STORES.FILE_BLOBS, { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains(STORES.FILE_SETTINGS)) {
          db.createObjectStore(STORES.FILE_SETTINGS, { keyPath: 'key' });
        }
      };

      req.onblocked = function () {
        if (!settled) {
          settled = true;
          openPromise = null;
          reject(
            createVaultError(
              'DB_BLOCKED',
              'Database upgrade is blocked by another open tab of Study Vault. Close other tabs and retry.'
            )
          );
        }
      };

      req.onerror = function () {
        if (!settled) {
          settled = true;
          openPromise = null;
          reject(
            createVaultError(
              'DB_OPEN_FAILED',
              'Could not open ' + DB_NAME + ': ' + (req.error ? req.error.message : 'Unknown error'),
              req.error || null
            )
          );
        }
      };

      req.onsuccess = function (event) {
        var db = event.target.result;

        // If this request already settled (e.g. rejected via onblocked), close the late handle
        // instead of overwriting the active connection state.
        if (settled) {
          try {
            db.close();
          } catch (e) {
            // Ignore close errors
          }
          return;
        }

        db.onversionchange = function () {
          db.close();
          if (dbConnection === db) dbConnection = null;
          openPromise = null;
        };

        db.onclose = function () {
          if (dbConnection === db) dbConnection = null;
          openPromise = null;
        };

        dbConnection = db;
        openPromise = null;
        settled = true;
        resolve(db);
      };
    });

    return openPromise;
  }

  function closeDB() {
    if (dbConnection) {
      try {
        dbConnection.close();
      } catch (e) {
        // Ignore close errors
      }
      dbConnection = null;
    }
    openPromise = null;
  }

  // Runs workFn inside a single IndexedDB transaction.
  // Callers must NEVER await non-IDB Promises inside workFn (prevents auto-commit).
  function runTransaction(storeNames, mode, workFn) {
    return initDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try {
          tx = db.transaction(storeNames, mode);
        } catch (err) {
          // Clear stale connection on InvalidStateError so a later call can reopen cleanly
          if (err && err.name === 'InvalidStateError') {
            if (dbConnection === db) dbConnection = null;
            openPromise = null;
          }
          reject(createVaultError('TX_FAILED', 'Failed to start transaction.', err));
          return;
        }

        var resultValue;
        var customError = null;
        var capturedRequestError = null;
        var settled = false;

        function resolveOnce(val) {
          if (settled) return;
          settled = true;
          resolve(val);
        }

        function failOnce(err) {
          if (settled) return;
          settled = true;
          reject(err);
        }

        tx.oncomplete = function () {
          resolveOnce(resultValue);
        };

        tx.onerror = function (event) {
          // Capture the originating request error without settling prematurely;
          // IndexedDB aborts the transaction next and fires tx.onabort after rollback.
          if (event && event.target && event.target.error) {
            capturedRequestError = event.target.error;
          } else if (tx.error) {
            capturedRequestError = tx.error;
          }
        };

        tx.onabort = function () {
          if (customError) {
            failOnce(customError);
            return;
          }

          var effectiveErr = isQuotaError(tx.error)
            ? tx.error
            : (capturedRequestError || tx.error);

          if (isQuotaError(effectiveErr)) {
            failOnce(
              createVaultError(
                'QUOTA_EXCEEDED',
                'Browser storage quota exceeded. Free up space or export and remove large files.',
                effectiveErr
              )
            );
            return;
          }

          failOnce(
            createVaultError(
              'TX_ABORTED',
              'Transaction aborted: ' + (effectiveErr && effectiveErr.message ? effectiveErr.message : 'Operation rolled back.'),
              effectiveErr || null
            )
          );
        };

        function abortWith(err) {
          customError = err;
          try {
            tx.abort();
          } catch (e) {
            failOnce(err);
          }
        }

        try {
          workFn(
            tx,
            function setResult(val) { resultValue = val; },
            abortWith
          );
        } catch (syncErr) {
          abortWith(
            syncErr && syncErr.name === 'FileVaultError'
              ? syncErr
              : createVaultError('TX_FAILED', syncErr ? syncErr.message : 'Transaction error.', syncErr)
          );
        }
      });
    });
  }

  // =========================================================================
  // 4. UPLOAD VALIDATION (BINARY, PLAIN TEXT, ZIP-BASED OFFICE)
  // =========================================================================

  function readBlobSliceBytes(blob, start, end) {
    var slice = blob.slice(start, end);
    if (typeof slice.arrayBuffer === 'function') {
      return slice.arrayBuffer().then(function (buf) {
        return new Uint8Array(buf);
      });
    }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(new Uint8Array(reader.result)); };
      reader.onerror = function () { reject(createVaultError('INVALID_INPUT', 'Failed to read file bytes.')); };
      reader.readAsArrayBuffer(slice);
    });
  }

  function hasBytesAt(bytes, offset, expected) {
    if (bytes.length < offset + expected.length) return false;
    for (var i = 0; i < expected.length; i++) {
      if (bytes[offset + i] !== expected[i]) return false;
    }
    return true;
  }

  function validateBinarySignature(ext, bytes) {
    switch (ext) {
      case 'pdf':
        return hasBytesAt(bytes, 0, [0x25, 0x50, 0x44, 0x46, 0x2d]);
      case 'png':
        return hasBytesAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      case 'jpg':
      case 'jpeg':
        return hasBytesAt(bytes, 0, [0xff, 0xd8, 0xff]);
      case 'gif':
        return (
          hasBytesAt(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
          hasBytesAt(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
        );
      case 'webp':
        return (
          hasBytesAt(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
          hasBytesAt(bytes, 8, [0x57, 0x45, 0x42, 0x50])
        );
      default:
        return false;
    }
  }

  function trimTruncatedUtf8Tail(bytes, isPartialSample) {
    if (!isPartialSample || bytes.length === 0) return bytes;
    var len = bytes.length;
    var checkCount = Math.min(3, len);
    for (var back = 1; back <= checkCount; back++) {
      var b = bytes[len - back];
      if ((b & 0x80) === 0) return bytes;
      if ((b & 0xc0) === 0xc0) {
        var expectedLen =
          (b & 0xe0) === 0xc0 ? 2 :
          (b & 0xf0) === 0xe0 ? 3 :
          (b & 0xf8) === 0xf0 ? 4 : 1;
        if (back < expectedLen) {
          return bytes.subarray(0, len - back);
        }
        return bytes;
      }
    }
    return bytes;
  }

  function validatePlainTextSample(blob) {
    if (blob.size === 0) {
      return Promise.resolve({ ok: true });
    }
    var sampleEnd = Math.min(blob.size, TEXT_SAMPLE_BYTES);
    var isPartial = blob.size > sampleEnd;

    return readBlobSliceBytes(blob, 0, sampleEnd).then(function (bytes) {
      for (var i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0x00) {
          throw createVaultError(
            'INVALID_TEXT_ENCODING',
            'Plain-text file contains binary null bytes and was rejected.'
          );
        }
      }

      var safeBytes = trimTruncatedUtf8Tail(bytes, isPartial);
      if (typeof TextDecoder !== 'undefined') {
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(safeBytes);
        } catch (err) {
          throw createVaultError(
            'INVALID_TEXT_ENCODING',
            'Plain-text file is not valid UTF-8 text.'
          );
        }
      }
      return { ok: true };
    });
  }

  function validateOoxmlStructure(blob, expectedPrefix) {
    return readBlobSliceBytes(blob, 0, 4).then(function (header) {
      if (!hasBytesAt(header, 0, [0x50, 0x4b, 0x03, 0x04])) {
        throw createVaultError(
          'SIGNATURE_MISMATCH',
          'File does not have a valid ZIP/Office header signature.'
        );
      }

      var tailStart = Math.max(0, blob.size - ZIP_EOCD_WINDOW);
      return readBlobSliceBytes(blob, tailStart, blob.size).then(function (tail) {
        if (tail.length < 22) {
          throw createVaultError('INVALID_OOXML', 'Office archive is truncated or malformed.');
        }

        var tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
        var eocdOffset = -1;
        for (var pos = tail.length - 22; pos >= 0; pos--) {
          if (
            tail[pos] === 0x50 &&
            tail[pos + 1] === 0x4b &&
            tail[pos + 2] === 0x05 &&
            tail[pos + 3] === 0x06
          ) {
            var commentLen = tailView.getUint16(pos + 20, true);
            if (pos + 22 + commentLen === tail.length) {
              eocdOffset = pos;
              break;
            }
          }
        }

        if (eocdOffset === -1) {
          throw createVaultError(
            'INVALID_OOXML',
            'Could not locate ZIP directory record; Office file may be corrupted.'
          );
        }

        var absoluteEocdOffset = tailStart + eocdOffset;
        var cdSize = tailView.getUint32(eocdOffset + 12, true);
        var cdOffset = tailView.getUint32(eocdOffset + 16, true);

        if (cdSize === 0xffffffff || cdOffset === 0xffffffff) {
          throw createVaultError(
            'INVALID_OOXML',
            'ZIP64 Office archives are not supported for browser inspection.'
          );
        }

        if (
          cdSize === 0 ||
          cdSize > ZIP_MAX_CD_INSPECT ||
          cdOffset + cdSize > absoluteEocdOffset ||
          cdOffset + cdSize > blob.size
        ) {
          throw createVaultError(
            'INVALID_OOXML',
            'Office archive directory is invalid or exceeds safe inspection bounds.'
          );
        }

        return readBlobSliceBytes(blob, cdOffset, cdOffset + cdSize).then(function (cdBytes) {
          if (cdBytes.length !== cdSize) {
            throw createVaultError(
              'INVALID_OOXML',
              'Office archive Central Directory could not be read completely.'
            );
          }

          var cdView = new DataView(cdBytes.buffer, cdBytes.byteOffset, cdBytes.byteLength);
          var decoder = typeof TextDecoder !== 'undefined'
            ? new TextDecoder('utf-8', { fatal: false })
            : null;

          var cursor = 0;
          var entryCount = 0;
          var hasContentTypes = false;
          var hasExpectedPrefix = false;
          var hasMacroBinary = false;

          while (cursor < cdBytes.length) {
            if (cursor + 46 > cdBytes.length) {
              throw createVaultError(
                'INVALID_OOXML',
                'Office archive Central Directory is truncated.'
              );
            }

            if (
              cdBytes[cursor] !== 0x50 ||
              cdBytes[cursor + 1] !== 0x4b ||
              cdBytes[cursor + 2] !== 0x01 ||
              cdBytes[cursor + 3] !== 0x02
            ) {
              throw createVaultError(
                'INVALID_OOXML',
                'Office archive contains an unexpected Central Directory signature.'
              );
            }

            var nameLen = cdView.getUint16(cursor + 28, true);
            var extraLen = cdView.getUint16(cursor + 30, true);
            var commentLen = cdView.getUint16(cursor + 32, true);
            var nameStart = cursor + 46;
            var nameEnd = nameStart + nameLen;
            var nextCursor = nameEnd + extraLen + commentLen;

            if (nameEnd > cdBytes.length || nextCursor > cdBytes.length) {
              throw createVaultError(
                'INVALID_OOXML',
                'Office archive Central Directory entry exceeds valid bounds.'
              );
            }

            var entryName = '';
            if (decoder) {
              entryName = decoder.decode(cdBytes.subarray(nameStart, nameEnd));
            } else {
              for (var k = nameStart; k < nameEnd; k++) {
                entryName += String.fromCharCode(cdBytes[k]);
              }
            }

            var normalizedEntry = entryName.replace(/\\/g, '/').toLowerCase();
            if (normalizedEntry === '[content_types].xml') {
              hasContentTypes = true;
            }
            if (normalizedEntry.indexOf(expectedPrefix) === 0) {
              hasExpectedPrefix = true;
            }
            if (normalizedEntry.indexOf('vbaproject.bin') !== -1) {
              hasMacroBinary = true;
            }

            entryCount++;
            cursor = nextCursor;
          }

          if (entryCount === 0 || cursor !== cdBytes.length) {
            throw createVaultError(
              'INVALID_OOXML',
              'Office archive Central Directory parsing did not complete at the expected boundary.'
            );
          }

          if (hasMacroBinary) {
            throw createVaultError(
              'MACRO_CONTENT_DETECTED',
              'Macro-enabled Office files (vbaProject.bin) are blocked.'
            );
          }

          if (!hasContentTypes || !hasExpectedPrefix) {
            throw createVaultError(
              'INVALID_OOXML',
              'File does not contain expected Office document structure (' + expectedPrefix + ' and [Content_Types].xml).'
            );
          }

          return { ok: true };
        });
      });
    });
  }

  function validateFileForUpload(file, customName) {
    return Promise.resolve().then(function () {
      if (!file || typeof file.size !== 'number' || typeof file.slice !== 'function') {
        throw createVaultError('INVALID_INPUT', 'A valid File or Blob object is required.');
      }

      var rawName = typeof customName === 'string' && customName.trim()
        ? customName
        : (typeof file.name === 'string' ? file.name : '');

      var safeName = sanitizeName(rawName, true);
      var ext = extractExtension(safeName);

      if (!ext) {
        throw createVaultError('UNSUPPORTED_FILE_TYPE', 'Files must include a supported file extension.');
      }

      if (BLOCKED_EXTENSIONS.indexOf(ext) !== -1) {
        throw createVaultError(
          'BLOCKED_FILE_TYPE',
          'File type ".' + ext + '" is blocked for security reasons.'
        );
      }

      var format = ALLOWED_FORMATS[ext];
      if (!format) {
        throw createVaultError(
          'UNSUPPORTED_FILE_TYPE',
          'File type ".' + ext + '" is not supported by Study Vault.'
        );
      }

      var maxBytes = SIZE_LIMITS[format.category];
      if (file.size > maxBytes) {
        throw createVaultError(
          'FILE_TOO_LARGE',
          'File exceeds the ' + Math.round(maxBytes / (1024 * 1024)) + ' MB limit for ' + format.category + ' files.',
          { maxBytes: maxBytes, actualBytes: file.size }
        );
      }

      if (format.category !== 'text' && file.size === 0) {
        throw createVaultError('EMPTY_FILE', 'Empty binary or Office files cannot be stored.');
      }

      var checkPromise;
      if (format.category === 'pdf' || format.category === 'image') {
        checkPromise = readBlobSliceBytes(file, 0, Math.min(12, file.size)).then(function (header) {
          if (!validateBinarySignature(ext, header)) {
            throw createVaultError(
              'SIGNATURE_MISMATCH',
              'File header bytes do not match expected ".' + ext + '" format.'
            );
          }
          return { ok: true };
        });
      } else if (format.category === 'text') {
        checkPromise = validatePlainTextSample(file);
      } else if (format.category === 'office') {
        checkPromise = validateOoxmlStructure(file, format.ooxmlPrefix);
      } else {
        checkPromise = Promise.reject(
          createVaultError('UNSUPPORTED_FILE_TYPE', 'Unsupported file category.')
        );
      }

      return checkPromise.then(function () {
        return {
          valid: true,
          safeName: safeName,
          ext: ext,
          category: format.category,
          mimeType: format.mimeType,
          size: file.size
        };
      });
    });
  }

  // =========================================================================
  // 5. HIERARCHY & SUBTREE HELPERS (PURE SYNCHRONOUS)
  // =========================================================================

  function buildFolderMap(folders) {
    var map = Object.create(null);
    for (var i = 0; i < folders.length; i++) {
      map[folders[i].id] = folders[i];
    }
    return map;
  }

  function wouldCreateCycle(folderId, targetParentId, folderMap) {
    if (targetParentId === null) return false;
    if (targetParentId === folderId) return true;

    var visited = Object.create(null);
    visited[folderId] = true;
    var current = targetParentId;

    while (current !== null && current !== undefined) {
      if (visited[current]) return true;
      visited[current] = true;
      var node = folderMap[current];
      if (!node) break;
      current = node.parentId;
    }
    return false;
  }

  function collectDescendantFolderIds(rootFolderId, folders, predicateFn) {
    var childrenByParent = Object.create(null);
    for (var i = 0; i < folders.length; i++) {
      var f = folders[i];
      if (predicateFn && !predicateFn(f)) continue;
      var pKey = f.parentId === null ? '__ROOT__' : f.parentId;
      if (!childrenByParent[pKey]) childrenByParent[pKey] = [];
      childrenByParent[pKey].push(f.id);
    }

    var visited = Object.create(null);
    var result = [];
    var queue = [rootFolderId];
    visited[rootFolderId] = true;

    while (queue.length > 0) {
      var currentId = queue.shift();
      result.push(currentId);
      var kids = childrenByParent[currentId];
      if (kids) {
        for (var j = 0; j < kids.length; j++) {
          if (!visited[kids[j]]) {
            visited[kids[j]] = true;
            queue.push(kids[j]);
          }
        }
      }
    }
    return result;
  }

  // =========================================================================
  // 6. FOLDER CRUD & NESTED SUBTREE OPERATIONS
  // =========================================================================

  function createFolder(options) {
    var opts = options || {};
    var safeName;
    var parentId;

    try {
      safeName = sanitizeName(opts.name, false);
      parentId = assertNullableId(opts.parentId, 'parentId');
    } catch (err) {
      return Promise.reject(err);
    }

    var now = Date.now();
    var record = {
      id: generateId(),
      name: safeName,
      nameLower: safeName.toLowerCase(),
      parentId: parentId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };

    return runTransaction([STORES.FOLDERS], 'readwrite', function (tx, setResult, abortWith) {
      var store = tx.objectStore(STORES.FOLDERS);

      function insertFolder() {
        store.put(record);
        setResult(record);
      }

      if (parentId === null) {
        insertFolder();
        return;
      }

      var parentReq = store.get(parentId);
      parentReq.onsuccess = function () {
        var parent = parentReq.result;
        if (!parent || parent.deletedAt !== null) {
          abortWith(
            createVaultError('INVALID_PARENT', 'Target parent folder does not exist or is in Trash.')
          );
          return;
        }
        insertFolder();
      };
    });
  }

  function renameFolder(folderId, newName) {
    var cleanId;
    var safeName;
    try {
      cleanId = assertNonEmptyId(folderId, 'folderId');
      safeName = sanitizeName(newName, false);
    } catch (err) {
      return Promise.reject(err);
    }

    return runTransaction([STORES.FOLDERS], 'readwrite', function (tx, setResult, abortWith) {
      var store = tx.objectStore(STORES.FOLDERS);
      var getReq = store.get(cleanId);
      getReq.onsuccess = function () {
        var folder = getReq.result;
        if (!folder) {
          abortWith(createVaultError('NOT_FOUND', 'Folder not found.'));
          return;
        }
        if (folder.deletedAt !== null) {
          abortWith(createVaultError('ALREADY_TRASHED', 'Cannot rename a trashed folder. Restore it first.'));
          return;
        }
        folder.name = safeName;
        folder.nameLower = safeName.toLowerCase();
        folder.updatedAt = Date.now();
        store.put(folder);
        setResult(folder);
      };
    });
  }

  function listFolders(options) {
    var opts = options || {};
    var includeTrashed = Boolean(opts.includeTrashed);
    var onlyTrashed = Boolean(opts.onlyTrashed);
    var filterByParent = Object.prototype.hasOwnProperty.call(opts, 'parentId');
    var targetParentId = null;

    try {
      if (filterByParent) {
        targetParentId = assertNullableId(opts.parentId, 'parentId');
      }
    } catch (err) {
      return Promise.reject(err);
    }

    return runTransaction([STORES.FOLDERS], 'readonly', function (tx, setResult) {
      var req = tx.objectStore(STORES.FOLDERS).getAll();
      req.onsuccess = function () {
        var all = req.result || [];
        var filtered = all.filter(function (f) {
          var isTrashed = f.deletedAt !== null;
          if (onlyTrashed && !isTrashed) return false;
          if (!onlyTrashed && !includeTrashed && isTrashed) return false;
          if (filterByParent && f.parentId !== targetParentId) return false;
          return true;
        });

        filtered.sort(function (a, b) {
          return a.nameLower.localeCompare(b.nameLower);
        });
        setResult(filtered);
      };
    });
  }

  function moveFolder(folderId, targetParentId) {
    var cleanId;
    var cleanParentId;
    try {
      cleanId = assertNonEmptyId(folderId, 'folderId');
      cleanParentId = assertNullableId(targetParentId, 'targetParentId');
    } catch (err) {
      return Promise.reject(err);
    }

    return runTransaction([STORES.FOLDERS], 'readwrite', function (tx, setResult, abortWith) {
      var store = tx.objectStore(STORES.FOLDERS);
      var allReq = store.getAll();
      allReq.onsuccess = function () {
        var allFolders = allReq.result || [];
        var folderMap = buildFolderMap(allFolders);
        var folder = folderMap[cleanId];

        if (!folder) {
          abortWith(createVaultError('NOT_FOUND', 'Folder to move was not found.'));
          return;
        }
        if (folder.deletedAt !== null) {
          abortWith(createVaultError('ALREADY_TRASHED', 'Cannot move a trashed folder. Restore it first.'));
          return;
        }
        if (cleanParentId !== null) {
          var targetParent = folderMap[cleanParentId];
          if (!targetParent || targetParent.deletedAt !== null) {
            abortWith(createVaultError('INVALID_PARENT', 'Destination parent folder does not exist or is in Trash.'));
            return;
          }
        }
        if (wouldCreateCycle(cleanId, cleanParentId, folderMap)) {
          abortWith(
            createVaultError(
              'CYCLE_DETECTED',
              'Cannot move a folder into itself or one of its own subfolders.'
            )
          );
          return;
        }

        folder.parentId = cleanParentId;
        folder.updatedAt = Date.now();
        store.put(folder);
        setResult(folder);
      };
    });
  }

  function trashFolderSubtree(folderId) {
    var cleanId;
    try {
      cleanId = assertNonEmptyId(folderId, 'folderId');
    } catch (err) {
      return Promise.reject(err);
    }

    return runTransaction([STORES.FOLDERS, STORES.FILES_META], 'readwrite', function (tx, setResult, abortWith) {
      var folderStore = tx.objectStore(STORES.FOLDERS);
      var metaStore = tx.objectStore(STORES.FILES_META);

      var foldersReq = folderStore.getAll();
      var filesReq = metaStore.getAll();
      var allFolders = null;
      var allFiles = null;

      function processWhenReady() {
        if (allFolders === null || allFiles === null) return;

        var folderMap = buildFolderMap(allFolders);
        var target = folderMap[cleanId];
        if (!target) {
          abortWith(createVaultError('NOT_FOUND', 'Folder not found.'));
          return;
        }
        if (target.deletedAt !== null) {
          abortWith(createVaultError('ALREADY_TRASHED', 'Folder is already in Trash.'));
          return;
        }

        var affectedFolderIds = collectDescendantFolderIds(cleanId, allFolders, function (f) {
          return f.deletedAt === null;
        });
        var affectedSet = Object.create(null);
        for (var i = 0; i < affectedFolderIds.length; i++) {
          affectedSet[affectedFolderIds[i]] = true;
        }

        var now = Date.now();
        var trashedFolders = 0;
        var trashedFiles = 0;

        for (var j = 0; j < affectedFolderIds.length; j++) {
          var f = folderMap[affectedFolderIds[j]];
          if (f && f.deletedAt === null) {
            f.deletedAt = now;
            f.updatedAt = now;
            folderStore.put(f);
            trashedFolders++;
          }
        }

        for (var k = 0; k < allFiles.length; k++) {
          var file = allFiles[k];
          if (file.deletedAt === null && file.folderId !== null && affectedSet[file.folderId]) {
            file.originalFolderId = file.folderId;
            file.deletedAt = now;
            file.updatedAt = now;
            metaStore.put(file);
            trashedFiles++;
          }
        }

        setResult({
          folderId: cleanId,
          deletedAt: now,
          trashedFolders: trashedFolders,
          trashedFiles: trashedFiles
        });
      }

      foldersReq.onsuccess = function () { allFolders = foldersReq.result || []; processWhenReady(); };
      filesReq.onsuccess = function () { allFiles = filesReq.result || []; processWhenReady(); };
    });
  }

  function restoreFolderSubtree(folderId) {
    var cleanId;
    try {
      cleanId = assertNonEmptyId(folderId, 'folderId');
    } catch (err) {
      return Promise.reject(err);
    }

    return runTransaction([STORES.FOLDERS, STORES.FILES_META], 'readwrite', function (tx, setResult, abortWith) {
      var folderStore = tx.objectStore(STORES.FOLDERS);
      var metaStore = tx.objectStore(STORES.FILES_META);

      var foldersReq = folderStore.getAll();
      var filesReq = metaStore.getAll();
      var allFolders = null;
      var allFiles = null;

      function processWhenReady() {
        if (allFolders === null || allFiles === null) return;

        var folderMap = buildFolderMap(allFolders);
        var target = folderMap[cleanId];
        if (!target) {
          abortWith(createVaultError('NOT_FOUND', 'Folder not found.'));
          return;
        }
        if (target.deletedAt === null) {
          abortWith(createVaultError('NOT_TRASHED', 'Folder is not in Trash.'));
          return;
        }

        // Batch-scoped restoration: only restore descendants & files trashed in the same batch
        var batchDeletedAt = target.deletedAt;

        var affectedFolderIds = collectDescendantFolderIds(cleanId, allFolders, function (f) {
          return f.deletedAt === batchDeletedAt;
        });
        var affectedSet = Object.create(null);
        for (var i = 0; i < affectedFolderIds.length; i++) {
          affectedSet[affectedFolderIds[i]] = true;
        }

        var restoredToRoot = false;
        if (target.parentId !== null) {
          var parent = folderMap[target.parentId];
          if (!parent || parent.deletedAt !== null) {
            target.parentId = null;
            restoredToRoot = true;
          }
        }

        var now = Date.now();
        var restoredFolders = 0;
        var restoredFiles = 0;

        for (var j = 0; j < affectedFolderIds.length; j++) {
          var f = folderMap[affectedFolderIds[j]];
          if (f && f.deletedAt === batchDeletedAt) {
            f.deletedAt = null;
            f.updatedAt = now;
            folderStore.put(f);
            restoredFolders++;
          }
        }

        for (var k = 0; k < allFiles.length; k++) {
          var file = allFiles[k];
          if (file.deletedAt === batchDeletedAt && file.folderId !== null && affectedSet[file.folderId]) {
            file.deletedAt = null;
            file.originalFolderId = null;
            file.updatedAt = now;
            metaStore.put(file);
            restoredFiles++;
          }
        }

        setResult({
          folderId: cleanId,
          restoredToRoot: restoredToRoot,
          restoredFolders: restoredFolders,
          restoredFiles: restoredFiles
        });
      }

      foldersReq.onsuccess = function () { allFolders = foldersReq.result || []; processWhenReady(); };
      filesReq.onsuccess = function () { allFiles = filesReq.result || []; processWhenReady(); };
    });
  }

  function deleteFolderPreserveFiles(folderId, destination) {
    var cleanId;
    var destMode = destination === 'root' ? 'root' : 'parent';
    try {
      cleanId = assertNonEmptyId(folderId, 'folderId');
    } catch (err) {
      return Promise.reject(err);
    }

    return runTransaction([STORES.FOLDERS, STORES.FILES_META], 'readwrite', function (tx, setResult, abortWith) {
      var folderStore = tx.objectStore(STORES.FOLDERS);
      var metaStore = tx.objectStore(STORES.FILES_META);

      var foldersReq = folderStore.getAll();
      var filesReq = metaStore.getAll();
      var allFolders = null;
      var allFiles = null;

      function processWhenReady() {
        if (allFolders === null || allFiles === null) return;

        var folderMap = buildFolderMap(allFolders);
        var target = folderMap[cleanId];
        if (!target) {
          abortWith(createVaultError('NOT_FOUND', 'Folder not found.'));
          return;
        }
        if (target.deletedAt !== null) {
          abortWith(createVaultError('ALREADY_TRASHED', 'Cannot delete-and-preserve a trashed folder. Restore or purge it from Trash.'));
          return;
        }

        // Only delete active folders; preserve any already-trashed subfolders
        var affectedFolderIds = collectDescendantFolderIds(cleanId, allFolders, function (f) {
          return f.deletedAt === null;
        });
        var affectedSet = Object.create(null);
        for (var i = 0; i < affectedFolderIds.length; i++) {
          affectedSet[affectedFolderIds[i]] = true;
        }

        var destFolderId = null;
        if (destMode === 'parent' && target.parentId !== null) {
          var parent = folderMap[target.parentId];
          if (parent && parent.deletedAt === null && !affectedSet[parent.id]) {
            destFolderId = parent.id;
          }
        }

        var now = Date.now();
        var preservedTrashedFolders = 0;
        var movedActiveFiles = 0;
        var movedTrashedFiles = 0;

        // Repoint already-trashed subfolders whose parent is being deleted so their Trash structure stays valid
        for (var t = 0; t < allFolders.length; t++) {
          var tf = allFolders[t];
          if (tf.deletedAt !== null && tf.parentId !== null && affectedSet[tf.parentId]) {
            tf.parentId = destFolderId;
            tf.updatedAt = now;
            folderStore.put(tf);
            preservedTrashedFolders++;
          }
        }

        for (var k = 0; k < allFiles.length; k++) {
          var file = allFiles[k];
          if (file.folderId !== null && affectedSet[file.folderId]) {
            file.folderId = destFolderId;
            if (file.originalFolderId && affectedSet[file.originalFolderId]) {
              file.originalFolderId = destFolderId;
            }
            file.updatedAt = now;
            metaStore.put(file);
            if (file.deletedAt === null) {
              movedActiveFiles++;
            } else {
              movedTrashedFiles++;
            }
          }
        }

        for (var j = 0; j < affectedFolderIds.length; j++) {
          folderStore.delete(affectedFolderIds[j]);
        }

        setResult({
          deletedFolders: affectedFolderIds.length,
          movedFiles: movedActiveFiles,
          movedActiveFiles: movedActiveFiles,
          movedTrashedFiles: movedTrashedFiles,
          preservedTrashedFolders: preservedTrashedFolders,
          destinationFolderId: destFolderId
        });
      }

      foldersReq.onsuccess = function () { allFolders = foldersReq.result || []; processWhenReady(); };
      filesReq.onsuccess = function () { allFiles = filesReq.result || []; processWhenReady(); };
    });
  }

  // =========================================================================
  // 7. FILE UPLOAD, METADATA, BLOB, RENAME, MOVE, TRASH & PURGE
  // =========================================================================

  function uploadFile(file, options) {
    var opts = options || {};
    var folderId;
    try {
      folderId = assertNullableId(opts.folderId, 'folderId');
    } catch (err) {
      return Promise.reject(err);
    }

    // Complete ALL async validation before opening the IndexedDB write transaction
    return validateFileForUpload(file, opts.customName).then(function (validated) {
      var now = Date.now();
      var id = generateId();

      var metaRecord = {
        id: id,
        name: validated.safeName,
        nameLower: validated.safeName.toLowerCase(),
        ext: validated.ext,
        mimeType: validated.mimeType,
        category: validated.category,
        size: validated.size,
        folderId: folderId,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
        deletedAt: null,
        originalFolderId: null
      };

      var blobRecord = {
        id: id,
        blob: file,
        storedSize: validated.size
      };

      var stores = folderId !== null
        ? [STORES.FOLDERS, STORES.FILES_META, STORES.FILE_BLOBS]
        : [STORES.FILES_META, STORES.FILE_BLOBS];

      return runTransaction(stores, 'readwrite', function (tx, setResult, abortWith) {
        function writeBoth() {
          tx.objectStore(STORES.FILES_META).put(metaRecord);
          tx.objectStore(STORES.FILE_BLOBS).put(blobRecord);
          setResult(metaRecord);
        }

        if (folderId === null) {
          writeBoth();
          return;
        }

        var folderReq = tx.objectStore(STORES.FOLDERS).get(folderId);
        folderReq.onsuccess = function () {
          var folder = folderReq.result;
          if (!folder || folder.deletedAt !== null) {
            abortWith(
              createVaultError('INVALID_PARENT', 'Destination folder does not exist or is in Trash.')
            );
            return;
          }
          writeBoth();
        };
      });
    });
  }

  function uploadFiles(fileList, options) {
    var items = Array.prototype.slice.call(fileList || []);
    var succeeded = [];
    var failed = [];

    return items.reduce(function (chain, file) {
      return chain.then(function () {
        return uploadFile(file, options).then(
          function (meta) {
            succeeded.push(meta);
          },
          function (err) {
            failed.push({
              fileName: file && typeof file.name === 'string' ? file.name : '(unknown)',
              code: err && err.code ? err.code : 'UPLOAD_FAILED',
              message: err && err.message ? err.message : 'Upload failed.'
            });
          }
        );
      });
    }, Promise.resolve()).then(function () {
      return {
        total: items.length,
        succeeded: succeeded,
        failed: failed
      };
    });
  }

  function getFileMeta(fileId) {
    var cleanId;
    try {
      cleanId = assertNonEmptyId(fileId, 'fileId');
    } catch (err) {
      return Promise.reject(err);
    }

    return runTransaction([STORES.FILES_META], 'readonly', function (tx, setResult) {
      var req = tx.objectStore(STORES.FILES_META).get(cleanId);
      req.onsuccess = function () {
        setResult(req.result || null);
      };
    });
  }

  function getFileBlob(fileId) {
    var cleanId;
    try {
      cleanId = assertNonEmptyId(fileId, 'fileId');
    } catch (err) {
      return Promise.reject(err);
    }

    return runTransaction([STORES.FILE_BLOBS], 'readonly', function (tx, setResult, abortWith) {
      var req = tx.objectStore(STORES.FILE_BLOBS).get(cleanId);
      req.onsuccess = function () {
        var rec = req.result;
        if (!rec || !rec.blob) {
          abortWith(createVaultError('NOT_FOUND', 'Binary file payload was not found.'));
          return;
        }
        setResult(rec.blob);
      };
    });
  }

  function listFiles(options) {
    var opts = options || {};
    var includeTrashed = Boolean(opts.includeTrashed);
    var onlyTrashed = Boolean(opts.onlyTrashed);
    var filterByFolder = Object.prototype.hasOwnProperty.call(opts, 'folderId');
    var targetFolderId = null;

    try {
      if (filterByFolder) {
        targetFolderId = assertNullableId(opts.folderId, 'folderId');
      }
    } catch (err) {
      return Promise.reject(err);
    }

    var query = typeof opts.search === 'string' ? opts.search.trim().toLowerCase() : '';
    var sortBy = opts.sortBy || 'updatedAt';
    var sortDir = opts.sortDir === 'asc' ? 1 : -1;

    return runTransaction([STORES.FILES_META], 'readonly', function (tx, setResult) {
      var req = tx.objectStore(STORES.FILES_META).getAll();
      req.onsuccess = function () {
        var all = req.result || [];
        var filtered = all.filter(function (f) {
          var isTrashed = f.deletedAt !== null;
          if (onlyTrashed && !isTrashed) return false;
          if (!onlyTrashed && !includeTrashed && isTrashed) return false;
          if (filterByFolder && f.folderId !== targetFolderId) return false;
          if (query && f.nameLower.indexOf(query) === -1) return false;
          return true;
        });

        filtered.sort(function (a, b) {
          if (sortBy === 'name') return a.nameLower.localeCompare(b.nameLower) * sortDir;
          if (sortBy === 'size') return (a.size - b.size) * sortDir;
          if (sortBy === 'type') return a.ext.localeCompare(b.ext) * sortDir;
          if (sortBy === 'createdAt') return (a.createdAt - b.createdAt) * sortDir;
          return (a.updatedAt - b.updatedAt) * sortDir;
        });

        setResult(filtered);
      };
    });
  }

  function renameFile(fileId, newName) {
    var cleanId;
    var safeInput;
    try {
      cleanId = assertNonEmptyId(fileId, 'fileId');
      safeInput = sanitizeName(newName, true);
    } catch (err) {
      return Promise.reject(err);
    }

    return runTransaction([STORES.FILES_META], 'readwrite', function (tx, setResult, abortWith) {
      var store = tx.objectStore(STORES.FILES_META);
      var req = store.get(cleanId);
      req.onsuccess = function () {
        var file = req.result;
        if (!file) {
          abortWith(createVaultError('NOT_FOUND', 'File not found.'));
          return;
        }
        if (file.deletedAt !== null) {
          abortWith(createVaultError('ALREADY_TRASHED', 'Cannot rename a trashed file. Restore it first.'));
          return;
        }

        var expectedSuffix = '.' + file.ext;
        var lowerInput = safeInput.toLowerCase();
        var finalName;

        if (lowerInput === expectedSuffix) {
          abortWith(createVaultError('INVALID_NAME', 'File name cannot consist only of its extension.'));
          return;
        }

        if (
          lowerInput.length > expectedSuffix.length &&
          lowerInput.slice(-expectedSuffix.length) === expectedSuffix
        ) {
          finalName = safeInput;
        } else {
          var candidateExt = extractExtension(safeInput);
          var isKnownOtherExt =
            candidateExt &&
            candidateExt !== file.ext &&
            (Boolean(ALLOWED_FORMATS[candidateExt]) || BLOCKED_EXTENSIONS.indexOf(candidateExt) !== -1);

          if (isKnownOtherExt) {
            abortWith(
              createVaultError(
                'INVALID_NAME',
                'Cannot change file extension from ".' + file.ext + '" to ".' + candidateExt + '".'
              )
            );
            return;
          }
          finalName = sanitizeName(safeInput + expectedSuffix, true);
        }

        file.name = finalName;
        file.nameLower = finalName.toLowerCase();
        file.updatedAt = Date.now();
        store.put(file);
        setResult(file);
      };
    });
  }

  function moveFile(fileId, targetFolderId) {
    var cleanId;
    var cleanFolderId;
    try {
      cleanId = assertNonEmptyId(fileId, 'fileId');
      cleanFolderId = assertNullableId(targetFolderId, 'targetFolderId');
    } catch (err) {
      return Promise.reject(err);
    }

    var stores = cleanFolderId !== null
      ? [STORES.FOLDERS, STORES.FILES_META]
      : [STORES.FILES_META];

    return runTransaction(stores, 'readwrite', function (tx, setResult, abortWith) {
      var metaStore = tx.objectStore(STORES.FILES_META);

      function updateFile() {
        var req = metaStore.get(cleanId);
        req.onsuccess = function () {
          var file = req.result;
          if (!file) {
            abortWith(createVaultError('NOT_FOUND', 'File not found.'));
            return;
          }
          if (file.deletedAt !== null) {
            abortWith(createVaultError('ALREADY_TRASHED', 'Cannot move a trashed file. Restore it first.'));
            return;
          }
          file.folderId = cleanFolderId;
          file.updatedAt = Date.now();
          metaStore.put(file);
          setResult(file);
        };
      }

      if (cleanFolderId === null) {
        updateFile();
        return;
      }

      var folderReq = tx.objectStore(STORES.FOLDERS).get(cleanFolderId);
      folderReq.onsuccess = function () {
        var folder = folderReq.result;
        if (!folder || folder.deletedAt !== null) {
          abortWith(createVaultError('INVALID_PARENT', 'Destination folder does not exist or is in Trash.'));
          return;
        }
        updateFile();
      };
    });
  }

  function markFileOpened(fileId) {
    var cleanId;
    try {
      cleanId = assertNonEmptyId(fileId, 'fileId');
    } catch (err) {
      return Promise.reject(err);
    }

    return runTransaction([STORES.FILES_META], 'readwrite', function (tx, setResult, abortWith) {
      var store = tx.objectStore(STORES.FILES_META);
      var req = store.get(cleanId);
      req.onsuccess = function () {
        var file = req.result;
        if (!file) {
          abortWith(createVaultError('NOT_FOUND', 'File not found.'));
          return;
        }
        file.lastOpenedAt = Date.now();
        store.put(file);
        setResult(file);
      };
    });
  }

  function trashFile(fileId) {
    var cleanId;
    try {
      cleanId = assertNonEmptyId(fileId, 'fileId');
    } catch (err) {
      return Promise.reject(err);
    }

    return runTransaction([STORES.FILES_META], 'readwrite', function (tx, setResult, abortWith) {
      var store = tx.objectStore(STORES.FILES_META);
      var req = store.get(cleanId);
      req.onsuccess = function () {
        var file = req.result;
        if (!file) {
          abortWith(createVaultError('NOT_FOUND', 'File not found.'));
          return;
        }
        if (file.deletedAt !== null) {
          abortWith(createVaultError('ALREADY_TRASHED', 'File is already in Trash.'));
          return;
        }
        var now = Date.now();
        file.originalFolderId = file.folderId;
        file.deletedAt = now;
        file.updatedAt = now;
        store.put(file);
        setResult(file);
      };
    });
  }

  function restoreFile(fileId) {
    var cleanId;
    try {
      cleanId = assertNonEmptyId(fileId, 'fileId');
    } catch (err) {
      return Promise.reject(err);
    }

    return runTransaction([STORES.FOLDERS, STORES.FILES_META], 'readwrite', function (tx, setResult, abortWith) {
      var folderStore = tx.objectStore(STORES.FOLDERS);
      var metaStore = tx.objectStore(STORES.FILES_META);

      var fileReq = metaStore.get(cleanId);
      fileReq.onsuccess = function () {
        var file = fileReq.result;
        if (!file) {
          abortWith(createVaultError('NOT_FOUND', 'File not found.'));
          return;
        }
        if (file.deletedAt === null) {
          abortWith(createVaultError('NOT_TRASHED', 'File is not in Trash.'));
          return;
        }

        var desiredFolder = file.originalFolderId !== undefined ? file.originalFolderId : file.folderId;

        function finishRestore(finalFolderId, restoredToRoot) {
          file.folderId = finalFolderId;
          file.originalFolderId = null;
          file.deletedAt = null;
          file.updatedAt = Date.now();
          metaStore.put(file);
          setResult({ file: file, restoredToRoot: restoredToRoot });
        }

        if (desiredFolder === null) {
          finishRestore(null, false);
          return;
        }

        var folderReq = folderStore.get(desiredFolder);
        folderReq.onsuccess = function () {
          var parent = folderReq.result;
          if (!parent || parent.deletedAt !== null) {
            finishRestore(null, true);
          } else {
            finishRestore(parent.id, false);
          }
        };
      };
    });
  }

  function permanentlyDeleteFile(fileId) {
    var cleanId;
    try {
      cleanId = assertNonEmptyId(fileId, 'fileId');
    } catch (err) {
      return Promise.reject(err);
    }

    return runTransaction([STORES.FILES_META, STORES.FILE_BLOBS], 'readwrite', function (tx, setResult, abortWith) {
      var metaStore = tx.objectStore(STORES.FILES_META);
      var blobStore = tx.objectStore(STORES.FILE_BLOBS);

      var req = metaStore.get(cleanId);
      req.onsuccess = function () {
        var file = req.result;
        if (!file) {
          abortWith(createVaultError('NOT_FOUND', 'File not found.'));
          return;
        }
        if (file.deletedAt === null) {
          abortWith(createVaultError('NOT_TRASHED', 'Move the file to Trash before permanently deleting it.'));
          return;
        }
        metaStore.delete(cleanId);
        blobStore.delete(cleanId);
        setResult({ deletedFileId: cleanId });
      };
    });
  }

  function permanentlyDeleteTrashedItems(selection) {
    var opts = selection || {};
    var rawFileIds = Array.isArray(opts.fileIds) ? opts.fileIds : [];
    var rawFolderIds = Array.isArray(opts.folderIds) ? opts.folderIds : [];

    var fileIds = [];
    var folderIds = [];
    try {
      for (var i = 0; i < rawFileIds.length; i++) fileIds.push(assertNonEmptyId(rawFileIds[i], 'fileIds[' + i + ']'));
      for (var j = 0; j < rawFolderIds.length; j++) folderIds.push(assertNonEmptyId(rawFolderIds[j], 'folderIds[' + j + ']'));
    } catch (err) {
      return Promise.reject(err);
    }

    if (fileIds.length === 0 && folderIds.length === 0) {
      return Promise.resolve({ deletedFolders: 0, deletedFiles: 0 });
    }

    return runTransaction(
      [STORES.FOLDERS, STORES.FILES_META, STORES.FILE_BLOBS],
      'readwrite',
      function (tx, setResult, abortWith) {
        var folderStore = tx.objectStore(STORES.FOLDERS);
        var metaStore = tx.objectStore(STORES.FILES_META);
        var blobStore = tx.objectStore(STORES.FILE_BLOBS);

        var foldersReq = folderStore.getAll();
        var filesReq = metaStore.getAll();
        var allFolders = null;
        var allFiles = null;

        function processWhenReady() {
          if (allFolders === null || allFiles === null) return;

          var folderMap = buildFolderMap(allFolders);
          var fileMap = Object.create(null);
          for (var a = 0; a < allFiles.length; a++) {
            fileMap[allFiles[a].id] = allFiles[a];
          }

          var foldersToDelete = Object.create(null);
          var filesToDelete = Object.create(null);

          for (var fIdx = 0; fIdx < folderIds.length; fIdx++) {
            var fid = folderIds[fIdx];
            var folder = folderMap[fid];
            if (!folder) {
              abortWith(createVaultError('NOT_FOUND', 'Trashed folder "' + fid + '" not found.'));
              return;
            }
            if (folder.deletedAt === null) {
              abortWith(createVaultError('NOT_TRASHED', 'Cannot permanently delete active folder "' + folder.name + '".'));
              return;
            }
            var subtree = collectDescendantFolderIds(fid, allFolders, function (item) {
              return item.deletedAt !== null;
            });
            for (var s = 0; s < subtree.length; s++) {
              foldersToDelete[subtree[s]] = true;
            }
          }

          for (var k = 0; k < allFiles.length; k++) {
            var candidate = allFiles[k];
            if (candidate.deletedAt !== null && candidate.folderId !== null && foldersToDelete[candidate.folderId]) {
              filesToDelete[candidate.id] = true;
            }
          }

          for (var mIdx = 0; mIdx < fileIds.length; mIdx++) {
            var mid = fileIds[mIdx];
            var file = fileMap[mid];
            if (!file) {
              abortWith(createVaultError('NOT_FOUND', 'Trashed file "' + mid + '" not found.'));
              return;
            }
            if (file.deletedAt === null) {
              abortWith(createVaultError('NOT_TRASHED', 'Cannot permanently delete active file "' + file.name + '".'));
              return;
            }
            filesToDelete[mid] = true;
          }

          var folderDeleteKeys = Object.keys(foldersToDelete);
          var fileDeleteKeys = Object.keys(filesToDelete);

          for (var x = 0; x < fileDeleteKeys.length; x++) {
            metaStore.delete(fileDeleteKeys[x]);
            blobStore.delete(fileDeleteKeys[x]);
          }
          for (var y = 0; y < folderDeleteKeys.length; y++) {
            folderStore.delete(folderDeleteKeys[y]);
          }

          setResult({
            deletedFolders: folderDeleteKeys.length,
            deletedFiles: fileDeleteKeys.length
          });
        }

        foldersReq.onsuccess = function () { allFolders = foldersReq.result || []; processWhenReady(); };
        filesReq.onsuccess = function () { allFiles = filesReq.result || []; processWhenReady(); };
      }
    );
  }

  function emptyTrash() {
    return runTransaction(
      [STORES.FOLDERS, STORES.FILES_META, STORES.FILE_BLOBS],
      'readwrite',
      function (tx, setResult) {
        var folderStore = tx.objectStore(STORES.FOLDERS);
        var metaStore = tx.objectStore(STORES.FILES_META);
        var blobStore = tx.objectStore(STORES.FILE_BLOBS);

        var foldersReq = folderStore.getAll();
        var filesReq = metaStore.getAll();
        var allFolders = null;
        var allFiles = null;

        function processWhenReady() {
          if (allFolders === null || allFiles === null) return;

          var deletedFolders = 0;
          var deletedFiles = 0;

          for (var i = 0; i < allFiles.length; i++) {
            if (allFiles[i].deletedAt !== null) {
              metaStore.delete(allFiles[i].id);
              blobStore.delete(allFiles[i].id);
              deletedFiles++;
            }
          }

          for (var j = 0; j < allFolders.length; j++) {
            if (allFolders[j].deletedAt !== null) {
              folderStore.delete(allFolders[j].id);
              deletedFolders++;
            }
          }

          setResult({
            deletedFolders: deletedFolders,
            deletedFiles: deletedFiles
          });
        }

        foldersReq.onsuccess = function () { allFolders = foldersReq.result || []; processWhenReady(); };
        filesReq.onsuccess = function () { allFiles = filesReq.result || []; processWhenReady(); };
      }
    );
  }

  // =========================================================================
  // 8. READ-ONLY INTEGRITY SCANNER & EXPLICIT USER-AUTHORIZED REPAIRS
  //    Never auto-deletes or auto-modifies records during a scan.
  // =========================================================================

  function runIntegrityScan() {
    return runTransaction(
      [STORES.FOLDERS, STORES.FILES_META, STORES.FILE_BLOBS],
      'readonly',
      function (tx, setResult) {
        var foldersReq = tx.objectStore(STORES.FOLDERS).getAll();
        var metaReq = tx.objectStore(STORES.FILES_META).getAll();
        var blobKeysReq = tx.objectStore(STORES.FILE_BLOBS).getAllKeys();

        var folders = null;
        var metas = null;
        var blobKeys = null;

        function evaluateWhenReady() {
          if (folders === null || metas === null || blobKeys === null) return;

          var folderMap = buildFolderMap(folders);
          var metaMap = Object.create(null);
          var blobKeySet = Object.create(null);

          for (var b = 0; b < blobKeys.length; b++) {
            blobKeySet[blobKeys[b]] = true;
          }

          var metaWithoutBlob = [];
          var filesWithMissingFolder = [];

          for (var i = 0; i < metas.length; i++) {
            var m = metas[i];
            metaMap[m.id] = m;

            if (!blobKeySet[m.id]) {
              metaWithoutBlob.push({ id: m.id, name: m.name, deletedAt: m.deletedAt });
            }

            if (m.folderId !== null) {
              var parentFolder = folderMap[m.folderId];
              if (!parentFolder) {
                filesWithMissingFolder.push({ id: m.id, name: m.name, folderId: m.folderId, reason: 'missing_folder' });
              } else if (m.deletedAt === null && parentFolder.deletedAt !== null) {
                filesWithMissingFolder.push({ id: m.id, name: m.name, folderId: m.folderId, reason: 'trashed_parent' });
              }
            }
          }

          var blobWithoutMeta = [];
          for (var k = 0; k < blobKeys.length; k++) {
            if (!metaMap[blobKeys[k]]) {
              blobWithoutMeta.push(blobKeys[k]);
            }
          }

          var foldersWithMissingParent = [];
          var folderCycles = [];
          var reportedCycleIds = Object.create(null);

          for (var j = 0; j < folders.length; j++) {
            var f = folders[j];

            if (f.parentId !== null) {
              var p = folderMap[f.parentId];
              if (!p) {
                foldersWithMissingParent.push({ id: f.id, name: f.name, parentId: f.parentId, reason: 'missing_parent' });
              } else if (f.deletedAt === null && p.deletedAt !== null) {
                foldersWithMissingParent.push({ id: f.id, name: f.name, parentId: f.parentId, reason: 'trashed_parent' });
              }
            }

            var path = [];
            var seenInWalk = Object.create(null);
            var curr = f.id;
            while (curr !== null && curr !== undefined) {
              if (seenInWalk[curr]) {
                if (!reportedCycleIds[curr]) {
                  var cycleStart = path.indexOf(curr);
                  var cycleNodes = path.slice(cycleStart);
                  for (var cIdx = 0; cIdx < cycleNodes.length; cIdx++) {
                    reportedCycleIds[cycleNodes[cIdx]] = true;
                  }
                  folderCycles.push({
                    entryFolderId: curr,
                    cyclePath: cycleNodes.concat(curr)
                  });
                }
                break;
              }
              seenInWalk[curr] = true;
              path.push(curr);
              var node = folderMap[curr];
              if (!node) break;
              curr = node.parentId;
            }
          }

          var totalIssues =
            metaWithoutBlob.length +
            blobWithoutMeta.length +
            filesWithMissingFolder.length +
            foldersWithMissingParent.length +
            folderCycles.length;

          setResult({
            complete: true,
            scannedAt: Date.now(),
            healthy: totalIssues === 0,
            totals: {
              folders: folders.length,
              filesMeta: metas.length,
              fileBlobs: blobKeys.length,
              issues: totalIssues
            },
            issues: {
              metaWithoutBlob: metaWithoutBlob,
              blobWithoutMeta: blobWithoutMeta,
              filesWithMissingFolder: filesWithMissingFolder,
              foldersWithMissingParent: foldersWithMissingParent,
              folderCycles: folderCycles
            }
          });
        }

        foldersReq.onsuccess = function () { folders = foldersReq.result || []; evaluateWhenReady(); };
        metaReq.onsuccess = function () { metas = metaReq.result || []; evaluateWhenReady(); };
        blobKeysReq.onsuccess = function () { blobKeys = blobKeysReq.result || []; evaluateWhenReady(); };
      }
    ).catch(function (err) {
      return {
        complete: false,
        scannedAt: Date.now(),
        healthy: false,
        error: err && err.message ? err.message : 'Integrity check incomplete — no records modified.',
        totals: null,
        issues: null
      };
    });
  }

  // Non-destructive repair: relocates unlinked files/folders to Root and breaks folder cycles.
  // Must only be called after explicit user confirmation.
  function repairOrphanedPointers() {
    return runTransaction(
      [STORES.FOLDERS, STORES.FILES_META],
      'readwrite',
      function (tx, setResult) {
        var folderStore = tx.objectStore(STORES.FOLDERS);
        var metaStore = tx.objectStore(STORES.FILES_META);

        var foldersReq = folderStore.getAll();
        var filesReq = metaStore.getAll();
        var folders = null;
        var files = null;

        function applyRepairs() {
          if (folders === null || files === null) return;

          var folderMap = buildFolderMap(folders);
          var now = Date.now();
          var repairedFiles = 0;
          var repairedFolders = 0;
          var brokenCycles = 0;

          for (var i = 0; i < folders.length; i++) {
            var f = folders[i];
            if (f.parentId !== null) {
              var parent = folderMap[f.parentId];
              if (!parent || (f.deletedAt === null && parent.deletedAt !== null)) {
                f.parentId = null;
                f.updatedAt = now;
                folderStore.put(f);
                repairedFolders++;
              }
            }
          }

          // Break any remaining cycles without deleting folders
          for (var j = 0; j < folders.length; j++) {
            var start = folders[j];
            var seen = Object.create(null);
            var curr = start.id;
            while (curr !== null && curr !== undefined) {
              if (seen[curr]) {
                var cycleNode = folderMap[curr];
                if (cycleNode && cycleNode.parentId !== null) {
                  cycleNode.parentId = null;
                  cycleNode.updatedAt = now;
                  folderStore.put(cycleNode);
                  brokenCycles++;
                }
                break;
              }
              seen[curr] = true;
              var node = folderMap[curr];
              if (!node) break;
              curr = node.parentId;
            }
          }

          for (var k = 0; k < files.length; k++) {
            var file = files[k];
            if (file.folderId !== null) {
              var folder = folderMap[file.folderId];
              if (!folder || (file.deletedAt === null && folder.deletedAt !== null)) {
                file.folderId = null;
                file.updatedAt = now;
                metaStore.put(file);
                repairedFiles++;
              }
            }
          }

          setResult({
            repairedFiles: repairedFiles,
            repairedFolders: repairedFolders,
            brokenCycles: brokenCycles
          });
        }

        foldersReq.onsuccess = function () { folders = foldersReq.result || []; applyRepairs(); };
        filesReq.onsuccess = function () { files = filesReq.result || []; applyRepairs(); };
      }
    );
  }

  // Explicitly removes ONLY confirmed orphan IDs after a complete integrity scan and user confirmation.
  // Re-verifies inside the transaction that each record is still orphaned before deleting.
  function purgeConfirmedOrphans(options) {
    var opts = options || {};
    var metaIds = Array.isArray(opts.metaWithoutBlobIds) ? opts.metaWithoutBlobIds : [];
    var blobIds = Array.isArray(opts.blobWithoutMetaIds) ? opts.blobWithoutMetaIds : [];

    var cleanMetaIds = [];
    var cleanBlobIds = [];
    try {
      for (var i = 0; i < metaIds.length; i++) cleanMetaIds.push(assertNonEmptyId(metaIds[i], 'metaWithoutBlobIds[' + i + ']'));
      for (var j = 0; j < blobIds.length; j++) cleanBlobIds.push(assertNonEmptyId(blobIds[j], 'blobWithoutMetaIds[' + j + ']'));
    } catch (err) {
      return Promise.reject(err);
    }

    if (cleanMetaIds.length === 0 && cleanBlobIds.length === 0) {
      return Promise.resolve({ removedMeta: 0, removedBlobs: 0 });
    }

    return runTransaction(
      [STORES.FILES_META, STORES.FILE_BLOBS],
      'readwrite',
      function (tx, setResult) {
        var metaStore = tx.objectStore(STORES.FILES_META);
        var blobStore = tx.objectStore(STORES.FILE_BLOBS);

        var metaKeysReq = metaStore.getAllKeys();
        var blobKeysReq = blobStore.getAllKeys();
        var metaKeys = null;
        var blobKeys = null;

        function applyPurge() {
          if (metaKeys === null || blobKeys === null) return;

          var metaSet = Object.create(null);
          var blobSet = Object.create(null);
          for (var a = 0; a < metaKeys.length; a++) metaSet[metaKeys[a]] = true;
          for (var b = 0; b < blobKeys.length; b++) blobSet[blobKeys[b]] = true;

          var removedMeta = 0;
          var removedBlobs = 0;

          for (var x = 0; x < cleanMetaIds.length; x++) {
            var mid = cleanMetaIds[x];
            if (metaSet[mid] && !blobSet[mid]) {
              metaStore.delete(mid);
              removedMeta++;
            }
          }

          for (var y = 0; y < cleanBlobIds.length; y++) {
            var bid = cleanBlobIds[y];
            if (blobSet[bid] && !metaSet[bid]) {
              blobStore.delete(bid);
              removedBlobs++;
            }
          }

          setResult({
            removedMeta: removedMeta,
            removedBlobs: removedBlobs
          });
        }

        metaKeysReq.onsuccess = function () { metaKeys = metaKeysReq.result || []; applyPurge(); };
        blobKeysReq.onsuccess = function () { blobKeys = blobKeysReq.result || []; applyPurge(); };
      }
    );
  }

  // =========================================================================
  // 9. STORAGE ESTIMATE, PERSISTENCE & LIBRARY SETTINGS
  // =========================================================================

  function getStorageEstimate() {
    var libraryUsagePromise = runTransaction([STORES.FILES_META], 'readonly', function (tx, setResult) {
      var req = tx.objectStore(STORES.FILES_META).getAll();
      req.onsuccess = function () {
        var all = req.result || [];
        var activeBytes = 0;
        var trashedBytes = 0;
        for (var i = 0; i < all.length; i++) {
          var sz = Number(all[i].size) || 0;
          if (all[i].deletedAt === null) activeBytes += sz;
          else trashedBytes += sz;
        }
        setResult({
          activeBytes: activeBytes,
          trashedBytes: trashedBytes,
          totalLibraryBytes: activeBytes + trashedBytes
        });
      };
    }).catch(function () {
      return { activeBytes: 0, trashedBytes: 0, totalLibraryBytes: 0 };
    });

    var browserEstimatePromise =
      global.navigator && global.navigator.storage && typeof global.navigator.storage.estimate === 'function'
        ? global.navigator.storage.estimate().then(function (est) {
            var usage = typeof est.usage === 'number' ? est.usage : null;
            var quota = typeof est.quota === 'number' ? est.quota : null;
            var pct = usage !== null && quota ? Math.min(100, Math.round((usage / quota) * 1000) / 10) : null;
            return { supported: true, usageBytes: usage, quotaBytes: quota, percentUsed: pct };
          }).catch(function () {
            return { supported: false, usageBytes: null, quotaBytes: null, percentUsed: null };
          })
        : Promise.resolve({ supported: false, usageBytes: null, quotaBytes: null, percentUsed: null });

    return Promise.all([libraryUsagePromise, browserEstimatePromise]).then(function (results) {
      var lib = results[0];
      var est = results[1];
      return {
        supported: est.supported,
        usageBytes: est.usageBytes,
        quotaBytes: est.quotaBytes,
        percentUsed: est.percentUsed,
        libraryActiveBytes: lib.activeBytes,
        libraryTrashedBytes: lib.trashedBytes,
        libraryTotalBytes: lib.totalLibraryBytes,
        note: 'Browser quota figures are estimates, not exact free device storage.'
      };
    });
  }

  function getPersistenceStatus() {
    if (!global.navigator || !global.navigator.storage || typeof global.navigator.storage.persisted !== 'function') {
      return Promise.resolve({
        supported: false,
        persisted: null,
        status: 'unavailable',
        message: 'This browser does not expose storage persistence controls. Export backups regularly.'
      });
    }

    return global.navigator.storage.persisted().then(function (isPersisted) {
      var granted = Boolean(isPersisted);
      return {
        supported: true,
        persisted: granted,
        status: granted ? 'protected' : 'best-effort',
        message: granted
          ? 'Protected (Browser Granted) — less likely to be cleared automatically, but not guaranteed. Keep external backups.'
          : 'Best-Effort (Not Granted) — browser may evict data when device storage is low. Export backups regularly.'
      };
    }).catch(function () {
      return {
        supported: false,
        persisted: null,
        status: 'unavailable',
        message: 'Could not read storage persistence status. Export backups regularly.'
      };
    });
  }

  function requestPersistentStorage() {
    if (!global.navigator || !global.navigator.storage || typeof global.navigator.storage.persist !== 'function') {
      return Promise.resolve({
        supported: false,
        persisted: null,
        status: 'unavailable',
        message: 'This browser does not support requesting persistent storage. Export backups regularly.'
      });
    }

    return global.navigator.storage.persist().then(function (granted) {
      var isGranted = Boolean(granted);
      return {
        supported: true,
        persisted: isGranted,
        status: isGranted ? 'protected' : 'best-effort',
        message: isGranted
          ? 'Protected (Browser Granted) — less likely to be cleared automatically, but not guaranteed. Keep external backups.'
          : 'Best-Effort (Not Granted) — browser declined persistent storage. Export backups regularly.'
      };
    }).catch(function () {
      return {
        supported: true,
        persisted: false,
        status: 'best-effort',
        message: 'Persistent storage request failed. Data remains best-effort; export backups regularly.'
      };
    });
  }

  function getSetting(key, defaultValue) {
    var cleanKey;
    try {
      cleanKey = assertNonEmptyId(key, 'setting key');
    } catch (err) {
      return Promise.reject(err);
    }

    return runTransaction([STORES.FILE_SETTINGS], 'readonly', function (tx, setResult) {
      var req = tx.objectStore(STORES.FILE_SETTINGS).get(cleanKey);
      req.onsuccess = function () {
        setResult(req.result ? req.result.value : defaultValue);
      };
    });
  }

  function setSetting(key, value) {
    var cleanKey;
    try {
      cleanKey = assertNonEmptyId(key, 'setting key');
    } catch (err) {
      return Promise.reject(err);
    }

    return runTransaction([STORES.FILE_SETTINGS], 'readwrite', function (tx, setResult) {
      var record = { key: cleanKey, value: value, updatedAt: Date.now() };
      tx.objectStore(STORES.FILE_SETTINGS).put(record);
      setResult(record);
    });
  }

  // =========================================================================
  // 10. PUBLIC FROZEN API
  // =========================================================================

  global.StudyVaultFilesDB = Object.freeze({
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    STORES: STORES,
    SIZE_LIMITS: SIZE_LIMITS,
    ALLOWED_FORMATS: ALLOWED_FORMATS,
    BLOCKED_EXTENSIONS: BLOCKED_EXTENSIONS,

    initDB: initDB,
    closeDB: closeDB,
    sanitizeName: sanitizeName,
    validateFileForUpload: validateFileForUpload,

    createFolder: createFolder,
    renameFolder: renameFolder,
    listFolders: listFolders,
    moveFolder: moveFolder,
    trashFolderSubtree: trashFolderSubtree,
    restoreFolderSubtree: restoreFolderSubtree,
    deleteFolderPreserveFiles: deleteFolderPreserveFiles,

    uploadFile: uploadFile,
    uploadFiles: uploadFiles,
    getFileMeta: getFileMeta,
    getFileBlob: getFileBlob,
    listFiles: listFiles,
    renameFile: renameFile,
    moveFile: moveFile,
    markFileOpened: markFileOpened,
    trashFile: trashFile,
    restoreFile: restoreFile,
    permanentlyDeleteFile: permanentlyDeleteFile,
    permanentlyDeleteTrashedItems: permanentlyDeleteTrashedItems,
    emptyTrash: emptyTrash,

    runIntegrityScan: runIntegrityScan,
    repairOrphanedPointers: repairOrphanedPointers,
    purgeConfirmedOrphans: purgeConfirmedOrphans,

    getStorageEstimate: getStorageEstimate,
    getPersistenceStatus: getPersistenceStatus,
    requestPersistentStorage: requestPersistentStorage,
    getSetting: getSetting,
    setSetting: setSetting
  });
})(window);
