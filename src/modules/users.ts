import fs from 'fs';
import path from 'path';

export interface User {
    id: string;
    publicKey: string;
    encryptedPrivateKey: string; // Em um sistema real, seria criptografado
    referralBy: string | null;
    isActive: boolean;
}

export class UserModule {
    private filePath: string;

    constructor() {
        this.filePath = path.join(process.cwd(), 'users.json');
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify([], null, 2));
        }
    }

    public getUsers(): User[] {
        try {
            // Remove BOM (byte-order mark) se existir antes de fazer parse
            let data = fs.readFileSync(this.filePath, 'utf-8');
            data = data.replace(/^\uFEFF/, '').trim();
            if (!data || data === '') return [];
            return JSON.parse(data);
        } catch {
            // JSON corrompido — reinicia o arquivo limpo e continua
            fs.writeFileSync(this.filePath, '[]', { encoding: 'utf8' });
            return [];
        }
    }

    public saveUser(user: User) {
        const users = this.getUsers();
        const index = users.findIndex(u => u.publicKey === user.publicKey);
        if (index > -1) {
            users[index] = user;
        } else {
            users.push(user);
        }
        // Sempre salva sem BOM em UTF-8 puro
        fs.writeFileSync(this.filePath, JSON.stringify(users, null, 2), { encoding: 'utf8' });
    }

    public getUserByPublicKey(pubkey: string): User | undefined {
        return this.getUsers().find(u => u.publicKey === pubkey);
    }

    public getReferralChain(startPubkey: string): string[] {
        const chain: string[] = [];
        let current = this.getUserByPublicKey(startPubkey);
        
        for (let i = 0; i < 5; i++) {
            if (current && current.referralBy) {
                chain.push(current.referralBy);
                current = this.getUserByPublicKey(current.referralBy);
            } else {
                break;
            }
        }
        return chain;
    }

    public getNetworkStats(ownerPubkey: string) {
        const users = this.getUsers();
        const counts = [0, 0, 0, 0, 0]; // [Nivel1, Nivel2, Nivel3, Nivel4, Nivel5]

        const findLevel = (currentPubkey: string, currentLevel: number) => {
            if (currentLevel > 5) return;
            
            const directDownlines = users.filter(u => u.referralBy === currentPubkey);
            counts[currentLevel - 1] += directDownlines.length;

            for (const downline of directDownlines) {
                findLevel(downline.publicKey, currentLevel + 1);
            }
        };

        findLevel(ownerPubkey, 1);
        return counts;
    }
}
