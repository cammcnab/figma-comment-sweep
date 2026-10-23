# figma-comment-sweep

Read-only Figma comment sweeps: a host-independent JavaScript core, zero-dependency Node CLI, and thin Pi extension. MIT licensed; Node **22+**; no build step.

## Install

The repository is currently private; GitHub access is required.

For Pi:

```sh
pi install git:github.com/cammcnab/figma-comment-sweep
```

For the standalone CLI (no Pi required):

```sh
git clone https://github.com/cammcnab/figma-comment-sweep.git
cd figma-comment-sweep
node src/cli.js --help
```

## Run

From the checkout:

```sh
node src/cli.js --help
node src/cli.js add https://www.figma.com/design/FILEKEY Design review
node src/cli.js status --json
# Set FIGMA_ACCESS_TOKEN securely in your shell, then:
node src/cli.js sweep --max-comments 100
node src/cli.js sweep --all --json
```

The package also exposes the `figma-comment-sweep` executable when installed/linked. No install is needed to run the CLI or tests from this checkout. Host peers are optional for CLI-only use. Authentication is never needed for help, status, or add.

For Pi, load once without changing settings:

```sh
pi --extension ./extensions/index.ts
```

Or explicitly install the local package with `pi install /absolute/path/to/figma-comment-sweep`. This registers `figma_comment_sweep` and `/figma-comments status | add <URL> [label] | sweep [--all] [--max-comments N]`. The adapter imports Pi's current `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` peers; Pi supplies them. Pi settings are not modified simply by running this package's CLI.

The Pi slash command remains `/figma-comments` for compatibility; the package and CLI are named `figma-comment-sweep`.

## Configuration

Default directory: `~/.config/figma-comments`. Set **FIGMA_COMMENTS_HOME** to override the entire config/state directory, including pointing at an old `~/.pi/figma-comments` directory. Nothing is automatically copied or migrated.

Create `config.json` there (all fields optional):

```json
{
  "files": [{ "key": "FILEKEY", "label": "Design review" }],
  "aliases": ["alex", "Alex Example"],
  "searchRoots": ["~/notes"],
  "desktopRecent": false,
  "keychain": false
}
```

- `files`: pinned file keys (alphanumeric), optionally labelled. `add` updates this list and preserves other settings.
- `aliases`: mention names; no person-specific aliases are built in. Short names need `@`; full names also match plain/Markdown labels. Optional `/me` supplies the authenticated handle/name and ID. Failing `/me` does not prevent a sweep.
- `searchRoots`: recursively scan Markdown files for Figma URLs. Empty by default. `~/` expands to your home; other relative paths resolve against the current working directory. Symlink directories are not followed; `.git` and `node_modules` are excluded; files over 8 MiB are skipped.
- `desktopRecent`: **opt-in**, macOS only. Reads best-effort file URL signals from Figma Desktop's local cache; the public API has no recent-files endpoint. It is not used for authentication. Other platforms ignore it.
- `keychain`: **opt-in**, macOS only. If FIGMA_ACCESS_TOKEN is unset, reads service `pi-figma-comments-token` with the `security` executable. Other platforms ignore it.

The environment token takes precedence. A Figma personal access token requires `file_comments:read`; `current_user:read` is optional for `/me`. Do not put tokens in config, commit them, or pass them as CLI arguments. Config rejects unknown top-level fields to catch mistakes.

Only GET requests are made to `https://api.figma.com/v1`. Redirects are rejected, requests time out after 30 seconds, and response bodies/subprocess errors are never echoed on failure. Per-file failures return generic errors and do not mark those comments reported. There are no retries; check scopes/access and rerun after rate limits expire.

## Reporting and persistence

- At most **100 files** are checked, pinned first, then discoveries by modification time; duplicate file keys merge.
- At most **four** comment requests run concurrently.
- Default primary output limit is 100; `--max-comments` accepts integers 1–1000. `--all` includes previously reported incoming comments, not your own comments.
- Every unseen comment in checked/watched files is eligible; watching/discovering a file does **not** establish ownership or editing activity. Unseen comments precede already-reported mentions, newest first within each group. Previously reported mentions remain eligible by default.
- Incoming feedback excludes your own comments **only** when `/me` supplies an ID matching the comment author's ID. Names/aliases never establish authorship; if identity is unavailable, alias mentions still work and no authors are excluded.
- The existing flat `comments` array and `file`, `comment`, `mentioned`, `isNew` fields remain. Primary items add `isContext: false`, `isOwn`, and `relevanceReason`: `mentions-you`, `thread-follow-up` (a preceding incoming mention in the same thread), `new-in-watched-file`, or `previously-reported-in-watched-file` for explicit history. Follow-ups need not mention you again.
- Each primary adds chronological nested `context` items marked `isContext: true` and `isOwn` (text labels your own context as `you`). Threads are isolated by file and root/`parent_id`. A reply includes its available root and latest preceding incoming mention; new feedback also includes up to five most recent other discussion comments, including subsequent replies. At most seven context items accompany a primary, outside its budget. Equal timestamps order roots first, then IDs; exact reply chronology cannot be recovered from equal timestamps.
- Already-reported primary comments get only their root/preceding mention, not a replay of the discussion, even with `--all`. `contextOmitted` explicitly counts other omitted thread comments; `parentMissing` flags unavailable parents. Context can overlap other primaries and may include deferred unseen feedback. It is supporting discussion, not a second delivery queue.
- **Only top-level primary IDs** are added to `state.json`. Nested context IDs are never added unless independently selected as primary; deferred comments remain unseen even if displayed as context. Own context remains unreported. IDs are not evicted. Legacy `seenCommentIds` are deliberately not trusted, recovering comments fetched but never returned.
- This is local delivery bookkeeping, **not** Figma read/resolve status. A successful sweep records delivery before the caller displays output; if output delivery fails, rerun with `--all`.
- Missing config/state starts empty; malformed JSON or invalid schema fails instead of silently resetting data.
- Writes use private temporary files and atomic rename. New directories use mode 0700 and files 0600 (POSIX; Windows uses platform ACL behavior). Existing directory permissions are not changed.
- A directory-wide `.lock` rejects concurrent add/sweep operations, preventing lost updates. After a crash, confirm no process is running before manually removing `.lock`. Status is read-only and sees atomic file snapshots.

`--json` prints structured results (including comments, per-file errors, deferred count, and new state); command errors go to stderr with exit status 1. A completed sweep with per-file API failures exits 0: inspect `errors` when automating. Discovery is best-effort; unreadable inputs are skipped. No network call is made by status.

## Library API

```js
import { sweep, formatSweep } from 'figma-comment-sweep';
// config/state/candidates are plain data; get(endpoint) is an injected GET transport.
const result = await sweep({ config: { files: [{ key: 'FILEKEY' }] }, get });
console.log(formatSweep(result));
// Persist result.state yourself only after a successful sweep.
```

The core has no Node/Pi imports. `figma-comment-sweep/node` exports `createService`, discovery, transport, and storage helpers for Node hosts. The service owns authentication, discovery, locking, and persistence; CLI and Pi use exactly this shared implementation.

## Test

```sh
node --test
```

Tests run offline with mocked APIs and temporary directories: capped sweeps, concurrency, legacy recovery, deferred delivery, bounded thread context, own-author identity, file-local threads, missing parents, timestamp ties, mention boundaries, private writes, malformed JSON, locks, redaction, GET-only transport, CLI parsing/JSON/help. No credentials or live Figma API are needed. CI runs Node 22/24 on Linux, macOS, and Windows.
