# 🛡️ ADKBOT V5 — Engine de Arbitragem Multiativo (Solana)

Bem-vindo ao **ADKBOT V5**, uma plataforma profissional de arbitragem descentralizada na rede Solana. Este sistema foi projetado para operar 24/7, identificando oportunidades de lucro entre múltiplos ativos (USDC, USDT, SOL, etc.) utilizando a liquidez da **Jupiter API**.

---

## ✨ Principais Funcionalidades

- **🔐 Autenticação Web3 Segura:** Login via assinatura digital (Nonce + Signature) compatível com Phantom, Solflare e MetaMask.
- **🔎 Scanner de Carteira Automático:** Detecta ativos com saldo e verifica rotas de arbitragem disponíveis no Jupiter instantaneamente.
- **⚡ Motor de Execução de Alta Performance:** Loop de monitoramento em tempo real com execução automática de swaps lucrativos.
- **👥 Sistema de Afiliados (5 Níveis):** Distribuição automática de comissões (15% do lucro) para rede de indicações em 5 níveis.
- **📊 Painel Admin em Tempo Real:** Monitoramento de logs via WebSockets, gestão de usuários e estatísticas globais.
- **💰 Gestão de Ativos:** Suporte nativo para arbitragem de SOL, USDC, USDT, DAI, BONK, JUP, RAY e MSOL.

---

## 🚀 Como Iniciar

### Pré-requisitos
- [Node.js](https://nodejs.org/) (v18 ou superior)
- Uma chave privada Solana (para a carteira Admin/Taxas)
- Um endpoint RPC Solana (recomendado: Helius, QuickNode ou Triton)

### Instalação

1. Clone o repositório:
   ```bash
   git clone https://github.com/adkbot/arbitragemdex.git
   cd arbitragemdex
   ```

2. Instale as dependências:
   ```bash
   npm install
   ```

3. Configure as variáveis de ambiente:
   - Copie o arquivo `.env.example` para `.env`:
     ```bash
     cp .env.example .env
     ```
   - Preencha os campos no `.env` com suas chaves e endpoints.

4. Inicie o servidor em modo de desenvolvimento:
   ```bash
   npm run dev
   ```

---

## 🛠️ Arquitetura do Sistema

O projeto segue princípios de **Engenharia de Software Sênior** com foco em modularidade e responsabilidade única:

- `src/bot.ts`: Motor principal de monitoramento e lógica de arbitragem.
- `src/modules/auth.ts`: Gestão de segurança Web3 e JWT.
- `src/modules/wallet.scanner.ts`: Scanner de ativos via RPC e Jupiter.
- `src/modules/payments.ts`: Gestão de payouts e distribuição de comissões.
- `src/views/`: Interfaces front-end (Dashboard do Usuário e Painel Admin).

---

## 🛡️ Segurança e Privacidade

- **.env:** Suas chaves privadas e segredos de API **nunca** devem ser compartilhados ou enviados para repositórios públicos. O arquivo `.env` já está no `.gitignore`.
- **JWT:** As sessões de usuário são protegidas por tokens criptografados com expiração configurável.
- **Assinaturas:** O login não exige envio de chaves privadas pelo frontend; apenas uma assinatura digital que prova a posse da carteira.

---

## 💰 Distribuição de Lucros (Padrão)

- **65%**: Investidor (Dono da Carteira)
- **20%**: ADM (Taxas de Operação e Gás)
- **15%**: Rede de Afiliados (Distribuído entre os 5 níveis)

---

## 📞 Suporte e Comunidade

Desenvolvido por **ADKBOT. FINANCE**.

> **Aviso Legal:** Operações de arbitragem envolvem riscos. Certifique-se de testar suas configurações em Mainnet-Beta com valores pequenos antes de escalar.
