import assert from "node:assert/strict";

import {
  EMPTY_BLOCK_HTML,
  blockHasDraftContent,
  flattenBlockIds,
} from "../src/lib/block-utils";
import type { Block, PageState } from "../src/lib/editor-types";
import { useEditorStore } from "../src/store/editor-store";

type EditorStateSeed = Pick<PageState, "blocks" | "rootBlocks">;

const PAGE_META = {
  id: "page-test",
  title: "",
  coverImage: null,
  icon: null,
};

function createBlock(
  id: string,
  parentId: string | null,
  children: string[] = [],
  content = `<p>${id}</p>`,
): Block {
  return {
    id,
    type: "paragraph",
    content,
    children,
    parentId,
  };
}

function seedState(seed: EditorStateSeed) {
  useEditorStore.setState({
    ...PAGE_META,
    blocks: seed.blocks,
    rootBlocks: seed.rootBlocks,
    activeBlockId: seed.rootBlocks[0] ?? null,
    focusRequest: null,
    selectedBlockIds: [],
  });
}

function orderedBlockIds() {
  return flattenBlockIds(useEditorStore.getState());
}

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "moves a root block after another root block",
    run: () => {
      seedState({
        rootBlocks: ["a", "b", "c"],
        blocks: {
          a: createBlock("a", null),
          b: createBlock("b", null),
          c: createBlock("c", null),
        },
      });

      useEditorStore.getState().moveBlock("a", "b", "after");
      assert.deepEqual(useEditorStore.getState().rootBlocks, ["b", "a", "c"]);
    },
  },
  {
    name: "moves a root block before another root block",
    run: () => {
      seedState({
        rootBlocks: ["a", "b", "c"],
        blocks: {
          a: createBlock("a", null),
          b: createBlock("b", null),
          c: createBlock("c", null),
        },
      });

      useEditorStore.getState().moveBlock("c", "a", "before");
      assert.deepEqual(useEditorStore.getState().rootBlocks, ["c", "a", "b"]);
    },
  },
  {
    name: "moves a middle root block to the top",
    run: () => {
      seedState({
        rootBlocks: ["a", "b", "c", "d"],
        blocks: {
          a: createBlock("a", null),
          b: createBlock("b", null),
          c: createBlock("c", null),
          d: createBlock("d", null),
        },
      });

      useEditorStore.getState().moveBlock("c", "a", "before");
      assert.deepEqual(useEditorStore.getState().rootBlocks, ["c", "a", "b", "d"]);
    },
  },
  {
    name: "reorders nested siblings within the same parent",
    run: () => {
      seedState({
        rootBlocks: ["root"],
        blocks: {
          root: createBlock("root", null, ["x", "y", "z"]),
          x: createBlock("x", "root"),
          y: createBlock("y", "root"),
          z: createBlock("z", "root"),
        },
      });

      useEditorStore.getState().moveBlock("z", "x", "before");
      assert.deepEqual(useEditorStore.getState().blocks.root.children, ["z", "x", "y"]);
    },
  },
  {
    name: "moves a nested block after a sibling in the same parent",
    run: () => {
      seedState({
        rootBlocks: ["root"],
        blocks: {
          root: createBlock("root", null, ["x", "y", "z"]),
          x: createBlock("x", "root"),
          y: createBlock("y", "root"),
          z: createBlock("z", "root"),
        },
      });

      useEditorStore.getState().moveBlock("x", "z", "after");
      assert.deepEqual(useEditorStore.getState().blocks.root.children, ["y", "z", "x"]);
    },
  },
  {
    name: "moves a child block to the root level",
    run: () => {
      seedState({
        rootBlocks: ["root", "tail"],
        blocks: {
          root: createBlock("root", null, ["child"]),
          child: createBlock("child", "root"),
          tail: createBlock("tail", null),
        },
      });

      useEditorStore.getState().moveBlock("child", "tail", "before");
      assert.deepEqual(useEditorStore.getState().rootBlocks, ["root", "child", "tail"]);
      assert.equal(useEditorStore.getState().blocks.child.parentId, null);
      assert.deepEqual(useEditorStore.getState().blocks.root.children, []);
    },
  },
  {
    name: "moves a root block into another parent's sibling group",
    run: () => {
      seedState({
        rootBlocks: ["a", "parent"],
        blocks: {
          a: createBlock("a", null),
          parent: createBlock("parent", null, ["x", "y"]),
          x: createBlock("x", "parent"),
          y: createBlock("y", "parent"),
        },
      });

      useEditorStore.getState().moveBlock("a", "x", "before");
      assert.deepEqual(useEditorStore.getState().rootBlocks, ["parent"]);
      assert.deepEqual(useEditorStore.getState().blocks.parent.children, ["a", "x", "y"]);
      assert.equal(useEditorStore.getState().blocks.a.parentId, "parent");
    },
  },
  {
    name: "moves a child between two different parents",
    run: () => {
      seedState({
        rootBlocks: ["left", "right"],
        blocks: {
          left: createBlock("left", null, ["a", "b"]),
          a: createBlock("a", "left"),
          b: createBlock("b", "left"),
          right: createBlock("right", null, ["x", "y"]),
          x: createBlock("x", "right"),
          y: createBlock("y", "right"),
        },
      });

      useEditorStore.getState().moveBlock("b", "x", "after");
      assert.deepEqual(useEditorStore.getState().blocks.left.children, ["a"]);
      assert.deepEqual(useEditorStore.getState().blocks.right.children, ["x", "b", "y"]);
      assert.equal(useEditorStore.getState().blocks.b.parentId, "right");
    },
  },
  {
    name: "prevents moving a block into its own descendant",
    run: () => {
      seedState({
        rootBlocks: ["a"],
        blocks: {
          a: createBlock("a", null, ["b"]),
          b: createBlock("b", "a", ["c"]),
          c: createBlock("c", "b"),
        },
      });

      useEditorStore.getState().moveBlock("a", "c", "after");
      assert.deepEqual(orderedBlockIds(), ["a", "b", "c"]);
      assert.deepEqual(useEditorStore.getState().rootBlocks, ["a"]);
      assert.deepEqual(useEditorStore.getState().blocks.a.children, ["b"]);
    },
  },
  {
    name: "keeps flattened visible order correct after a cross-parent move",
    run: () => {
      seedState({
        rootBlocks: ["a", "b", "c"],
        blocks: {
          a: createBlock("a", null),
          b: createBlock("b", null, ["b1", "b2"]),
          b1: createBlock("b1", "b"),
          b2: createBlock("b2", "b"),
          c: createBlock("c", null),
        },
      });

      useEditorStore.getState().moveBlock("c", "b1", "before");
      assert.deepEqual(orderedBlockIds(), ["a", "b", "c", "b1", "b2"]);
      assert.deepEqual(useEditorStore.getState().rootBlocks, ["a", "b"]);
      assert.deepEqual(useEditorStore.getState().blocks.b.children, ["c", "b1", "b2"]);
    },
  },
  {
    name: "treats whitespace-only content as draft content for click-below creation",
    run: () => {
      assert.equal(blockHasDraftContent("<p>&nbsp;</p>"), true);
      assert.equal(blockHasDraftContent("<p>   </p>"), true);
    },
  },
  {
    name: "treats an empty paragraph as empty for click-below creation",
    run: () => {
      assert.equal(blockHasDraftContent(EMPTY_BLOCK_HTML), false);
    },
  },
  {
    name: "resetBlocks restores a single empty block after delete-all fallback",
    run: () => {
      seedState({
        rootBlocks: ["a", "b"],
        blocks: {
          a: createBlock("a", null),
          b: createBlock("b", null),
        },
      });

      useEditorStore.getState().resetBlocks();
      const state = useEditorStore.getState();

      assert.equal(state.rootBlocks.length, 1);
      assert.equal(Object.keys(state.blocks).length, 1);
      assert.equal(state.activeBlockId, state.rootBlocks[0]);
      assert.equal(state.blocks[state.rootBlocks[0]]?.content, EMPTY_BLOCK_HTML);
    },
  },
];

let passed = 0;

for (const test of tests) {
  test.run();
  passed += 1;
  console.log(`PASS ${passed}. ${test.name}`);
}

console.log(`Completed ${passed} editor regression scenarios.`);
