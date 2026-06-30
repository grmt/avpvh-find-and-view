export interface MeiliHit {
  id: string;
  type: 'photo' | 'find' | 'scan' | 'post' | 'page';
  title: string;
  text: string;
  collection: string;
  url: string;
  thumb_url: string;
  tags: string[];
  date: string | null;
  page_number: number | null;
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
  placeholder: string;
}

declare global {
  interface Window {
    favInstances?: FavConfig[];
  }
}
