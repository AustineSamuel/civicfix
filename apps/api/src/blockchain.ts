import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Get,
  Query,
  ServiceUnavailableException
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BlockchainStatus, Prisma, Role } from "@prisma/client";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddress,
  keccak256,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { PrismaService } from "./prisma.service.js";
import { AuthenticatedUser, CurrentUser, Public, Roles } from "./security.js";
import { canonicalJson, sha256 } from "./integrity.js";

const anchorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CASE") }),
  z.object({ type: z.literal("STATUS"), historyId: z.string().min(1) }),
  z.object({ type: z.literal("EVIDENCE"), evidenceId: z.string().min(1) })
]);

const registryAbi = [
  {
    type: "function",
    name: "cases",
    stateMutability: "view",
    inputs: [{ name: "caseId", type: "bytes32" }],
    outputs: [{ name: "registered", type: "bool" }]
  },
  {
    type: "function",
    name: "initialCommitments",
    stateMutability: "view",
    inputs: [{ name: "caseId", type: "bytes32" }],
    outputs: [{ name: "initialCommitment", type: "bytes32" }]
  },
  {
    type: "function",
    name: "evidenceCommitments",
    stateMutability: "view",
    inputs: [{ name: "caseId", type: "bytes32" }, { name: "evidenceId", type: "bytes32" }],
    outputs: [{ name: "commitment", type: "bytes32" }]
  },
  {
    type: "function",
    name: "statusCommitments",
    stateMutability: "view",
    inputs: [{ name: "caseId", type: "bytes32" }, { name: "eventHash", type: "bytes32" }],
    outputs: [{ name: "commitment", type: "bytes32" }]
  },
  {
    type: "function",
    name: "registerCase",
    stateMutability: "nonpayable",
    inputs: [{ name: "caseId", type: "bytes32" }, { name: "initialCommitment", type: "bytes32" }],
    outputs: []
  },
  {
    type: "function",
    name: "commitEvidence",
    stateMutability: "nonpayable",
    inputs: [{ name: "caseId", type: "bytes32" }, { name: "evidenceId", type: "bytes32" }, { name: "commitment", type: "bytes32" }],
    outputs: []
  },
  {
    type: "function",
    name: "commitStatus",
    stateMutability: "nonpayable",
    inputs: [{ name: "caseId", type: "bytes32" }, { name: "auditEventHash", type: "bytes32" }],
    outputs: []
  }
] as const;

type AnchorType = "CASE" | "STATUS" | "EVIDENCE";
const unfinalizedStatuses: BlockchainStatus[] = [
  BlockchainStatus.PENDING,
  BlockchainStatus.SUBMITTING
];
type ChainClients = {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  address: Address;
  chainId: number;
};

type StoredAnchor = {
  id: string;
  reportId: string;
  caseIdentifier: string;
  commitment: string;
  evidenceIdentifier: string | null;
  chainId: number;
  contractAddress: string;
  transactionType: string;
  transactionHash: string | null;
  processingStatus: BlockchainStatus;
  retryCount: number;
  lastError: string | null;
  blockNumber: bigint | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  idempotencyKey: string;
};

@Injectable()
export class BlockchainService {
  constructor(private readonly prisma: PrismaService) {}

  async anchor(reportId: string, input: unknown, actor: AuthenticatedUser) {
    const targetInput = anchorSchema.parse(input);
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException("Report not found.");

    const caseIdentifier = keccak256(toBytes(report.publicCaseNumber));
    const type: AnchorType = targetInput.type;
    let evidenceIdentifier: Hex | null = null;
    let commitment: Hex;

    if (targetInput.type === "CASE") {
      commitment = `0x${sha256(canonicalJson({
        caseNumber: report.publicCaseNumber,
        title: report.title,
        description: report.description,
        category: report.category,
        approximateLocation: report.approximateLocation,
        submittedAt: report.createdAt.toISOString(),
        recordVersion: 1
      }))}`;
    } else if (targetInput.type === "STATUS") {
      const history = await this.prisma.statusHistory.findFirst({
        where: { id: targetInput.historyId, reportId },
        select: { auditEventHash: true }
      });
      if (!history) throw new NotFoundException("Status history entry not found.");
      commitment = `0x${history.auditEventHash}`;
    } else {
      const evidence = await this.prisma.evidence.findFirst({
        where: { id: targetInput.evidenceId, reportId },
        select: { id: true, manifestHash: true }
      });
      if (!evidence) throw new NotFoundException("Evidence not found.");
      evidenceIdentifier = keccak256(toBytes(evidence.id));
      commitment = `0x${evidence.manifestHash}`;
    }

    const chain = this.chainClients(true);
    const chainId = await this.getConfiguredChainId(chain.publicClient, chain.chainId);
    const idempotencyKey = sha256(canonicalJson({
      reportId,
      type,
      caseIdentifier,
      evidenceIdentifier,
      commitment
    }));

    let transaction = await this.prisma.blockchainTransaction.findUnique({
      where: { idempotencyKey }
    }) as StoredAnchor | null;
    let created = false;
    if (!transaction) {
      try {
        transaction = await this.prisma.$transaction(async (database) => {
          const createdRecord = await database.blockchainTransaction.create({
            data: {
              reportId,
              caseIdentifier,
              commitment,
              evidenceIdentifier,
              chainId,
              contractAddress: chain.address,
              transactionType: type,
              idempotencyKey,
              processingStatus: BlockchainStatus.PENDING
            }
          });
          await database.auditEvent.create({
            data: {
              actorId: actor.sub,
              action: "BLOCKCHAIN_ANCHOR_REQUESTED",
              subjectId: reportId,
              metadata: { transactionId: createdRecord.id, type, commitment }
            }
          });
          return createdRecord;
        }) as StoredAnchor;
        created = true;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
        transaction = await this.prisma.blockchainTransaction.findUnique({
          where: { idempotencyKey }
        }) as StoredAnchor | null;
        if (!transaction) throw error;
      }
    }

    if (transaction.processingStatus === BlockchainStatus.VERIFIED ||
      transaction.processingStatus === BlockchainStatus.CONFIRMED) {
      return this.publicTransaction(transaction);
    }
    if (!created) {
      if (transaction.processingStatus === BlockchainStatus.PENDING && transaction.transactionHash) {
        return this.confirm(transaction, chain);
      }
      if (transaction.processingStatus === BlockchainStatus.PENDING &&
        !transaction.transactionHash && Date.now() - transaction.updatedAt.getTime() > 120_000) {
        return this.submit(transaction, chain);
      }
      return this.publicTransaction(transaction);
    }
    return this.submit(transaction, chain);
  }

  async retry(transactionId: string, actor: AuthenticatedUser) {
    const existing = await this.prisma.blockchainTransaction.findUnique({
      where: { id: transactionId }
    }) as StoredAnchor | null;
    if (!existing) throw new NotFoundException("Blockchain transaction not found.");
    const staleUnsubmitted = !existing.transactionHash &&
      unfinalizedStatuses.includes(existing.processingStatus) &&
      Date.now() - existing.updatedAt.getTime() > 120_000;
    if (existing.processingStatus !== BlockchainStatus.FAILED && !staleUnsubmitted) {
      throw new ConflictException("Only failed or stale unsubmitted transactions can be retried.");
    }

    const chain = this.chainClients(!existing.transactionHash);
    const chainId = await this.getConfiguredChainId(chain.publicClient, chain.chainId);
    if (existing.chainId !== chainId || existing.contractAddress.toLowerCase() !== chain.address.toLowerCase()) {
      throw new ConflictException("The configured chain or registry differs from the original transaction.");
    }
    if (existing.transactionHash) {
      await this.prisma.auditEvent.create({
        data: {
          actorId: actor.sub,
          action: "BLOCKCHAIN_TRANSACTION_RETRY",
          subjectId: transactionId,
          metadata: { retryType: "CONFIRM_EXISTING_TRANSACTION" }
        }
      });
      return this.confirm(existing, chain);
    }
    const claimed = await this.prisma.blockchainTransaction.updateMany({
      where: {
        id: transactionId,
        processingStatus: staleUnsubmitted ? existing.processingStatus : BlockchainStatus.FAILED
      },
      data: { processingStatus: BlockchainStatus.PENDING, lastError: null }
    });
    if (claimed.count !== 1) {
      const current = await this.prisma.blockchainTransaction.findUnique({ where: { id: transactionId } });
      if (!current) throw new NotFoundException("Blockchain transaction not found.");
      return this.publicTransaction(current as StoredAnchor);
    }
    const pending = await this.prisma.blockchainTransaction.findUnique({
      where: { id: transactionId }
    }) as StoredAnchor | null;
    if (!pending) throw new NotFoundException("Blockchain transaction not found.");
    await this.prisma.auditEvent.create({
      data: {
        actorId: actor.sub,
        action: "BLOCKCHAIN_TRANSACTION_RETRY",
        subjectId: transactionId,
        metadata: { retryType: "RESUBMIT" }
      }
    });
    return this.submit(pending, chain);
  }

  async forReport(reportId: string) {
    await this.ensureReport(reportId);
    const transactions = await this.prisma.blockchainTransaction.findMany({
      where: { reportId },
      orderBy: { createdAt: "asc" }
    });
    return transactions.map((item) => this.publicTransaction(item as StoredAnchor));
  }

  async integrity(reportId: string) {
    await this.ensureReport(reportId);
    const records = await this.prisma.blockchainTransaction.findMany({
      where: { reportId },
      orderBy: { createdAt: "asc" }
    }) as StoredAnchor[];
    if (!process.env.REGISTRY_CONTRACT_ADDRESS || !process.env.RPC_URL) {
      return { status: "NOT_CONFIGURED", verified: false, checks: [] };
    }

    const chain = this.chainClients(false);
    await this.getConfiguredChainId(chain.publicClient, chain.chainId);
    const checks = await Promise.all(records.map(async (record) => {
      const actual = await this.readCommitment(chain.publicClient, chain.address, record);
      return {
        transactionId: record.id,
        type: record.transactionType,
        processingStatus: record.processingStatus,
        expectedCommitment: record.commitment,
        actualCommitment: actual,
        verified: actual.toLowerCase() === record.commitment.toLowerCase()
      };
    }));
    const hasMismatch = checks.some(({ verified, processingStatus }) =>
      !verified && !unfinalizedStatuses.includes(processingStatus));
    const hasPending = checks.some(({ processingStatus }) =>
      unfinalizedStatuses.includes(processingStatus));
    return {
      status: checks.length === 0
        ? "NO_COMMITMENTS"
        : hasMismatch
          ? "MISMATCH"
          : hasPending
            ? "PENDING"
            : checks.every(({ verified }) => verified) ? "VERIFIED" : "FAILED",
      verified: checks.length > 0 && checks.every(({ verified }) => verified),
      checks
    };
  }

  async adminList(query: unknown) {
    const { page, pageSize } = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50)
    }).parse(query);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.blockchainTransaction.findMany({
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.blockchainTransaction.count()
    ]);
    return {
      data: data.map((record) => ({
        ...this.publicTransaction(record as StoredAnchor),
        lastError: record.lastError
      })),
      page,
      pageSize,
      total
    };
  }

  private async ensureReport(reportId: string): Promise<void> {
    if (!await this.prisma.report.findUnique({ where: { id: reportId }, select: { id: true } })) {
      throw new NotFoundException("Report not found.");
    }
  }

  private chainClients(writeRequired: boolean): ChainClients {
    const rawAddress = process.env.REGISTRY_CONTRACT_ADDRESS;
    const rpcUrl = process.env.RPC_URL;
    const chainId = Number(process.env.CHAIN_ID ?? "31337");
    if (!rawAddress || !rpcUrl || !isAddress(rawAddress) ||
      !Number.isSafeInteger(chainId) || chainId < 1) {
      throw new ServiceUnavailableException("Blockchain registry configuration is incomplete.");
    }
    const chain = defineChain({
      id: chainId,
      name: "CivicFix EVM",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } }
    });
    const transport = http(rpcUrl, { retryCount: 0, timeout: 10_000 });
    const publicClient = createPublicClient({ chain, transport });

    if (!writeRequired) {
      return { publicClient, address: rawAddress, chainId };
    }
    const privateKey = process.env.ANCHOR_PRIVATE_KEY;
    if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      throw new ServiceUnavailableException("A dedicated test-network anchor key is not configured.");
    }
    const account = privateKeyToAccount(privateKey as Hex);
    const walletClient = createWalletClient({ account, chain, transport });
    return { publicClient, walletClient, address: rawAddress, chainId };
  }

  private async getConfiguredChainId(client: PublicClient, expected: number): Promise<number> {
    let actual: number;
    try {
      actual = await client.getChainId();
    } catch {
      throw new ServiceUnavailableException("Blockchain RPC is unavailable.");
    }
    if (actual !== expected) {
      throw new ServiceUnavailableException("The configured RPC is connected to a different chain.");
    }
    return actual;
  }

  private async submit(record: StoredAnchor, chain: ChainClients) {
    const claimed = await this.prisma.blockchainTransaction.updateMany({
      where: { id: record.id, processingStatus: BlockchainStatus.PENDING },
      data: { processingStatus: BlockchainStatus.SUBMITTING, lastError: null }
    });
    if (claimed.count !== 1) {
      const current = await this.prisma.blockchainTransaction.findUnique({ where: { id: record.id } });
      if (!current) throw new NotFoundException("Blockchain transaction not found.");
      return this.publicTransaction(current as StoredAnchor);
    }

    try {
      const current = await this.readCommitment(chain.publicClient, chain.address, record);
      if (current !== `0x${"0".repeat(64)}`) {
        if (current.toLowerCase() !== record.commitment.toLowerCase()) {
          throw new ConflictException("A different commitment already exists for this identifier.");
        }
        const verified = await this.markVerified(record, null, null);
        return this.publicTransaction(verified);
      }

      const wallet = chain.walletClient;
      if (!wallet) throw new ServiceUnavailableException("Blockchain write client is unavailable.");
      const hash = await this.writeCommitment(wallet, chain.address, record);
      await this.prisma.blockchainTransaction.update({
        where: { id: record.id },
        data: { processingStatus: BlockchainStatus.PENDING, transactionHash: hash }
      });
      const receipt = await chain.publicClient.waitForTransactionReceipt({
        hash: hash as Hex,
        confirmations: 1,
        timeout: 60_000
      });
      if (receipt.status !== "success") {
        throw new Error("Transaction receipt indicates a reverted transaction.");
      }
      const actual = await this.readCommitment(chain.publicClient, chain.address, record);
      if (actual.toLowerCase() !== record.commitment.toLowerCase()) {
        throw new Error("Confirmed transaction state does not match the stored commitment.");
      }
      const verified = await this.markVerified(record, hash, receipt.blockNumber);
      return this.publicTransaction(verified);
    } catch (error) {
      await this.prisma.blockchainTransaction.update({
        where: { id: record.id },
        data: {
          processingStatus: BlockchainStatus.FAILED,
          lastError: `${error instanceof Error ? error.name : "UnknownError"}: blockchain operation failed`,
          retryCount: { increment: 1 }
        }
      });
      if (error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException(
        "Blockchain submission failed. The PostgreSQL report remains saved; an administrator may retry."
      );
    }
  }

  private async confirm(record: StoredAnchor, chain: ChainClients) {
    if (!record.transactionHash) return this.publicTransaction(record);
    try {
      const receipt = await chain.publicClient.waitForTransactionReceipt({
        hash: record.transactionHash as Hex,
        confirmations: 1,
        timeout: 60_000
      });
      if (receipt.status !== "success") throw new Error("Transaction reverted.");
      const actual = await this.readCommitment(chain.publicClient, chain.address, record);
      if (actual.toLowerCase() !== record.commitment.toLowerCase()) {
        throw new Error("On-chain commitment does not match.");
      }
      const verified = await this.markVerified(record, record.transactionHash, receipt.blockNumber);
      return this.publicTransaction(verified);
    } catch {
      throw new ServiceUnavailableException("Blockchain transaction confirmation is still unavailable.");
    }
  }

  private async markVerified(
    record: StoredAnchor,
    transactionHash: string | null,
    blockNumber: bigint | null
  ): Promise<StoredAnchor> {
    return this.prisma.$transaction(async (database) => {
      const verified = await database.blockchainTransaction.update({
        where: { id: record.id },
        data: {
          processingStatus: BlockchainStatus.VERIFIED,
          transactionHash,
          blockNumber,
          confirmedAt: new Date(),
          lastError: null
        }
      }) as StoredAnchor;
      if (record.transactionType === "STATUS") {
        await database.statusHistory.updateMany({
          where: { reportId: record.reportId, auditEventHash: record.commitment.slice(2) },
          data: {
            blockchainStatus: BlockchainStatus.VERIFIED,
            transactionHash
          }
        });
      }
      return verified;
    });
  }

  private async readCommitment(client: PublicClient, address: Address, record: StoredAnchor): Promise<Hex> {
    const caseIdentifier = record.caseIdentifier as Hex;
    if (record.transactionType === "CASE") {
      return client.readContract({
        address,
        abi: registryAbi,
        functionName: "initialCommitments",
        args: [caseIdentifier]
      });
    }
    if (record.transactionType === "STATUS") {
      return client.readContract({
        address,
        abi: registryAbi,
        functionName: "statusCommitments",
        args: [caseIdentifier, record.commitment as Hex]
      });
    }
    if (record.transactionType === "EVIDENCE" && record.evidenceIdentifier) {
      return client.readContract({
        address,
        abi: registryAbi,
        functionName: "evidenceCommitments",
        args: [caseIdentifier, record.evidenceIdentifier as Hex]
      });
    }
    throw new BadRequestException("Stored blockchain transaction type is invalid.");
  }

  private async writeCommitment(client: WalletClient, address: Address, record: StoredAnchor): Promise<Hex> {
    const account = client.account;
    if (!account) throw new ServiceUnavailableException("Blockchain signing account is unavailable.");
    const caseIdentifier = record.caseIdentifier as Hex;
    if (record.transactionType === "CASE") {
      return client.writeContract({
        account,
        address,
        abi: registryAbi,
        functionName: "registerCase",
        args: [caseIdentifier, record.commitment as Hex],
        chain: undefined
      });
    }
    if (record.transactionType === "STATUS") {
      return client.writeContract({
        account,
        address,
        abi: registryAbi,
        functionName: "commitStatus",
        args: [caseIdentifier, record.commitment as Hex],
        chain: undefined
      });
    }
    if (record.transactionType === "EVIDENCE" && record.evidenceIdentifier) {
      return client.writeContract({
        account,
        address,
        abi: registryAbi,
        functionName: "commitEvidence",
        args: [caseIdentifier, record.evidenceIdentifier as Hex, record.commitment as Hex],
        chain: undefined
      });
    }
    throw new BadRequestException("Stored blockchain transaction type is invalid.");
  }

  private publicTransaction(record: StoredAnchor) {
    return {
      id: record.id,
      reportId: record.reportId,
      transactionType: record.transactionType,
      processingStatus: record.processingStatus,
      chainId: record.chainId,
      contractAddress: record.contractAddress,
      caseIdentifier: record.caseIdentifier,
      commitment: record.commitment,
      transactionHash: record.transactionHash,
      blockNumber: record.blockNumber?.toString() ?? null,
      confirmedAt: record.confirmedAt,
      retryCount: record.retryCount,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }
}

@ApiTags("blockchain")
@Controller("reports")
export class BlockchainController {
  constructor(private readonly blockchain: BlockchainService) {}

  @Get(":reportId/blockchain")
  @Public()
  get(@Param("reportId") reportId: string) {
    return this.blockchain.forReport(reportId);
  }

  @Get(":reportId/integrity")
  @Public()
  integrity(@Param("reportId") reportId: string) {
    return this.blockchain.integrity(reportId);
  }

  @Post(":reportId/anchor")
  @ApiBearerAuth()
  @Roles(Role.ADMINISTRATOR)
  anchor(
    @Param("reportId") reportId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.blockchain.anchor(reportId, body, user);
  }
}

@ApiTags("blockchain administration")
@ApiBearerAuth()
@Roles(Role.ADMINISTRATOR)
@Controller("admin/blockchain-transactions")
export class BlockchainAdminController {
  constructor(private readonly blockchain: BlockchainService) {}

  @Get()
  list(@Query() query: unknown) {
    return this.blockchain.adminList(query);
  }

  @Post(":transactionId/retry")
  retry(
    @Param("transactionId") transactionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.blockchain.retry(transactionId, user);
  }
}
