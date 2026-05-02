"use client";
/* eslint-disable react-hooks/refs */

import { useEffect } from "react";
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Link2,
  Strikethrough,
  Type,
  Underline,
} from "lucide-react";

function createVirtualElement(rect: DOMRect) {
  return {
    getBoundingClientRect: () => rect,
  };
}

function ToolbarButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      aria-label={label}
      className={`rounded-lg p-2 transition ${
        active ? "bg-[#2A2A2A] text-[#F3F2EE]" : "text-white/80 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

export function FloatingFormattingToolbar({
  editor,
  open,
  referenceRect,
}: {
  editor: Editor;
  open: boolean;
  referenceRect: DOMRect | null;
}) {
  const floating = useFloating({
    open,
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(12), flip(), shift({ padding: 12 })],
  });
  const setFloating = floating.refs.setFloating;

  useEffect(() => {
    if (!referenceRect) {
      return;
    }

    floating.refs.setPositionReference(createVirtualElement(referenceRect));
  }, [floating.refs, referenceRect]);

  if (!open || !referenceRect) {
    return null;
  }

  return (
    <FloatingPortal>
      <div
        ref={setFloating}
        style={floating.floatingStyles}
        className="z-50 flex items-center gap-1 rounded-2xl border border-white/8 bg-[#141414] p-2 text-white shadow-[0_18px_60px_rgba(0,0,0,0.42)]"
      >
        <ToolbarButton
          label="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarButton
          label="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarButton
          label="Underline"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <Underline className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarButton
          label="Strikethrough"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarButton
          label="Link"
          active={editor.isActive("link")}
          onClick={() => {
            const href = window.prompt("Add a link", "https://");
            if (!href) {
              editor.chain().focus().unsetLink().run();
              return;
            }

            editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
          }}
        >
          <Link2 className="h-4 w-4" />
        </ToolbarButton>

        <div className="mx-1 h-5 w-px bg-white/10" />

        <ToolbarButton
          label="Default text color"
          onClick={() => editor.chain().focus().unsetColor().run()}
        >
          <Type className="h-4 w-4" />
        </ToolbarButton>

        {[
          { label: "Gray", color: "#D9D5CD" },
          { label: "Blue", color: "#5A85FF" },
          { label: "Red", color: "#FF5C5C" },
          { label: "Green", color: "#2BC48A" },
        ].map((swatch) => (
          <button
            key={swatch.label}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.chain().focus().setColor(swatch.color).run()}
            className="h-5 w-5 rounded-full ring-1 ring-white/15 transition hover:scale-105"
            style={{ backgroundColor: swatch.color }}
            aria-label={swatch.label}
          />
        ))}
      </div>
    </FloatingPortal>
  );
}
