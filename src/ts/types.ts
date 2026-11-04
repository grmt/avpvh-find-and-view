export interface MeiliHit {
  id: string;
  type: 'photo' | 'find' | 'scan' | 'spreadsheet' | 'post' | 'page';
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
  has_image?: boolean;
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
  // Whether this visitor may edit scan page text via the lightbox's Edit
  // button. The real gate is the REST endpoint's own permission check —
  // this only controls whether the button is shown at all.
  canEdit: boolean;
  restRoot: string;
  editNonce: string;
}

// Scan pages order by page_number; chat transcripts have no page_number and
// order chronologically by date instead. Hits missing both sort last, stably.
export function compareHitOrder(a: MeiliHit, b: MeiliHit): number {
  if (a.page_number != null || b.page_number != null) {
    return (a.page_number ?? Infinity) - (b.page_number ?? Infinity);
  }
  if (a.date != null || b.date != null) {
    return (a.date ?? '').localeCompare(b.date ?? '');
  }
  return 0;
}

declare global {
  interface Window {
    favInstances?: FavConfig[];
  }
}
