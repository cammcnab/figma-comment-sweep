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
  const eligible = items.filter((item) => includeSeen || item.isNew || item.mentioned);
  // Previously reported mentions must not starve the unseen backlog.
  eligible.sort((a, b) => Number(b.isNew) - Number(a.isNew) || Date.parse(b.comment.created_at) - Date.parse(a.comment.created_at));
  const limit = Number.isFinite(maxComments) ? Math.max(1, Math.min(1000, Math.floor(maxComments))) : 100;
  return { relevant: eligible.slice(0, limit), deferred: Math.max(0, eligible.length - limit) };
}

export function reportedIds(previous, returned) {
  // Local delivery bookkeeping only; never update Figma read/resolved status.
  // No size-based eviction: that would make old comments unexpectedly new again.
  return [...new Set([...previous, ...returned.map((item) => item.comment.id)])];
}
