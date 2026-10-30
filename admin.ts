import { Bot } from 'node-telegram-bot-api';

export const isBotAdmin = (telegram_id?: number): boolean => {
    const admin = process.env.STEAM_ADMIN_TELEGRAM_USER_ID;
    return !!admin && telegram_id != null && String(telegram_id) === admin;
};

export const isChatAdmin = async (bot: Bot, chat_id: number, telegram_id?: number): Promise<boolean> => {
    if (isBotAdmin(telegram_id)) {
        return true;
    } else if (telegram_id == null) {
        return false;
    }
    try {
        const member = await bot.api.getChatMember({ chat_id, user_id: telegram_id });
        return member.status === 'creator' || member.status === 'administrator';
    } catch (err) {
        console.error(`Could not check whether user ${telegram_id} administers chat ${chat_id}:`, err);
        return false;
    }
};
