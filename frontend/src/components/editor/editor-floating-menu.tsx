"use client";

import { FloatingMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { Code2, Heading1, Heading2, List, ListChecks, ListOrdered, Quote } from "lucide-react";

// Shows to the left of an empty line - the lightweight equivalent of
// Notion's "/" command menu, without building a full suggestion-popup
// extension for it.
export function EditorFloatingMenu({ editor }: { editor: Editor }) {
  return (
    <FloatingMenu
      editor={editor}
      className="flex items-center gap-0.5 rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
    >
      <FloatingButton label="Heading 1" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
        <Heading1 className="size-3.5" />
      </FloatingButton>
      <FloatingButton label="Heading 2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="size-3.5" />
      </FloatingButton>
      <FloatingButton label="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="size-3.5" />
      </FloatingButton>
      <FloatingButton label="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="size-3.5" />
      </FloatingButton>
      <FloatingButton label="Task list" onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <ListChecks className="size-3.5" />
      </FloatingButton>
      <FloatingButton label="Quote" onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="size-3.5" />
      </FloatingButton>
      <FloatingButton label="Code block" onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        <Code2 className="size-3.5" />
      </FloatingButton>
    </FloatingMenu>
  );
}

function FloatingButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
