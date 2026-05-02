"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { GripVertical, Plus } from "lucide-react";

import { blockLabel, SLASH_COMMANDS } from "@/lib/block-utils";
import { EditorBlock } from "@/components/editor/editor-block";
import { useBlock, useEditorStore } from "@/store/editor-store";

function BlockOptionsMenu({
  blockId,
  onClose,
  position,
  triggerRef,
}: {
  blockId: string;
  onClose: () => void;
  position: { left: number; top: number };
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const deleteBlock = useEditorStore((state) => state.deleteBlock);
  const duplicateBlock = useEditorStore((state) => state.duplicateBlock);
  const selectedBlockIds = useEditorStore((state) => state.selectedBlockIds);
  const updateBlockTypes = useEditorStore((state) => state.updateBlockTypes);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const targetBlockIds =
    selectedBlockIds.includes(blockId) && selectedBlockIds.length > 1
      ? selectedBlockIds
      : [blockId];

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (
        !menuRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose, triggerRef]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      data-editor-selection-chrome="true"
      style={{
        left: position.left,
        top: position.top,
      }}
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      className="muxel-selection-chrome fixed z-30 w-56 select-none rounded-2xl border border-white/10 bg-[#161616] p-2 text-[#F3F2EE] shadow-[0_18px_50px_rgba(0,0,0,0.4)]"
    >
      <button
        type="button"
        onClick={() => {
          duplicateBlock(blockId);
          onClose();
        }}
        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-[#202020]"
      >
        Duplicate
      </button>

      <button
        type="button"
        onClick={() => {
          deleteBlock(blockId);
          onClose();
        }}
        className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-[#D8A6A0] transition hover:bg-[#261919]"
      >
        Delete
      </button>

      <div className="my-2 h-px bg-white/8" />
      <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7B7871]">
        Turn Into
      </div>
      {targetBlockIds.length > 1 ? (
        <div className="px-3 pb-2 text-xs text-[#9A978F]">
          Apply to {targetBlockIds.length} selected blocks
        </div>
      ) : null}

      <div className="space-y-1">
        {SLASH_COMMANDS.map((command) => (
          <button
            key={command.type}
            type="button"
            onClick={() => {
              updateBlockTypes(targetBlockIds, command.type);
              onClose();
            }}
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-[#202020]"
          >
            <span>{command.label}</span>
            <span className="text-xs text-[#7B7871]">{command.aliases[0]}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export function BlockWrapper({
  blockId,
  depth,
}: {
  blockId: string;
  depth: number;
}) {
  const block = useBlock(blockId);
  const addBlockBelow = useEditorStore((state) => state.addBlockBelow);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: blockId });
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dragStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const draggedSincePointerDownRef = useRef(false);

  const updateMenuPosition = () => {
    const triggerRect = menuTriggerRef.current?.getBoundingClientRect();

    if (!triggerRect) {
      return;
    }

    setMenuPosition({
      left: triggerRect.left,
      top: triggerRect.bottom + 8,
    });
  };

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen]);

  const setMenuTriggerRefs = (node: HTMLButtonElement | null) => {
    menuTriggerRef.current = node;
    setActivatorNodeRef(node);
  };

  if (!block) {
    return null;
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    marginLeft: `${depth * 24}px`,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-block-wrapper-id={blockId}
      className={`group relative py-0.5 ${isDragging ? "z-20 opacity-70" : ""}`}
    >
      <div
        data-editor-selection-chrome="true"
        className="absolute left-[-3rem] top-2 z-20 flex select-none items-start"
      >
        <div
          className={`relative flex items-center gap-1 transition ${
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <button
            type="button"
            onClick={() => addBlockBelow(blockId, { type: "paragraph" })}
            className="rounded-md p-1 text-[#A6A198] transition hover:bg-[#202020] hover:text-[#F8F6F1]"
            aria-label="Add block below"
          >
            <Plus className="h-4 w-4" />
          </button>

          <button
            ref={setMenuTriggerRefs}
            type="button"
            {...attributes}
            {...listeners}
            onPointerDownCapture={(event) => {
              dragStartPointRef.current = {
                x: event.clientX,
                y: event.clientY,
              };
              draggedSincePointerDownRef.current = false;
            }}
            onPointerMoveCapture={(event) => {
              const startPoint = dragStartPointRef.current;
              if (!startPoint) {
                return;
              }

              if (
                Math.abs(event.clientX - startPoint.x) > 4 ||
                Math.abs(event.clientY - startPoint.y) > 4
              ) {
                draggedSincePointerDownRef.current = true;
              }
            }}
            onPointerUpCapture={() => {
              dragStartPointRef.current = null;
            }}
            onClick={() => {
              if (draggedSincePointerDownRef.current) {
                draggedSincePointerDownRef.current = false;
                return;
              }

              updateMenuPosition();
              setMenuOpen((current) => !current);
            }}
            className="cursor-grab rounded-md p-1 text-[#A6A198] transition hover:bg-[#202020] hover:text-[#F8F6F1] active:cursor-grabbing"
            aria-label={`Drag or format ${blockLabel(block.type)} block`}
          >
            <GripVertical className="h-4 w-4" />
          </button>

          {menuOpen ? (
            <BlockOptionsMenu
              blockId={blockId}
              onClose={() => setMenuOpen(false)}
              position={menuPosition}
              triggerRef={menuTriggerRef}
            />
          ) : null}
        </div>
      </div>

      <div
        data-block-content-id={blockId}
        className={`min-w-0 ${depth > 0 ? "border-l border-white/8 pl-4" : ""}`}
      >
        <EditorBlock blockId={blockId} depth={depth} />
      </div>
    </div>
  );
}
