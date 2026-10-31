export interface ParsedMention {
    id?: number;
    username?: string; // without leading @
    display: string;
}

export const userMention = (id: number, display: string): string => `[${display}](user:${id})`;

// A rotation player is stored either as `[Name](user:123)` (text mention, has the bot's user id)
// or as a plain `@username` string. Extract what we can to match against button tappers.
export const parseMention = (mention: string): ParsedMention => {
    const match: RegExpMatchArray | null = mention.match(/^\[(.*)\]\(user:(\d+)\)$/);
    if (match) {
        return { id: Number(match[2]), display: match[1] };
    } else if (mention.startsWith('@')) {
        return { username: mention.substring(1), display: mention };
    }

    return { display: mention };
};

// Render a name so that it shows up in a message without pinging the user
// (zero-width space breaks the @mention).
export const displayName = (name: string): string => name.replace('@', '@​');
