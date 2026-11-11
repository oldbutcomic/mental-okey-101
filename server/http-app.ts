import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

type HttpAppOptions = {
  distDirectory: string;
  healthCheck: () => Promise<boolean>;
  isClientOriginAllowed: (origin: string | undefined) => boolean;
};

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendJson(response: ServerResponse, status: number, body: unknown) {
  const content = JSON.stringify(body);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(content),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(content);
}

function sendNotFound(response: ServerResponse) {
  sendJson(response, 404, { error: 'Not found' });
}

async function existingFile(path: string): Promise<{ path: string; size: number } | null> {
  try {
    const info = await stat(path);
    if (info.isFile()) return { path, size: info.size };
    if (info.isDirectory()) {
      const indexPath = resolve(path, 'index.html');
      const indexInfo = await stat(indexPath);
      if (indexInfo.isFile()) return { path: indexPath, size: indexInfo.size };
    }
  } catch {
    return null;
  }
  return null;
}

async function sendStaticFile(request: IncomingMessage, response: ServerResponse, filePath: string, size: number) {
  const extension = extname(filePath).toLowerCase();
  const isHtml = extension === '.html';
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  const isHashedAsset = pathname.startsWith('/assets/') && /-[\w-]{8,}\.[^/.]+$/.test(pathname);
  response.writeHead(200, {
    'Cache-Control': isHtml ? 'no-cache' : isHashedAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    'Content-Length': size,
    'Content-Type': contentTypes[extension] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.once('error', error => {
    console.error('[http] Static file read failed', error);
    if (!response.headersSent) sendJson(response, 500, { error: 'Static file unavailable' });
    else response.destroy(error);
  });
  stream.pipe(response);
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, options: HttpAppOptions) {
  let url: URL;
  try {
    url = new URL(request.url || '/', 'http://localhost');
  } catch {
    sendJson(response, 400, { error: 'Invalid request URL' });
    return;
  }

  const pathname = url.pathname;
  // Socket.IO attaches its own request listener to the same HTTP server.
  if (pathname === '/socket.io' || pathname.startsWith('/socket.io/')) return;

  if (pathname === '/healthz') {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
    if (!options.isClientOriginAllowed(origin)) {
      response.writeHead(403, { 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, OPTIONS' });
      response.end();
      return;
    }
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET, OPTIONS' });
      response.end();
      return;
    }
    try {
      const healthy = await options.healthCheck();
      sendJson(response, healthy ? 200 : 503, { status: healthy ? 'ok' : 'unavailable' });
    } catch {
      sendJson(response, 503, { status: 'unavailable' });
    }
    return;
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    sendNotFound(response);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname).replaceAll('\\', '/');
  } catch {
    sendJson(response, 400, { error: 'Invalid asset path' });
    return;
  }
  const distRoot = resolve(options.distDirectory);
  const relativePath = decodedPath.replace(/^\/+/, '') || 'index.html';
  const requestedPath = resolve(distRoot, relativePath);
  const fromRoot = relative(distRoot, requestedPath);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    sendJson(response, 403, { error: 'Invalid asset path' });
    return;
  }

  let file = await existingFile(requestedPath);
  if (!file && request.headers.accept?.includes('text/html') && !extname(decodedPath)) {
    file = await existingFile(resolve(distRoot, 'index.html'));
  }
  if (!file) {
    const indexFile = await existingFile(resolve(distRoot, 'index.html'));
    if (!indexFile) {
      sendJson(response, 503, { error: 'Frontend build is unavailable' });
      return;
    }
    sendNotFound(response);
    return;
  }
  await sendStaticFile(request, response, file.path, file.size);
}

export function createHttpRequestHandler(options: HttpAppOptions) {
  return (request: IncomingMessage, response: ServerResponse) => {
    void handleRequest(request, response, options).catch(error => {
      console.error('[http] Request failed', error);
      if (!response.headersSent) sendJson(response, 500, { error: 'Request failed' });
      else response.destroy(error instanceof Error ? error : undefined);
    });
  };
}
