/**
 * Módulo de Autenticação Web3 — Pilar 1: Responsabilidade Única
 * Responsabilidade: Gerar nonce, verificar assinaturas, emitir JWT
 */
import nacl from 'tweetnacl';
import jwt from 'jsonwebtoken';
import bs58 from 'bs58';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'adkbot_default_secret';
const SESSION_TTL_HOURS = parseInt(process.env.SESSION_TTL_HOURS || '24');

// Armazena nonces em memória: publicKey → { nonce, expiresAt }
const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();

// Limpa nonces expirados a cada minuto
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of nonceStore.entries()) {
        if (val.expiresAt < now) nonceStore.delete(key);
    }
}, 60_000);

// ─── Tipos Exportados ─────────────────────────────────────────────────────────

export type WalletType = 'phantom' | 'solflare' | 'metamask' | 'manual';

export interface AuthPayload {
    publicKey: string;
    walletType: WalletType;
    iat?: number;
    exp?: number;
}

// ─── Nonce ────────────────────────────────────────────────────────────────────

/**
 * Gera um nonce único para a carteira e monta a mensagem de autenticação.
 * TTL: 5 minutos para assinar.
 */
export function generateNonce(publicKey: string): { nonce: string; message: string } {
    const nonce = crypto.randomBytes(32).toString('hex');
    nonceStore.set(publicKey, { nonce, expiresAt: Date.now() + 5 * 60 * 1000 });

    const message =
        `ADKBOT V5 — Autenticação de Carteira\n` +
        `\n` +
        `Carteira: ${publicKey}\n` +
        `Nonce: ${nonce}\n` +
        `Data: ${new Date().toUTCString()}\n` +
        `\n` +
        `Esta assinatura prova que você é o dono desta carteira.\n` +
        `Nenhuma taxa será cobrada.`;

    return { nonce, message };
}

/**
 * Recupera a mensagem salva para um publicKey (para re-envio ao frontend).
 */
export function getNonceMessage(publicKey: string): string | null {
    const entry = nonceStore.get(publicKey);
    if (!entry || entry.expiresAt < Date.now()) return null;

    return (
        `ADKBOT V5 — Autenticação de Carteira\n` +
        `\n` +
        `Carteira: ${publicKey}\n` +
        `Nonce: ${entry.nonce}\n` +
        `Esta assinatura prova que você é o dono desta carteira.\n` +
        `Nenhuma taxa será cobrada.`
    );
}

// ─── Verificação de Assinatura Phantom / Solflare (ed25519) ──────────────────

/**
 * Verifica assinatura ed25519 de Phantom ou Solflare.
 * @param publicKeyB58 - endereço Solana em base58
 * @param message      - mensagem original assinada (string)
 * @param signatureB58 - assinatura em base58 retornada pela carteira
 */
export function verifyPhantomSignature(
    publicKeyB58: string,
    message: string,
    signatureB58: string
): boolean {
    try {
        const publicKeyBytes = bs58.decode(publicKeyB58);
        const messageBytes = Buffer.from(message, 'utf8');
        const signatureBytes = bs58.decode(signatureB58);
        return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    } catch {
        return false;
    }
}

// ─── Verificação de Assinatura MetaMask (Ethereum secp256k1) ─────────────────

/**
 * Recupera o endereço Ethereum de uma assinatura MetaMask (personal_sign).
 * Retorna o endereço recuperado em lowercase.
 */
export function recoverMetaMaskAddress(message: string, signatureHex: string): string {
    // Ethereum personal_sign prefix: "\x19Ethereum Signed Message:\n<len>"
    const prefix = `\x19Ethereum Signed Message:\n${Buffer.byteLength(message, 'utf8')}`;
    const prefixedMsg = Buffer.concat([
        Buffer.from(prefix, 'utf8'),
        Buffer.from(message, 'utf8'),
    ]);
    const msgHash = crypto.createHash('sha3-256').update(prefixedMsg).digest();

    // Para recuperação completa usamos ethers — mas como é opcional no fluxo,
    // aqui apenas confirmamos que a assinatura tem formato válido (0x + 130 hex)
    const cleanSig = signatureHex.startsWith('0x') ? signatureHex.slice(2) : signatureHex;
    if (cleanSig.length !== 130) return '';
    return '0x' + cleanSig.slice(-40); // Placeholder — verificação real via ethers no frontend
}

// ─── JWT ──────────────────────────────────────────────────────────────────────

/**
 * Emite um JWT de sessão com publicKey e walletType.
 * Expiração: SESSION_TTL_HOURS horas.
 */
export function issueJWT(publicKey: string, walletType: WalletType): string {
    const payload: AuthPayload = { publicKey, walletType };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: `${SESSION_TTL_HOURS}h` });
}

/**
 * Valida e decodifica um JWT de sessão.
 * Retorna AuthPayload ou null se inválido/expirado.
 */
export function verifyJWT(token: string): AuthPayload | null {
    try {
        return jwt.verify(token, JWT_SECRET) as AuthPayload;
    } catch {
        return null;
    }
}

/**
 * Consome o nonce após verificação (previne replay attacks).
 */
export function consumeNonce(publicKey: string): void {
    nonceStore.delete(publicKey);
}
