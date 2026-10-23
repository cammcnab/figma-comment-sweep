import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweep, formatSweep } from '../src/core.js';
const c = (id, message, parent_id = '', user = {id:'other', name:'Alex'}) => ({id,message,parent_id,user,created_at:'2026-10-22T10:00:00Z'});
const run = (comments, options = {}, me = {id:'me',name:'Alex'}) => sweep({config:{files:[{key:'abc'}],aliases:['alex']},get:async e => e === '/me' ? me : {comments},...options});
test('replies get parent, mention and subsequent discussion; context does not deliver deferred IDs', async () => {
  const r = await run([c('z','@alex review'),c('a','reply','z'),c('b','follow up','z')],{maxComments:1,state:{reportedCommentIds:['z']}});
  assert.equal(r.comments[0].comment.id,'a');
  assert.equal(r.comments[0].relevanceReason,'thread-follow-up');
  assert.deepEqual(r.comments[0].context.map(i=>i.comment.id),['z','b']);
  assert.ok(r.comments[0].context.every(i=>i.isContext));
  assert.deepEqual(r.state.reportedCommentIds,['z','a']);
  assert.equal(r.deferred,2);
});
test('own identity uses ID only, own parent retained as context, own mentions excluded', async () => {
  const r = await run([c('root','@alex own','',{id:'me',name:'Someone'}),c('reply','same display name','root')]);
  assert.equal(r.comments.length,1);
  assert.equal(r.comments[0].comment.id,'reply');
  assert.equal(r.comments[0].context[0].isOwn,true);
  assert.equal(r.comments[0].context[0].isContext,true);
  assert.deepEqual(r.state.reportedCommentIds,['reply']);
  assert.match(formatSweep(r),/\[context, you\]/);
});
test('missing identity preserves aliases and never guesses authorship',async()=>{
  for (const me of [{name:'Alex'},null]) {
    const r=await run([c('one','@alex thoughts','',{id:'me',name:'Alex'})],{},me);
    assert.equal(r.comments.length,1);
    assert.equal(r.comments[0].isOwn,false);
    assert.equal(r.comments[0].mentioned,true);
  }
  const r=await run([c('one','@alex thoughts')],{get:async e=>{if(e==='/me')throw Error('no scope');return {comments:[c('one','@alex thoughts')]};}});
  assert.equal(r.comments[0].mentioned,true);
});
test('context bounded with omissions; recurring mention does not replay old discussion',async()=>{
  const comments=[c('root','@alex') ,...Array.from({length:20},(_,i)=>c(`r${i}`,'discussion','root'))];
  let r=await run(comments,{maxComments:1});
  assert.ok(r.comments[0].context.length<=7);
  assert.ok(r.comments[0].contextOmitted>0);
  assert.match(formatSweep(r),/thread comments omitted/);
  r=await run(comments,{state:{reportedCommentIds:comments.map(c=>c.id)}});
  assert.equal(r.comments.length,1);
  assert.deepEqual(r.comments[0].context,[]);
  assert.equal(r.comments[0].contextOmitted,20);
});
test('out-of-order equal timestamps deterministic, root precedes replies, missing parents explicit',async()=>{
  const comments=[c('b','reply','z'),c('z','@alex'),c('a','reply','z')];
  const a=await run(comments), b=await run([...comments].reverse());
  const find=r=>r.comments.find(i=>i.comment.id==='b');
  assert.deepEqual(find(a).context.map(i=>i.comment.id),['z','a']);
  assert.deepEqual(find(a).context,find(b).context);
  const missing=await run([c('one','reply','missing')]);
  assert.equal(missing.comments[0].parentMissing,true);
  assert.match(formatSweep(missing),/Parent comment unavailable/);
});
test('own replies are context only and explicit history keeps truthful reasons',async()=>{
  const comments=[c('root','@alex'),c('own','my answer','root',{id:'me'}),c('reply','next answer','root')];
  const r=await run(comments);
  assert.deepEqual(r.comments.map(i=>i.comment.id),['root','reply']);
  assert.equal(r.comments[0].context.find(i=>i.comment.id==='own').isOwn,true);
  assert.equal(r.comments[1].relevanceReason,'thread-follow-up');
  assert.ok(!r.state.reportedCommentIds.includes('own'));
  const history=await run([c('plain','old')],{includeSeen:true,state:{reportedCommentIds:['plain']}});
  assert.equal(history.comments[0].relevanceReason,'previously-reported-in-watched-file');
});
test('threads are file-local even when parent IDs collide',async()=>{
  const r=await sweep({config:{files:[{key:'abc'},{key:'def'}],aliases:['alex']},get:async e=>e==='/me'?{}:{comments:e.includes('/abc/')?[c('root','@alex')]:[c('reply','unrelated','root')]}});
  const reply=r.comments.find(i=>i.comment.id==='reply');
  assert.deepEqual(reply.context,[]);
  assert.equal(reply.relevanceReason,'new-in-watched-file');
  assert.equal(reply.parentMissing,true);
});
