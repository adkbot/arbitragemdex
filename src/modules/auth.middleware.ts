/**
 * Middleware de Autenticação — Pilar 1: Responsabilidade Única
 * Responsabilidade: Proteger rotas que exigem carteira autenticada via JWT
 */
import { Request, Response, NextFunction } from 'express';
import { verifyJWT, AuthPayload } from './auth.js';

// Extende o tipo Request para incluir dados do usuário autenticado
declare global {
    namespace Express {
        interface Request {
            user?: AuthPayload;
        }
    }
}

/**
 * Middleware: Exige JWT válido no header Authorization: Bearer <token>
 * ou no cookie adkbot_session, ou na query ?token=
 * Em caso de falha, retorna 401 com mensagem clara.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers['authorization'];
    const queryToken = req.query.token as string | undefined;

    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
    } else if (queryToken) {
        token = queryToken;
    }

    if (!token) {
        res.status(401).json({
            error: 'Autenticação necessária.',
            code: 'NO_TOKEN',
            hint: 'Conecte sua carteira e assine a mensagem de autenticação.'
        });
        return;
    }

    const payload = verifyJWT(token);
    if (!payload) {
        res.status(401).json({
            error: 'Sessão expirada ou inválida.',
            code: 'INVALID_TOKEN',
            hint: 'Reconecte sua carteira para obter uma nova sessão.'
        });
        return;
    }

    req.user = payload;
    next();
}
