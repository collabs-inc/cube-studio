import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !context.parentURL?.startsWith('file:')) throw err;
    let wanted;
    try { wanted = fileURLToPath(new URL(specifier, context.parentURL)); } catch { throw err; }
    const m = /^(.*)[\\/](engine|brand)[\\/](.+)$/.exec(wanted);
    if (!m || !fs.existsSync(path.join(m[1], 'videos'))) throw err;       // only a project's engine/ and brand/
    const fallback = path.join(APP, m[2], m[3]);
    if (!fallback.startsWith(APP + path.sep) || !fs.existsSync(fallback)) throw err;
    return next(pathToFileURL(fallback).href, context);
  }
}
