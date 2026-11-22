/* ==========================================================================
   GARAGE'S STUDY VAULT v4.1 — STAGE 1: StudyVaultFilesDB ENGINE
   File: js/files-db.js
   Isolated local-first IndexedDB storage, validation, and integrity engine.
   Zero external dependencies. Classic-script IIFE exposing window.StudyVaultFilesDB.
   ========================================================================== */

(function (global) {
  'use strict';

  // Guard against accidental global overwrite
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

  // Documented conservative per-file size limits (bytes).
  // Note: Actual usable capacity depends on device RAM, OS limits, and browser quota.
  var SIZE_LIMITS = Object.freeze({
    pdf: 50 * 1024 * 1024,    // 50 MB
    image: 20 * 1024 * 1024,  // 20 MB
    text: 5 * 1024 * 1024,    // 5 MB
    office: 30 * 1024 * 1024  // 30 MB
  });

  var MAX_NAME_LENGTH = 120;
  var TEXT_SAMPLE_BYTES = 8192;
  var ZIP_EOCD_WINDOW = 65557;       // 22-byte EOCD + max 65535-byte comment
  var ZIP_MAX_CD_INSPECT = 2 * 1024 * 1024; // Cap central-directory slice at 2 MB

  // Explicitly blocked executable, script, active-markup, and macro extensions
  var BLOCKED_EXTENSIONS = Object.freeze([
    'html', 'htm', 'xhtml', 'svg', 'svgz',
    'js', 'mjs', 'cjs', 'ts',
    'exe', 'dll', 'msi', 'apk', 'dmg', 'app',
    'bat', 'cmd', 'sh', 'ps1', 'vbs', 'jar',
    'docm', 'xlsm', 'pptm'
  ]);

  // Allowlisted file formats (MIME types are assigned from validated format, not browser input)
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
  // 2. STRUCTURED ERROR TYPE & HELPERS
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
    // Strip path separators, null bytes, and ASCII control characters
    var cleaned = rawName
      .replace(/[\u0000-\u001f\u007f]/g, '')
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
  // 3. DATABASE CONNECTION MANAGEMENT (StudyVaultFilesDB v1)
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

        // Store 1: folders
        if (!db.objectStoreNames.contains(STORES.FOLDERS)) {
          var folderStore = db.createObjectStore(STORES.FOLDERS, { keyPath: 'id' });
          folderStore.createIndex('by_parentId', 'parentId', { unique: false });
          folderStore.createIndex('by_deletedAt', 'deletedAt', { unique: false });
          folderStore.createIndex('by_name', 'nameLower', { unique: false });
        }

        // Store 2: filesMeta (isolated from binary blobs for fast listing/search/sort)
        if (!db.objectStoreNames.contains(STORES.FILES_META)) {
          var metaStore = db.createObjectStore(STORES.FILES_META, { keyPath: 'id' });
          metaStore.createIndex('by_folderId', 'folderId', { unique: false });
          metaStore.createIndex('by_deletedAt', 'deletedAt', { unique: false });
          metaStore.createIndex('by_updatedAt', 'updatedAt', { unique: false });
          metaStore.createIndex('by_name', 'nameLower', { unique: false });
          metaStore.createIndex('by_mimeType', 'mimeType', { unique: false });
        }

        // Store 3: fileBlobs (binary payloads only)
        if (!db.objectStoreNames.contains(STORES.FILE_BLOBS)) {
          db.createObjectStore(STORES.FILE_BLOBS, { keyPath: 'id' });
        }

        // Store 4: fileSettings (library-specific metadata)
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

        db.onversionchange = function () {
          db.close();
          if (dbConnection === db) {
            dbConnection = null;
          }
          openPromise = null;
        };

        db.onclose = function () {
          if (dbConnection === db) {
            dbConnection = null;
          }
          openPromise = null;
        };

        dbConnection = db;
        openPromise = null;

        if (!settled) {
          settled = true;
          resolve(db);
        }
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

  // Promisify a single IDBRequest inside an active transaction
  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB request failed')); };
    });
  }

  // Execute a callback inside a single IDB transaction.
  // IMPORTANT: Callers must NEVER await non-IDB Promises inside workFn.
  function runTransaction(storeNames, mode, workFn) {
    return initDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try {
          tx = db.transaction(storeNames, mode);
        } catch (err) {
          reject(createVaultError('TX_FAILED', 'Failed to start transaction.', err));
          return;
        }

        var resultValue;
        var customError = null;
        var settled = false;

        function failOnce(err) {
          if (settled) return;
          settled = true;
          reject(err);
        }

        tx.oncomplete = function () {
          if (settled) return;
          settled = true;
          resolve(resultValue);
        };

        tx.onabort = function () {
          if (customError) {
            failOnce(customError);
            return;
          }
          var txErr = tx.error;
          if (isQuotaError(txErr)) {
            failOnce(
              createVaultError(
                'QUOTA_EXCEEDED',
                'Browser storage quota exceeded. Free up space or export and remove large files.',
                txErr
              )
            );
            return;
          }
          failOnce(
            createVaultError(
              'TX_ABORTED',
              'Transaction aborted: ' + (txErr ? txErr.message : 'Operation rolled back.'),
              txErr || null
            )
          );
        };

        tx.onerror = function () {
          if (customError) {
            failOnce(customError);
            return;
          }
          var txErr = tx.error;
          if (isQuotaError(txErr)) {
            failOnce(
              createVaultError(
                'QUOTA_EXCEEDED',
                'Browser storage quota exceeded. Free up space or export and remove large files.',
                txErr
              )
            );
            return;
          }
          failOnce(
            createVaultError(
              'TX_FAILED',
              'Transaction failed: ' + (txErr ? txErr.message : 'Unknown error'),
              txErr || null
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
  //    Note: Format/consistency check only — never executes or renders files.
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
        // %PDF-
        return hasBytesAt(bytes, 0, [0x25, 0x50, 0x44, 0x46, 0x2d]);
      case 'png':
        // 89 50 4E 47 0D 0A 1A 0A
        return hasBytesAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      case 'jpg':
      case 'jpeg':
        // FF D8 FF
        return hasBytesAt(bytes, 0, [0xff, 0xd8, 0xff]);
      case 'gif':
        // GIF87a or GIF89a
        return (
          hasBytesAt(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
          hasBytesAt(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
        );
      case 'webp':
        // RIFF....WEBP
        return (
          hasBytesAt(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
          hasBytesAt(bytes, 8, [0x57, 0x45, 0x42, 0x50])
        );
      default:
        return false;
    }
  }

  // Trim up to 3 trailing bytes if a multi-byte UTF-8 sequence was cut at the sample boundary
  function trimTruncatedUtf8Tail(bytes, isPartialSample) {
    if (!isPartialSample || bytes.length === 0) return bytes;
    var len = bytes.length;
    var checkCount = Math.min(3, len);
    for (var back = 1; back <= checkCount; back++) {
      var b = bytes[len - back];
      // ASCII byte: boundary is clean
      if ((b & 0x80) === 0) return bytes;
      // UTF-8 lead byte found
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
      // 1. Null-byte scan (rejects disguised binaries)
      for (var i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0x00) {
          throw createVaultError(
            'INVALID_TEXT_ENCODING',
            'Plain-text file contains binary null bytes and was rejected.'
          );
        }
      }

      // 2. Strict UTF-8 decoding
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

  // Pure-JS ZIP Central Directory marker check for OOXML (.docx, .pptx, .xlsx).
  // Reads only the tail EOCD window + Central Directory slice (never the full file).
  function validateOoxmlStructure(blob, expectedPrefix) {
    return readBlobSliceBytes(blob, 0, 4).then(function (header) {
      // Local file header signature: PK\x03\x04
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

        var cdSize = tailView.getUint32(eocdOffset + 12, true);
        var cdOffset = tailView.getUint32(eocdOffset + 16, true);

        // ZIP64 central directory sentinel check
        if (cdSize === 0xffffffff || cdOffset === 0xffffffff) {
          throw createVaultError(
            'INVALID_OOXML',
            'ZIP64 Office archives are not supported for browser inspection.'
          );
        }

        if (cdSize === 0 || cdSize > ZIP_MAX_CD_INSPECT || cdOffset + cdSize > blob.size) {
          throw createVaultError(
            'INVALID_OOXML',
            'Office archive directory is invalid or exceeds safe inspection bounds.'
          );
        }

        return readBlobSliceBytes(blob, cdOffset, cdOffset + cdSize).then(function (cdBytes) {
          var cdView = new DataView(cdBytes.buffer, cdBytes.byteOffset, cdBytes.byteLength);
          var decoder = typeof TextDecoder !== 'undefined'
            ? new TextDecoder('utf-8', { fatal: false })
            : null;

          var cursor = 0;
          var hasContentTypes = false;
          var hasExpectedPrefix = false;
          var hasMacroBinary = false;

          while (cursor + 46 <= cdBytes.length) {
            // Central directory file header signature: PK\x01\x02
            if (
              cdBytes[cursor] !== 0x50 ||
              cdBytes[cursor + 1] !== 0x4b ||
              cdBytes[cursor + 2] !== 0x01 ||
              cdBytes[cursor + 3] !== 0x02
            ) {
              break;
            }

            var nameLen = cdView.getUint16(cursor + 28, true);
            var extraLen = cdView.getUint16(cursor + 30, true);
            var commentLen = cdView.getUint16(cursor + 32, true);
            var nameStart = cursor + 46;
            var nameEnd = nameStart + nameLen;

            if (nameEnd > cdBytes.length) break;

            var entryName = '';
            if (decoder) {
              entryName = decoder.decode(cdBytes.subarray(nameStart, nameEnd));
            } else {
              for (var k = nameStart; k < nameEnd; k++) {
                entryName += String.fromCharCode(cdBytes[k]);
              }
            }

            var lowerEntry = entryName.toLowerCase();
            if (lowerEntry === '[content_types].xml') {
              hasContentTypes = true;
            }
            if (lowerEntry.indexOf(expectedPrefix) === 0) {
              hasExpectedPrefix = true;
            }
            if (lowerEntry.indexOf('vbaproject.bin') !== -1) {
              hasMacroBinary = true;
            }

            cursor = nameEnd + extraLen + commentLen;
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
  // 5. HIERARCHY & SUBTREE HELPERS (PURE SYNCHRONOUS FUNCTIONS)
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

  // Collects targetFolderId plus all descendant folder IDs using a visited set (cycle-safe)
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
    var targetParentId = filterByParent ? assertNullableId(opts.parentId, 'parentId') : null;

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

        // Collect target + all active descendants
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

        // Collect target + all trashed descendants
        var affectedFolderIds = collectDescendantFolderIds(cleanId, allFolders, function (f) {
          return f.deletedAt !== null;
        });
        var affectedSet = Object.create(null);
        for (var i = 0; i < affectedFolderIds.length; i++) {
          affectedSet[affectedFolderIds[i]] = true;
        }

        // If original parent no longer exists or is still trashed, restore subtree to Root
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
          if (f && f.deletedAt !== null) {
            f.deletedAt = null;
            f.updatedAt = now;
            folderStore.put(f);
            restoredFolders++;
          }
        }

        for (var k = 0; k < allFiles.length; k++) {
          var file = allFiles[k];
          if (file.deletedAt !== null && file.folderId !== null && affectedSet[file.folderId]) {
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

  // Deletes a folder (and any nested subfolders) while preserving all files by moving them
  // to the folder's parent ('parent') or Root ('root').
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
          abortWith(createVaultError('ALREADY_TRASHED', 'Cannot delete-and-preserve a trashed folder. Restore or permanently delete it from Trash.'));
          return;
        }

        var affectedFolderIds = collectDescendantFolderIds(cleanId, allFolders, null);
        var affectedSet = Object.create(null);
        for (var i = 0; i < affectedFolderIds.length; i++) {
          affectedSet[affectedFolderIds[i]] = true;
        }

        // Determine safe destination folder ID
        var destFolderId = null;
        if (destMode === 'parent' && target.parentId !== null) {
          var parent = folderMap[target.parentId];
          if (parent && parent.deletedAt === null && !affectedSet[parent.id]) {
            destFolderId = parent.id;
          }
        }

        var now = Date.now();
        var movedFiles = 0;

        for (var k = 0; k < allFiles.length; k++) {
          var file = allFiles[k];
          if (file.folderId !== null && affectedSet[file.folderId]) {
            file.folderId = destFolderId;
            if (file.originalFolderId && affectedSet[file.originalFolderId]) {
              file.originalFolderId = destFolderId;
            }
            file.updatedAt = now;
            metaStore.put(file);
            movedFiles++;
          }
        }

        for (var j = 0; j < affectedFolderIds.length; j++) {
          folderStore.delete(affectedFolderIds[j]);
        }

        setResult({
          deletedFolders: affectedFolderIds.length,
          movedFiles: movedFiles,
          destinationFolderId: destFolderId
        });
      }

      foldersReq.onsuccess = function () { allFolders = foldersReq.result || []; processWhenReady(); };
      filesReq.onsuccess = function () { allFiles = filesReq.result || []; processWhenReady(); };
    });
  }

  // =========================================================================
  // 7. FILE UPLOAD, METADATA, BLOB RETRIEVAL, RENAME, MOVE, TRASH & PURGE
  // =========================================================================

  function uploadFile(file, options) {
    var opts = options || {};
    var folderId;
    try {
      folderId = assertNullableId(opts.folderId, 'folderId');
    } catch (err) {
      return Promise.reject(err);
    }

    // Step 1: Complete ALL async validation BEFORE opening the write transaction
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

      // Step 2: Single atomic readwrite transaction across folders, filesMeta, fileBlobs
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

  // Multi-file upload: atomic per file, accurately reporting per-file success and failure
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
    var targetFolderId = filterByFolder ? assertNullableId(opts.folderId, 'folderId') : null;
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

        // Preserve stored extension integrity; disallow changing extension to another format
        var candidateExt = extractExtension(safeInput);
        var finalName = safeInput;
        if (!candidateExt) {
          finalName = sanitizeName(safeInput + '.' + file.ext, true);
        } else if (candidateExt !== file.ext) {
          abortWith(
            createVaultError(
              'INVALID_NAME',
              'Cannot change file extension from ".' + file.ext + '" to ".' + candidateExt + '".'
            )
          );
          return;
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

          // Validate and expand selected trashed folders + trashed descendants
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

          // Include all trashed files located inside folders being permanently deleted
          for (var k = 0; k < allFiles.length; k++) {
            var candidate = allFiles[k];
            if (candidate.deletedAt !== null && candidate.folderId !== null && foldersToDelete[candidate.folderId]) {
              filesToDelete[candidate.id] = true;
            }
          }

          // Validate explicitly selected trashed files
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

  // =========================================================================
  // 8. READ-ONLY INTEGRITY SCANNER & EXPLICIT USER-AUTHORIZED REPAIRS
  //    Never runs automatically on load; never auto-deletes or auto-repairs.
  // =========================================================================

  function runIntegrityScan() {
    return runTransaction(
      [STORES.FOLDERS, STORES.FILES_META, STORES.FILE_BLOBS],
      'readonly',
      function (tx, setResult) {
        var foldersReq = tx.objectStore(STORES.FOLDERS).getAll();
        var metaReq = tx.objectStore(STORES.FILES_META).getAll();
        // getAllKeys() avoids loading binary blobs into RAM
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

            // Detect hierarchy cycles
            var path = [];
            var seenInWalk = Object.create(null);
            var curr = f.id;
            while (curr !== null && curr !== undefined) {
              if (seenInWalk[curr]) {
                if (!reportedCycleIds[curr]) {
                  reportedCycleIds[curr] = true;
                  var cycleStart = path.indexOf(curr);
                  folderCycles.push({
                    entryFolderId: curr,
                    cyclePath: path.slice(cycleStart).concat(curr)
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
        complete:
