import { DocumentError } from '../documents/errors.mjs';

export async function readBoundedBody(body, maxBytes) {
  const chunks = [];
  let size = 0;
  let complete = false;
  try {
    for await (const chunk of body) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) {
        throw new DocumentError(413, 'pdf_too_large', 'The PDF exceeds the file-size limit.');
      }
      chunks.push(bytes);
    }
    complete = true;
    return Buffer.concat(chunks, size);
  } finally {
    if (!complete) {
      body.destroy?.();
      await body.cancel?.().catch(() => {});
    }
  }
}
