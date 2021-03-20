module.exports = (api, message) => {
    const who = message.message.from?.first_name || message.message.from?.username || 'stranger';

    message.reply(`Hello to you too, ${who}!`);
};