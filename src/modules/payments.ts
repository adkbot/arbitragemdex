import { 
    Connection, 
    PublicKey, 
    Transaction, 
    Keypair,
    sendAndConfirmTransaction
} from "@solana/web3.js";
import { 
    getOrCreateAssociatedTokenAccount, 
    createTransferInstruction 
} from "@solana/spl-token";

export interface PaymentRatios {
    user: number;
    admin: number;
    network: number;
}

export class PaymentModule {
    private connection: Connection;
    private ratios: PaymentRatios = {
        user: 0.65,
        admin: 0.20,
        network: 0.15
    };

    constructor(connection: Connection) {
        this.connection = connection;
    }

    public calculateSplit(grossProfit: number) {
        const userPart = grossProfit * this.ratios.user;
        const adminPart = grossProfit * this.ratios.admin;
        const networkPart = grossProfit * this.ratios.network;

        return {
            user: userPart,
            admin: adminPart,
            network: networkPart,
            total: grossProfit
        };
    }

    /**
     * Executa pagamentos REAIS na Solana com Multinível (5 Níveis)
     */
    public async executePayouts(
        fromKeypair: Keypair, 
        adminPubkey: string, 
        referralChain: string[], // Array de endereços [Nivel1, Nivel2, Nivel3, Nivel4, Nivel5]
        amount: number,
        tokenMint: string
    ) {
        try {
            const mintPublicKey = new PublicKey(tokenMint);
            const split = this.calculateSplit(amount);
            const transaction = new Transaction();
            const fromATA = await getOrCreateAssociatedTokenAccount(this.connection, fromKeypair, mintPublicKey, fromKeypair.publicKey);

            // 1. Enviar para o ADM (20%)
            if (split.admin > 0) {
                const toAdminATA = await getOrCreateAssociatedTokenAccount(this.connection, fromKeypair, mintPublicKey, new PublicKey(adminPubkey));
                transaction.add(createTransferInstruction(fromATA.address, toAdminATA.address, fromKeypair.publicKey, Math.floor(split.admin * 10**6)));
            }

            // 2. Enviar para a Rede Multinível (15% total dividido em 5 níveis)
            const levelsPct = [0.05, 0.04, 0.03, 0.02, 0.01]; // 5%, 4%, 3%, 2%, 1%
            
            for (let i = 0; i < referralChain.length && i < levelsPct.length; i++) {
                const levelAddress = referralChain[i];
                if (levelAddress) {
                    const levelAmount = amount * levelsPct[i];
                    const toLevelATA = await getOrCreateAssociatedTokenAccount(this.connection, fromKeypair, mintPublicKey, new PublicKey(levelAddress));
                    transaction.add(createTransferInstruction(fromATA.address, toLevelATA.address, fromKeypair.publicKey, Math.floor(levelAmount * 10**6)));
                    console.log(`[PAYMENT] Nível ${i+1} pago: ${levelAmount.toFixed(4)} USDC para ${levelAddress}`);
                }
            }

            if (transaction.instructions.length > 0) {
                const signature = await sendAndConfirmTransaction(this.connection, transaction, [fromKeypair]);
                return signature;
            }
            return null;
        } catch (error) {
            console.error("[PAYMENT ERROR] Falha na distribuição multinível:", error);
            throw error;
        }
    }
}
