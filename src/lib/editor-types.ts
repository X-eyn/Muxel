export type BlockType =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "bullet_list"
  | "numbered_list"
  | "quote"
  | "divider"
  | "code"
  | "callout";

export interface BlockProperties {
  textColor?: string;
  backgroundColor?: string;
  checked?: boolean;
}

export interface Block {
  id: string;
  type: BlockType;
  content: string;
  properties?: BlockProperties;
  children: string[];
  parentId: string | null;
}

export interface PageState {
  id: string;
  title: string;
  coverImage: string | null;
  icon: string | null;
  blocks: Record<string, Block>;
  rootBlocks: string[];
}

export type FocusPosition = "start" | "end";

export interface FocusRequest {
  blockId: string;
  position: FocusPosition;
  timestamp: number;
}

export interface SlashCommandOption {
  type: BlockType;
  label: string;
  aliases: string[];
  description: string;
}
