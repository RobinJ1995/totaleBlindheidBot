module.exports = (bot, msg) => {
    const who = msg.from?.first_name || msg.from?.username || 'stranger';

    msg.reply(`Hello to you too, ${who}!`);
};