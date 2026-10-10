import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

// Same shape the backend's reconciler parses (app/services/wiki_link.py):
// [[Title]] or [[Title|shown text]], never spanning a line.
const WIKI_LINK = /\[\[([^[\]|\n]{1,255})(?:\|[^[\]\n]{0,255})?\]\]/g;

/**
 * Set by the component that owns the editor, after the editor exists
 * (editor.storage.wikiLink). Storage rather than options because options are
 * fixed when the editor is created, while the note list loads later.
 */
export interface WikiLinkStorage {
  /** Whether a [[title]] matches one of the author's notes (case-insensitive). */
  isResolved: (title: string) => boolean;
  /** Ctrl/Cmd-click on a [[title]]. */
  onOpen: (title: string) => void;
}

export function wikiLinkStorage(editor: { storage: unknown }): WikiLinkStorage {
  return (editor.storage as { wikiLink: WikiLinkStorage }).wikiLink;
}

export const wikiLinkKey = new PluginKey<DecorationSet>("wikiLink");

/** Call after the set of known titles changes, so highlights are recomputed. */
export const REFRESH_WIKI_LINKS = "refreshWikiLinks";

function normalise(title: string) {
  return title.split(/\s+/).filter(Boolean).join(" ");
}

function decorate(doc: PMNode, isResolved: WikiLinkStorage["isResolved"]) {
  const decorations: Decoration[] = [];
  // Per text block, so a match can't run from one paragraph into the next;
  // the text is the block's visible characters, whatever marks are on them.
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textContent;
    for (const m of text.matchAll(WIKI_LINK)) {
      const title = normalise(m[1]);
      if (!title) continue;
      const from = pos + 1 + m.index!;
      decorations.push(
        Decoration.inline(from, from + m[0].length, {
          class: isResolved(title) ? "wiki-link" : "wiki-link wiki-link-missing",
          "data-wiki-title": title,
          title: isResolved(title)
            ? `Ctrl+click to open "${title}"`
            : `No note titled "${title}" yet. Ctrl+click to create it`,
        }),
      );
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Highlights [[wiki-links]] in the text and opens them on Ctrl/Cmd-click.
 * Purely visual: the text stays plain characters, so the saved HTML is
 * exactly what the backend parses, and the link exists in the graph only
 * once the server has reconciled it.
 */
export const WikiLink = Extension.create<Record<string, never>, WikiLinkStorage>({
  name: "wikiLink",

  addStorage() {
    return { isResolved: () => false, onOpen: () => {} };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<DecorationSet>({
        key: wikiLinkKey,
        state: {
          init: (_, { doc }) => decorate(doc, storage.isResolved),
          apply: (tr, old) =>
            tr.docChanged || tr.getMeta(REFRESH_WIKI_LINKS)
              ? decorate(tr.doc, storage.isResolved)
              : old,
        },
        props: {
          decorations(state) {
            return wikiLinkKey.getState(state);
          },
          handleClick(view, _pos, event) {
            const target = (event.target as HTMLElement).closest<HTMLElement>("[data-wiki-title]");
            if (!target) return false;
            // While editing, a plain click places the cursor as usual; the
            // modifier is what makes it a navigation (as in other editors).
            if (view.editable && !(event.ctrlKey || event.metaKey)) return false;
            storage.onOpen(target.dataset.wikiTitle!);
            return true;
          },
        },
      }),
    ];
  },
});
