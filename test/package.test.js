import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sweep, isMentioned, validateConfig } from '../src/core.js';
import { createService, createGet } from '../src/node.js';
import { runCli } from '../src/cli.js';
const comment=i=>({id:`c${i}`,message:`feedback ${i}`,created_at:'2026-10-22T10:00:00Z'});
async function temporary(fn) {const home=await mkdtemp(path.join(os.tmpdir(),'figma-comments-'));try {await fn(home);} finally {await rm(home,{recursive:true,force:true});}}
test('mentions are configurable, bounded, escaped, and optionally authenticated',()=>{
  for(const message of ['@alex!','Alex Example, thoughts?','<@123>','@[123]','@123 hi']) assert.ok(isMentioned({message},{id:'123'},['alex','Alex Example']));
  for(const message of ['@alexander','person@alex','123','@alex-other','@cam']) assert.equal(isMentioned({message},{id:'123'},['alex']),false);
  assert.ok(isMentioned({message:'@a.b+c?'},undefined,['a.b+c']));
  assert.ok(isMentioned({message:'@designer'},{handle:'designer'}));
});
test('sweep regression: 100-file cap, four concurrent GETs, legacy recovery, only delivered IDs persisted',async()=>{
  let active=0,peak=0,calls=0,state={seenCommentIds:['c0']};
  const config={files:Array.from({length:105},(_,i)=>({key:`file${i}`}))};
  const get=async endpoint=>{if(endpoint==='/me') throw new Error('optional scope'); calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,1));active--;return {comments:endpoint.includes('/file0/')?Array.from({length:105},(_,i)=>comment(i)):[]};};
  let r=await sweep({config,state,get,maxComments:100});assert.equal(r.checkedFiles,100);assert.equal(r.skippedFiles,5);assert.equal(r.deferred,5);assert.ok(r.legacyReset);assert.equal(r.state.reportedCommentIds.length,100);state=r.state;
  r=await sweep({config,state,get,maxComments:100});assert.equal(r.comments.length,5);state=r.state;
  r=await sweep({config,state,get});assert.equal(r.comments.length,0);assert.equal(calls,300);assert.equal(peak,4);
});
test('unseen backlog precedes previously reported mentions, IDs never evicted',async()=>{
  const previous=Array.from({length:6000},(_,i)=>`c${i}`);
  const r=await sweep({config:{files:[{key:'abc'}],aliases:['alex']},state:{reportedCommentIds:previous},maxComments:1,get:async e=>e==='/me'?{}:{comments:[{...comment(0),message:'@alex'},comment(6000)]}});
  assert.equal(r.comments[0].comment.id,'c6000');assert.equal(r.deferred,1);assert.equal(r.state.reportedCommentIds.length,6001);
});
test('malformed config/state never overwritten; add and status require no token',()=>temporary(async home=>{
  const service=createService({home,env:{}});await service.add('https://figma.com/design/abc','Example');assert.equal((await service.status()).pinnedFiles,1);
  await writeFile(path.join(home,'state.json'),'{broken');await assert.rejects(service.add('https://figma.com/board/def'),/Malformed state/);assert.equal(await readFile(path.join(home,'state.json'),'utf8'),'{broken');
  await writeFile(path.join(home,'state.json'),'{}');await writeFile(path.join(home,'config.json'),'{broken');await assert.rejects(service.status(),/Malformed config/);
  assert.throws(()=>validateConfig({keychain:'yes'}),/Invalid config/);
}));
test('GET only, error redaction, endpoint whitelist',async()=>{
  const get=createGet('secret',async(url,options)=>{assert.equal(options.method,'GET');assert.equal(options.redirect,'error');throw new Error('secret');});
  await assert.rejects(get('/me'),e=>!e.message.includes('secret'));await assert.rejects(get('/files/../../evil/comments'),/Unsupported/);
});
test('service persists privately, safe API errors, lock rejection and cleanup',()=>temporary(async home=>{
  const service=createService({home,env:{FIGMA_ACCESS_TOKEN:'secret'},discoverFiles:async()=>[],fetchImpl:async url=>({ok:true,json:async()=>url.endsWith('/me')?{}:{comments:[comment(0),comment(1)]}})});
  await service.add('https://figma.com/design/abc');const r=await service.sweep({maxComments:1});assert.equal(r.deferred,1);assert.equal(JSON.parse(await readFile(path.join(home,'state.json'),'utf8')).reportedCommentIds.length,1);
  if(process.platform!=='win32') assert.equal((await stat(path.join(home,'state.json'))).mode&0o777,0o600);
  await mkdir(path.join(home,'.lock'));await assert.rejects(service.sweep(),/holds the lock/);await rm(path.join(home,'.lock'),{recursive:true});
}));
test('CLI parsing, JSON, limits, and real executable help offline',async()=>{
  let output='',error='',options;const deps={stdout:s=>output=s,stderr:s=>error=s,service:{status:async()=>({authenticated:false}),sweep:async o=>{options=o;return {};}}};
  assert.equal(await runCli(['status','--json'],deps),0);assert.equal(JSON.parse(output).authenticated,false);
  assert.equal(await runCli(['sweep','--json','--all','--max-comments','7'],deps),0);assert.deepEqual(options,{includeSeen:true,maxComments:7});
  assert.equal(await runCli(['sweep','--max-comments','0'],deps),1);assert.match(error,/integer/);
  assert.equal(await runCli(['status','--unknown'],deps),1);
  const help=spawnSync(process.execPath,[fileURLToPath(new URL('../src/cli.js',import.meta.url)),'--help'],{encoding:'utf8'});assert.equal(help.status,0);assert.match(help.stdout,/Usage:/);
});
