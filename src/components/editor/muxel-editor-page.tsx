"use client";

import { BlockList } from "@/components/editor/block-list";
import { PageHeader } from "@/components/editor/page-header";
import { blockHasDraftContent, flattenBlockIds } from "@/lib/block-utils";
import { useEditorStore } from "@/store/editor-store";

export function MuxelEditorPage() {
  const activeBlockId = useEditorStore((state) => state.activeBlockId);
  const addBlockBelow = useEditorStore((state) => state.addBlockBelow);

  return (
    <main className="min-h-screen bg-[#0d0d0d] text-[#F3F2EE]">
      <PageHeader />
      <section
        className="mx-auto flex min-h-[40vh] w-full max-w-[900px] flex-col px-12 pb-40 pt-2 lg:px-24"
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }

          const referenceBlockId =
            activeBlockId ??
            (() => {
              const state = useEditorStore.getState();
              const orderedBlockIds = flattenBlockIds(state);
              return orderedBlockIds[orderedBlockIds.length - 1] ?? null;
            })();
          if (!referenceBlockId) {
            return;
          }

          const state = useEditorStore.getState();
          const referenceBlock = state.blocks[referenceBlockId];
          if (!referenceBlock || !blockHasDraftContent(referenceBlock.content)) {
            return;
          }

          event.preventDefault();
          addBlockBelow(referenceBlockId, { type: "paragraph" });
        }}
      >
        <BlockList />
      </section>
    </main>
  );
}
