const { TextDecoder } = require('node:util');

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16BE_BOM = Buffer.from([0xfe, 0xff]);

function startsWith(buffer, prefix) {
  return buffer.length >= prefix.length && buffer.subarray(0, prefix.length).equals(prefix);
}

function controlCharacterRatio(text) {
  if (!text.length) return 0;
  let controls = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0) return 1;
    if (code < 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13) controls++;
  }
  return controls / text.length;
}

function decodeUtf16Be(buffer) {
  const body = Buffer.from(buffer);
  if (body.length % 2 !== 0) throw new Error('Invalid UTF-16BE byte length');
  body.swap16();
  return body.toString('utf16le');
}

function detectAndDecode(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || []);

  if (startsWith(buffer, UTF8_BOM)) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(3));
    return { text, encoding: 'utf8-bom', supported: controlCharacterRatio(text) <= 0.02 };
  }
  if (startsWith(buffer, UTF16LE_BOM)) {
    const text = buffer.subarray(2).toString('utf16le');
    return { text, encoding: 'utf16le-bom', supported: controlCharacterRatio(text) <= 0.02 };
  }
  if (startsWith(buffer, UTF16BE_BOM)) {
    const text = decodeUtf16Be(buffer.subarray(2));
    return { text, encoding: 'utf16be-bom', supported: controlCharacterRatio(text) <= 0.02 };
  }

  if (buffer.includes(0)) return { text: null, encoding: 'binary', supported: false };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (controlCharacterRatio(text) > 0.02) return { text: null, encoding: 'binary', supported: false };
    return { text, encoding: 'utf8', supported: true };
  } catch (_) {
    return { text: null, encoding: 'unknown', supported: false };
  }
}

function detectLineEndings(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const normalized = text.replace(/\r\n/g, '');
  const lf = (normalized.match(/\n/g) || []).length;
  const cr = (normalized.match(/\r/g) || []).length;
  const kinds = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length;
  if (kinds > 1) return 'mixed';
  if (crlf) return 'crlf';
  if (lf) return 'lf';
  if (cr) return 'cr';
  return 'none';
}

function normalizeLineEndings(text, target) {
  if (target === 'preserve') return text;
  if (target !== 'lf' && target !== 'crlf') throw new Error('Unsupported line ending target.');
  const unified = text.replace(/\r\n|\r|\n/g, '\n');
  return target === 'crlf' ? unified.replace(/\n/g, '\r\n') : unified;
}

function encodeText(text, targetEncoding, originalEncoding) {
  const target = targetEncoding === 'preserve' ? originalEncoding : targetEncoding;
  if (target === 'utf8') return Buffer.from(text, 'utf8');
  if (target === 'utf8-bom') return Buffer.concat([UTF8_BOM, Buffer.from(text, 'utf8')]);
  if (target === 'utf16le-bom') return Buffer.concat([UTF16LE_BOM, Buffer.from(text, 'utf16le')]);
  if (target === 'utf16be-bom') {
    const body = Buffer.from(text, 'utf16le');
    if (body.length % 2 !== 0) throw new Error('Invalid UTF-16 output length');
    body.swap16();
    return Buffer.concat([UTF16BE_BOM, body]);
  }
  throw new Error('Unsupported text encoding target.');
}

function normalizeBuffer(buffer, options = {}) {
  const lineEnding = String(options.lineEnding || 'lf').toLowerCase();
  const encodingMode = String(options.encodingMode || 'utf8').toLowerCase();
  if (!['preserve', 'lf', 'crlf'].includes(lineEnding)) throw new Error('Unsupported line ending target.');
  if (!['preserve', 'utf8', 'utf8-bom'].includes(encodingMode)) throw new Error('Unsupported encoding target.');

  const decoded = detectAndDecode(buffer);
  if (!decoded.supported || decoded.text === null) {
    return {
      output: Buffer.from(buffer),
      changed: false,
      skipped: true,
      reason: decoded.encoding === 'binary' ? 'binary' : 'unsupported-encoding',
      sourceEncoding: decoded.encoding,
      outputEncoding: decoded.encoding,
      sourceLineEnding: 'unknown',
      outputLineEnding: 'unknown'
    };
  }

  const sourceLineEnding = detectLineEndings(decoded.text);
  const normalizedText = normalizeLineEndings(decoded.text, lineEnding);
  const output = encodeText(normalizedText, encodingMode, decoded.encoding);
  const outputEncoding = encodingMode === 'preserve' ? decoded.encoding : encodingMode;
  const outputLineEnding = lineEnding === 'preserve' ? sourceLineEnding : lineEnding;

  return {
    output,
    changed: !Buffer.from(buffer).equals(output),
    skipped: false,
    reason: null,
    sourceEncoding: decoded.encoding,
    outputEncoding,
    sourceLineEnding,
    outputLineEnding
  };
}

module.exports = {
  detectAndDecode,
  detectLineEndings,
  normalizeLineEndings,
  normalizeBuffer
};
