class NullValueError extends Error {}
class EmptyValueError extends Error {}
class WrongTypeError extends Error {}

const checkNotNull = <T>(x: T | null | undefined): T => {
    if (x === null || x === undefined) {
        throw new NullValueError('Null value');
    }

    return x;
}

const checkNotEmpty = <T>(x: T): T => {
    if (String(checkNotNull(x)) === '') {
        throw new EmptyValueError('Empty value');
    }

    return x;
}

const checkNotEmptyOrWhitespace = <T>(x: T): T => {
    if (String(checkNotEmpty(x)).trim() === '') {
        throw new EmptyValueError('Whitespace-only value');
    }

    return x;
}

const checkInstanceOf = <T>(x: any, type: new (...args: any[]) => T): T => {
    if (!(x instanceof type)) {
        throw new WrongTypeError('Type error');
    }

    return x;
}

const pickRandom = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const checkHttpStatus = (res: Response): Response => {
    if ([200, 201, 204].includes(res.status)) {
        return res;
    }

    throw Error(`${res.status} ${res.statusText}`);
};

const httpCheckParse = (res: Response): Promise<any> => checkHttpStatus(res).json();

const promiseLog = (message?: string): (<T>(x: T) => T) => {
    if (message) {
        console.info(message);
    }

    return <T>(x: T): T => {
        if (!message) {
            console.log(x);
        }

        return x;
    }
}

const escapeMarkdown = (text: string): string => {
    // Only escape the subset of special characters accepted by Telegram
    return text.replace(/([`_*\\(\[])/g, '\\$1');
}

const escapeHtml = (text: string): string => {
    // Escape the characters that are significant in Telegram's HTML parse mode
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const formatError = (err: Error): string => {
    if (err.stack) {
        return escapeMarkdown(err.stack);
    }

    return `*${err.message}*`;
}

export {
    checkNotNull,
    checkNotEmpty,
    checkNotEmptyOrWhitespace,
    checkInstanceOf,
    pickRandom,
    promiseLog,
    escapeMarkdown,
    escapeHtml,
    formatError,
    NullValueError,
    EmptyValueError,
    WrongTypeError
};