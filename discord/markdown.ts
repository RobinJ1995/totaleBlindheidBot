import { MessageEntity } from 'node-telegram-bot-api';
import { Formatted } from '../format.js';

const escapeMarkdown = (text: string): string => text.replace(/[\\*_~|`]/g, '\\$&').replace(/^([#>-])/gm, '\\$1');

const wrap = (entity: MessageEntity, inner: string, raw: string): string => {
    switch (entity.type) {
        case 'bold':
            return `**${inner}**`;
        case 'italic':
            return `*${inner}*`;
        case 'underline':
            return `__${inner}__`;
        case 'strikethrough':
            return `~~${inner}~~`;
        case 'spoiler':
            return `||${inner}||`;
        case 'code':
            return `\`${raw}\``;
        case 'pre':
            return `\`\`\`${entity.language ?? ''}\n${raw}\n\`\`\``;
        case 'text_link':
            return `[${inner}](${entity.url})`;
        case 'url':
            return raw;
        case 'blockquote':
        case 'expandable_blockquote':
            return inner.split('\n').map(line => `> ${line}`).join('\n');
        default:
            return inner;
    }
};

// Entity offsets are UTF-16 code units, like JS string indexes. Entities nest but never partially
// overlap, so the outermost entity at each position is rendered with its contents recursed.
export const toDiscordMarkdown = (formatted: Formatted): string => {
    const entities: MessageEntity[] = [...formatted.entities]
        .sort((a, b) => a.offset - b.offset || b.length - a.length);

    const render = (start: number, end: number, candidates: MessageEntity[]): string => {
        const { out, pos } = candidates.reduce(({ out, pos }, entity) => {
            const entityEnd: number = entity.offset + entity.length;
            if (entity.offset < pos || entityEnd > end) {
                return { out, pos }; // inside an entity already rendered, or outside this span
            }
            const nested: MessageEntity[] = candidates.filter(e => e !== entity && e.offset >= entity.offset && e.offset + e.length <= entityEnd);
            const raw: string = formatted.text.slice(entity.offset, entityEnd);
            return {
                out: out + escapeMarkdown(formatted.text.slice(pos, entity.offset)) + wrap(entity, render(entity.offset, entityEnd, nested), raw),
                pos: entityEnd
            };
        }, { out: '', pos: start });
        return out + escapeMarkdown(formatted.text.slice(pos, end));
    };

    return render(0, formatted.text.length, entities);
};

export const DISCORD_MESSAGE_LIMIT = 2000;

export const splitMessage = (content: string, limit: number = DISCORD_MESSAGE_LIMIT): string[] => {
    const chunks: string[] = [];
    let rest: string = content;
    while (rest.length > limit) {
        const newline: number = rest.lastIndexOf('\n', limit);
        const cut: number = newline > 0 ? newline : limit;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut).replace(/^\n/, '');
    }
    chunks.push(rest);
    return chunks;
};
