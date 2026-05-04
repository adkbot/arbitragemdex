import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { ArbitrageBot } from './bot.js';
import { UserModule } from './modules/users.js';
import { generateNonce, verifyPhantomSignature, issueJWT, verifyJWT, consumeNonce } from './modules/auth.js';
import { requireAuth } from './modules/auth.middleware.js';
import { WalletScanner } from './modules/wallet.scanner.js';

// ─── Configuração ─────────────────────────────────────────────────────────────

dotenv.config();

const bot = new ArbitrageBot();
bot.start();
const userModule = new UserModule();
const walletScanner = new WalletScanner();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

// ─── Rotas de View ────────────────────────────────────────────────────────────

// Rota do Usuário (Pública)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'user.html'));
});

// Silenciar erro de favicon
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Rota Admin (protegida por token de query)
app.get('/admin', (req, res) => {
    const token = req.query.token;
    if (token !== ADMIN_TOKEN) return res.status(404).send('Página não encontrada.');
    res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// ─── API Auth — Web3 Signature Login ─────────────────────────────────────────

/**
 * [PASSO 1] Frontend pede um nonce para a carteira
 * GET /api/auth/nonce?publicKey=<base58>
 */
app.get('/api/auth/nonce', (req, res) => {
    const { publicKey } = req.query;
    if (!publicKey || typeof publicKey !== 'string') {
        return res.status(400).json({ error: 'publicKey é obrigatório.' });
    }
    if (publicKey.length < 32 || publicKey.length > 44) {
        return res.status(400).json({ error: 'Endereço Solana inválido.' });
    }

    const { nonce, message } = generateNonce(publicKey);
    res.json({ nonce, message });
});

/**
 * [PASSO 2] Frontend envia a assinatura — backend verifica e retorna JWT
 * POST /api/auth/verify
 * Body: { publicKey, signature, walletType, message }
 */
app.post('/api/auth/verify', (req, res) => {
    const { publicKey, signature, walletType, message } = req.body;

    if (!publicKey || !walletType) {
        return res.status(400).json({ error: 'publicKey e walletType são obrigatórios.' });
    }

    // MetaMask: não verifica assinatura ed25519 (usa Ethereum secp256k1)
    // A verificação foi feita no frontend. Aqui apenas emite o token.
    if (walletType === 'metamask' || walletType === 'manual') {
        const token = issueJWT(publicKey, walletType);
        consumeNonce(publicKey);
        return res.json({ success: true, token, walletType, publicKey });
    }

    // Phantom / Solflare: verificação criptográfica ed25519 no backend
    if (!signature || !message) {
        return res.status(400).json({ error: 'signature e message são obrigatórios para Phantom/Solflare.' });
    }

    const valid = verifyPhantomSignature(publicKey, message, signature);
    if (!valid) {
        return res.status(401).json({ error: 'Assinatura inválida. Autenticação negada.' });
    }

    consumeNonce(publicKey); // Previne replay attacks
    const token = issueJWT(publicKey, walletType);
    res.json({ success: true, token, walletType, publicKey });
});

/**
 * [OPCIONAL] Verifica se o token de sessão atual ainda é válido
 * GET /api/auth/session
 */
app.get('/api/auth/session', requireAuth, (req, res) => {
    res.json({
        valid: true,
        publicKey: req.user!.publicKey,
        walletType: req.user!.walletType,
    });
});

// ─── API Scan de Carteira (REQUER AUTH) ──────────────────────────────────────

/**
 * Escaneamento automático da carteira: saldos + rotas Jupiter
 * GET /api/wallet/scan
 * Header: Authorization: Bearer <token>
 */
app.get('/api/wallet/scan', requireAuth, async (req, res) => {
    const publicKey = req.user!.publicKey;
    try {
        const scanResult = await walletScanner.scanWallet(publicKey);
        res.json(scanResult);
    } catch (err) {
        res.status(500).json({
            error: 'Erro ao escanear carteira.',
            detail: err instanceof Error ? err.message : String(err),
        });
    }
});

// ─── API Pública — Stats Gerais ───────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
    const stats = bot.getStats();
    res.json({
        totalPool: (parseFloat(stats.balances.sol) * 145 + parseFloat(stats.balances.usdc)).toFixed(2),
        balances: stats.balances,
        users: stats.userCount,
        txToday: stats.txToday,
        minProfit: process.env.MIN_PROFIT_USDC + ' USDC',
        status: stats.status,
        wallet: stats.wallet,
    });
});

// ─── API Usuário (REQUER AUTH) ────────────────────────────────────────────────

app.get('/api/user/balance', requireAuth, async (req, res) => {
    const publicKey = req.user!.publicKey;
    try {
        const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
        const rpc = process.env.SOLANA_ENDPOINT || 'https://api.mainnet-beta.solana.com';
        const conn = new Connection(rpc, 'confirmed');
        const pk = new PublicKey(publicKey);

        const lamports = await conn.getBalance(pk);
        const sol = lamports / LAMPORTS_PER_SOL;

        const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        let usdc = 0;
        try {
            const accounts = await conn.getTokenAccountsByOwner(pk, { mint: USDC_MINT });
            if (accounts.value.length > 0) {
                const bal = await conn.getTokenAccountBalance(accounts.value[0].pubkey);
                usdc = bal.value.uiAmount || 0;
            }
        } catch (_) { /* sem conta USDC */ }

        const hasBalance = sol > 0.001 || usdc > 1;
        res.json({ sol: sol.toFixed(4), usdc: usdc.toFixed(2), hasBalance });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar saldo.', sol: '0.0000', usdc: '0.00', hasBalance: false });
    }
});

app.get('/api/user/network', requireAuth, (req, res) => {
    const publicKey = req.user!.publicKey;
    try {
        const counts = userModule.getNetworkStats(publicKey);
        res.json({
            levels: [
                { name: 'Nível 1', pct: 5, count: counts[0] },
                { name: 'Nível 2', pct: 4, count: counts[1] },
                { name: 'Nível 3', pct: 3, count: counts[2] },
                { name: 'Nível 4', pct: 2, count: counts[3] },
                { name: 'Nível 5', pct: 1, count: counts[4] },
            ],
        });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar rede.' });
    }
});

// ─── Registro / Vinculação de Carteira ────────────────────────────────────────

app.post('/api/register', requireAuth, (req, res) => {
    const publicKey = req.user!.publicKey;
    const { referralBy } = req.body;
    try {
        userModule.saveUser({
            id: Date.now().toString(),
            publicKey,
            encryptedPrivateKey: '',
            referralBy: referralBy || null,
            isActive: true,
        });
        res.json({ success: true, message: 'Carteira registrada! Bot monitorando...' });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao registrar carteira.' });
    }
});

app.post('/api/link-wallet', requireAuth, (req, res) => {
    const publicKey = req.user!.publicKey;
    const { privateKey, referralBy } = req.body;
    if (!privateKey) {
        return res.status(400).json({ error: 'Chave privada é obrigatória para vincular.' });
    }
    try {
        userModule.saveUser({
            id: Date.now().toString(),
            publicKey,
            encryptedPrivateKey: privateKey,
            referralBy: referralBy || null,
            isActive: true,
        });
        res.json({ success: true, message: 'Carteira vinculada e bot iniciado!' });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao salvar carteira.' });
    }
});

// ─── WebSocket — Logs em Tempo Real ──────────────────────────────────────────

io.on('connection', (socket) => {
    console.log('Novo cliente conectado ao painel admin');
    const logHandler = (logData: any) => socket.emit('log', logData);
    bot.on('log', logHandler);
    socket.on('disconnect', () => bot.removeListener('log', logHandler));
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🛡️  ADKbot V5 - ENGINE INICIADA`);
    console.log(`📡 Servidor rodando na porta ${PORT}`);
    console.log(`🔐 Admin: http://localhost:${PORT}/admin?token=${ADMIN_TOKEN}`);
    console.log(`🔑 Auth: POST /api/auth/verify | GET /api/auth/nonce`);
    console.log(`🔎 Scan: GET /api/wallet/scan (requer JWT)`);
    console.log(`=========================================`);
});
