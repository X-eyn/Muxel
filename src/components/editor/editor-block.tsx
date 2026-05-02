"use client";

import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { flushSync } from "react-dom";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";

import {
  blockHasDraftContent,
  blockIsEmpty,
  blockSupportsText,
  EMPTY_BLOCK_HTML,
  filterSlashCommands,
  getSiblingIndex,
  isListBlock,
  placeholderForBlockType,
  wrapInlineHtml,
} from "@/lib/block-utils";
import type { BlockType } from "@/lib/editor-types";
import { FloatingFormattingToolbar } from "@/components/editor/floating-formatting-toolbar";
import { SlashCommandMenu } from "@/components/editor/slash-command-menu";
import { useBlock, useEditorStore } from "@/store/editor-store";

interface SlashState {
  open: boolean;
  query: string;
  range: { from: number; to: number } | null;
  selectedIndex: number;
  rect: DOMRect | null;
}

type EditorKeyEvent =
  | KeyboardEvent
  | ReactKeyboardEvent<HTMLDivElement>;

const registeredEditors = new Map<string, Editor>();
const FOCUS_RETRY_LIMIT = 12;
const FOCUS_RETRY_MS = 16;

function focusEditorInstance(editor: Editor, position: "start" | "end") {
  if (editor.isDestroyed) {
    return false;
  }

  editor.view.dom.focus({ preventScroll: true });
  editor.view.focus();
  editor.commands.focus(position);
  return true;
}

function focusBlockWhenReady(blockId: string, position: "start" | "end") {
  if (typeof window === "undefined") {
    return;
  }

  let attempts = 0;
  let focused = false;

  const focus = () => {
    if (focused) {
      return;
    }

    const targetEditor = registeredEditors.get(blockId);
    if (targetEditor && focusEditorInstance(targetEditor, position)) {
      focused = true;
      return;
    }

    attempts += 1;
    if (attempts <= FOCUS_RETRY_LIMIT) {
      window.setTimeout(focus, FOCUS_RETRY_MS);
    }
  };

  queueMicrotask(focus);
  window.requestAnimationFrame(focus);
  window.setTimeout(focus, 0);
}

function buildParagraphDocument(text: string) {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: text
          ? [
              {
                type: "text",
                text,
              },
            ]
          : [],
      },
    ],
  };
}

function getBlockShellClasses(type: BlockType) {
  switch (type) {
    case "h1":
      return "text-[32px] font-bold leading-[1.2] tracking-[-0.03em] text-[#F7F5EF]";
    case "h2":
      return "text-[26px] font-semibold leading-[1.25] tracking-[-0.02em] text-[#F7F5EF]";
    case "h3":
      return "text-[22px] font-semibold leading-[1.3] text-[#F7F5EF]";
    case "quote":
      return "rounded-xl border-l-4 border-white/10 bg-[#151515] px-4 italic text-[#F1EEE7]";
    case "code":
      return "rounded-xl bg-[#141414] px-4 font-mono text-[14px] leading-6 text-[#F5F3EE]";
    case "callout":
      return "rounded-2xl bg-[#151515] px-4 text-[#F3F0E9]";
    default:
      return "";
  }
}

function applyMarkdownShortcut(editor: Editor, currentType: BlockType) {
  const text = editor.getText();
  const shortcutMatchers: Array<{ regex: RegExp; type: BlockType }> = [
    { regex: /^#\s/, type: "h1" },
    { regex: /^##\s/, type: "h2" },
    { regex: /^###\s/, type: "h3" },
    { regex: /^>\s/, type: "quote" },
    { regex: /^-\s/, type: "bullet_list" },
    { regex: /^\*\s/, type: "bullet_list" },
    { regex: /^1\.\s/, type: "numbered_list" },
    { regex: /^```\s?/, type: "code" },
  ];

  const match = shortcutMatchers.find((item) => item.regex.test(text));
  if (!match || match.type === currentType) {
    return null;
  }

  const nextText = text.replace(match.regex, "");
  editor.commands.setContent(buildParagraphDocument(nextText), {
    emitUpdate: false,
  });
  return match.type;
}

function createRect(left: number, top: number, right: number, bottom: number) {
  return new DOMRect(left, top, right - left, bottom - top);
}

export function EditorBlock({
  blockId,
  depth,
}: {
  blockId: string;
  depth: number;
}) {
  const block = useBlock(blockId);
  const activeBlockId = useEditorStore((state) => state.activeBlockId);
  const focusRequest = useEditorStore((state) => state.focusRequest);
  const clearFocusRequest = useEditorStore((state) => state.clearFocusRequest);
  const requestFocus = useEditorStore((state) => state.requestFocus);
  const setActiveBlockId = useEditorStore((state) => state.setActiveBlockId);
  const updateBlockContent = useEditorStore((state) => state.updateBlockContent);
  const updateBlockType = useEditorStore((state) => state.updateBlockType);
  const addBlockBelow = useEditorStore((state) => state.addBlockBelow);
  const deleteBlock = useEditorStore((state) => state.deleteBlock);
  const mergeBlockIntoPrevious = useEditorStore((state) => state.mergeBlockIntoPrevious);
  const indentBlock = useEditorStore((state) => state.indentBlock);
  const outdentBlock = useEditorStore((state) => state.outdentBlock);
  const getPreviousBlockId = useEditorStore((state) => state.getPreviousBlockId);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const [slashState, setSlashState] = useState<SlashState>({
    open: false,
    query: "",
    range: null,
    selectedIndex: 0,
    rect: null,
  });
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const [showToolbar, setShowToolbar] = useState(false);
  const blockRef = useRef(block);
  const slashStateRef = useRef(slashState);
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    blockRef.current = block;
  }, [block]);

  useEffect(() => {
    slashStateRef.current = slashState;
  }, [slashState]);

  const closeSlashState = () => {
    setSlashState({
      open: false,
      query: "",
      range: null,
      selectedIndex: 0,
      rect: null,
    });
  };

  const handleEditorKeyDown = (event: EditorKeyEvent) => {
    const currentBlock = blockRef.current;
    const currentSlashState = slashStateRef.current;
    const activeEditor = editorRef.current;
    const key = event.key.toLowerCase();
    const modifierPressed = event.metaKey || event.ctrlKey;

    if (modifierPressed && key === "z") {
      event.preventDefault();
      closeSlashState();

      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }

      return true;
    }

    if (event.ctrlKey && key === "y") {
      event.preventDefault();
      closeSlashState();
      redo();
      return true;
    }

    if (!activeEditor || !currentBlock) {
      return false;
    }

    if (currentSlashState.open) {
      const commands = filterSlashCommands(currentSlashState.query);

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashState((current) => ({
          ...current,
          selectedIndex: current.selectedIndex + 1 >= commands.length ? 0 : current.selectedIndex + 1,
        }));
        return true;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashState((current) => ({
          ...current,
          selectedIndex:
            current.selectedIndex - 1 < 0 ? commands.length - 1 : current.selectedIndex - 1,
        }));
        return true;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const selectedCommand = commands[currentSlashState.selectedIndex];
        if (selectedCommand && currentSlashState.range) {
          activeEditor
            .chain()
            .focus()
            .deleteRange(currentSlashState.range)
            .run();
          updateBlockType(currentBlock.id, selectedCommand.type);
          startTransition(() => {
            updateBlockContent(currentBlock.id, activeEditor.getHTML());
          });
        }
        closeSlashState();
        return true;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeSlashState();
        return true;
      }
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      const nextType = isListBlock(currentBlock.type)
        ? currentBlock.type
        : "paragraph";
      let nextBlockId: string | null = null;
      flushSync(() => {
        nextBlockId = addBlockBelow(currentBlock.id, {
          type: nextType,
          content: wrapInlineHtml(""),
        });
      });
      if (nextBlockId) {
        focusBlockWhenReady(nextBlockId, "start");
      }
      return true;
    }

    if (event.key === "Enter" && (event.shiftKey || event.altKey)) {
      event.preventDefault();
      activeEditor.commands.setHardBreak();
      return true;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      if (
        isListBlock(currentBlock.type) &&
        blockIsEmpty(activeEditor.getHTML())
      ) {
        updateBlockType(currentBlock.id, "paragraph");
        return true;
      }

      const nextType = isListBlock(currentBlock.type)
        ? currentBlock.type
        : "paragraph";
      let nextBlockId: string | null = null;
      flushSync(() => {
        nextBlockId = addBlockBelow(currentBlock.id, {
          type: nextType,
          content: EMPTY_BLOCK_HTML,
          focusPosition: "start",
        });
      });
      if (nextBlockId) {
        focusBlockWhenReady(nextBlockId, "start");
      }
      closeSlashState();
      return true;
    }

    if (event.key === "Backspace" && activeEditor.state.selection.empty) {
      const atStart = activeEditor.state.selection.$from.parentOffset === 0;
      if (!atStart) {
        return false;
      }

      const previousBlockId = getPreviousBlockId(currentBlock.id);
      if (!previousBlockId) {
        return false;
      }

      event.preventDefault();

      if (blockIsEmpty(activeEditor.getHTML())) {
        deleteBlock(currentBlock.id);
        requestFocus(previousBlockId, "end");
        return true;
      }

      mergeBlockIntoPrevious(currentBlock.id);
      return true;
    }

    if (event.key === "Tab") {
      event.preventDefault();

      if (event.shiftKey) {
        outdentBlock(currentBlock.id);
      } else {
        indentBlock(currentBlock.id);
      }

      return true;
    }

    return false;
  };

  const syncFloatingUi = (instance: Editor) => {
    if (typeof window === "undefined") {
      return;
    }

    const { selection } = instance.state;

    if (!selection.empty) {
      const browserSelection = window.getSelection();
      if (browserSelection && browserSelection.rangeCount > 0) {
        const range = browserSelection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          setSelectionRect(rect);
          setShowToolbar(true);
        }
      }
    } else {
      setShowToolbar(false);
    }

    const textBeforeCursor = instance.state.doc.textBetween(
      0,
      selection.from,
      "\n",
      "\0",
    );
    const slashMatch = textBeforeCursor.match(/(^|\s)\/([^\s/]*)$/);

    if (!selection.empty || !slashMatch) {
      setSlashState((current) =>
        current.open
          ? { open: false, query: "", range: null, selectedIndex: 0, rect: null }
          : current,
      );
      return;
    }

    const query = slashMatch[2] ?? "";
    const start = selection.from - query.length - 1;
    const coords = instance.view.coordsAtPos(selection.from);
    const rect = createRect(coords.left, coords.bottom, coords.right, coords.bottom);

    setSlashState((current) => ({
      open: true,
      query,
      range: {
        from: start,
        to: selection.from,
      },
      selectedIndex: current.query === query ? current.selectedIndex : 0,
      rect,
    }));
  };

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          codeBlock: false,
          horizontalRule: false,
          link: false,
          underline: false,
          undoRedo: false,
        }),
        Placeholder.configure({
          placeholder: placeholderForBlockType(block?.type ?? "paragraph"),
        }),
        Underline,
        TextStyle,
        Color,
        Link.configure({
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
        }),
      ],
      content: block?.content,
      onCreate: ({ editor: instance }) => {
        editorRef.current = instance;
      },
      onDestroy: () => {
        editorRef.current = null;
      },
      onFocus: ({ editor: instance }) => {
        setActiveBlockId(blockId);
        syncFloatingUi(instance);
      },
      onBlur: () => {
        setShowToolbar(false);
        closeSlashState();
      },
      onSelectionUpdate: ({ editor: instance }) => {
        syncFloatingUi(instance);
      },
      onUpdate: ({ editor: instance }) => {
        const currentBlock = blockRef.current;
        const nextBlockType = applyMarkdownShortcut(
          instance,
          currentBlock?.type ?? "paragraph",
        );
        if (nextBlockType && currentBlock) {
          updateBlockType(currentBlock.id, nextBlockType);
        }

        startTransition(() => {
          updateBlockContent(blockId, instance.getHTML());
        });
        syncFloatingUi(instance);
      },
      editorProps: {
        attributes: {
          class: [
            "muxel-editor",
            "min-h-[1.75rem]",
            "w-full",
            "bg-transparent",
            "outline-none",
            "text-[16px]",
            "leading-6",
            "text-[#F5F3EE]",
          ].join(" "),
          spellcheck: "true",
        },
        handleKeyDown: (_view, event) => handleEditorKeyDown(event),
      },
    },
    [block?.id, block?.type],
  );

  useEffect(() => {
    if (!editor || !block || !blockSupportsText(block.type)) {
      return;
    }

    if (editor.getHTML() !== block.content) {
      editor.commands.setContent(block.content, { emitUpdate: false });
    }
  }, [block, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    registeredEditors.set(blockId, editor);

    return () => {
      if (registeredEditors.get(blockId) === editor) {
        registeredEditors.delete(blockId);
      }
    };
  }, [blockId, editor]);

  useLayoutEffect(() => {
    if (!editor || !focusRequest || focusRequest.blockId !== blockId) {
      return;
    }

    focusEditorInstance(editor, focusRequest.position);
    clearFocusRequest();
  }, [blockId, clearFocusRequest, editor, focusRequest]);

  if (!block) {
    return null;
  }

  if (block.type === "divider") {
    return (
      <button
        type="button"
        onClick={() => addBlockBelow(block.id, { type: "paragraph" })}
        className="flex h-10 w-full items-center"
      >
        <span className="h-px w-full bg-white/8" />
      </button>
    );
  }

  const listIndex = getSiblingIndex(
    useEditorStore.getState(),
    block.id,
  );
  const showInlinePlaceholder =
    activeBlockId === block.id &&
    blockSupportsText(block.type) &&
    !blockHasDraftContent(block.content);

  return (
    <div className={`relative flex w-full items-start gap-3 px-2 py-2 ${getBlockShellClasses(block.type)}`}>
      {block.type === "callout" ? (
        <div className="pt-0.5 text-lg leading-none text-[#D6A14D]">!</div>
      ) : null}

      {block.type === "bullet_list" ? (
        <div className="pt-[3px] text-sm text-[#D4CFC6]">{"\u2022"}</div>
      ) : null}

      {block.type === "numbered_list" ? (
        <div className="min-w-[1.5rem] pt-[2px] text-sm text-[#D4CFC6]">
          {listIndex + 1}.
        </div>
      ) : null}

      <div
        data-placeholder={
          showInlinePlaceholder ? placeholderForBlockType(block.type) : undefined
        }
        className={`relative min-w-0 flex-1 ${showInlinePlaceholder ? "muxel-editor-placeholder" : ""} ${depth > 0 ? "pl-0" : ""}`}
      >
        <div
          className="relative z-10"
          onKeyDownCapture={(event) => {
            if (handleEditorKeyDown(event)) {
              event.stopPropagation();
            }
          }}
        >
          {editor ? <EditorContent editor={editor} /> : null}
        </div>
      </div>

      {editor ? (
        <FloatingFormattingToolbar
          editor={editor}
          open={showToolbar}
          referenceRect={selectionRect}
        />
      ) : null}

      <SlashCommandMenu
        open={slashState.open}
        query={slashState.query}
        selectedIndex={slashState.selectedIndex}
        referenceRect={slashState.rect}
        onSelect={(type) => {
          if (!editor || !slashState.range) {
            return;
          }

          editor.chain().focus().deleteRange(slashState.range).run();
          updateBlockType(block.id, type);
          startTransition(() => {
            updateBlockContent(block.id, editor.getHTML());
          });
          setSlashState({
            open: false,
            query: "",
            range: null,
            selectedIndex: 0,
            rect: null,
          });
        }}
        onClose={closeSlashState}
      />
    </div>
  );
}

