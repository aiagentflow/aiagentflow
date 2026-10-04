/** Minimal event emitter. */
export class Emitter {
    constructor() {
        this.listeners = new Map();
    }

    on(event, listener) {
        const list = this.listeners.get(event) ?? [];
        list.push(listener);
        this.listeners.set(event, list);
        return this;
    }

    off(event, listener) {
        const list = this.listeners.get(event) ?? [];
        this.listeners.set(event, list.filter(l => l !== listener));
        return this;
    }

    emit(event, ...args) {
        for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
    }
}
