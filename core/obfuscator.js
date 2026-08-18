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

function assertSeparateTrees(inputDir, outputDir) {
  const input = path.resolve(inputDir);
  const output = path.resolve(outputDir);
  const relative = path.relative(input, output);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    const error = new Error('Output directory must be outside the input project tree.');
    error.code = 'OUTPUT_INSIDE_INPUT';
    throw error;
  }
  return { input, output };
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
 * CLI-compatible folder processor. PHP files use the same bounded, strict
 * UTF-8 core API as the web route. The output tree must live outside the input
 * tree, and symbolic-link roots are rejected by walkDir().
 */
async function processFolder(inputDir, outputDir, onFile, options = {}) {
  const roots = assertSeparateTrees(inputDir, outputDir);
  const files = await walkDir(roots.input, roots.input, {
    maxFiles: RESOURCE_POLICY.maxFiles,
    maxDirectories: RESOURCE_POLICY.maxFiles,
    maxDepth: 128
  });

  let existingOutput;
  try { existingOutput = await fsp.lstat(roots.output); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existingOutput?.isSymbolicLink()) {
    const error = new Error('Output directory cannot be a symbolic link.');
    error.code = 'OUTPUT_SYMLINK';
    throw error;
  }
  if (existingOutput && !existingOutput.isDirectory()) {
    const error = new Error('Output path exists and is not a directory.');
    error.code = 'INVALID_OUTPUT_DIRECTORY';
    throw error;
  }
  await fsp.mkdir(roots.output, { recursive: true });

  for (const { fullPath, relativePath } of files) {
    options.checkCancelled?.();
    const outPath = path.join(roots.output, relativePath);
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
  assertSeparateTrees,
  decodePhpSource,
  obfuscateCode,
  obfuscateBuffer,
  obfuscateFile,
  processFolder
};
