import * as fs from 'fs/promises';
import * as path from 'path';

export class DatabaseManager {
    private storagePath: string;
    
    constructor(storagePath: string) {
        this.storagePath = storagePath;
    }

    private get indexPath() { return path.join(this.storagePath, 'index.json'); }
    private get chatsPath() { return path.join(this.storagePath, 'chats'); }

    async init() {
        try { await fs.mkdir(this.chatsPath, { recursive: true }); } catch (e) {}
        try {
            await fs.access(this.indexPath);
        } catch {
            await fs.writeFile(this.indexPath, JSON.stringify({ conversations: [] }));
        }
    }

    async getIndex() {
        try {
            const data = await fs.readFile(this.indexPath, 'utf-8');
            return JSON.parse(data);
        } catch (e) {
            return { conversations: [] };
        }
    }

    async saveConversation(id: string, title: string, history: any[], traces: string[]) {
        const payload = { id, title, updatedAt: new Date().toISOString(), history, traces };
        await fs.writeFile(path.join(this.chatsPath, `${id}.json`), JSON.stringify(payload, null, 2));

        const index = await this.getIndex();
        const existing = index.conversations.find((c: any) => c.id === id);
        if (existing) {
            existing.updatedAt = payload.updatedAt;
            existing.title = title;
        } else {
            index.conversations.push({ id, title, updatedAt: payload.updatedAt });
        }
        await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2));
    }
}
