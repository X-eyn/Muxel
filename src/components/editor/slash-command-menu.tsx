"use client";

import { useDeferredValue, useEffect, useRef } from "react";
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react";

import { filterSlashCommands } from "@/lib/block-utils";
import type { BlockType } from "@/lib/editor-types";

function createVirtualElement(rect: DOMRect) {
  return {
    getBoundingClientRect: () => rect,
  };
}

export function SlashCommandMenu({
  open,
  query,
  selectedIndex,
  referenceRect,
  onSelect,
  onClose,
}: {
  open: boolean;
  query: string;
  selectedIndex: number;
  referenceRect: DOMRect | null;
  onSelect: (type: BlockType) => void;
  onClose: () => void;
}) {
  const deferredQuery = useDeferredValue(query);
  const commands = filterSlashCommands(deferredQuery);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const floating = useFloating({
    open,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 12 })],
  });
  const setFloating = (node: HTMLDivElement | null) => {
    menuRef.current = node;
    floating.refs.setFloating(node);
  };

  useEffect(() => {
    if (!referenceRect) {
      return;
    }

    floating.refs.setPositionReference(createVirtualElement(referenceRect));
  }, [floating.refs, referenceRect]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }

      onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose, open]);

  if (!open || !referenceRect || commands.length === 0) {
    return null;
  }

  return (
    <FloatingPortal>
      <div
        ref={setFloating}
        style={floating.floatingStyles}
        className="z-40 w-[272px] rounded-[18px] border border-white/10 bg-[#161616]/98 p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.34)] backdrop-blur"
      >
        <div className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7B7871]">
          Turn Into
        </div>

        <div className="space-y-1">
          {commands.map((command, index) => (
            <button
              key={command.type}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(command.type)}
              className={`flex w-full items-start justify-between rounded-[14px] px-3 py-2 text-left transition ${
                index === selectedIndex ? "bg-[#222222]" : "hover:bg-[#202020]"
              }`}
            >
              <span className="pr-4">
                <span className="block text-sm font-medium text-[#F3F2EE]">
                  {command.label}
                </span>
                <span className="mt-0.5 block text-xs text-[#9A978F]">
                  {command.description}
                </span>
              </span>
              <span className="pt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[#7B7871]">
                {command.aliases[0]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </FloatingPortal>
  );
}
