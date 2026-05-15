/**
 * Notes export — bundles entries (regular + diary) into a single zip the
 * user can save anywhere: Files, Drive, email-to-self.
 *
 * Format:
 *   notes-and-diary-2026-05-01.zip
 *   ├── README.md          (overview, entry index, format notes)
 *   ├── entries/
 *   │   ├── 2026-05-01--diary--my-day.md
 *   │   ├── 2026-04-30--note--meeting-notes.md
 *   │   └── ...
 *   └── media/
 *       ├── img_1234.jpg   (originals copied byte-for-byte)
 *       └── audio_5678.m4a
 *
 * Each .md file carries YAML-style frontmatter (date, type, title, mood,
 * etc.) followed by the markdown body. Media files referenced by an entry
 * are linked in frontmatter using `../media/filename` so the markdown is
 * portable — open in Obsidian's "open vault" mode and it just works.
 *
 * jszip generates the archive in-memory as base64, then we write that to
 * documentDirectory and hand it off to Sharing. No native zip lib needed,
 * no special permissions.
 */

import { documentDirectory, writeAsStringAsync, readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import JSZip from 'jszip';
import type { Note } from '../store/useAppStore';

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function isoDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeYaml(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Filename-safe slug from a title — drops everything that isn't alphanumeric
// or Persian/Arabic/Hebrew, collapses runs, lowercases. Falls back to a
// short hash of the id when the result is empty so zip filenames stay unique.
function slugify(s: string, fallbackId: string): string {
  const slug = (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9֐-׿؀-ۿݐ-ݿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (slug) return slug;
  return `entry-${fallbackId.slice(-6)}`;
}

function renderNoteMarkdown(note: Note): string {
  const isDiary = note.kind === 'diary';
  const dateMs = isDiary ? (note.entryDate ?? note.createdAt) : note.createdAt;
  const lines: string[] = [];

  lines.push('---');
  lines.push(`date: ${isoDate(dateMs)}`);
  lines.push(`time: ${isoDateTime(dateMs)}`);
  lines.push(`type: ${isDiary ? 'diary' : 'note'}`);
  if (note.title) lines.push(`title: ${escapeYaml(note.title)}`);
  if (note.group) lines.push(`group: ${escapeYaml(note.group)}`);
  if (isDiary && note.mood) lines.push(`mood: ${escapeYaml(note.mood)}`);
  if (note.isPinned) lines.push('pinned: true');
  if (note.isLocked) lines.push('locked: true');
  if (note.isSealed) {
    lines.push('sealed: true');
    if (note.unlockDateStr) lines.push(`unlocks: ${note.unlockDateStr}`);
    else if (note.unlockDate) lines.push(`unlocks: ${isoDate(note.unlockDate)}`);
  }
  if (note.imageUris && note.imageUris.length > 0) {
    lines.push(`images: [${note.imageUris.map(u => escapeYaml(`../media/${u.split('/').pop() || u}`)).join(', ')}]`);
  }
  if (note.audio && note.audio.length > 0) {
    lines.push(`audio: [${note.audio.map(m => escapeYaml(`../media/${m.uri.split('/').pop() || ''}`)).join(', ')}]`);
  }
  lines.push('---');
  lines.push('');
  if (note.title) {
    lines.push(`# ${note.title}`);
    lines.push('');
  }
  lines.push(note.content || '');
  lines.push('');

  return lines.join('\n');
}

function renderReadme(notes: Note[], scope: ExportScope): string {
  const total = notes.length;
  const diaryCount = notes.filter(n => n.kind === 'diary').length;
  const noteCount = total - diaryCount;
  const mediaTotal = notes.reduce(
    (sum, n) => sum + (n.imageUris?.length ?? 0) + (n.audio?.length ?? 0),
    0
  );

  return [
    `# Export — ${isoDate(Date.now())}`,
    '',
    `- Total entries: **${total}**`,
    scope === 'all' ? `- Notes: ${noteCount} · Diary entries: ${diaryCount}` : `- ${scope === 'diary' ? 'Diary' : 'Notes'}: ${total}`,
    `- Media files: **${mediaTotal}**`,
    '',
    '## Format',
    '',
    'Each entry lives in `entries/` as a markdown file with YAML frontmatter (date, type, title, mood, etc.). Media files referenced by entries are bundled in `media/`; entries link to them via relative paths (`../media/filename`).',
    '',
    'This format imports cleanly into:',
    '- **Obsidian** — open the export folder as a vault.',
    '- **Bear**, **Notion**, **Logseq** — drag-and-drop import.',
    '- **Plain text editors** — every file is just markdown.',
    '',
    'Your data is yours. Nothing here is locked behind a proprietary format.',
    '',
  ].join('\n');
}

export type ExportScope = 'all' | 'diary' | 'notes';

/**
 * Build and share a zip archive of the given notes. Returns
 * `{ ok: true }` on successful share-sheet handoff, `{ ok: false, reason }`
 * on unrecoverable failure. User dismissing the share sheet is treated as
 * success — they did the action.
 */
export async function exportNotesAsBundle(notes: Note[], scope: ExportScope = 'all'): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) return { ok: false, reason: 'Sharing is not available on this device.' };

    const filtered = notes.filter(n => {
      if (n.status === 'trash') return false;
      if (scope === 'diary') return n.kind === 'diary';
      if (scope === 'notes') return n.kind !== 'diary';
      return true;
    });
    const dateOf = (n: Note) => (n.kind === 'diary' ? (n.entryDate ?? n.createdAt) : n.createdAt);
    filtered.sort((a, b) => dateOf(b) - dateOf(a));

    const zip = new JSZip();
    zip.file('README.md', renderReadme(filtered, scope));

    // Track media filenames we've already added so duplicates across
    // entries (same image attached to multiple notes — possible with
    // copy-paste) don't double up.
    const seenMedia = new Set<string>();
    const entriesFolder = zip.folder('entries');
    const mediaFolder = zip.folder('media');

    for (const note of filtered) {
      const dateStr = isoDate(dateOf(note));
      const slug = slugify(note.title || '', note.id);
      const typeLabel = note.kind === 'diary' ? 'diary' : 'note';
      const filename = `${dateStr}--${typeLabel}--${slug}.md`;
      entriesFolder?.file(filename, renderNoteMarkdown(note));

      // Pull media bytes and stuff them into media/ as base64. expo-file-system
      // returns base64 strings directly; jszip accepts base64 with the right
      // option flag.
      const mediaUris: string[] = [
        ...(note.imageUris || []),
        ...((note.audio || []).map(m => m.uri)),
      ];
      for (const uri of mediaUris) {
        const filename = uri.split('/').pop() || '';
        if (!filename || seenMedia.has(filename)) continue;
        try {
          const b64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
          mediaFolder?.file(filename, b64, { base64: true });
          seenMedia.add(filename);
        } catch (e) {
          // Missing media file — skip silently. The entry's frontmatter
          // still references it; better to ship an export that's mostly
          // complete than to abort the whole thing because one stale URI.
          console.warn('[notesExport] failed to read media', uri, e);
        }
      }
    }

    // jszip generates base64 we can hand directly to writeAsStringAsync
    // with Base64 encoding. Avoids an intermediate Blob/ArrayBuffer step
    // (RN's environment makes those awkward).
    const zipBase64 = await zip.generateAsync({ type: 'base64' });
    const stamp = isoDate(Date.now());
    const archiveName = scope === 'diary'
      ? `diary-${stamp}.zip`
      : scope === 'notes'
        ? `notes-${stamp}.zip`
        : `notes-and-diary-${stamp}.zip`;
    const path = `${documentDirectory}${archiveName}`;
    await writeAsStringAsync(path, zipBase64, { encoding: EncodingType.Base64 });
    await Sharing.shareAsync(path, {
      mimeType: 'application/zip',
      dialogTitle: scope === 'diary' ? 'Export diary' : scope === 'notes' ? 'Export notes' : 'Export notes + diary',
      UTI: 'public.zip-archive',
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'Export failed.' };
  }
}

// Back-compat alias — the older markdown-only export. Kept exported so
// nothing referencing it explodes; it now delegates to the bundled zip.
export const exportNotesAsMarkdown = exportNotesAsBundle;
