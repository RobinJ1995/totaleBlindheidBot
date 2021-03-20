const { checkNotNull, checkNotEmpty } = require('../utils');

class MessageEntity {
    constructor(message, meta) {
        this.message = checkNotNull(message);
        this.meta = checkNotNull(meta);
    }
}

module.exports = MessageEntity;