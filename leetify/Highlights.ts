import Streak from '../stats/Streak.js';
import { PlayerStats } from './LeetifyMatch.js';

export interface ReportedPlayer {
    name: string;
    stats: PlayerStats;
    streak: Streak | null;
}

interface Highlight {
    text: string;
    // How remarkable it is: 1 is just notable, higher is more so.
    weight: number;
}

type Rule = (player: ReportedPlayer, lobby: PlayerStats[]) => Highlight | null;

const MAX_HIGHLIGHTS = 4;
// Below this many players "of the server" says little.
const LOBBY_SIZE = 4;
const SLOW_REACTION_FACTOR = 1.3;

const times = (count: number, once: string, many: string): string => count === 1 ? once : `${count} ${many}`;

const atLeast = (value: number, threshold: number, text: string, emphasis = 1): Highlight | null =>
    value >= threshold ? { text, weight: emphasis * value / threshold } : null;

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

const RULES: Rule[] = [
    ({ name, stats }) => {
        const feats: string[] = [
            ...(stats.multi5k > 0 ? [times(stats.multi5k, 'ace', 'aces')] : []),
            ...(stats.multi4k > 0 ? [times(stats.multi4k, '4k', '4ks')] : [])
        ];
        return feats.length > 0
            ? { text: `💥 ${name}: ${feats.join(', ')}`, weight: (stats.multi5k > 0 ? 10 : 3) + stats.multi5k + stats.multi4k }
            : null;
    },
    ({ name, stats }) => atLeast(stats.flashbang_hit_friend, 8, `😵 ${name} flashed teammates ${stats.flashbang_hit_friend} times`, 1.5),
    ({ name, streak }) => streak?.isNotable() ? { text: streak.describe(name), weight: 1.5 * streak.length / 3 } : null,
    ({ name, stats }, lobby) => lobby.length >= LOBBY_SIZE && lobby.every(other => other.steam64_id === stats.steam64_id || other.total_kills < stats.total_kills)
        ? { text: `🏅 ${name} top-fragged the server with ${stats.total_kills} kills`, weight: 2 }
        : null,
    ({ name, stats }, lobby) => lobby.length >= LOBBY_SIZE && lobby.every(other => other.steam64_id === stats.steam64_id || other.total_deaths < stats.total_deaths)
        ? { text: `⚰️ ${name} died the most in the server: ${stats.total_deaths} deaths`, weight: 2 }
        : null,
    ({ name, stats }) => stats.rounds_count >= 10
        ? atLeast(1 - stats.rounds_survived / stats.rounds_count, 0.9, `🪦 ${name} died in ${stats.rounds_count - stats.rounds_survived} of ${stats.rounds_count} rounds`)
        : null,
    ({ name, stats }) => stats.total_kills >= 10
        ? atLeast(stats.total_hs_kills / stats.total_kills, 0.7, `🎯 ${name}: ${Math.round(100 * stats.total_hs_kills / stats.total_kills)}% headshots`)
        : null,
    ({ name, stats }) => atLeast(stats.dpr, 100, `💪 ${name}: ${Math.round(stats.dpr)} ADR`),
    ({ name, stats }) => atLeast(stats.kd_ratio, 2, `📈 ${name}: ${stats.kd_ratio.toFixed(1)} K/D`),
    ({ name, stats }) => stats.total_deaths >= 10 && stats.kd_ratio <= 0.5
        ? { text: `📉 ${name}: ${stats.kd_ratio.toFixed(1)} K/D`, weight: 0.5 / Math.max(stats.kd_ratio, 0.1) }
        : null,
    ({ name, stats }) => atLeast(stats.shots_hit_friend, 10, `🔫 ${name} shot teammates ${stats.shots_hit_friend} times`),
    ({ name, stats }) => atLeast(stats.he_friends_damage_avg, 8, `💣 ${name}: ${Math.round(stats.he_friends_damage_avg)} average HE damage to teammates`),
    ({ name, stats }) => atLeast(stats.utility_on_death_avg, 400, `🎒 ${name} died with $${Math.round(stats.utility_on_death_avg)} of utility on average`),
    ({ name, stats }) => atLeast(stats.flash_assist, 3, `✨ ${name}: ${stats.flash_assist} flash assists`),
    ({ name, stats }, lobby) => {
        const usual: number = median(lobby.map(other => other.reaction_time).filter(time => time > 0));
        return lobby.length >= LOBBY_SIZE && usual > 0
            ? atLeast(stats.reaction_time, SLOW_REACTION_FACTOR * usual, `🐌 ${name}: ${Math.round(1000 * stats.reaction_time)} ms reaction time`)
            : null;
    },
    ({ name, stats }) => atLeast(stats.mvps, 6, `⭐ ${name}: ${stats.mvps} MVPs`)
];

// The most remarkable things the players did in a match, most remarkable first.
export default class Highlights {
    constructor(private readonly players: ReportedPlayer[], private readonly lobby: PlayerStats[]) {}

    lines(): string[] {
        return RULES
            .flatMap(rule => this.players.map(player => rule(player, this.lobby)))
            .filter((highlight): highlight is Highlight => highlight !== null)
            .sort((a, b) => b.weight - a.weight)
            .slice(0, MAX_HIGHLIGHTS)
            .map(highlight => highlight.text);
    }
}
