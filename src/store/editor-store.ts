"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import {
  blockIsEmpty,
  createEmptyBlockContent,
  EMPTY_BLOCK_HTML,
  flattenBlockIds,
  getPreviousVisibleBlockId,
  mergeInlineHtml,
  sanitizeContentForBlockType,
} from "@/lib/block-utils";
import type {
  Block,
  BlockType,
  FocusPosition,
  FocusRequest,
  PageState,
} from "@/lib/editor-types";

interface AddBlockOptions {
  content?: string;
  type?: BlockType;
  parentId?: string | null;
  focusPosition?: FocusPosition;
}

type MoveBlockPlacement = "before" | "after";
type HistoryBatch =
  | {
      kind: "content";
      blockId: string;
      timestamp: number;
    }
  | {
      kind: "title";
      timestamp: number;
    }
  | null;

interface HistorySnapshot extends PageState {
  activeBlockId: string | null;
}

interface EditorStore extends PageState {
  activeBlockId: string | null;
  focusRequest: FocusRequest | null;
  selectedBlockIds: string[];
  historyPast: HistorySnapshot[];
  historyFuture: HistorySnapshot[];
  historyBatch: HistoryBatch;
  setTitle: (title: string) => void;
  setCoverImage: (coverImage: string | null) => void;
  setIcon: (icon: string | null) => void;
  setActiveBlockId: (blockId: string | null) => void;
  setSelectedBlockIds: (blockIds: string[]) => void;
  resetBlocks: () => void;
  requestFocus: (blockId: string, position?: FocusPosition) => void;
  clearFocusRequest: () => void;
  updateBlockContent: (blockId: string, content: string) => void;
  updateBlockType: (blockId: string, type: BlockType) => void;
  updateBlockTypes: (blockIds: string[], type: BlockType) => void;
  addBlockBelow: (referenceBlockId: string, options?: AddBlockOptions) => string | null;
  deleteBlock: (blockId: string) => void;
  duplicateBlock: (blockId: string) => void;
  mergeBlockIntoPrevious: (blockId: string) => void;
  indentBlock: (blockId: string) => void;
  outdentBlock: (blockId: string) => void;
  moveBlock: (activeId: string, overId: string, placement?: MoveBlockPlacement) => void;
  undo: () => void;
  redo: () => void;
  getPreviousBlockId: (blockId: string) => string | null;
}

const INITIAL_BLOCK_ID = "block-initial";
const EMPTY_BLOCK_IDS: string[] = [];
const HISTORY_LIMIT = 100;
const TEXT_HISTORY_MERGE_MS = 800;

const initialPageState: PageState = {
  id: "page-muxel",
  title: "",
  coverImage: null,
  icon: null,
  rootBlocks: [INITIAL_BLOCK_ID],
  blocks: {
    [INITIAL_BLOCK_ID]: {
      id: INITIAL_BLOCK_ID,
      type: "paragraph",
      content: EMPTY_BLOCK_HTML,
      children: [],
      parentId: null,
    },
  },
};

function createBlock(
  type: BlockType = "paragraph",
  content = createEmptyBlockContent(),
  parentId: string | null = null,
): Block {
  return {
    id: crypto.randomUUID(),
    type,
    content: sanitizeContentForBlockType(content, type),
    children: [],
    parentId,
  };
}

function cloneBlocks(blocks: Record<string, Block>) {
  return Object.fromEntries(
    Object.entries(blocks).map(([id, block]) => [id, { ...block, children: [...block.children] }]),
  );
}

function createHistorySnapshot(
  state: Pick<
    EditorStore,
    "activeBlockId" | "blocks" | "coverImage" | "icon" | "id" | "rootBlocks" | "title"
  >,
): HistorySnapshot {
  return {
    id: state.id,
    title: state.title,
    coverImage: state.coverImage,
    icon: state.icon,
    blocks: cloneBlocks(state.blocks),
    rootBlocks: [...state.rootBlocks],
    activeBlockId: state.activeBlockId,
  };
}

function pushHistory(
  state: EditorStore,
  historyBatch: HistoryBatch = null,
) {
  return {
    historyPast: [
      ...state.historyPast.slice(-(HISTORY_LIMIT - 1)),
      createHistorySnapshot(state),
    ],
    historyFuture: [],
    historyBatch,
  };
}

function restoreHistorySnapshot(snapshot: HistorySnapshot) {
  const restoredActiveBlockId =
    snapshot.activeBlockId && snapshot.blocks[snapshot.activeBlockId]
      ? snapshot.activeBlockId
      : snapshot.rootBlocks[0] ?? null;

  return {
    id: snapshot.id,
    title: snapshot.title,
    coverImage: snapshot.coverImage,
    icon: snapshot.icon,
    blocks: cloneBlocks(snapshot.blocks),
    rootBlocks: [...snapshot.rootBlocks],
    activeBlockId: restoredActiveBlockId,
    selectedBlockIds: [],
    focusRequest: restoredActiveBlockId
      ? {
          blockId: restoredActiveBlockId,
          position: "end" as const,
          timestamp: Date.now(),
        }
      : null,
  };
}

function getSiblingIds(page: Pick<PageState, "blocks" | "rootBlocks">, parentId: string | null) {
  return parentId ? page.blocks[parentId]?.children ?? EMPTY_BLOCK_IDS : page.rootBlocks;
}

function replaceSiblingIds(
  page: { blocks: Record<string, Block>; rootBlocks: string[] },
  parentId: string | null,
  nextSiblingIds: string[],
) {
  if (parentId === null) {
    page.rootBlocks = nextSiblingIds;
    return;
  }

  const parent = page.blocks[parentId];
  if (!parent) {
    return;
  }

  page.blocks[parentId] = {
    ...parent,
    children: nextSiblingIds,
  };
}

function collectSubtreeIds(blocks: Record<string, Block>, blockId: string): string[] {
  const block = blocks[blockId];
  if (!block) {
    return [];
  }

  return [blockId, ...block.children.flatMap((childId) => collectSubtreeIds(blocks, childId))];
}

function createEmptyPage() {
  const block = createBlock();
  return {
    ...initialPageState,
    blocks: {
      [block.id]: block,
    },
    rootBlocks: [block.id],
  };
}

function cloneSubtree(
  blocks: Record<string, Block>,
  blockId: string,
  parentId: string | null,
): { newRootId: string; clonedBlocks: Record<string, Block> } {
  const source = blocks[blockId];
  const nextId = crypto.randomUUID();
  const clonedRoot: Block = {
    ...source,
    id: nextId,
    parentId,
    children: [],
  };

  const clonedBlocks: Record<string, Block> = {
    [nextId]: clonedRoot,
  };

  const nextChildren: string[] = [];

  for (const childId of source.children) {
    const clonedChild = cloneSubtree(blocks, childId, nextId);
    nextChildren.push(clonedChild.newRootId);
    Object.assign(clonedBlocks, clonedChild.clonedBlocks);
  }

  clonedBlocks[nextId] = {
    ...clonedRoot,
    children: nextChildren,
  };

  return {
    newRootId: nextId,
    clonedBlocks,
  };
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...initialPageState,
  activeBlockId: INITIAL_BLOCK_ID,
  focusRequest: null,
  selectedBlockIds: [],
  historyPast: [],
  historyFuture: [],
  historyBatch: null,
  setTitle: (title) =>
    set((state) => {
      if (title === state.title) {
        return state;
      }

      const timestamp = Date.now();
      const shouldMergeWithPreviousTitleUpdate =
        state.historyBatch?.kind === "title" &&
        timestamp - state.historyBatch.timestamp <= TEXT_HISTORY_MERGE_MS;
      const history = shouldMergeWithPreviousTitleUpdate
        ? {
            historyFuture: [],
            historyBatch: {
              kind: "title" as const,
              timestamp,
            },
          }
        : pushHistory(state, {
            kind: "title",
            timestamp,
          });

      return {
        ...history,
        title,
      };
    }),
  setCoverImage: (coverImage) =>
    set((state) =>
      coverImage === state.coverImage
        ? state
        : {
            ...pushHistory(state),
            coverImage,
          },
    ),
  setIcon: (icon) =>
    set((state) =>
      icon === state.icon
        ? state
        : {
            ...pushHistory(state),
            icon,
          },
    ),
  setActiveBlockId: (blockId) =>
    set({
      activeBlockId: blockId,
      selectedBlockIds: [],
    }),
  setSelectedBlockIds: (blockIds) =>
    set({
      selectedBlockIds: [...new Set(blockIds)],
    }),
  resetBlocks: () =>
    set((state) => {
      const emptyPage = createEmptyPage();
      const firstBlockId = emptyPage.rootBlocks[0] ?? null;

      return {
        ...pushHistory(state),
        blocks: emptyPage.blocks,
        rootBlocks: emptyPage.rootBlocks,
        activeBlockId: firstBlockId,
        selectedBlockIds: [],
        focusRequest: firstBlockId
          ? {
              blockId: firstBlockId,
              position: "start",
              timestamp: Date.now(),
            }
          : null,
      };
    }),
  requestFocus: (blockId, position = "start") =>
    set({
      focusRequest: {
        blockId,
        position,
        timestamp: Date.now(),
      },
      activeBlockId: blockId,
      selectedBlockIds: [],
    }),
  clearFocusRequest: () => set({ focusRequest: null }),
  updateBlockContent: (blockId, content) =>
    set((state) => {
      const block = state.blocks[blockId];
      if (!block) {
        return state;
      }
      const nextContent = sanitizeContentForBlockType(content, block.type);

      if (nextContent === block.content) {
        return state;
      }

      const timestamp = Date.now();
      const shouldMergeWithPreviousContentUpdate =
        state.historyBatch?.kind === "content" &&
        state.historyBatch.blockId === blockId &&
        timestamp - state.historyBatch.timestamp <= TEXT_HISTORY_MERGE_MS;
      const history = shouldMergeWithPreviousContentUpdate
        ? {
            historyFuture: [],
            historyBatch: {
              kind: "content" as const,
              blockId,
              timestamp,
            },
          }
        : pushHistory(state, {
            kind: "content",
            blockId,
            timestamp,
          });

      return {
        ...history,
        blocks: {
          ...state.blocks,
          [blockId]: {
            ...block,
            content: nextContent,
          },
        },
      };
    }),
  updateBlockType: (blockId, type) =>
    set((state) => {
      const block = state.blocks[blockId];
      if (!block) {
        return state;
      }

      return {
        ...pushHistory(state),
        blocks: {
          ...state.blocks,
          [blockId]: {
            ...block,
            type,
            content: sanitizeContentForBlockType(block.content, type),
          },
        },
      };
    }),
  updateBlockTypes: (blockIds, type) =>
    set((state) => {
      const nextBlocks = { ...state.blocks };
      let changed = false;

      for (const blockId of blockIds) {
        const block = state.blocks[blockId];
        if (!block) {
          continue;
        }

        nextBlocks[blockId] = {
          ...block,
          type,
          content: sanitizeContentForBlockType(block.content, type),
        };
        changed = true;
      }

      if (!changed) {
        return state;
      }

      return {
        ...pushHistory(state),
        blocks: nextBlocks,
        selectedBlockIds: [],
      };
    }),
  addBlockBelow: (referenceBlockId, options) => {
    const state = get();
    const referenceBlock = state.blocks[referenceBlockId];
    if (!referenceBlock) {
      return null;
    }

    const parentId = options?.parentId ?? referenceBlock.parentId;
    const siblings = [...getSiblingIds(state, parentId)];
    const insertIndex = siblings.indexOf(referenceBlockId);
    const nextBlock = createBlock(
      options?.type ?? "paragraph",
      options?.content ?? createEmptyBlockContent(),
      parentId,
    );

    siblings.splice(insertIndex + 1, 0, nextBlock.id);

    set((current) => {
      const blocks = {
        ...current.blocks,
        [nextBlock.id]: nextBlock,
      };

      const nextRootBlocks = [...current.rootBlocks];
      const nextPage = { blocks, rootBlocks: nextRootBlocks };
      replaceSiblingIds(nextPage, parentId, siblings);

      return {
        ...pushHistory(current),
        blocks: nextPage.blocks,
        rootBlocks: nextPage.rootBlocks,
        activeBlockId: nextBlock.id,
        selectedBlockIds: [],
        focusRequest: {
          blockId: nextBlock.id,
          position: options?.focusPosition ?? "start",
          timestamp: Date.now(),
        },
      };
    });

    return nextBlock.id;
  },
  deleteBlock: (blockId) =>
    set((state) => {
      const block = state.blocks[blockId];
      if (!block) {
        return state;
      }

      const nextBlocks = cloneBlocks(state.blocks);
      const nextRootBlocks = [...state.rootBlocks];
      const targetParentId = block.parentId;
      const nextPage = { blocks: nextBlocks, rootBlocks: nextRootBlocks };
      const siblings = [...getSiblingIds(state, targetParentId)].filter((id) => id !== blockId);

      replaceSiblingIds(nextPage, targetParentId, siblings);

      for (const id of collectSubtreeIds(nextBlocks, blockId)) {
        delete nextBlocks[id];
      }

      if (Object.keys(nextBlocks).length === 0) {
        const emptyPage = createEmptyPage();
        return {
          ...pushHistory(state),
          blocks: emptyPage.blocks,
          rootBlocks: emptyPage.rootBlocks,
          activeBlockId: emptyPage.rootBlocks[0] ?? null,
          selectedBlockIds: [],
          focusRequest: emptyPage.rootBlocks[0]
            ? {
                blockId: emptyPage.rootBlocks[0],
                position: "start",
                timestamp: Date.now(),
              }
            : null,
        };
      }

      return {
        ...pushHistory(state),
        blocks: nextBlocks,
        rootBlocks: nextPage.rootBlocks,
        selectedBlockIds: [],
      };
    }),
  duplicateBlock: (blockId) =>
    set((state) => {
      const block = state.blocks[blockId];
      if (!block) {
        return state;
      }

      const clonedTree = cloneSubtree(state.blocks, blockId, block.parentId);
      const nextBlocks = {
        ...cloneBlocks(state.blocks),
        ...clonedTree.clonedBlocks,
      };
      const nextRootBlocks = [...state.rootBlocks];
      const nextPage = { blocks: nextBlocks, rootBlocks: nextRootBlocks };
      const siblings = [...getSiblingIds(state, block.parentId)];
      const insertIndex = siblings.indexOf(blockId);
      siblings.splice(insertIndex + 1, 0, clonedTree.newRootId);
      replaceSiblingIds(nextPage, block.parentId, siblings);

      return {
        ...pushHistory(state),
        blocks: nextBlocks,
        rootBlocks: nextPage.rootBlocks,
        activeBlockId: clonedTree.newRootId,
        selectedBlockIds: [],
        focusRequest: {
          blockId: clonedTree.newRootId,
          position: "start",
          timestamp: Date.now(),
        },
      };
    }),
  mergeBlockIntoPrevious: (blockId) =>
    set((state) => {
      const block = state.blocks[blockId];
      const previousBlockId = getPreviousVisibleBlockId(state, blockId);

      if (!block || !previousBlockId) {
        return state;
      }

      const previousBlock = state.blocks[previousBlockId];
      if (!previousBlock) {
        return state;
      }

      const nextBlocks = cloneBlocks(state.blocks);
      nextBlocks[previousBlockId] = {
        ...previousBlock,
        content: mergeInlineHtml(previousBlock.content, block.content),
      };

      const nextRootBlocks = [...state.rootBlocks];
      const nextPage = { blocks: nextBlocks, rootBlocks: nextRootBlocks };
      const siblings = [...getSiblingIds(state, block.parentId)].filter((id) => id !== blockId);
      replaceSiblingIds(nextPage, block.parentId, siblings);

      for (const id of collectSubtreeIds(nextBlocks, blockId)) {
        delete nextBlocks[id];
      }

      return {
        ...pushHistory(state),
        blocks: nextBlocks,
        rootBlocks: nextPage.rootBlocks,
        activeBlockId: previousBlockId,
        selectedBlockIds: [],
        focusRequest: {
          blockId: previousBlockId,
          position: "end",
          timestamp: Date.now(),
        },
      };
    }),
  indentBlock: (blockId) =>
    set((state) => {
      const block = state.blocks[blockId];
      const previousBlockId = getPreviousVisibleBlockId(state, blockId);

      if (!block || !previousBlockId || previousBlockId === block.parentId) {
        return state;
      }

      if (collectSubtreeIds(state.blocks, blockId).includes(previousBlockId)) {
        return state;
      }

      const nextBlocks = cloneBlocks(state.blocks);
      const nextRootBlocks = [...state.rootBlocks];
      const nextPage = { blocks: nextBlocks, rootBlocks: nextRootBlocks };
      const sourceSiblings = [...getSiblingIds(state, block.parentId)].filter((id) => id !== blockId);
      replaceSiblingIds(nextPage, block.parentId, sourceSiblings);

      const nextParent = nextBlocks[previousBlockId];
      if (!nextParent) {
        return state;
      }

      nextBlocks[blockId] = {
        ...block,
        parentId: previousBlockId,
      };
      nextBlocks[previousBlockId] = {
        ...nextParent,
        children: [...nextParent.children, blockId],
      };

      return {
        ...pushHistory(state),
        blocks: nextBlocks,
        rootBlocks: nextPage.rootBlocks,
        activeBlockId: blockId,
        selectedBlockIds: [],
        focusRequest: {
          blockId,
          position: "end",
          timestamp: Date.now(),
        },
      };
    }),
  outdentBlock: (blockId) =>
    set((state) => {
      const block = state.blocks[blockId];
      if (!block?.parentId) {
        return state;
      }

      const parent = state.blocks[block.parentId];
      if (!parent) {
        return state;
      }

      const nextParentId = parent.parentId;
      const nextBlocks = cloneBlocks(state.blocks);
      const nextRootBlocks = [...state.rootBlocks];
      const nextPage = { blocks: nextBlocks, rootBlocks: nextRootBlocks };

      replaceSiblingIds(
        nextPage,
        block.parentId,
        parent.children.filter((id) => id !== blockId),
      );

      const destinationSiblings = [...getSiblingIds(nextPage, nextParentId)];
      const parentIndex = destinationSiblings.indexOf(parent.id);
      destinationSiblings.splice(parentIndex + 1, 0, blockId);
      replaceSiblingIds(nextPage, nextParentId, destinationSiblings);

      nextBlocks[blockId] = {
        ...block,
        parentId: nextParentId,
      };

      return {
        ...pushHistory(state),
        blocks: nextBlocks,
        rootBlocks: nextPage.rootBlocks,
        activeBlockId: blockId,
        selectedBlockIds: [],
        focusRequest: {
          blockId,
          position: "end",
          timestamp: Date.now(),
        },
      };
    }),
  moveBlock: (activeId, overId, placement = "before") =>
    set((state) => {
      if (activeId === overId) {
        return state;
      }

      const activeBlock = state.blocks[activeId];
      const overBlock = state.blocks[overId];

      if (!activeBlock || !overBlock) {
        return state;
      }

      if (collectSubtreeIds(state.blocks, activeId).includes(overId)) {
        return state;
      }

      const sourceParentId = activeBlock.parentId;
      const destinationParentId = overBlock.parentId;
      const nextBlocks = cloneBlocks(state.blocks);
      const nextRootBlocks = [...state.rootBlocks];
      const nextPage = { blocks: nextBlocks, rootBlocks: nextRootBlocks };

      replaceSiblingIds(
        nextPage,
        sourceParentId,
        getSiblingIds(state, sourceParentId).filter((id) => id !== activeId),
      );

      const destinationSiblings = [...getSiblingIds(nextPage, destinationParentId)];
      const overIndex = destinationSiblings.indexOf(overId);
      if (overIndex < 0) {
        return state;
      }

      const insertIndex = placement === "after" ? overIndex + 1 : overIndex;
      destinationSiblings.splice(insertIndex, 0, activeId);
      replaceSiblingIds(nextPage, destinationParentId, destinationSiblings);

      nextBlocks[activeId] = {
        ...activeBlock,
        parentId: destinationParentId,
      };

      return {
        ...pushHistory(state),
        blocks: nextBlocks,
        rootBlocks: nextPage.rootBlocks,
        selectedBlockIds: [],
      };
    }),
  undo: () =>
    set((state) => {
      const previousSnapshot = state.historyPast[state.historyPast.length - 1];

      if (!previousSnapshot) {
        return state;
      }

      return {
        ...restoreHistorySnapshot(previousSnapshot),
        historyPast: state.historyPast.slice(0, -1),
        historyFuture: [
          createHistorySnapshot(state),
          ...state.historyFuture.slice(0, HISTORY_LIMIT - 1),
        ],
        historyBatch: null,
      };
    }),
  redo: () =>
    set((state) => {
      const nextSnapshot = state.historyFuture[0];

      if (!nextSnapshot) {
        return state;
      }

      return {
        ...restoreHistorySnapshot(nextSnapshot),
        historyPast: [
          ...state.historyPast.slice(-(HISTORY_LIMIT - 1)),
          createHistorySnapshot(state),
        ],
        historyFuture: state.historyFuture.slice(1),
        historyBatch: null,
      };
    }),
  getPreviousBlockId: (blockId) => {
    const state = get();
    return getPreviousVisibleBlockId(state, blockId);
  },
}));

export function useRootBlockIds() {
  return useEditorStore((state) => state.rootBlocks);
}

export function useBlock(blockId: string) {
  return useEditorStore((state) => state.blocks[blockId]);
}

export function useOrderedBlockIds() {
  return useEditorStore(useShallow((state) => flattenBlockIds(state)));
}

export function useCanDeleteBlock(blockId: string) {
  return useEditorStore((state) => {
    const block = state.blocks[blockId];
    if (!block) {
      return false;
    }

    return !(state.rootBlocks.length === 1 && blockIsEmpty(block.content));
  });
}
