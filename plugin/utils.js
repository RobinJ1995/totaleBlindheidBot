class NullValueError extends Error {}
class EmptyValueError extends Error {}
class WrongTypeError extends Error {}

const checkNotNull = x => {
    if (x === null || x === undefined) {
        throw new NullValueError('Null value');
    }

    return x;
}

const checkNotEmpty = x => {
    if (String(checkNotNull(x)) === '') {
        throw new EmptyValueError('Empty value');
    }

    return x;
}

const checkNotEmptyOrWhitespace = x => {
    if (String(checkNotEmpty(x)).trim() === '') {
        throw new EmptyValueError('Whitespace-only value');
    }

    return x;
}

const checkInstanceOf = (x, type) => {
    if (!x instanceof type) {
        throw new WrongTypeError('Type error');
    }

    return x;
}

const pickRandom = arr => arr[Math.floor(Math.random() * arr.length)];

const checkHttpStatus = res => {
    if ([200, 201, 204].includes(res.status)) {
        return res;
    }

    throw Error(`${res.status} ${res.statusText}`);
};

const httpCheckParse = res => checkHttpStatus(res).json();

const promiseLog = message => {
    if (message) {
        console.info(message);
    }

    return x => {
        if (!message) {
            console.log(x);
        }

        return x;
    }
}

const escapeMarkdown = text => {
    // Only escape the subset of special characters accepted by Telegram
    return text.replace(/([`_*\\(\[])/g, '\\$1');
}

const formatError = err => {
    if (err.stack) {
        return escapeMarkdown(err.stack);
    }

    return `*${err.message}*`;
}

module.exports = {
    checkNotNull,
    checkNotEmpty,
    checkNotEmptyOrWhitespace,
    checkInstanceOf,
    pickRandom,
    checkHttpStatus,
    httpCheckParse,
    promiseLog,
    escapeMarkdown,
    formatError
};