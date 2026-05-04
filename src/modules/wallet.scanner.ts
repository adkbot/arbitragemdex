/**
 * Módulo de Escaneamento de Carteira — Pilar 1: Responsabilidade Única
 * Responsabilidade: Escanear ativos da carteira + verificar rotas de arbitragem via Jupiter API
 */
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// ─── Tokens Conhecidos na Rede Solana ─────────────────────────────────────────

export interface KnownToken {
    symbol: string;
    mint: string;
    decimals: number;
    minOperational: number; // Saldo mínimo para operar (em unidades do token)
}

export const KNOWN_TOKENS: KnownToken[] = [
    { symbol: 'SOL',  mint: 'So11111111111111111111111111111111111111112',  decimals: 9,  minOperational: 0.001 },
    { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6,  minOperational: 1.0 },
    { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6,  minOperational: 1.0 },
    { symbol: 'DAI',  mint: 'EjyF9mYv7CcfsCBnrS9SnoSVSY2v5Bwsk7uK5K9L1pD',  decimals: 8,  minOperational: 1.0 },
    { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5,  minOperational: 1000 },
    { symbol: 'JUP',  mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6,  minOperational: 1.0 },
    { symbol: 'RAY',  mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6,  minOperational: 0.1 },
    { symbol: 'MSOL', mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', decimals: 9,  minOperational: 0.001 },
];

// ─── Tipos de Resultado ───────────────────────────────────────────────────────

export interface WalletAsset {
    symbol: string;
    mint: string;
    balance: number;
    balanceUSD: number;
    canOperate: boolean;   // Saldo >= mínimo operacional
    hasRoutes: boolean;    // Jupiter encontrou rota de arbitragem
    bestRoute?: string;    // Par de melhor oportunidade detectada
}

export interface WalletScanResult {
    publicKey: string;
    totalBalanceUSD: number;
    assets: WalletAsset[];
    operationalAssets: WalletAsset[];  // Apenas os que podem operar
    scannedAt: string;
    canStartBot: boolean;  // True se pelo menos 1 ativo pode operar
}

// ─── Classe Principal ─────────────────────────────────────────────────────────

export class WalletScanner {
    private connection: Connection;
    private jupiterBaseUrl: string;

    constructor() {
        const rpc = process.env.SOLANA_ENDPOINT || 'https://api.mainnet-beta.solana.com';
        this.connection = new Connection(rpc, 'confirmed');
        this.jupiterBaseUrl = process.env.JUPITER_ENDPOINT || 'https://quote-api.jup.ag/v6';
    }

    /**
     * [PÚBLICO] Escaneamento completo: saldos + rotas Jupiter + elegibilidade
     */
    public async scanWallet(publicKey: string): Promise<WalletScanResult> {
        const pk = new PublicKey(publicKey);

        // Passo 1: Buscar todos os saldos em paralelo
        const [solBalance, tokenBalances] = await Promise.all([
            this.getSOLBalance(pk),
            this.getTokenBalances(pk),
        ]);

        // Passo 2: Montar mapa de saldos
        const balanceMap = new Map<string, number>();
        balanceMap.set('So11111111111111111111111111111111111111112', solBalance);
        for (const [mint, amount] of tokenBalances.entries()) {
            balanceMap.set(mint, amount);
        }

        // Passo 3: Para cada token com saldo operacional, verificar rotas Jupiter
        const assets: WalletAsset[] = [];

        for (const token of KNOWN_TOKENS) {
            const balance = balanceMap.get(token.mint) ?? 0;
            const canOperate = balance >= token.minOperational;

            let hasRoutes = false;
            let bestRoute: string | undefined;

            if (canOperate) {
                const routeCheck = await this.checkJupiterRoute(token);
                hasRoutes = routeCheck.hasRoute;
                bestRoute = routeCheck.bestPair;
            }

            const balanceUSD = await this.estimateUSD(token.symbol, balance);

            assets.push({
                symbol: token.symbol,
                mint: token.mint,
                balance,
                balanceUSD,
                canOperate,
                hasRoutes,
                bestRoute,
            });
        }

        const operationalAssets = assets.filter(a => a.canOperate && a.hasRoutes);
        const totalBalanceUSD = assets.reduce((sum, a) => sum + a.balanceUSD, 0);

        return {
            publicKey,
            totalBalanceUSD,
            assets,
            operationalAssets,
            scannedAt: new Date().toISOString(),
            canStartBot: operationalAssets.length > 0,
        };
    }

    // ─── Saldo SOL ───────────────────────────────────────────────────────────

    private async getSOLBalance(pk: PublicKey): Promise<number> {
        try {
            const lamports = await this.connection.getBalance(pk);
            return lamports / LAMPORTS_PER_SOL;
        } catch {
            return 0;
        }
    }

    // ─── Saldos de Tokens SPL ────────────────────────────────────────────────

    private async getTokenBalances(pk: PublicKey): Promise<Map<string, number>> {
        const result = new Map<string, number>();
        try {
            // Busca todas as contas de token do usuário de uma vez (1 chamada RPC)
            const accounts = await this.connection.getParsedTokenAccountsByOwner(pk, {
                programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
            });

            for (const { account } of accounts.value) {
                const info = account.data.parsed?.info;
                if (!info) continue;
                const mint: string = info.mint;
                const uiAmount: number = info.tokenAmount?.uiAmount ?? 0;
                result.set(mint, uiAmount);
            }
        } catch {
            // RPC indisponível — retorna mapa vazio
        }
        return result;
    }

    // ─── Verificação de Rota Jupiter ─────────────────────────────────────────

    /**
     * Verifica se o Jupiter tem rota de swap disponível para o token.
     * Testa: token → USDC (rota principal de arbitragem)
     */
    private async checkJupiterRoute(
        token: KnownToken
    ): Promise<{ hasRoute: boolean; bestPair?: string }> {
        const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

        // Não faz sentido verificar USDC → USDC
        if (token.mint === USDC_MINT) {
            return { hasRoute: true, bestPair: 'USDC→SOL→USDC' };
        }

        try {
            // Valor de teste: mínimo operacional do token
            const amountRaw = Math.floor(token.minOperational * 10 ** token.decimals);

            const url = `${this.jupiterBaseUrl}/quote` +
                `?inputMint=${token.mint}` +
                `&outputMint=${USDC_MINT}` +
                `&amount=${amountRaw}` +
                `&slippageBps=50` +
                `&onlyDirectRoutes=false`;

            const resp = await axios.get(url, { timeout: 8000 });
            const quote = resp.data;

            if (quote && quote.outAmount && parseInt(quote.outAmount) > 0) {
                return {
                    hasRoute: true,
                    bestPair: `${token.symbol}→USDC (${quote.routePlan?.length ?? 1} passo(s))`,
                };
            }
            return { hasRoute: false };
        } catch {
            // Rate limit ou sem rota — não bloqueia
            return { hasRoute: false };
        }
    }

    // ─── Estimativa USD Simples ───────────────────────────────────────────────

    /**
     * Estimativa básica de valor em USD (sem oracle externo para não adicionar dependências)
     */
    private estimateUSD(symbol: string, balance: number): number {
        const prices: Record<string, number> = {
            SOL:  145,
            USDC: 1,
            USDT: 1,
            DAI:  1,
            BONK: 0.000025,
            JUP:  0.5,
            RAY:  1.8,
            MSOL: 150,
        };
        return balance * (prices[symbol] ?? 0);
    }
}
