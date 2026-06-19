const CHUNK_SIZE = 8 * 1024 * 1024;
const TUS_VERSION = '1.0.0';

function b64(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function authHeaders(token) {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function parseLocation(location) {
  if (!location) return null;
  const parts = location.split('/').filter(Boolean);
  return parts[parts.length - 1] || null;
}

async function readJson(response) {
  const text = await response.text().catch(() => '');
  try {
    return text ? JSON.parse(text) : {};
  } catch (_) {
    return { raw: text };
  }
}

export async function createTusUpload(file, { projectId, token, onProgress }) {
  const metadata = [
    `filename ${b64(file.name)}`,
    `filetype ${b64(file.type || 'application/octet-stream')}`,
  ];
  if (projectId) metadata.push(`project_id ${b64(projectId)}`);
  const res = await fetch('/api/upload/resumable', {
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/offset+octet-stream',
      'Tus-Resumable': TUS_VERSION,
      'Upload-Length': String(file.size),
      'Upload-Metadata': metadata.join(','),
    },
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(body.error || body.message || `TUS create failed (${res.status})`);
  const id = parseLocation(res.headers.get('Location')) || body.id;
  if (!id) throw new Error('TUS create response missing Location/id');
  return { id, body };
}

export async function patchTusChunk(file, uploadId, offset, token) {
  const end = Math.min(offset + CHUNK_SIZE, file.size);
  const blob = file.slice(offset, end);
  const res = await fetch(`/api/upload/resumable/${encodeURIComponent(uploadId)}`, {
    method: 'PATCH',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/offset+octet-stream',
      'Tus-Resumable': TUS_VERSION,
      'Upload-Offset': String(offset),
      'Content-Range': `bytes ${offset}-${end - 1}/${file.size}`,
    },
    body: blob,
  });
  if (!res.ok) {
    const body = await readJson(res);
    throw new Error(body.error || body.message || `TUS patch failed (${res.status})`);
  }
  const nextOffset = Number(res.headers.get('Upload-Offset') || end);
  return nextOffset;
}

export async function getTusIngest(uploadId, token) {
  const res = await fetch(`/api/upload/resumable/${encodeURIComponent(uploadId)}/ingest`, {
    headers: authHeaders(token),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(body.error || body.message || `TUS ingest failed (${res.status})`);
  return body.result || body;
}

export async function uploadMediaFile(file, { projectId, token, onProgress }) {
  const { id } = await createTusUpload(file, { projectId, token, onProgress });
  let offset = 0;
  while (offset < file.size) {
    offset = await patchTusChunk(file, id, offset, token);
    if (typeof onProgress === 'function') onProgress(Math.min(1, offset / Math.max(1, file.size)));
  }
  if (typeof onProgress === 'function') onProgress(1);
  return id;
}
