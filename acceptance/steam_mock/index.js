/*
 * Drop-in fake of the `steam-user` package for acceptance tests.
 *
 * It implements only the surface that SteamService.ts touches, never talks to
 * the real Steam network, and exposes a small HTTP control server so behave can
 * trigger `user` (game presence) and `steamGuard` events on demand.
 *
 * This file is mounted over node_modules/steam-user in the bot test container,
 * so `require('steam-user')` resolves here at runtime.
 */
const EventEmitter = require('events');
const http = require('http');

const CONTROL_PORT = parseInt(process.env.STEAM_CONTROL_PORT || '9100', 10);
const FAKE_STEAMID64 = '76561190000000000';

// The most recently constructed client; the bot creates exactly one.
let activeClient = null;

// State of the most recent steamGuard request, exposed over the control API.
const steamGuardState = { requested: false, called: false, code: null };

const personaRequests = [];

const nicknames = [];

// How each account stands with the bot's (an EFriendRelationship name); anyone not listed is a friend.
const relationships = new Map();

// Accounts Steam turns the bot's friend requests down for.
const refusing = new Set();

const friendRequests = [];

let logOns = 0;

// A session Steam has stopped answering; the next logon starts a healthy one.
let silent = false;

class FakeSteamUser extends EventEmitter {
    constructor(options) {
        super();
        this.options = options || {};
        this.steamID = null;
        this.myFriends = new Proxy({}, {
            get: (_friends, steamId) => FakeSteamUser.EFriendRelationship[relationships.get(steamId) ?? 'Friend']
        });
        this.users = {};
        // SteamService attaches 'save'/'read' listeners to storage when S3 is
        // configured. We never persist, so an inert emitter is enough.
        this.storage = new EventEmitter();
        activeClient = this;
    }

    logOn() {
        // Simulate a successful login on the next tick so listeners are wired up.
        setImmediate(() => {
            logOns++;
            silent = false;
            this.steamID = { getSteamID64: () => FAKE_STEAMID64 };
            this.emit('loggedOn');
            this.emit('friendsList');
        });
    }

    setPersona(_state, name) {
        if (name !== undefined) {
            nicknames.push(name);
        }
    }

    // Like Steam's: answers with what it knows of each account. The requests also tell behave
    // which accounts the bot tracks by now.
    getPersonas(steamIds) {
        const ids = steamIds.map(String);
        personaRequests.push(ids);
        if (silent) {
            return;
        }
        setImmediate(() => ids.forEach(id => this.emit('user', { getSteamID64: () => id }, this.users[id] ?? {})));
    }

    // Like Steam's: asks a stranger, accepts someone who asked.
    addFriend(steamId) {
        const id = String(steamId);
        friendRequests.push(id);
        if (refusing.has(id)) {
            return Promise.reject(new Error('LimitExceeded'));
        }
        relationships.set(id, relationships.get(id) === 'RequestRecipient' ? 'Friend' : 'RequestInitiator');
        return Promise.resolve({ personaName: id });
    }

    logOff() {
        this.steamID = null;
    }
}

FakeSteamUser.EPersonaState = {
    Offline: 0,
    Online: 1,
    Busy: 2,
    Away: 3,
    Snooze: 4,
    LookingToTrade: 5,
    LookingToPlay: 6,
};

FakeSteamUser.EFriendRelationship = {
    None: 0,
    Blocked: 1,
    RequestRecipient: 2,
    Friend: 3,
    RequestInitiator: 4,
    Ignored: 5,
    IgnoredFriend: 6,
};

// ---------------------------------------------------------------------------
// Control server (used by behave, not by the bot).
// ---------------------------------------------------------------------------

function readBody(req) {
    return new Promise(resolve => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch (e) {
                resolve({});
            }
        });
    });
}

function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

const controlServer = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];

    if (req.method === 'GET' && url === '/steam/health') {
        sendJson(res, 200, { ok: true, hasClient: !!activeClient });
    } else if (req.method === 'GET' && url === '/steam/steamguard/state') {
        sendJson(res, 200, { ok: true, ...steamGuardState });
    } else if (req.method === 'GET' && url === '/steam/personas') {
        sendJson(res, 200, { ok: true, requests: personaRequests });
    } else if (req.method === 'GET' && url === '/steam/nicknames') {
        sendJson(res, 200, { ok: true, nicknames });
    } else if (req.method === 'GET' && url === '/steam/logons') {
        sendJson(res, 200, { ok: true, logOns });
    } else if (req.method === 'POST' && url === '/steam/silence') {
        silent = true;
        sendJson(res, 200, { ok: true });
    } else if (req.method === 'GET' && url === '/steam/friend-requests') {
        sendJson(res, 200, { ok: true, requests: friendRequests });
    } else if (req.method === 'POST' && url === '/steam/relationship') {
        const body = await readBody(req);
        const steamId = String(body.steamId);
        relationships.set(steamId, body.relationship);
        if (body.refuses) {
            refusing.add(steamId);
        }
        if (activeClient) {
            activeClient.emit('friendRelationship', { getSteamID64: () => steamId }, FakeSteamUser.EFriendRelationship[body.relationship]);
        }
        sendJson(res, 200, { ok: true });
    } else if (!activeClient) {
        // All remaining endpoints act on the live client.
        sendJson(res, 503, { ok: false, error: 'no client' });
    } else if (req.method === 'POST' && url === '/steam/refresh') {
        activeClient.emit('friendsList');
        sendJson(res, 200, { ok: true });
    } else if (req.method === 'POST' && url === '/steam/user') {
        const body = await readBody(req);
        const steamId = String(body.steamId || FAKE_STEAMID64);
        const user = body.user || {};
        // maybeCloseSession reads activeClient.users[sid].gameid, so keep it in sync.
        activeClient.users[steamId] = user;
        const sid = { getSteamID64: () => steamId };
        activeClient.emit('user', sid, user);
        sendJson(res, 200, { ok: true });
    } else if (req.method === 'POST' && url === '/steam/steamguard') {
        const body = await readBody(req);
        const domain = body.domain || null;
        const lastCodeWrong = !!body.lastCodeWrong;
        steamGuardState.requested = true;
        steamGuardState.called = false;
        steamGuardState.code = null;
        const callback = code => {
            steamGuardState.called = true;
            steamGuardState.code = code;
        };
        activeClient.emit('steamGuard', domain, callback, lastCodeWrong);
        sendJson(res, 200, { ok: true });
    } else {
        sendJson(res, 404, { ok: false, error: 'not found' });
    }
});

controlServer.listen(CONTROL_PORT, '0.0.0.0', () => {
    console.log(`[steam-mock] control server listening on ${CONTROL_PORT}`);
});

module.exports = FakeSteamUser;
