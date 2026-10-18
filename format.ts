import { MessageEntity } from 'node-telegram-bot-api';

// Message text plus its formatting as entities, so nothing ever needs escaping.
export interface Formatted {
    text: string;
    entities: MessageEntity[];
}

// Plain strings are unformatted text.
export type Part = string | Formatted;

export const asFormatted = (part: Part): Formatted =>
    typeof part === 'string' ? { text: part, entities: [] } : part;

const concat = (parts: Part[]): Formatted => {
    let text = '';
    const entities: MessageEntity[] = [];
    for (const part of parts.map(asFormatted)) {
        entities.push(...part.entities.map(entity => ({ ...entity, offset: entity.offset + text.length })));
        text += part.text;
    }
    return { text, entities };
};

// Tagged template: fmt`Stats for ${bold(name)}`.
export const fmt = (strings: TemplateStringsArray, ...values: (Part | number)[]): Formatted => {
    const parts: Part[] = [strings[0]];
    values.forEach((value, i) => parts.push(typeof value === 'number' ? String(value) : value, strings[i + 1]));
    return concat(parts);
};

export const join = (parts: Part[], separator: string): Formatted =>
    concat(parts.flatMap((part, i) => i === 0 ? [part] : [separator, part]));

const wrap = (content: Part, entity: Omit<MessageEntity, 'offset' | 'length'>): Formatted => {
    const inner = asFormatted(content);
    return inner.text.length === 0
        ? inner
        : { text: inner.text, entities: [{ ...entity, offset: 0, length: inner.text.length } as MessageEntity, ...inner.entities] };
};

export const bold = (content: Part): Formatted => wrap(content, { type: 'bold' });

export const link = (content: Part, url: string): Formatted => wrap(content, { type: 'text_link', url });

// The text/entities fields of a sendMessage or editMessageText call.
export const messageText = (part: Part): { text: string, entities?: MessageEntity[] } => {
    const { text, entities } = asFormatted(part);
    return entities.length > 0 ? { text, entities } : { text };
};

export const sameFormatted = (a: Formatted, b: Formatted): boolean =>
    a.text === b.text && JSON.stringify(a.entities) === JSON.stringify(b.entities);

// Convert text stored before the switch to entities. Handles the legacy Markdown this bot
// generated: *bold*, [text](url) and backslash escapes.
export const fromLegacyMarkdown = (markdown: string): Formatted => {
    const unescape = (s: string): string => s.replace(/\\([`_*\\(\[])/g, '$1');
    const parts: Part[] = [];
    let plain = '';
    let inBold = false;
    let boldParts: Part[] = [];
    const flush = (): void => {
        if (plain) {
            (inBold ? boldParts : parts).push(unescape(plain));
            plain = '';
        }
    };

    for (let i = 0; i < markdown.length; i++) {
        const c = markdown[i];
        const linkMatch = c === '[' ? markdown.slice(i).match(/^\[((?:\\.|[^\]\\])*)\]\(([^)]*)\)/) : null;
        if (c === '\\' && i + 1 < markdown.length) {
            plain += markdown.slice(i, i + 2);
            i++;
        } else if (c === '*') {
            flush();
            if (inBold) {
                parts.push(bold(concat(boldParts)));
                boldParts = [];
            }
            inBold = !inBold;
        } else if (linkMatch) {
            flush();
            (inBold ? boldParts : parts).push(link(unescape(linkMatch[1]), linkMatch[2]));
            i += linkMatch[0].length - 1;
        } else {
            plain += c;
        }
    }
    flush();
    if (inBold) {
        // Unterminated: keep the asterisk as literal text.
        parts.push('*', ...boldParts);
    }
    return concat(parts);
};
