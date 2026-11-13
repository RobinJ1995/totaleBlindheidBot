// Notices a Steam session that still looks logged on but has stopped answering.
export default class SteamWatchdog {
    private unansweredSince: number | null = null;

    constructor(
        private readonly silenceMs: number,
        private readonly onSilent: () => void,
        private readonly now: () => number = Date.now
    ) {}

    // Steam was asked something it answers with user updates.
    asked(): void {
        if (this.unansweredSince === null) {
            this.unansweredSince = this.now();
            return;
        } else if (this.now() - this.unansweredSince < this.silenceMs) {
            return;
        }
        this.unansweredSince = null;
        this.onSilent();
    }

    heard(): void {
        this.unansweredSince = null;
    }
}
