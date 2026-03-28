import { extname } from 'path';

export function normalizeUploadedFilename(filename: string) {
  if (!filename) {
    return filename;
  }

  const decoded = Buffer.from(filename, 'latin1').toString('utf8');

  if (decoded.includes('\uFFFD')) {
    return filename;
  }

  return decoded;
}

export function buildAttachmentContentDisposition(filename: string) {
  const normalizedName = normalizeUploadedFilename(filename);
  const fallbackName = createAsciiFallbackFilename(normalizedName);

  return `attachment; filename="${escapeQuotedString(
    fallbackName,
  )}"; filename*=UTF-8''${encodeRFC5987Value(normalizedName)}`;
}

function createAsciiFallbackFilename(filename: string) {
  const extension = extname(filename);
  const basename = extension ? filename.slice(0, -extension.length) : filename;
  const asciiBasename = basename
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/["\\]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  const asciiExtension = extension.replace(/[^\x20-\x7E]/g, '');

  if (asciiBasename) {
    return `${asciiBasename}${asciiExtension}`;
  }

  return `download${asciiExtension || ''}`;
}

function encodeRFC5987Value(value: string) {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function escapeQuotedString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
