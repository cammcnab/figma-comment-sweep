function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isMentioned(comment, currentUser, configuredAliases = []) {
  const message = comment.message.normalize("NFKC");
  // Recognize ID tokens if Figma encodes them in the message. Never match an
  // arbitrary occurrence of the ID (or the comment author's ID) as a mention.
  if (currentUser?.id) {
    const id = escapeRegex(currentUser.id);
    if (new RegExp(`(?:<@${id}>|@\\[${id}\\]|(?<![\\p{L}\\p{N}_@])@${id}(?![\\p{L}\\p{N}_.-]))`, "u").test(message)) return true;
  }
  const aliases = new Set([
    ...configuredAliases,
    currentUser?.handle, currentUser?.name,
  ].filter((value) => Boolean(value)));
  for (const alias of aliases) {
    const name = alias.normalize("NFKC").replace(/^@/, "");
    const pattern = escapeRegex(name).replace(/\s+/g, "\\s+");
    // Short names require @; full names can be plain text/Markdown labels.
    // Boundaries avoid matching @camille, @cameron-other, or email addresses.
    const prefix = /\s/.test(name) ? "@?" : "@";
    if (new RegExp(`(?<![\\p{L}\\p{N}_.@-])${prefix}${pattern}(?![\\p{L}\\p{N}_.@-])`, "iu").test(message)) return true;
  }
  return false;
}

export function selectForReport(items, includeSeen, maxComments) {
  const eligible = items.filter((item) => !item.isOwn && (includeSeen || item.isNew || item.mentioned));
  // Previously reported mentions must not starve the unseen backlog.
  eligible.sort((a, b) => Number(b.isNew) - Number(a.isNew) || Date.parse(b.comment.created_at) - Date.parse(a.comment.created_at));
  const limit = Number.isFinite(maxComments) ? Math.max(1, Math.min(1000, Math.floor(maxComments))) : 100;
  return { relevant: eligible.slice(0, limit), deferred: Math.max(0, eligible.length - limit) };
}

/** Add bounded, file-local discussion without turning context into delivery. */
export function withThreadContext(items, returned) {
  const threads = new Map();
  const key = item => JSON.stringify([item.file.key, item.comment.parent_id || item.comment.id]);
  for (const item of items) {
    const k = key(item);
    if (!threads.has(k)) threads.set(k, []);
    threads.get(k).push(item);
  }
  const chronological = (a, b) => Date.parse(a.comment.created_at) - Date.parse(b.comment.created_at) || Number(Boolean(a.comment.parent_id)) - Number(Boolean(b.comment.parent_id)) || a.comment.id.localeCompare(b.comment.id);
  for (const thread of threads.values()) thread.sort(chronological);
  return returned.map(item => {
    const thread = threads.get(key(item));
    const index = thread.indexOf(item);
    const rootId = item.comment.parent_id || item.comment.id;
    const root = thread.find(other => other.comment.id === rootId);
    const anchor = thread.slice(0, index).findLast(other => other.mentioned && !other.isOwn);
    // A recurring, already-delivered mention gets only its parent, not the old
    // discussion again. Only new feedback expands the discussion window.
    const discussion = item.isNew ? thread.filter(other => other !== item && other !== root && other !== anchor) : [];
    const chosen = new Set([root !== item && root, anchor, ...discussion.slice(-5)].filter(Boolean));
    const context = thread.filter(other => chosen.has(other)).map(other => ({...other, isContext: true}));
    return {...item, isContext: false,
      relevanceReason: item.mentioned ? 'mentions-you' : anchor ? 'thread-follow-up' : item.isNew ? 'new-in-watched-file' : 'previously-reported-in-watched-file',
      context,
      contextOmitted: thread.filter(other => other !== item && !chosen.has(other)).length,
      parentMissing: Boolean(item.comment.parent_id && !root),
    };
  });
}

export function reportedIds(previous, returned) {
  // Only top-level primary delivery counts: nested context may contain unseen,
  // deferred feedback or our own comments. Never mark those reported here.
  // Local delivery bookkeeping only; never update Figma read/resolved status.
  // No size-based eviction: that would make old comments unexpectedly new again.
  return [...new Set([...previous, ...returned.map((item) => item.comment.id)])];
}
