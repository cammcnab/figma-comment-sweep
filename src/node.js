import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractKeys, validateConfig, validateState, sweep } from './core.js';
const exec = promisify(execFile);
export function homeDirectory(env = process.env) { return env.FIGMA_COMMENTS_HOME || path.join(os.homedir(), '.config', 'figma-comments'); }
async function readJson(file, fallback, validate) {
  let text;
  try { text = await fs.readFile(file,'utf8'); } catch (e) { if (e.code === 'ENOENT') return validate(fallback); throw new Error(`Cannot read ${path.basename(file)}.`); }
  let value; try { value = JSON.parse(text); } catch { throw new Error(`Malformed ${path.basename(file)}; repair it before continuing.`); }
  return validate(value);
}
export async function atomicWrite(file,value) {
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp,`${JSON.stringify(value,null,2)}\n`,{mode:0o600,flag:'wx'}); await fs.rename(temp,file); }
  finally { await fs.rm(temp,{force:true}); }
}
async function withLock(home,fn) {
  await fs.mkdir(home,{recursive:true,mode:0o700});
  const lock = path.join(home,'.lock');
  try { await fs.mkdir(lock,{mode:0o700}); } catch(e) { if (e.code === 'EEXIST') throw new Error('Another figma-comments operation holds the lock. If it crashed, remove .lock only after confirming no operation is running.'); throw new Error('Cannot acquire figma-comments lock.'); }
  try { return await fn(); } finally { await fs.rmdir(lock); }
}
async function tokenFor(config,env) {
  if (env.FIGMA_ACCESS_TOKEN?.trim()) return env.FIGMA_ACCESS_TOKEN.trim();
  if (config.keychain && process.platform === 'darwin') {
    try { const {stdout} = await exec('security',['find-generic-password','-s','pi-figma-comments-token','-w']); return stdout.trim() || undefined; } catch { /* Do not expose subprocess output. */ }
  }
}
export function createGet(token, fetchImpl = fetch) {
  return async endpoint => {
    if (!/^\/(?:me|files\/[A-Za-z0-9]+\/comments\?as_md=true)$/.test(endpoint)) throw new Error('Unsupported Figma endpoint.');
    let response; try { response = await fetchImpl(`https://api.figma.com/v1${endpoint}`, {method:'GET',headers:{'X-Figma-Token':token},signal:AbortSignal.timeout(30000),redirect:'error'}); } catch { throw new Error('Figma request failed.'); }
    if (!response.ok) throw new Error(`Figma API HTTP ${response.status}.`);
    try { return await response.json(); } catch { throw new Error('Invalid Figma response.'); }
  };
}
async function scan(root,source,{depth=Infinity,maxFiles=Infinity,binary=false}={}) {
  const result = []; let count = 0;
  async function walk(dir,level) {
    if (level > depth || count >= maxFiles) return;
    let entries; try { entries = await fs.readdir(dir,{withFileTypes:true}); } catch { return; }
    for (const e of entries) {
      if (count >= maxFiles) break;
      const file = path.join(dir,e.name);
      if (e.isDirectory() && e.name !== '.git' && e.name !== 'node_modules') await walk(file,level+1);
      else if (e.isFile() && (binary || e.name.endsWith('.md'))) {
        count++;
        try { const stat = await fs.stat(file); if (stat.size > 8*1024*1024) continue; const content = await fs.readFile(file,binary?'latin1':'utf8'); for (const key of extractKeys(content)) result.push({key,source,label:binary?undefined:e.name,updatedAt:stat.mtimeMs}); } catch { /* Volatile/unreadable discovery input. */ }
      }
    }
  }
  await walk(root,0); return result;
}
export async function discover(config) {
  const candidates = [];
  for (const root of config.searchRoots) candidates.push(...await scan(root.startsWith('~/') ? path.join(os.homedir(),root.slice(2)) : path.resolve(root),'search-root'));
  if (config.desktopRecent && process.platform === 'darwin') {
    const root = path.join(os.homedir(),'Library','Application Support','Figma','DesktopProfile');
    let entries = []; try { entries = await fs.readdir(root,{withFileTypes:true}); } catch { /* Optional desktop cache. */ }
    for (const e of entries.filter(e => e.isDirectory() && /^v\d+$/.test(e.name))) candidates.push(...await scan(path.join(root,e.name),'desktop-recent',{depth:3,maxFiles:250,binary:true}));
  }
  return candidates;
}
export function createService({home=homeDirectory(),env=process.env,fetchImpl=fetch,discoverFiles=discover}={}) {
  const load = async () => ({config:await readJson(path.join(home,'config.json'),{},validateConfig),state:await readJson(path.join(home,'state.json'),{},validateState)});
  return {
    async status() { const {config,state} = await load(); return {home,authenticated:Boolean(await tokenFor(config,env)),pinnedFiles:config.files.length,reportedComments:(state.reportedCommentIds??[]).length,searchRoots:config.searchRoots,desktopRecent:config.desktopRecent,keychain:config.keychain,maxFiles:100}; },
    async add(url,label) { const key = extractKeys(url??'')[0]; if (!key) throw new Error('Provide a Figma file URL.'); return withLock(home,async()=> {const {config}=await load(); config.files=[...config.files.filter(f=>f.key!==key),{key,...(label?{label}:{})}]; await atomicWrite(path.join(home,'config.json'),config); return {key,label};}); },
    async sweep(options={}) { return withLock(home,async()=> {const {config,state}=await load(); const token=await tokenFor(config,env); if (!token) throw new Error('Missing Figma token. Set FIGMA_ACCESS_TOKEN or explicitly enable macOS Keychain in config.json. Requires file_comments:read.'); const result=await sweep({config,state,candidates:await discoverFiles(config),get:createGet(token,fetchImpl),...options}); await atomicWrite(path.join(home,'state.json'),result.state); return result;}); },
  };
}
