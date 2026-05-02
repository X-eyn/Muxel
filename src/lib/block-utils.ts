import type { BlockType, PageState, SlashCommandOption } from "@/lib/editor-types";

export const EMPTY_BLOCK_HTML = "<p></p>";
export const DEMO_COVER_IMAGE =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 600">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f2efe7" />
          <stop offset="50%" stop-color="#dbe8df" />
          <stop offset="100%" stop-color="#cfdff8" />
        </linearGradient>
      </defs>
      <rect width="1600" height="600" fill="url(#bg)" />
      <circle cx="280" cy="140" r="120" fill="#ffffff" opacity="0.45" />
      <circle cx="1340" cy="430" r="180" fill="#f9fafb" opacity="0.55" />
      <path d="M0 480 C280 360 500 560 800 470 S1300 360 1600 500 L1600 600 L0 600 Z" fill="#ffffff" opacity="0.8" />
    </svg>
  `);

export const SLASH_COMMANDS: SlashCommandOption[] = [
  {
    type: "paragraph",
    label: "Text",
    aliases: ["text", "paragraph", "p"],
    description: "Start writing with plain body text.",
  },
  {
    type: "h1",
    label: "Heading 1",
    aliases: ["h1", "heading1", "title"],
    description: "Large section heading.",
  },
  {
    type: "h2",
    label: "Heading 2",
    aliases: ["h2", "heading2", "subheading"],
    description: "Medium section heading.",
  },
  {
    type: "bullet_list",
    label: "Bullet List",
    aliases: ["bullet", "bullets", "list", "ul"],
    description: "One bullet item per block.",
  },
  {
    type: "numbered_list",
    label: "Numbered List",
    aliases: ["numbered", "ordered", "ol"],
    description: "Create an ordered list item.",
  },
  {
    type: "quote",
    label: "Quote",
    aliases: ["quote", "blockquote"],
    description: "Highlighted quote block.",
  },
  {
    type: "code",
    label: "Code",
    aliases: ["code", "snippet"],
    description: "Monospace code block.",
  },
  {
    type: "callout",
    label: "Callout",
    aliases: ["callout", "note"],
    description: "Soft highlighted callout block.",
  },
  {
    type: "divider",
    label: "Divider",
    aliases: ["divider", "hr", "line"],
    description: "Visual separator line.",
  },
];

export function createEmptyBlockContent() {
  return EMPTY_BLOCK_HTML;
}

export function blockSupportsText(type: BlockType) {
  return type !== "divider";
}

export function isListBlock(type: BlockType) {
  return type === "bullet_list" || type === "numbered_list";
}

export function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function stripHtmlPreservingWhitespace(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function blockIsEmpty(content: string) {
  return stripHtml(content).length === 0;
}

export function blockHasDraftContent(content: string) {
  return stripHtmlPreservingWhitespace(content).length > 0;
}

export function extractInlineHtml(content: string) {
  const match = content.match(/^<p(?:\s[^>]*)?>([\s\S]*)<\/p>$/i);
  if (match) {
    return match[1];
  }

  if (content === EMPTY_BLOCK_HTML) {
    return "";
  }

  return content;
}

export function wrapInlineHtml(inlineHtml: string) {
  return `<p>${inlineHtml}</p>`;
}

export function mergeInlineHtml(previousContent: string, currentContent: string) {
  return wrapInlineHtml(
    `${extractInlineHtml(previousContent)}${extractInlineHtml(currentContent)}`,
  );
}

export function sanitizeContentForBlockType(content: string, type: BlockType) {
  if (!blockSupportsText(type)) {
    return EMPTY_BLOCK_HTML;
  }

  return content.length === 0 ? EMPTY_BLOCK_HTML : content;
}

export function placeholderForBlockType(type: BlockType) {
  switch (type) {
    case "h1":
      return "Heading 1";
    case "h2":
      return "Heading 2";
    case "h3":
      return "Heading 3";
    case "quote":
      return "Quote";
    case "code":
      return "Write code";
    case "callout":
      return "Callout";
    case "bullet_list":
      return "List item";
    case "numbered_list":
      return "List item";
    default:
      return "Type '/' for commands";
  }
}

export function blockLabel(type: BlockType) {
  return (
    SLASH_COMMANDS.find((command) => command.type === type)?.label ?? "Text"
  );
}

export function filterSlashCommands(query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return SLASH_COMMANDS;
  }

  return SLASH_COMMANDS.filter((command) => {
    return (
      command.label.toLowerCase().includes(normalizedQuery) ||
      command.aliases.some((alias) => alias.includes(normalizedQuery))
    );
  });
}

export function flattenBlockIds(page: Pick<PageState, "blocks" | "rootBlocks">) {
  const orderedIds: string[] = [];

  const visit = (blockId: string) => {
    orderedIds.push(blockId);

    const block = page.blocks[blockId];
    if (!block) {
      return;
    }

    for (const childId of block.children) {
      visit(childId);
    }
  };

  for (const rootId of page.rootBlocks) {
    visit(rootId);
  }

  return orderedIds;
}

export function getPreviousVisibleBlockId(
  page: Pick<PageState, "blocks" | "rootBlocks">,
  blockId: string,
) {
  const orderedIds = flattenBlockIds(page);
  const index = orderedIds.indexOf(blockId);

  if (index <= 0) {
    return null;
  }

  return orderedIds[index - 1] ?? null;
}

export function getSiblingIndex(
  page: Pick<PageState, "blocks" | "rootBlocks">,
  blockId: string,
) {
  const block = page.blocks[blockId];
  if (!block) {
    return -1;
  }

  const siblings = block.parentId
    ? page.blocks[block.parentId]?.children ?? []
    : page.rootBlocks;

  return siblings.indexOf(blockId);
}

export function getDepth(
  page: Pick<PageState, "blocks">,
  blockId: string,
  depth = 0,
): number {
  const block = page.blocks[blockId];

  if (!block?.parentId) {
    return depth;
  }

  return getDepth(page, block.parentId, depth + 1);
}
