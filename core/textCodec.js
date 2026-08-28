const { TextDecoder } = require('util');

class TextEncodingError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'TextEncodingError';
    this.code = code;
  }
}

function decodeUtf8(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Text source must be a Buffer.');
  if (options.rejectNull !== false && buffer.includes(0)) {
    throw new TextEncodingError('TEXT_BINARY_INPUT', 'Text source contains null bytes.');
  }
  if (buffer.length >= 2 && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))) {
    throw new TextEncodingError('TEXT_UNSUPPORTED_ENCODING', 'This processor accepts UTF-8 source only.');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (error) {
    throw new TextEncodingError('TEXT_INVALID_UTF8', 'Text source is not valid UTF-8.', error);
  }
}

module.exports = {
  TextEncodingError,
  decodeUtf8
};
