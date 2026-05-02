"use client";

import { useEffect, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { flattenBlockIds } from "@/lib/block-utils";
import { BlockWrapper } from "@/components/editor/block-wrapper";
import {
  useBlock,
  useEditorStore,
  useOrderedBlockIds,
  useRootBlockIds,
} from "@/store/editor-store";

const EMPTY_IDS: string[] = [];
const CROSS_BLOCK_SELECTION_ACTIVATION_DISTANCE = 4;
const EDGE_SCROLL_ZONE_PX = 56;
const EDGE_SCROLL_STEP_PX = 18;
const selectionNodeIds = new WeakMap<Node, number>();
let nextSelectionNodeId = 1;

interface TextSelectionPoint {
  blockId: string;
  node: Node;
  offset: number;
}

interface SelectionHighlightRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CustomSelectionSnapshot {
  blockIds: string[];
  rects: SelectionHighlightRect[];
  text: string;
}

type SelectionInputKind = "pointer" | "mouse";

const blockCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);

  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }

  const intersectionCollisions = rectIntersection(args);

  if (intersectionCollisions.length > 0) {
    return intersectionCollisions;
  }

  return closestCenter(args);
};

function getBlockWrapperIdFromNode(target: EventTarget | null) {
  if (!(target instanceof Node)) {
    return null;
  }

  const element = target instanceof Element ? target : target.parentElement;
  return element?.closest<HTMLElement>("[data-block-wrapper-id]")?.dataset.blockWrapperId ?? null;
}

function getBlockContentIdFromNode(target: EventTarget | null) {
  if (!(target instanceof Node)) {
    return null;
  }

  const element = target instanceof Element ? target : target.parentElement;
  return element?.closest<HTMLElement>("[data-block-content-id]")?.dataset.blockContentId ?? null;
}

function isSelectionChromeTarget(target: EventTarget | null) {
  if (!(target instanceof Node)) {
    return false;
  }

  const element = target instanceof Element ? target : target.parentElement;
  return Boolean(
    element?.closest(
      "[data-editor-selection-chrome], .muxel-selection-chrome",
    ),
  );
}

function getBlockContentElement(container: HTMLElement, blockId: string) {
  return container.querySelector<HTMLElement>(
    `[data-block-content-id="${blockId}"]`,
  );
}

function getEditorElementForBlock(blockContentElement: HTMLElement) {
  return (
    blockContentElement.querySelector<HTMLElement>(".muxel-editor") ??
    blockContentElement
  );
}

function getFirstAndLastTextNode(element: HTMLElement) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return (node.textContent?.length ?? 0) > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });

  let firstTextNode: Text | null = null;
  let lastTextNode: Text | null = null;
  let currentNode = walker.nextNode();

  while (currentNode) {
    if (currentNode instanceof Text) {
      if (!firstTextNode) {
        firstTextNode = currentNode;
      }

      lastTextNode = currentNode;
    }

    currentNode = walker.nextNode();
  }

  return {
    firstTextNode,
    lastTextNode,
  };
}

function getBoundarySelectionPoint(
  blockContentElement: HTMLElement,
  blockId: string,
  boundary: "start" | "end",
): TextSelectionPoint {
  const editorElement = getEditorElementForBlock(blockContentElement);
  const { firstTextNode, lastTextNode } = getFirstAndLastTextNode(editorElement);

  if (boundary === "start") {
    return firstTextNode
      ? {
          blockId,
          node: firstTextNode,
          offset: 0,
        }
      : {
          blockId,
          node: editorElement,
          offset: 0,
        };
  }

  return lastTextNode
    ? {
        blockId,
        node: lastTextNode,
        offset: lastTextNode.textContent?.length ?? 0,
      }
    : {
        blockId,
        node: editorElement,
        offset: editorElement.childNodes.length,
      };
}

function clampRangeOffset(node: Node, offset: number) {
  if (node instanceof Text) {
    return Math.max(0, Math.min(offset, node.textContent?.length ?? 0));
  }

  return Math.max(0, Math.min(offset, node.childNodes.length));
}

function toSelectionPoint(
  container: HTMLElement,
  node: Node,
  offset: number,
): TextSelectionPoint | null {
  if (!container.contains(node)) {
    return null;
  }

  const blockId = getBlockContentIdFromNode(node);
  if (!blockId) {
    return null;
  }

  return {
    blockId,
    node,
    offset: clampRangeOffset(node, offset),
  };
}

function getNativeCaretSelectionPoint(
  container: HTMLElement,
  clientX: number,
  clientY: number,
) {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const caretPosition = documentWithCaret.caretPositionFromPoint?.(
    clientX,
    clientY,
  );

  if (caretPosition) {
    const point = toSelectionPoint(
      container,
      caretPosition.offsetNode,
      caretPosition.offset,
    );

    if (point) {
      return point;
    }
  }

  const caretRange = documentWithCaret.caretRangeFromPoint?.(clientX, clientY);

  if (caretRange) {
    const point = toSelectionPoint(
      container,
      caretRange.startContainer,
      caretRange.startOffset,
    );

    if (point) {
      return point;
    }
  }

  return null;
}

function getBlockIdAtPoint(
  container: HTMLElement,
  blockIds: string[],
  clientX: number,
  clientY: number,
) {
  const hoveredBlockId = getBlockWrapperIdFromNode(
    document.elementFromPoint(clientX, clientY),
  );

  if (hoveredBlockId && blockIds.includes(hoveredBlockId)) {
    return hoveredBlockId;
  }

  const blockRects = blockIds
    .map((blockId) => {
      const element = container.querySelector<HTMLElement>(
        `[data-block-wrapper-id="${blockId}"]`,
      );

      return element
        ? {
            blockId,
            rect: element.getBoundingClientRect(),
          }
        : null;
    })
    .filter(
      (
        item,
      ): item is {
        blockId: string;
        rect: DOMRect;
      } => Boolean(item),
    );

  if (blockRects.length === 0) {
    return null;
  }

  const firstBlock = blockRects[0];
  const lastBlock = blockRects[blockRects.length - 1];

  if (clientY <= firstBlock.rect.top) {
    return firstBlock.blockId;
  }

  if (clientY >= lastBlock.rect.bottom) {
    return lastBlock.blockId;
  }

  const containingBlock = blockRects.find(
    ({ rect }) => clientY >= rect.top && clientY <= rect.bottom,
  );

  if (containingBlock) {
    return containingBlock.blockId;
  }

  return blockRects.reduce((closest, current) => {
    const closestDistance = Math.min(
      Math.abs(clientY - closest.rect.top),
      Math.abs(clientY - closest.rect.bottom),
    );
    const currentDistance = Math.min(
      Math.abs(clientY - current.rect.top),
      Math.abs(clientY - current.rect.bottom),
    );

    return currentDistance < closestDistance ? current : closest;
  }).blockId;
}

function getTextSelectionPointAtPoint(
  container: HTMLElement,
  blockIds: string[],
  clientX: number,
  clientY: number,
) {
  const blockId = getBlockIdAtPoint(container, blockIds, clientX, clientY);
  const blockContentElement = blockId
    ? getBlockContentElement(container, blockId)
    : null;

  if (!blockId || !blockContentElement) {
    return getNativeCaretSelectionPoint(container, clientX, clientY);
  }

  const nativePoint = getNativeCaretSelectionPoint(container, clientX, clientY);

  if (nativePoint?.blockId === blockId) {
    return nativePoint;
  }

  const editorElement = getEditorElementForBlock(blockContentElement);
  const rect = editorElement.getBoundingClientRect();
  const clampedX = Math.max(rect.left + 1, Math.min(clientX, rect.right - 1));
  const clampedY = Math.max(rect.top + 1, Math.min(clientY, rect.bottom - 1));
  const clampedPoint = getNativeCaretSelectionPoint(container, clampedX, clampedY);

  if (clampedPoint?.blockId === blockId) {
    return clampedPoint;
  }

  const midpoint = rect.top + rect.height / 2;
  const boundary = clientY < midpoint ? "start" : "end";

  return getBoundarySelectionPoint(blockContentElement, blockId, boundary);
}

function getPointerDistance(
  startPoint: { x: number; y: number },
  event: PointerEvent | MouseEvent,
) {
  return Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y);
}

function scrollNearViewportEdge(clientY: number) {
  if (clientY < EDGE_SCROLL_ZONE_PX) {
    window.scrollBy(0, -EDGE_SCROLL_STEP_PX);
    return;
  }

  if (window.innerHeight - clientY < EDGE_SCROLL_ZONE_PX) {
    window.scrollBy(0, EDGE_SCROLL_STEP_PX);
  }
}

function isPrimaryLeftButton(event: PointerEvent | MouseEvent) {
  if ("isPrimary" in event && !event.isPrimary) {
    return false;
  }

  return event.button === 0;
}

function selectionPointsAreEqual(
  firstPoint: TextSelectionPoint,
  secondPoint: TextSelectionPoint,
) {
  return (
    firstPoint.node === secondPoint.node &&
    firstPoint.offset === secondPoint.offset
  );
}

function focusPointIsBeforeAnchor(
  anchorPoint: TextSelectionPoint,
  focusPoint: TextSelectionPoint,
) {
  const comparisonRange = document.createRange();
  comparisonRange.setStart(anchorPoint.node, anchorPoint.offset);
  comparisonRange.collapse(true);

  try {
    return comparisonRange.comparePoint(focusPoint.node, focusPoint.offset) < 0;
  } catch {
    return false;
  } finally {
    comparisonRange.detach();
  }
}

function getSelectedBlockIdsFromRange(container: HTMLElement, range: Range) {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-block-content-id]"),
  )
    .filter((element) => {
      const editorElement = getEditorElementForBlock(element);
      const walker = document.createTreeWalker(
        editorElement,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if ((node.textContent?.length ?? 0) === 0) {
              return NodeFilter.FILTER_SKIP;
            }

            const nodeRange = document.createRange();
            const selectedRange = range.cloneRange();

            try {
              nodeRange.selectNodeContents(node);

              if (!range.intersectsNode(node)) {
                return NodeFilter.FILTER_SKIP;
              }

              if (
                selectedRange.compareBoundaryPoints(
                  Range.START_TO_START,
                  nodeRange,
                ) < 0
              ) {
                selectedRange.setStart(node, 0);
              }

              if (
                selectedRange.compareBoundaryPoints(
                  Range.END_TO_END,
                  nodeRange,
                ) > 0
              ) {
                selectedRange.setEnd(node, node.textContent?.length ?? 0);
              }

              return /\S/.test(selectedRange.toString())
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_SKIP;
            } catch {
              return NodeFilter.FILTER_SKIP;
            } finally {
              nodeRange.detach();
              selectedRange.detach();
            }
          },
        },
      );

      return Boolean(walker.nextNode());
    })
    .map((element) => element.dataset.blockContentId)
    .filter((blockId): blockId is string => Boolean(blockId));
}

function getSelectedOffsetsForTextNode(range: Range, textNode: Text) {
  const nodeLength = textNode.textContent?.length ?? 0;

  if (nodeLength === 0) {
    return null;
  }

  try {
    if (!range.intersectsNode(textNode)) {
      return null;
    }
  } catch {
    return null;
  }

  let startOffset = 0;
  let endOffset = nodeLength;

  if (range.startContainer === textNode) {
    startOffset = clampRangeOffset(textNode, range.startOffset);
  }

  if (range.endContainer === textNode) {
    endOffset = clampRangeOffset(textNode, range.endOffset);
  }

  if (startOffset >= endOffset) {
    return null;
  }

  return {
    startOffset,
    endOffset,
  };
}

function getCustomSelectionSnapshot(
  container: HTMLElement,
  anchorPoint: TextSelectionPoint,
  focusPoint: TextSelectionPoint,
): CustomSelectionSnapshot {
  if (selectionPointsAreEqual(anchorPoint, focusPoint)) {
    return {
      blockIds: [],
      rects: [],
      text: "",
    };
  }

  const range = createSelectionRange(anchorPoint, focusPoint);
  const containerRect = container.getBoundingClientRect();
  const blockIds: string[] = [];
  const rects: SelectionHighlightRect[] = [];
  let rectIndex = 0;

  for (const blockContentElement of Array.from(
    container.querySelectorAll<HTMLElement>("[data-block-content-id]"),
  )) {
    const blockId = blockContentElement.dataset.blockContentId;

    if (!blockId) {
      continue;
    }

    const editorElement = getEditorElementForBlock(blockContentElement);
    const walker = document.createTreeWalker(
      editorElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return (node.textContent?.length ?? 0) > 0
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        },
      },
    );
    let blockHasVisibleSelection = false;
    let currentNode = walker.nextNode();

    while (currentNode) {
      if (currentNode instanceof Text) {
        const offsets = getSelectedOffsetsForTextNode(range, currentNode);

        if (offsets) {
          const segmentRange = document.createRange();

          try {
            segmentRange.setStart(currentNode, offsets.startOffset);
            segmentRange.setEnd(currentNode, offsets.endOffset);

            if (/\S/.test(segmentRange.toString())) {
              blockHasVisibleSelection = true;

              for (const rect of Array.from(segmentRange.getClientRects())) {
                if (rect.width <= 0 || rect.height <= 0) {
                  continue;
                }

                rects.push({
                  id: `${blockId}-${rectIndex}`,
                  left: rect.left - containerRect.left,
                  top: rect.top - containerRect.top,
                  width: rect.width,
                  height: rect.height,
                });
                rectIndex += 1;
              }
            }
          } finally {
            segmentRange.detach();
          }
        }
      }

      currentNode = walker.nextNode();
    }

    if (blockHasVisibleSelection) {
      blockIds.push(blockId);
    }
  }

  const text = range.toString();
  range.detach();

  return {
    blockIds,
    rects,
    text,
  };
}

function createSelectionRange(
  anchorPoint: TextSelectionPoint,
  focusPoint: TextSelectionPoint,
) {
  const range = document.createRange();
  const focusBeforeAnchor = focusPointIsBeforeAnchor(anchorPoint, focusPoint);

  if (focusBeforeAnchor) {
    range.setStart(focusPoint.node, focusPoint.offset);
    range.setEnd(anchorPoint.node, anchorPoint.offset);
  } else {
    range.setStart(anchorPoint.node, anchorPoint.offset);
    range.setEnd(focusPoint.node, focusPoint.offset);
  }

  return range;
}

function getSelectionPointKey(point: TextSelectionPoint) {
  let nodeId = selectionNodeIds.get(point.node);

  if (!nodeId) {
    nodeId = nextSelectionNodeId;
    nextSelectionNodeId += 1;
    selectionNodeIds.set(point.node, nodeId);
  }

  return `${point.blockId}:${nodeId}:${point.offset}`;
}

function getSelectionKey(
  anchorPoint: TextSelectionPoint,
  focusPoint: TextSelectionPoint,
) {
  return `${getSelectionPointKey(anchorPoint)}>${getSelectionPointKey(focusPoint)}`;
}

function getSelectionInputKind(event: PointerEvent | MouseEvent): SelectionInputKind {
  return event instanceof PointerEvent ? "pointer" : "mouse";
}

function eventMatchesSelectionInputKind(
  event: PointerEvent | MouseEvent,
  activeKind: SelectionInputKind | null,
) {
  if (!activeKind) {
    return true;
  }

  return getSelectionInputKind(event) === activeKind;
}

function syncSelectedBlockIdsFromSelection(
  container: HTMLElement,
  setSelectedBlockIds: (blockIds: string[]) => void,
) {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    setSelectedBlockIds([]);
    return;
  }

  setSelectedBlockIds(
    getSelectedBlockIdsFromRange(container, selection.getRangeAt(0)),
  );
}

function BlockTreeNode({
  blockId,
  depth,
}: {
  blockId: string;
  depth: number;
}) {
  const block = useBlock(blockId);
  const childIds = block?.children ?? EMPTY_IDS;

  return (
    <>
      <BlockWrapper blockId={blockId} depth={depth} />
      {childIds.map((childId) => (
        <BlockTreeNode key={childId} blockId={childId} depth={depth + 1} />
      ))}
    </>
  );
}

export function BlockList() {
  const rootBlocks = useRootBlockIds();
  const orderedBlockIds = useOrderedBlockIds();
  const selectedBlockIds = useEditorStore((state) => state.selectedBlockIds);
  const moveBlock = useEditorStore((state) => state.moveBlock);
  const resetBlocks = useEditorStore((state) => state.resetBlocks);
  const setSelectedBlockIds = useEditorStore((state) => state.setSelectedBlockIds);
  const [selectionHighlightRects, setSelectionHighlightRects] = useState<
    SelectionHighlightRect[]
  >([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectionAnchorPointRef = useRef<TextSelectionPoint | null>(null);
  const latestSelectionFocusPointRef = useRef<TextSelectionPoint | null>(null);
  const selectionStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const selectionInputKindRef = useRef<SelectionInputKind | null>(null);
  const textSelectionDragActiveRef = useRef(false);
  const selectionAnimationFrameRef = useRef<number | null>(null);
  const lastAppliedSelectionKeyRef = useRef<string | null>(null);
  const customSelectionRef = useRef<{
    anchorPoint: TextSelectionPoint;
    focusPoint: TextSelectionPoint;
  } | null>(null);
  const blockDragActiveRef = useRef(false);
  const latestDragPointerYRef = useRef<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = ({ activatorEvent }: DragStartEvent) => {
    blockDragActiveRef.current = true;
    latestDragPointerYRef.current =
      activatorEvent instanceof MouseEvent ? activatorEvent.clientY : null;
  };

  const handleDragCancel = () => {
    blockDragActiveRef.current = false;
    latestDragPointerYRef.current = null;
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const pointerY = latestDragPointerYRef.current;
    blockDragActiveRef.current = false;
    latestDragPointerYRef.current = null;

    if (!over || active.id === over.id) {
      return;
    }

    const translatedRect = active.rect.current.translated;
    const activeMidpoint = translatedRect
      ? translatedRect.top + translatedRect.height / 2
      : null;
    const overMidpoint = over.rect.top + over.rect.height / 2;
    const orderedBlockIds = flattenBlockIds(useEditorStore.getState());
    const activeIndex = orderedBlockIds.indexOf(String(active.id));
    const overIndex = orderedBlockIds.indexOf(String(over.id));
    let placement: "before" | "after";

    if (pointerY !== null) {
      placement = pointerY > overMidpoint ? "after" : "before";
    } else if (activeIndex >= 0 && overIndex >= 0) {
      placement = activeIndex < overIndex ? "after" : "before";
    } else {
      placement =
        activeMidpoint !== null && activeMidpoint > overMidpoint
          ? "after"
          : "before";
    }

    moveBlock(String(active.id), String(over.id), placement);
  };

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const container = containerRef.current;

      if (textSelectionDragActiveRef.current || customSelectionRef.current) {
        return;
      }

      if (!container) {
        return;
      }

      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setSelectedBlockIds([]);
        return;
      }

      syncSelectedBlockIdsFromSelection(container, setSelectedBlockIds);
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [setSelectedBlockIds]);

  useEffect(() => {
    if (selectedBlockIds.length > 0 || textSelectionDragActiveRef.current) {
      return;
    }

    customSelectionRef.current = null;
    setSelectionHighlightRects([]);
  }, [selectedBlockIds.length]);

  useEffect(() => {
    const selectionDragListenerOptions = { capture: true };
    const enableCrossBlockSelectionMode = () => {
      document.body.classList.add("muxel-cross-block-selecting");
    };
    const disableCrossBlockSelectionMode = () => {
      document.body.classList.remove("muxel-cross-block-selecting");
    };
    const clearNativeSelection = () => {
      const selection = window.getSelection();

      if (selection?.rangeCount) {
        selection.removeAllRanges();
      }
    };
    const cancelQueuedSelectionSync = () => {
      if (selectionAnimationFrameRef.current === null) {
        return;
      }

      window.cancelAnimationFrame(selectionAnimationFrameRef.current);
      selectionAnimationFrameRef.current = null;
    };
    const clearCustomSelection = () => {
      cancelQueuedSelectionSync();
      customSelectionRef.current = null;
      setSelectionHighlightRects([]);
      setSelectedBlockIds([]);
      lastAppliedSelectionKeyRef.current = null;
      disableCrossBlockSelectionMode();
    };
    const syncCustomSelection = (
      container: HTMLElement,
      anchorPoint: TextSelectionPoint,
      focusPoint: TextSelectionPoint,
      force = false,
    ) => {
      const selectionKey = getSelectionKey(anchorPoint, focusPoint);

      if (!force && lastAppliedSelectionKeyRef.current === selectionKey) {
        return;
      }

      lastAppliedSelectionKeyRef.current = selectionKey;
      customSelectionRef.current = {
        anchorPoint,
        focusPoint,
      };
      const snapshot = getCustomSelectionSnapshot(
        container,
        anchorPoint,
        focusPoint,
      );

      setSelectionHighlightRects(snapshot.rects);
      setSelectedBlockIds(snapshot.blockIds);
    };
    const queueCustomSelectionSync = (
      container: HTMLElement,
      anchorPoint: TextSelectionPoint,
      focusPoint: TextSelectionPoint,
      force = false,
    ) => {
      const selectionKey = getSelectionKey(anchorPoint, focusPoint);

      if (!force && lastAppliedSelectionKeyRef.current === selectionKey) {
        return;
      }

      lastAppliedSelectionKeyRef.current = selectionKey;
      customSelectionRef.current = {
        anchorPoint,
        focusPoint,
      };
      cancelQueuedSelectionSync();
      selectionAnimationFrameRef.current = window.requestAnimationFrame(() => {
        selectionAnimationFrameRef.current = null;
        const currentContainer = containerRef.current;

        if (!currentContainer) {
          return;
        }

        const snapshot = getCustomSelectionSnapshot(
          currentContainer,
          anchorPoint,
          focusPoint,
        );

        setSelectionHighlightRects(snapshot.rects);
        setSelectedBlockIds(snapshot.blockIds);
      });
    };
    const repaintCustomSelection = () => {
      const container = containerRef.current;
      const customSelection = customSelectionRef.current;

      if (!container || !customSelection) {
        return;
      }

      const snapshot = getCustomSelectionSnapshot(
        container,
        customSelection.anchorPoint,
        customSelection.focusPoint,
      );
      setSelectionHighlightRects(snapshot.rects);
    };
    const handleDeleteSelection = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") {
        return;
      }

      const selection = window.getSelection();
      const state = useEditorStore.getState();
      const orderedBlockIds = flattenBlockIds(state);

      if (
        !selection ||
        selection.isCollapsed ||
        orderedBlockIds.length === 0 ||
        state.selectedBlockIds.length !== orderedBlockIds.length
      ) {
        return;
      }

      event.preventDefault();
      selection.removeAllRanges();
      resetBlocks();
    };
    const handleCopySelection = (event: ClipboardEvent) => {
      const container = containerRef.current;
      const customSelection = customSelectionRef.current;

      if (!container || !customSelection) {
        return;
      }

      const snapshot = getCustomSelectionSnapshot(
        container,
        customSelection.anchorPoint,
        customSelection.focusPoint,
      );

      if (!/\S/.test(snapshot.text)) {
        return;
      }

      event.preventDefault();
      event.clipboardData?.setData("text/plain", snapshot.text);
    };

    const handleSelectionDragStart = (event: PointerEvent | MouseEvent) => {
      cancelQueuedSelectionSync();

      if (!isPrimaryLeftButton(event)) {
        return;
      }

      const inputKind = getSelectionInputKind(event);
      if (!eventMatchesSelectionInputKind(event, selectionInputKindRef.current)) {
        return;
      }

      const anchorBlockId = getBlockContentIdFromNode(event.target);
      if (!anchorBlockId) {
        if (!isSelectionChromeTarget(event.target)) {
          clearCustomSelection();
        }

        selectionAnchorPointRef.current = null;
        latestSelectionFocusPointRef.current = null;
        selectionStartPointRef.current = null;
        selectionInputKindRef.current = null;
        textSelectionDragActiveRef.current = false;
        lastAppliedSelectionKeyRef.current = null;
        cancelQueuedSelectionSync();
        return;
      }

      clearCustomSelection();
      selectionInputKindRef.current = inputKind;
      const container = containerRef.current;
      const anchorPoint = container
        ? getTextSelectionPointAtPoint(
            container,
            flattenBlockIds(useEditorStore.getState()),
            event.clientX,
            event.clientY,
          )
        : null;

      selectionAnchorPointRef.current =
        anchorPoint?.blockId === anchorBlockId ? anchorPoint : null;
      latestSelectionFocusPointRef.current = null;
      selectionStartPointRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
      textSelectionDragActiveRef.current = false;
      lastAppliedSelectionKeyRef.current = null;
    };

    const handleSelectionDragMove = (event: PointerEvent | MouseEvent) => {
      if (blockDragActiveRef.current) {
        latestDragPointerYRef.current = event.clientY;
      }

      const anchorPoint = selectionAnchorPointRef.current;
      const container = containerRef.current;

      if (!anchorPoint || !container) {
        return;
      }

      const orderedBlockIds = flattenBlockIds(useEditorStore.getState());
      const focusPoint = getTextSelectionPointAtPoint(
        container,
        orderedBlockIds,
        event.clientX,
        event.clientY,
      );
      if (!focusPoint) {
        if (textSelectionDragActiveRef.current) {
          event.preventDefault();
          event.stopPropagation();
        }

        return;
      }

      const movedFarEnough =
        !selectionStartPointRef.current ||
        getPointerDistance(selectionStartPointRef.current, event) >
          CROSS_BLOCK_SELECTION_ACTIVATION_DISTANCE;

      if (!movedFarEnough && !textSelectionDragActiveRef.current) {
        return;
      }

      latestSelectionFocusPointRef.current = focusPoint;
      const shouldUseCustomSelection =
        textSelectionDragActiveRef.current ||
        anchorPoint.blockId !== focusPoint.blockId;

      if (!shouldUseCustomSelection) {
        return;
      }

      if (!textSelectionDragActiveRef.current) {
        textSelectionDragActiveRef.current = true;
        enableCrossBlockSelectionMode();
        clearNativeSelection();
      }

      event.preventDefault();
      event.stopPropagation();
      scrollNearViewportEdge(event.clientY);
      queueCustomSelectionSync(container, anchorPoint, focusPoint);
    };

    const handleSelectionDragEnd = () => {
      if (
        !selectionInputKindRef.current &&
        !selectionAnchorPointRef.current &&
        !textSelectionDragActiveRef.current
      ) {
        return;
      }

      cancelQueuedSelectionSync();

      const container = containerRef.current;
      const anchorPoint = selectionAnchorPointRef.current;
      const focusPoint = latestSelectionFocusPointRef.current;

      if (
        container &&
        textSelectionDragActiveRef.current &&
        anchorPoint &&
        focusPoint
      ) {
        syncCustomSelection(container, anchorPoint, focusPoint, true);
        disableCrossBlockSelectionMode();
      } else if (container) {
        disableCrossBlockSelectionMode();
        if (!customSelectionRef.current) {
          syncSelectedBlockIdsFromSelection(container, setSelectedBlockIds);
        }
      } else {
        disableCrossBlockSelectionMode();
      }

      selectionAnchorPointRef.current = null;
      latestSelectionFocusPointRef.current = null;
      selectionStartPointRef.current = null;
      selectionInputKindRef.current = null;
      textSelectionDragActiveRef.current = false;
      lastAppliedSelectionKeyRef.current = null;
    };

    const handleSelectStart = (event: Event) => {
      if (!textSelectionDragActiveRef.current && !customSelectionRef.current) {
        return;
      }

      event.preventDefault();
    };

    document.addEventListener(
      "pointerdown",
      handleSelectionDragStart,
      selectionDragListenerOptions,
    );
    document.addEventListener(
      "pointermove",
      handleSelectionDragMove,
      selectionDragListenerOptions,
    );
    document.addEventListener(
      "pointerup",
      handleSelectionDragEnd,
      selectionDragListenerOptions,
    );
    document.addEventListener(
      "pointercancel",
      handleSelectionDragEnd,
      selectionDragListenerOptions,
    );
    document.addEventListener(
      "mousedown",
      handleSelectionDragStart,
      selectionDragListenerOptions,
    );
    document.addEventListener(
      "mousemove",
      handleSelectionDragMove,
      selectionDragListenerOptions,
    );
    document.addEventListener(
      "mouseup",
      handleSelectionDragEnd,
      selectionDragListenerOptions,
    );
    document.addEventListener("selectstart", handleSelectStart, true);
    document.addEventListener("keydown", handleDeleteSelection, true);
    document.addEventListener("copy", handleCopySelection, true);
    window.addEventListener("resize", repaintCustomSelection);
    window.addEventListener("scroll", repaintCustomSelection, true);

    return () => {
      document.removeEventListener(
        "pointerdown",
        handleSelectionDragStart,
        selectionDragListenerOptions,
      );
      document.removeEventListener(
        "pointermove",
        handleSelectionDragMove,
        selectionDragListenerOptions,
      );
      document.removeEventListener(
        "pointerup",
        handleSelectionDragEnd,
        selectionDragListenerOptions,
      );
      document.removeEventListener(
        "pointercancel",
        handleSelectionDragEnd,
        selectionDragListenerOptions,
      );
      document.removeEventListener(
        "mousedown",
        handleSelectionDragStart,
        selectionDragListenerOptions,
      );
      document.removeEventListener(
        "mousemove",
        handleSelectionDragMove,
        selectionDragListenerOptions,
      );
      document.removeEventListener(
        "mouseup",
        handleSelectionDragEnd,
        selectionDragListenerOptions,
      );
      document.removeEventListener("selectstart", handleSelectStart, true);
      document.removeEventListener("keydown", handleDeleteSelection, true);
      document.removeEventListener("copy", handleCopySelection, true);
      window.removeEventListener("resize", repaintCustomSelection);
      window.removeEventListener("scroll", repaintCustomSelection, true);
      cancelQueuedSelectionSync();
      disableCrossBlockSelectionMode();
    };
  }, [resetBlocks, setSelectedBlockIds]);

  return (
    <DndContext
      id="muxel-page-blocks"
      sensors={sensors}
      collisionDetection={blockCollisionDetection}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={orderedBlockIds} strategy={verticalListSortingStrategy}>
        <div ref={containerRef} className="relative flex flex-col">
          {rootBlocks.map((blockId) => (
            <BlockTreeNode key={blockId} blockId={blockId} depth={0} />
          ))}
          {selectedBlockIds.length > 0 && selectionHighlightRects.length > 0 ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-[2]"
            >
              {selectionHighlightRects.map((rect) => (
                <div
                  key={rect.id}
                  className="absolute rounded-[2px] bg-[rgba(116,182,255,0.58)]"
                  style={{
                    height: rect.height,
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      </SortableContext>
    </DndContext>
  );
}
