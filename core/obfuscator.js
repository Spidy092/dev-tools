const fsp = require('fs').promises;
const path = require('path');
const { walkDir } = require('./utils');
const { readFileBuffer } = require('./processingEngine');
const { RESOURCE_POLICY } = require('./resourcePolicy');
const { decodeUtf8, TextEncodingError } = require('./textCodec');

class PhpSourceError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PhpSourceError';
    this.code = code;
  }
}

/**
 * Takes a validated PHP source string and returns an obfuscated PHP string.
 */
function obfuscateCode(code) {
  if (typeof code !== 'string') throw new TypeError('PHP source must be a string.');
  const payload = '?>' + code;
  const encoded = Buffer.from(payload, 'utf8').toString('base64');
  return `<?php eval(base64_decode('${encoded}'));`;
}

function decodePhpSource(buffer) {
  try {
    return decodeUtf8(buffer);
  } catch (error) {
    if (error instanceof TextEncodingError) {
      const map = {
        TEXT_BINARY_INPUT: 'PHP_BINARY_INPUT',
        TEXT_UNSUPPORTED_ENCODING: 'PHP_UNSUPPORTED_ENCODING',
        TEXT_INVALID_UTF8: 'PHP_INVALID_UTF8'
      };
      throw new PhpSourceError(map[error.code] || 'PHP_INVALID_SOURCE',
        error.code === 'TEXT_UNSUPPORTED_ENCODING'
          ? 'PHP Protector accepts UTF-8 source only.'
          : error.code === 'TEXT_BINARY_INPUT'
            ? 'PHP source contains null bytes and will not be obfuscated.'
            : 'PHP Protector accepts valid UTF-8 source only.',
        error);
    }
    throw error;
  }
}

function obfuscateBuffer(buffer) {
  return Buffer.from(obfuscateCode(decodePhpSource(buffer)), 'utf8');
}

async function obfuscateFile(filePath, options = {}) {
  const read = await readFileBuffer(filePath, {
    expectedSize: options.expectedSize,
    maxBytes: Number.isSafeInteger(options.maxBytes) ? options.maxBytes : RESOURCE_POLICY.codeBufferBytes,
    chunkBytes: options.chunkBytes,
    signal: options.signal,
    checkCancelled: options.checkCancelled,
    onBytes: options.onBytes
  });
  return {
    buffer: obfuscateBuffer(read.buffer),
    inputBytes: read.bytes
  };
}

/**
 * Legacy CLI-compatible folder processor. PHP files use the same bounded,
 * strict UTF-8 core API as the web route. Non-PHP files use copyFile so they
 * are never materialized into JavaScript memory.
 */
async function processFolder(inputDir, outputDir, onFile, options = {}) {
  await fsp.mkdir(outputDir, { recursive: true });
  const files = await walkDir(inputDir);

  for (const { fullPath, relativePath } of files) {
    options.checkCancelled?.();
    const outPath = path.join(outputDir, relativePath);
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    const stat = await fsp.stat(fullPath);
    if (!stat.isFile()) continue;

    if (path.extname(fullPath).toLowerCase() === '.php') {
      const result = await obfuscateFile(fullPath, {
        expectedSize: stat.size,
        maxBytes: RESOURCE_POLICY.codeBufferBytes,
        signal: options.signal,
        checkCancelled: options.checkCancelled
      });
      await fsp.writeFile(outPath, result.buffer, { mode: stat.mode & 0o777 });
      if (onFile) onFile(relativePath, 'php');
    } else {
      await fsp.copyFile(fullPath, outPath);
      if (onFile) onFile(relativePath, 'copy');
    }
  }
}

module.exports = {
  PhpSourceError,
  decodePhpSource,
  obfuscateCode,
  obfuscateBuffer,
  obfuscateFile,
  processFolder
};
