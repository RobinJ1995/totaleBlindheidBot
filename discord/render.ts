import { User } from '../dao/UserDAO.js';
import { Formatted } from '../format.js';
import { parseMention } from '../rsvp.js';
import { toDiscordMarkdown } from './markdown.js';

const discordMention = (mention: string, users: Record<number, User>): string => {
    const parsed = parseMention(mention);
    const discord_id: string | undefined = parsed.id === undefined ? undefined : users[parsed.id]?.discord_id;
    return discord_id !== undefined ? `<@${discord_id}>` : toDiscordMarkdown({ text: parsed.display, entities: [] });
};

export const withDiscordTags = (head: Formatted, tags: string[], users: Record<number, User>): string =>
    `${toDiscordMarkdown(head)}${tags.map(tag => discordMention(tag, users)).join(' ')}`;
