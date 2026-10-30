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

// Rendered in each reader's own timezone; `content` is the fallback for clients that can't.
export const dateTime = (content: Part, date: Date, format: string): Formatted =>
    wrap(content, { type: 'date_time', unix_time: Math.floor(date.getTime() / 1000), date_time_format: format });

// The text/entities fields of a sendMessage or editMessageText call.
export const messageText = (part: Part): { text: string, entities?: MessageEntity[] } => {
    const { text, entities } = asFormatted(part);
    return entities.length > 0 ? { text, entities } : { text };
};

export const sameFormatted = (a: Formatted, b: Formatted): boolean =>
    a.text === b.text && JSON.stringify(a.entities) === JSON.stringify(b.entities);

