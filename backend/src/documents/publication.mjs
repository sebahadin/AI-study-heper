import { createHash } from 'node:crypto';
import { DocumentError } from './errors.mjs';

export const noteSourceText = note => `${note.title}\n\n${note.content}`.replace(/\r\n?/g, '\n');
export const textDigest = text => createHash('sha256').update(text).digest('hex');
export const passageDigest = passages => textDigest(JSON.stringify(passages.map(({ citation: c, text }) => [
  c.chunk_id, text, c.locator, c.page_start ?? null, c.page_end ?? null,
])));
const invalid = () => new DocumentError(422, 'invalid_index_manifest', 'The indexed passage manifest is invalid or incomplete.');
const only = (value, keys) => value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).every(key => keys.includes(key));

export function validatePublication(body, doc, sourceType) {
  if (!only(body, ['lease_token', 'report', 'generation_id', 'manifest_digest', 'source_sha256', 'passages', 'pages_without_text'])) { throw invalid(); }
  const report = body.report;
  if (!only(report, ['job_id', 'document_id', 'source_version', 'status', 'expected_chunks', 'indexed_chunks', 'embedding_model', 'index_version'])
      || report.status !== 'ready' || report.job_id !== doc.indexing.jobId || report.document_id !== String(doc._id)
      || report.source_version !== doc.sourceVersion || body.generation_id !== doc.indexing.generationId
      || body.source_sha256 !== (sourceType === 'note' ? textDigest(noteSourceText(doc)) : doc.sha256)
      || !Number.isSafeInteger(report.expected_chunks) || report.expected_chunks < 1 || report.expected_chunks > 1000
      || report.indexed_chunks !== report.expected_chunks || !Array.isArray(body.passages) || body.passages.length !== report.expected_chunks
      || !['embedding_model', 'index_version'].every(key => typeof report[key] === 'string' && report[key].length > 0 && report[key].length < 1024)) { throw invalid(); }
  const ids = new Set();
  let bytes = 0;
  for (const passage of body.passages) {
    if (!only(passage, ['citation', 'text']) || typeof passage.text !== 'string' || !passage.text.trim()
        || passage.text.length > 20000 || /[\uD800-\uDFFF]/u.test(passage.text)) { throw invalid(); }
    bytes += Buffer.byteLength(passage.text);
    const c = passage.citation;
    const source = c?.source;
    if (!only(c, ['chunk_id', 'source', 'locator', 'page_start', 'page_end'])
        || !only(source, ['source_id', 'source_type', 'source_version', 'book_id', 'index_generation'])
        || source.source_id !== String(doc._id) || source.source_type !== sourceType || source.source_version !== doc.sourceVersion
        || source.index_generation !== body.generation_id || (source.book_id !== undefined && source.book_id !== null)
        || typeof c.chunk_id !== 'string' || !/^[a-z]+-[a-f0-9]{64}$/.test(c.chunk_id) || ids.has(c.chunk_id)) { throw invalid(); }
    ids.add(c.chunk_id);
    if (sourceType === 'document') {
      if (!Number.isInteger(c.page_start) || c.page_start < 1 || c.page_start > doc.pageCount
          || ((c.page_end !== null && c.page_end !== undefined) && c.page_end !== c.page_start) || c.locator !== `page ${c.page_start}`) { throw invalid(); }
    } else if ((c.page_start !== null && c.page_start !== undefined) || (c.page_end !== null && c.page_end !== undefined) || !/^paragraph [1-9][0-9]*$/.test(c.locator)
               || !noteSourceText(doc).includes(passage.text)) { throw invalid(); }
  }
  if (bytes > 2000000 || body.manifest_digest !== passageDigest(body.passages)) { throw invalid(); }
  const missing = body.pages_without_text || [];
  if (!Array.isArray(missing) || missing.some(page => sourceType !== 'document' || !Number.isInteger(page) || page < 1 || page > doc.pageCount)
      || new Set(missing).size !== missing.length) { throw invalid(); }
  return {
    activeGeneration: body.generation_id, manifestDigest: body.manifest_digest,
    embeddingModel: report.embedding_model, indexVersion: report.index_version,
    passages: body.passages, indexedChunks: report.indexed_chunks, pagesWithoutText: missing,
  };
}
