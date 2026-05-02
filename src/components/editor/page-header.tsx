"use client";

import { useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { ImagePlus, SmilePlus } from "lucide-react";
import Image from "next/image";

import { DEMO_COVER_IMAGE } from "@/lib/block-utils";
import { useEditorStore } from "@/store/editor-store";

export function PageHeader() {
  const title = useEditorStore((state) => state.title);
  const coverImage = useEditorStore((state) => state.coverImage);
  const icon = useEditorStore((state) => state.icon);
  const rootBlocks = useEditorStore((state) => state.rootBlocks);
  const setTitle = useEditorStore((state) => state.setTitle);
  const setCoverImage = useEditorStore((state) => state.setCoverImage);
  const setIcon = useEditorStore((state) => state.setIcon);
  const setSelectedBlockIds = useEditorStore((state) => state.setSelectedBlockIds);
  const requestFocus = useEditorStore((state) => state.requestFocus);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const titleRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element) {
      return;
    }

    if (element.textContent !== title) {
      element.textContent = title;
    }
  }, [title]);

  return (
    <header className="pb-6">
      {coverImage ? (
        <div className="group relative h-[30vh] min-h-[220px] w-full overflow-hidden bg-[#161616]">
          <Image
            src={coverImage}
            alt="Muxel page cover"
            fill
            unoptimized
            className="object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 via-black/10 to-black/55" />
          <div className="absolute right-6 top-6 flex gap-2 opacity-0 transition group-hover:opacity-100">
            <button
              type="button"
              onClick={() => setCoverImage(DEMO_COVER_IMAGE)}
              className="rounded-full border border-white/10 bg-[#161616]/90 px-4 py-2 text-sm font-medium text-[#F3F2EE] shadow-sm backdrop-blur transition hover:bg-[#1E1E1E]"
            >
              Change cover
            </button>
            <button
              type="button"
              onClick={() => setCoverImage(null)}
              className="rounded-full border border-white/10 bg-[#161616]/90 px-4 py-2 text-sm font-medium text-[#D8A6A0] shadow-sm backdrop-blur transition hover:bg-[#1E1E1E]"
            >
              Remove cover
            </button>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-[900px] flex-col px-12 pt-12 lg:px-24">
        <div className={coverImage ? "-mt-12" : "pt-8"}>
          {icon ? (
            <button
              type="button"
              onClick={() => setIcon(null)}
              className="mb-5 inline-flex h-20 w-20 items-center justify-center rounded-[24px] border border-white/8 bg-[#151515] text-[42px] leading-none shadow-[0_18px_40px_rgba(0,0,0,0.32)] transition hover:bg-[#1B1B1B]"
              aria-label="Remove page icon"
            >
              {icon}
            </button>
          ) : null}

          <div className="mb-5 flex flex-wrap gap-3 text-sm text-[#9A978F]">
            {!icon ? (
              <button
                type="button"
                onClick={() => setIcon("\u2726")}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-white/10 bg-[#151515] px-4 font-medium text-[#E8E5DE] transition hover:bg-[#1D1D1D]"
              >
                <SmilePlus className="h-4 w-4" />
                Add icon
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIcon(null)}
                className="inline-flex h-11 items-center rounded-full border border-white/10 bg-[#151515] px-4 font-medium text-[#E8E5DE] transition hover:bg-[#1D1D1D]"
              >
                Remove icon
              </button>
            )}

            {!coverImage ? (
              <button
                type="button"
                onClick={() => setCoverImage(DEMO_COVER_IMAGE)}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-white/10 bg-[#151515] px-4 font-medium text-[#E8E5DE] transition hover:bg-[#1D1D1D]"
              >
                <ImagePlus className="h-4 w-4" />
                Add cover
              </button>
            ) : null}
          </div>
        </div>

        <div
          ref={titleRef}
          role="textbox"
          aria-label="Page title"
          aria-multiline={false}
          contentEditable
          suppressContentEditableWarning
          spellCheck
          data-placeholder="Untitled"
          onFocus={() => setSelectedBlockIds([])}
          onInput={(event) => {
            const nextTitle = event.currentTarget.textContent?.replace(/\n/g, "") ?? "";
            setTitle(nextTitle);
          }}
          onBlur={(event) => {
            const nextTitle = event.currentTarget.textContent?.replace(/\n/g, "") ?? "";

            if (!nextTitle) {
              event.currentTarget.textContent = "";
            }

            setTitle(nextTitle);
          }}
          onKeyDown={(event) => {
            const key = event.key.toLowerCase();
            const modifierPressed = event.metaKey || event.ctrlKey;

            if (modifierPressed && key === "z") {
              event.preventDefault();

              if (event.shiftKey) {
                redo();
              } else {
                undo();
              }

              return;
            }

            if (event.ctrlKey && key === "y") {
              event.preventDefault();
              redo();
              return;
            }

            if (event.key === "Enter") {
              event.preventDefault();
              const firstBlockId = rootBlocks[0];

              if (firstBlockId) {
                flushSync(() => {
                  requestFocus(firstBlockId, "start");
                });
              }
            }
          }}
          className="min-h-[64px] w-full whitespace-pre-wrap break-words text-[56px] font-bold leading-[1.05] tracking-[-0.04em] text-[#F5F3EE] outline-none [&:empty:before]:pointer-events-none [&:empty:before]:content-[attr(data-placeholder)] [&:empty:before]:text-[#7B776F]"
        />
      </div>
    </header>
  );
}
