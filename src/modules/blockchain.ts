import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';

dotenv.config();

export class BlockchainModule {
    private connection: Connection;
    private adminWallet: Keypair;

    constructor() {
        const rpcUrl = process.env.SOLANA_ENDPOINT || '';
        this.connection = new Connection(rpcUrl, 'confirmed');

        // Carrega a chave do .env (Pilar 1)
        try {
            const rawKey = process.env.ADMIN_PRIVATE_KEY || '';
            if (rawKey.length === 64) {
                // Formato Hexadecimal (32 bytes Seed)
                this.adminWallet = Keypair.fromSeed(Buffer.from(rawKey, 'hex'));
            } else {
                // Formato Array [1,2,3...] (64 bytes SecretKey)
                const secretKey = JSON.parse(rawKey);
                this.adminWallet = Keypair.fromSecretKey(new Uint8Array(secretKey));
            }
        } catch (e) {
            console.warn("⚠️ Chave privada não configurada ou inválida no .env. Usando chave temporária.");
            this.adminWallet = Keypair.generate();
        }
    }

    public async getBalance(pubkey: string) {
        const balance = await this.connection.getBalance(new PublicKey(pubkey));
        return balance / 1e9; // Converte lamports para SOL
    }

    public getAdminPubkey() {
        return this.adminWallet.publicKey.toBase58();
    }

    public static getAdminKeypair(): Keypair {
        try {
            const rawKey = process.env.ADMIN_PRIVATE_KEY || '';
            if (rawKey.length === 64) {
                // Se tem 64 caracteres hex, são 32 bytes (Seed)
                return Keypair.fromSeed(Buffer.from(rawKey, 'hex'));
            } else {
                // Se for um array de 64 bytes [1,2,3...]
                const secretKey = JSON.parse(rawKey);
                return Keypair.fromSecretKey(new Uint8Array(secretKey));
            }
        } catch (e) {
            console.error("❌ Erro fatal ao carregar chave do administrador:", e);
            throw new Error("ADMIN_PRIVATE_KEY inválida");
        }
    }

    public getConnection() {
        return this.connection;
    }
}
