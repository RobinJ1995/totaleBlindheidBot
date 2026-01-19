"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WrongTypeError = exports.EmptyValueError = exports.NullValueError = exports.formatError = exports.escapeMarkdown = exports.promiseLog = exports.pickRandom = exports.checkInstanceOf = exports.checkNotEmptyOrWhitespace = exports.checkNotEmpty = exports.checkNotNull = void 0;
class NullValueError extends Error {
}
exports.NullValueError = NullValueError;
class EmptyValueError extends Error {
}
exports.EmptyValueError = EmptyValueError;
class WrongTypeError extends Error {
}
exports.WrongTypeError = WrongTypeError;
const checkNotNull = (x) => {
    if (x === null || x === undefined) {
        throw new NullValueError('Null value');
    }
    return x;
};
exports.checkNotNull = checkNotNull;
const checkNotEmpty = (x) => {
    if (String(checkNotNull(x)) === '') {
        throw new EmptyValueError('Empty value');
    }
    return x;
};
exports.checkNotEmpty = checkNotEmpty;
const checkNotEmptyOrWhitespace = (x) => {
    if (String(checkNotEmpty(x)).trim() === '') {
        throw new EmptyValueError('Whitespace-only value');
    }
    return x;
};
exports.checkNotEmptyOrWhitespace = checkNotEmptyOrWhitespace;
const checkInstanceOf = (x, type) => {
    if (!(x instanceof type)) {
        throw new WrongTypeError('Type error');
    }
    return x;
};
exports.checkInstanceOf = checkInstanceOf;
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
exports.pickRandom = pickRandom;
const checkHttpStatus = (res) => {
    if ([200, 201, 204].includes(res.status)) {
        return res;
    }
    throw Error(`${res.status} ${res.statusText}`);
};
const httpCheckParse = (res) => checkHttpStatus(res).json();
const promiseLog = (message) => {
    if (message) {
        console.info(message);
    }
    return (x) => {
        if (!message) {
            console.log(x);
        }
        return x;
    };
};
exports.promiseLog = promiseLog;
const escapeMarkdown = (text) => {
    // Only escape the subset of special characters accepted by Telegram
    return text.replace(/([`_*\\(\[])/g, '\\$1');
};
exports.escapeMarkdown = escapeMarkdown;
const formatError = (err) => {
    if (err.stack) {
        return escapeMarkdown(err.stack);
    }
    return `*${err.message}*`;
};
exports.formatError = formatError;
