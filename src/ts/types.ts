export interface MeiliHit {
  id: string;
  type: 'photo' | 'find' | 'scan' | 'post' | 'page';
  title: string;
  text: string;
  collection: string;
  url: string;
  source_url?: string | null;
  thumb_url: string;
  tags: string[];
  date: string | null;
  page_number: number | null;
  text_format?: 'md' | 'text' | null;
  _snippetResult?: { text?: { value: string } };
  _formatted?: { text?: string };
}

export interface FavConfig {
  uid: string;
  meiliUrl: string;
  meiliKey: string;
  mediaIndex: string;
  contentIndex: string;
  perPage: number;
  snippetLen: number;
  showMedia: boolean;
  showContent: boolean;
  browseMode: boolean;
  browseRootLabel: string;
  placeholder: string;
}

declare global {
  interface Window {
    favInstances?: FavConfig[];
  }
}
