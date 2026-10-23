import { isMentioned, selectForReport, reportedIds, withThreadContext } from './logic.js';
export { isMentioned, selectForReport, reportedIds } from './logic.js';
export const MAX_FILES = 100;
export function extractKeys(text) {
  return [...text.matchAll(/https?:\/\/(?:www\.)?figma\.com\/(?:design|file|board|proto|slides)\/([A-Za-z0-9]+)/g)].map(m => m[1]);
}
export function validateConfig(value) {
  const fail = () => { throw new Error('Invalid config.json; see README for the configuration schema.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  for (const key of Object.keys(value)) if (!['files','aliases','searchRoots','desktopRecent','keychain'].includes(key)) fail();
  for (const key of ['aliases','searchRoots']) if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some(x => typeof x !== 'string' || !x.trim()))) fail();
  for (const key of ['desktopRecent','keychain']) if (value[key] !== undefined && typeof value[key] !== 'boolean') fail();
  if (value.files !== undefined && (!Array.isArray(value.files) || value.files.some(f => !f || typeof f.key !== 'string' || !/^[A-Za-z0-9]+$/.test(f.key) || (f.label !== undefined && typeof f.label !== 'string')))) fail();
  return { files: [], aliases: [], searchRoots: [], desktopRecent: false, keychain: false, ...value };
}
export function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ['reportedCommentIds','seenCommentIds'].some(k => value[k] !== undefined && (!Array.isArray(value[k]) || value[k].some(x => typeof x !== 'string'))) || (value.lastRunAt !== undefined && typeof value.lastRunAt !== 'string')) throw new Error('Invalid state.json; restore or repair it before continuing.');
  return value;
}
/** Host-independent: get(endpoint) must perform read-only authenticated requests. */
export async function sweep({ config, state = {}, candidates = [], get, includeSeen = false, maxComments = 100, now = () => new Date().toISOString() }) {
  config = validateConfig(config); validateState(state);
  if (!Number.isInteger(maxComments) || maxComments < 1 || maxComments > 1000) throw new Error('maxComments must be an integer from 1 to 1000.');
  const byKey = new Map();
  for (const f of [...config.files.map(f => ({...f, source: 'configured', updatedAt: Number.MAX_SAFE_INTEGER})), ...candidates]) {
    if (!/^[A-Za-z0-9]+$/.test(f.key)) continue;
    if (!byKey.has(f.key) || f.updatedAt > byKey.get(f.key).updatedAt) byKey.set(f.key, f);
  }
  const discovered = [...byKey.values()].sort((a,b) => b.updatedAt - a.updatedAt);
  const files = discovered.slice(0, MAX_FILES), all = [], errors = [];
  let user;
  if (files.length) { try { user = await get('/me'); } catch { /* Optional scope. */ } }
  const previous = state.reportedCommentIds ?? [], seen = new Set(previous);
  for (let i = 0; i < files.length; i += 4) {
    const batch = await Promise.all(files.slice(i,i+4).map(async file => {
      try {
        const response = await get(`/files/${file.key}/comments?as_md=true`);
        if (!Array.isArray(response.comments) || response.comments.some(c => !c || typeof c.id !== 'string' || typeof c.message !== 'string' || typeof c.created_at !== 'string')) throw new Error('Invalid response');
        return response.comments.map(comment => ({file, comment, mentioned: isMentioned(comment,user,config.aliases), isNew: !seen.has(comment.id), isOwn: Boolean(user?.id && comment.user?.id === user.id)}));
      } catch { errors.push({key: file.key, error: 'Unable to read comments (check access, token scopes, and rate limits).'}); return []; }
    }));
    all.push(...batch.flat());
  }
  const selected = selectForReport(all,includeSeen,maxComments);
  const relevant = withThreadContext(all, selected.relevant), deferred = selected.deferred;
  return { checkedFiles: files.length, candidateFiles: discovered.length, skippedFiles: discovered.length-files.length, totalComments: all.length, comments: relevant, deferred, errors, legacyReset: Boolean(state.seenCommentIds && !state.reportedCommentIds), state: {reportedCommentIds: reportedIds(previous,relevant), lastRunAt: now()} };
}
export function formatSweep(result) {
  return [`Figma Comment Sweep: checking ${result.checkedFiles}/${result.candidateFiles} candidate files (max 100; ${result.skippedFiles} skipped).`, `Found ${result.totalComments} comments; reporting ${result.comments.length}; ${result.deferred} eligible comments deferred. Unreported comments remain unseen.`, 'Read-only Figma access; local reporting never changes Figma read/resolved status.', ...(result.legacyReset ? ['Legacy seen tracking reset to recover unreported comments.'] : []), ...result.comments.map(({file,comment:c,mentioned,isNew,relevanceReason,context = [],contextOmitted = 0,parentMissing}) => `\n- ${file.label ?? file.key} (${[isNew && 'new',mentioned && 'mentioned',c.resolved_at ? 'resolved' : 'open',relevanceReason].filter(Boolean).join(', ')})\n  ${(c.user?.name ?? c.user?.handle ?? 'Unknown')} · ${c.created_at}\n  ${c.message.replace(/\s+/g,' ').trim()}\n  https://www.figma.com/design/${file.key}?comment-id=${encodeURIComponent(c.id)}${context.map(item => `\n  [context${item.isOwn ? ', you' : ''}] ${item.comment.user?.name ?? item.comment.user?.handle ?? 'Unknown'} · ${item.comment.created_at}: ${item.comment.message.replace(/\s+/g,' ').trim()}`).join('')}${contextOmitted ? `\n  [${contextOmitted} other thread comments omitted]` : ''}${parentMissing ? '\n  [Parent comment unavailable]' : ''}`), ...result.errors.map(e => `${e.key}: ${e.error}`)].join('\n');
}
