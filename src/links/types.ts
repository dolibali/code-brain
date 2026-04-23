export type LinkDirection = "incoming" | "outgoing" | "both";

export type LinkPageInput = {
  project: string;
  fromSlug: string;
  toSlug: string;
  relation: string;
  context?: string;
};

export type GetLinksInput = {
  project: string;
  slug: string;
  direction?: LinkDirection;
};

export type RetrievedLink = {
  direction: "incoming" | "outgoing";
  relation: string;
  fromSlug: string;
  toSlug: string;
  otherSlug: string;
  otherType: string | null;
  otherTitle: string | null;
  context: string | null;
};

export interface LinkService {
  linkPages(input: LinkPageInput): void;
  getLinks(input: GetLinksInput): RetrievedLink[];
}
