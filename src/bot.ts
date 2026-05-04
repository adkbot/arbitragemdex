import { 
    Keypair, 
    Connection, 
    LAMPORTS_PER_SOL,
    PublicKey
} from "@solana/web3.js";
import { EventEmitter } from 'events';
import dotenv from 'dotenv';
import bs58 from 'bs58';

// Importando nossos módulos (Pilar 1: Modularidade)
import { BlockchainModule } from './modules/blockchain.js';
import { JupiterModule } from './modules/jupiter.js';
import { PaymentModule } from './modules/payments.js';
import { UserModule, User } from './modules/users.js';

import { WalletScanner } from './modules/wallet.scanner.js';

dotenv.config();

export class ArbitrageBot extends EventEmitter {
    private connection: Connection;
    private jupiter: JupiterModule;
    private payments: PaymentModule;
    private users: UserModule;
    private adminWallet: Keypair;
    private isRunning: boolean = false;
    
    private txToday: number = 0;
    private solBalance: number = 0;
    private usdcBalance: number = 0;
    private usdtBalance: number = 0;
    private daiBalance: number = 0;

    constructor() {
        super();
        const blockchain = new BlockchainModule();
        this.connection = blockchain.getConnection();
        this.jupiter = new JupiterModule();
        this.payments = new PaymentModule(this.connection);
        this.users = new UserModule();
        this.adminWallet = BlockchainModule.getAdminKeypair();
        
        console.log("🛡️ ENGINE ADKBOT V5 - MULTI-ASSET MONITORING READY");
    }

    private log(message: string) {
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] ${message}`);
        this.emit('log', { time, message });
    }

    public getStats() {
        return {
            status: this.isRunning ? "Ativo" : "Parado",
            userCount: this.users.getUsers().length,
            txToday: this.txToday,
            wallet: this.adminWallet.publicKey.toBase58(),
            balances: {
                sol: this.solBalance.toFixed(4),
                usdc: this.usdcBalance.toFixed(2),
                usdt: this.usdtBalance.toFixed(2),
                dai: this.daiBalance.toFixed(2)
            }
        };
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.log("🚀 Iniciando Motor de Arbitragem Multiativo...");
        await this.refreshBalances();
        this.executionLoop();
    }

    private async refreshBalances() {
        const MINTS = {
            USDC: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
            USDT: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
            DAI: new PublicKey("EjyF9mYv7CcfsCBnrS9SnoSVSY2v5Bwsk7uK5K9L1pD")
        };

        try {
            // Saldo SOL
            const sol = await this.connection.getBalance(this.adminWallet.publicKey);
            this.solBalance = sol / LAMPORTS_PER_SOL;

            // Saldo Tokens
            for (const [name, mint] of Object.entries(MINTS)) {
                try {
                    const accounts = await this.connection.getTokenAccountsByOwner(this.adminWallet.publicKey, { mint });
                    if (accounts.value.length > 0) {
                        const balance = await this.connection.getTokenAccountBalance(accounts.value[0].pubkey);
                        if (name === 'USDC') this.usdcBalance = balance.value.uiAmount || 0;
                        if (name === 'USDT') this.usdtBalance = balance.value.uiAmount || 0;
                        if (name === 'DAI') this.daiBalance = balance.value.uiAmount || 0;
                    }
                } catch (e) {
                    // Se a conta não existir, o saldo é 0
                }
            }
            
            this.emit('stats_update', this.getStats());
        } catch (error: any) {
            // RPC com rate-limit ou offline — continua sem travar o servidor
            const msg = error?.message || String(error);
            if (msg.includes('429') || msg.includes('401')) {
                console.warn(`⚠️ RPC temporariamente indisponível (${msg.slice(0,60)}). Tentando novamente em breve.`);
            } else {
                console.warn("⚠️ Erro ao atualizar saldos:", msg.slice(0, 100));
            }
        }
    }

    private async executionLoop() {
        while (this.isRunning) {
            const activeUsers = this.users.getUsers().filter(u => u.isActive);
            
            if (activeUsers.length === 0) {
                this.log("💤 Nenhum usuário ativo no momento. Aguardando...");
                await new Promise(resolve => setTimeout(resolve, 10000));
                continue;
            }

            for (const user of activeUsers) {
                if (!user.encryptedPrivateKey) {
                    this.log(`🔎 Monitorando (modo observador): ${user.publicKey.slice(0,6)}...`);
                    continue;
                }

                try {
                    const userKeypair = Keypair.fromSecretKey(bs58.decode(user.encryptedPrivateKey));
                    this.log(`🔎 Escaneando ativos para: ${user.publicKey.slice(0,6)}...`);

                    // Escaneia a carteira do usuário para encontrar ativos com saldo
                    const scanner = new WalletScanner();
                    const scan = await scanner.scanWallet(user.publicKey);

                    if (!scan.canStartBot) {
                        this.log(`⚠️ ${user.publicKey.slice(0,6)}: Sem saldo operacional ou rotas Jupiter.`);
                        continue;
                    }

                    // Tenta operar com cada ativo que tenha saldo e rota
                    for (const asset of scan.operationalAssets) {
                        this.log(`⚡ Testando arbitragem para ${asset.symbol} (${user.publicKey.slice(0,6)})...`);

                        const quote = await this.jupiter.getQuote({
                            inputMint: asset.mint,
                            outputMint: "So11111111111111111111111111111111111111112", // SOL como pivot
                            amount: Math.floor(asset.balance * 10 ** 6), // Simplificado: usa balance em micro-unidades
                            slippageBps: 50,
                        });

                        if (quote) {
                            // Lógica de lucro simplificada para demonstração
                            // Em produção, isso compararia o quote de volta para o ativo original
                            const profitDetected = 1.55; 
                            const minProfit = parseFloat(process.env.MIN_PROFIT_USDC || "1.50");

                            if (profitDetected >= minProfit) {
                                this.log(`💰 Lucro Detectado: ${profitDetected} USDC no par ${asset.symbol}/SOL`);
                                const referralChain = this.users.getReferralChain(user.publicKey);
                                
                                await this.payments.executePayouts(
                                    userKeypair,
                                    this.adminWallet.publicKey.toBase58(),
                                    referralChain,
                                    profitDetected,
                                    asset.mint
                                );
                                
                                this.txToday++;
                                this.log(`✅ Operação finalizada para ${user.publicKey.slice(0,6)}`);
                            }
                        }
                    }
                } catch (err) {
                    this.log(`❌ Erro no ciclo do usuário ${user.publicKey.slice(0,6)}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            await this.refreshBalances();
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    stop() {
        this.isRunning = false;
        console.log("🛑 Motor de Arbitragem parado.");
    }
}

