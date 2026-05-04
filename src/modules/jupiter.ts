import { 
    createJupiterApiClient, 
    DefaultApi, 
    ResponseError, 
    QuoteGetRequest, 
    QuoteResponse,
    Instruction,
    AccountMeta,
    SwapRequest
} from '@jup-ag/api';
import { 
    Connection, 
    PublicKey, 
    TransactionInstruction, 
    AddressLookupTableAccount, 
    VersionedTransaction, 
    TransactionMessage,
    TransactionSignature
} from '@solana/web3.js';
import { BlockchainModule } from './blockchain.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export class JupiterModule {
    private jupiterApi: DefaultApi;
    private connection: Connection;

    constructor() {
        const baseUrl = process.env.JUPITER_ENDPOINT || "https://quote-api.jup.ag/v6";
        this.jupiterApi = createJupiterApiClient({ basePath: baseUrl });
        
        const blockchain = new BlockchainModule();
        this.connection = blockchain.getConnection();
    }

    /**
     * [Endpoint: /quote] Busca a melhor rota de troca
     */
    public async getQuote(request: QuoteGetRequest): Promise<QuoteResponse> {
        try {
            const quote = await this.jupiterApi.quoteGet(request);
            if (!quote) throw new Error("Nenhuma cotação encontrada");
            return quote;
        } catch (error) {
            await this.handleApiError(error, "Erro ao buscar cotação");
            throw error;
        }
    }

    /**
     * [Endpoint: /swap] Retorna a transação serializada para um swap
     */
    public async getSwapTransaction(quoteResponse: QuoteResponse, userPublicKey: string): Promise<string> {
        try {
            const swapRequest: SwapRequest = {
                quoteResponse,
                userPublicKey,
                // prioritizationFeeLamports removido por incompatibilidade com a versão atual do SDK
            };
            const response = await this.jupiterApi.swapPost({ swapRequest });
            return response.swapTransaction;
        } catch (error) {
            await this.handleApiError(error, "Erro ao gerar transação de swap");
            throw error;
        }
    }

    /**
     * [Endpoint: /swap-instructions] Retorna as instruções brutas de swap
     */
    public async getSwapInstructions(quoteResponse: QuoteResponse, userPublicKey: string) {
        try {
            return await this.jupiterApi.swapInstructionsPost({
                swapRequest: {
                    quoteResponse,
                    userPublicKey,
                    // prioritizationFeeLamports: 'auto'
                }
            });
        } catch (error) {
            await this.handleApiError(error, "Erro ao buscar instruções de swap");
            throw error;
        }
    }

    /**
     * [Endpoint: /program-id-to-label] Mapeamento de IDs de programa
     */
    public async getProgramIdToLabel() {
        try {
            return await this.jupiterApi.programIdToLabelGet();
        } catch (error) {
            await this.handleApiError(error, "Erro ao buscar rótulos de programas");
            throw error;
        }
    }

    /**
     * [Endpoint: /indexed-route-map] Mapa de rotas indexadas
     */
    public async getIndexedRouteMap() {
        try {
            // Tentando endpoint público alternativo para este método específico
            const response = await axios.get(`https://public.jupiterapi.com/indexed-route-map`);
            return response.data;
        } catch (error: any) {
            console.error(`[JUPITER] Erro ao buscar mapa de rotas:`, error.message);
            throw error;
        }
    }

    /**
     * Executa o swap real na rede Solana
     */
    public async executeSwap(quote: QuoteResponse): Promise<TransactionSignature> {
        const adminWallet = BlockchainModule.getAdminKeypair();
        const userPublicKey = adminWallet.publicKey.toBase58();

        console.log(`[JUPITER] Iniciando execução real de swap para ${userPublicKey}...`);

        try {
            const instructions = await this.getSwapInstructions(quote, userPublicKey);

            const txInstructions: TransactionInstruction[] = [
                ...instructions.computeBudgetInstructions.map(this.instructionDataToTransactionInstruction),
                ...instructions.setupInstructions.map(this.instructionDataToTransactionInstruction),
                this.instructionDataToTransactionInstruction(instructions.swapInstruction),
                this.instructionDataToTransactionInstruction(instructions.cleanupInstruction),
            ].filter((ix) => ix !== null) as TransactionInstruction[];

            const addressLookupTableAccounts = await this.getAdressLookupTableAccounts(
                instructions.addressLookupTableAddresses
            );

            const { blockhash } = await this.connection.getLatestBlockhash('confirmed');

            const messageV0 = new TransactionMessage({
                payerKey: adminWallet.publicKey,
                recentBlockhash: blockhash,
                instructions: txInstructions,
            }).compileToV0Message(addressLookupTableAccounts);

            const transaction = new VersionedTransaction(messageV0);
            transaction.sign([adminWallet]);

            const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
                skipPreflight: true,
                maxRetries: 2
            });

            console.log(`[JUPITER] Transação enviada: ${signature}`);
            
            const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
            if (confirmation.value.err) {
                throw new Error(`Falha na confirmação da transação: ${JSON.stringify(confirmation.value.err)}`);
            }

            return signature;
        } catch (error) {
            console.error("[JUPITER] Erro fatal na execução do swap:", error);
            throw error;
        }
    }

    // --- Helpers ---

    private instructionDataToTransactionInstruction(instruction: Instruction | undefined) {
        if (!instruction) return null;
        return new TransactionInstruction({
            programId: new PublicKey(instruction.programId),
            keys: instruction.accounts.map((key: AccountMeta) => ({
                pubkey: new PublicKey(key.pubkey),
                isSigner: key.isSigner,
                isWritable: key.isWritable,
            })),
            data: Buffer.from(instruction.data, "base64"),
        });
    }

    private async getAdressLookupTableAccounts(keys: string[]): Promise<AddressLookupTableAccount[]> {
        const addressLookupTableAccountInfos = await this.connection.getMultipleAccountsInfo(
            keys.map((key) => new PublicKey(key))
        );

        return addressLookupTableAccountInfos.reduce((acc, accountInfo, index) => {
            const addressLookupTableAddress = keys[index];
            if (accountInfo) {
                const addressLookupTableAccount = new AddressLookupTableAccount({
                    key: new PublicKey(addressLookupTableAddress),
                    state: AddressLookupTableAccount.deserialize(accountInfo.data),
                });
                acc.push(addressLookupTableAccount);
            }
            return acc;
        }, new Array<AddressLookupTableAccount>());
    }

    private async handleApiError(error: any, context: string) {
        if (error instanceof ResponseError) {
            console.error(`[JUPITER] ${context}:`, await error.response.json());
        } else {
            console.error(`[JUPITER] ${context}:`, error.message || error);
        }
    }
}

