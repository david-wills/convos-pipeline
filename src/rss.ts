// RSS/Atom parsing shared by podcast ingest and news fetch. fast-xml-parser
// returns different shapes depending on cardinality and CDATA, so most of this
// file is normalisation.

import { XMLParser } from 'fast-xml-parser';

export type XmlNode = Record<string, unknown>;

export function parseXml(xmlText: string): XmlNode {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseAttributeValue: false,
    cdataPropName: '#text',
    parseTagValue: false, // keeps durations like "1:02:03" as strings
    trimValues: true,
    processEntities: true,
    htmlEntities: true,
  });
  return parser.parse(xmlText) as XmlNode;
}

/** Text content of a node, whatever wrapper the parser chose. */
export function text(node: unknown): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === 'string') return node.trim() || null;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) {
    for (const item of node) {
      const t = text(item);
      if (t) return t;
    }
    return null;
  }
  if (typeof node === 'object') {
    const t = (node as XmlNode)['#text'];
    if (typeof t === 'string') return t.trim() || null;
  }
  return null;
}

export function attr(node: unknown, key: string): string | null {
  if (!node || typeof node !== 'object') return null;
  const val = (node as XmlNode)[`@_${key}`];
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

/** RSS 2.0 <channel> or Atom <feed>, plus its items as an array. */
export function channelAndItems(parsed: XmlNode): { channel: XmlNode; items: XmlNode[] } {
  const rss = parsed['rss'] as XmlNode | undefined;
  const feed = parsed['feed'] as XmlNode | undefined;
  const channel = (rss?.['channel'] as XmlNode | undefined) ?? feed;
  if (!channel) throw new Error('No RSS <channel> or Atom <feed> element found');
  const raw = channel['item'] ?? channel['entry'];
  const items = !raw ? [] : Array.isArray(raw) ? (raw as XmlNode[]) : [raw as XmlNode];
  return { channel, items };
}

/** "3723", "1:02:03", "45:30", "3723.5" -> seconds. */
export function parseDuration(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const str = String(raw).trim();
  if (!str) return null;
  if (str.includes(':')) {
    const parts = str.split(':').map((p) => parseFloat(p));
    if (parts.some(isNaN)) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return null;
  }
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

/** RFC 2822 (and friends) -> ISO 8601 so string comparison sorts correctly. */
export function normalizeDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? dateStr : date.toISOString();
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'convos-pipeline/0.1 (+https://github.com/david-wills)',
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}
