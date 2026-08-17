import {
  rpc,
  TransactionBuilder,
  Networks,
  Contract,
  nativeToScVal,
  scValToNative,
  Account,
  xdr,
  Address,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";

// Default contract ID (can be overridden by environment variables)
export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || "CAC3P5X22L5Z4ZJWWJXZL4A3HJKZLSYZXZJKZLSYZXZJKZLSYZXZJKZL"; 

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const server = new rpc.Server(RPC_URL);

// Native XLM Token Address on Stellar Testnet
export const NATIVE_TOKEN_ADDRESS = "CDLZFC3SYJYDZT7K67VZ75HPJGWK373F64VCH2CBG7K32CQQNGVZC5F4";

export interface Campaign {
  id: number;
  creator: string;
  recipient: string;
  token: string;
  target_amount: string; // large number as string
  pledged_amount: string; // large number as string
  deadline: number; // Unix timestamp
  title: string;
  description: string;
  claimed: boolean;
}

/**
 * Get total number of campaigns created
 */
export async function getCampaignCount(): Promise<number> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const tx = new TransactionBuilder(
      new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHB", "0"),
      { fee: "100", networkPassphrase: NETWORK_PASSPHRASE }
    )
      .addOperation(contract.call("get_campaign_count"))
      .setTimeout(30)
      .build();

    const response = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(response) && response.result) {
      return Number(scValToNative(response.result.retval));
    }
    return 0;
  } catch (error) {
    console.error("Error fetching campaign count:", error);
    return 0;
  }
}

/**
 * Get details of a single campaign
 */
export async function getCampaign(campaignId: number): Promise<Campaign | null> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const idSc = nativeToScVal(BigInt(campaignId), { type: "u64" });
    const tx = new TransactionBuilder(
      new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHB", "0"),
      { fee: "100", networkPassphrase: NETWORK_PASSPHRASE }
    )
      .addOperation(contract.call("get_campaign", idSc))
      .setTimeout(30)
      .build();

    const response = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(response) && response.result) {
      const value = response.result.retval;
      const rawCampaign = scValToNative(value);
      if (!rawCampaign) return null;

      // Map raw JS object fields returned by SDK
      return {
        id: Number(rawCampaign.id),
        creator: rawCampaign.creator,
        recipient: rawCampaign.recipient,
        token: rawCampaign.token,
        target_amount: rawCampaign.target_amount.toString(),
        pledged_amount: rawCampaign.pledged_amount.toString(),
        deadline: Number(rawCampaign.deadline),
        title: rawCampaign.title.toString(),
        description: rawCampaign.description.toString(),
        claimed: rawCampaign.claimed,
      };
    }
    return null;
  } catch (error) {
    console.error(`Error fetching campaign ${campaignId}:`, error);
    return null;
  }
}

/**
 * Get a user's pledge amount for a campaign
 */
export async function getPledge(campaignId: number, backerAddress: string): Promise<string> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const idSc = nativeToScVal(BigInt(campaignId), { type: "u64" });
    const backerSc = nativeToScVal(Address.fromString(backerAddress));
    const tx = new TransactionBuilder(
      new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHB", "0"),
      { fee: "100", networkPassphrase: NETWORK_PASSPHRASE }
    )
      .addOperation(contract.call("get_pledge", idSc, backerSc))
      .setTimeout(30)
      .build();

    const response = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(response) && response.result) {
      return scValToNative(response.result.retval).toString();
    }
    return "0";
  } catch (error) {
    console.error("Error fetching pledge:", error);
    return "0";
  }
}

/**
 * Helper to build, simulate, sign and submit a transaction
 */
async function buildAndSubmitTx(
  userAddress: string,
  contractCallOp: xdr.Operation
): Promise<string> {
  // 1. Fetch source account details
  const accountResponse = await server.getAccount(userAddress);
  const account = new Account(userAddress, accountResponse.sequenceNumber());

  // 2. Build preliminary transaction
  const initialTx = new TransactionBuilder(account, {
    fee: "10000", // Max fee buffer
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contractCallOp)
    .setTimeout(120)
    .build();

  // 3. Simulate to calculate resources
  const simulated = await server.simulateTransaction(initialTx);
  if (!rpc.Api.isSimulationSuccess(simulated)) {
    console.error("Simulation failed:", simulated);
    throw new Error("Transaction simulation failed. Check inputs or authorization.");
  }

  // 4. Assemble resources
  const assembledTx = rpc.assembleTransaction(initialTx, simulated) as any;

  // 5. Sign with Freighter wallet
  const signResult = await signTransaction(assembledTx.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  if (signResult.error) {
    throw new Error(`Signing failed: ${signResult.error}`);
  }

  const signedTx = TransactionBuilder.fromXDR(signResult.signedTxXdr, NETWORK_PASSPHRASE) as any;

  // 6. Submit transaction
  const submitResponse = await server.sendTransaction(signedTx);
  if (submitResponse.status !== "PENDING") {
    throw new Error(`Transaction submission rejected: ${submitResponse.status}`);
  }

  // 7. Poll for final ledger result
  let txResult = await server.getTransaction(submitResponse.hash);
  let retries = 30;
  while (retries > 0) {
    const txStatus = txResult.status as string;
    if (txStatus !== "NOT_FOUND" && txStatus !== "PENDING") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    txResult = await server.getTransaction(submitResponse.hash);
    retries--;
  }

  const finalStatus = txResult.status as string;
  if (finalStatus === "SUCCESS") {
    return submitResponse.hash;
  } else {
    console.error("Transaction failed result:", txResult);
    throw new Error("Transaction failed on-chain.");
  }
}

/**
 * Create a new campaign
 */
export async function createCampaign(
  creatorAddress: string,
  recipientAddress: string,
  tokenAddress: string,
  targetAmount: number,
  deadlineSecs: number,
  title: string,
  description: string
): Promise<string> {
  const contract = new Contract(CONTRACT_ID);
  
  // Format inputs to ScVals
  const creatorSc = nativeToScVal(Address.fromString(creatorAddress));
  const recipientSc = nativeToScVal(Address.fromString(recipientAddress));
  const tokenSc = nativeToScVal(Address.fromString(tokenAddress));
  // Convert standard decimals (Stellar token standard decimals are 7)
  const targetRaw = BigInt(Math.floor(targetAmount * 10000000));
  const targetSc = nativeToScVal(targetRaw, { type: "i128" });
  const deadlineSc = nativeToScVal(BigInt(deadlineSecs), { type: "u64" });
  const titleSc = nativeToScVal(title, { type: "string" });
  const descSc = nativeToScVal(description, { type: "string" });

  const op = contract.call(
    "create_campaign",
    creatorSc,
    recipientSc,
    tokenSc,
    targetSc,
    deadlineSc,
    titleSc,
    descSc
  );

  return buildAndSubmitTx(creatorAddress, op);
}

/**
 * Pledge tokens to a campaign
 */
export async function pledgeCampaign(
  backerAddress: string,
  campaignId: number,
  amount: number
): Promise<string> {
  const contract = new Contract(CONTRACT_ID);
  
  const backerSc = nativeToScVal(Address.fromString(backerAddress));
  const idSc = nativeToScVal(BigInt(campaignId), { type: "u64" });
  const amountRaw = BigInt(Math.floor(amount * 10000000)); // 7 decimals
  const amountSc = nativeToScVal(amountRaw, { type: "i128" });

  const op = contract.call("pledge", backerSc, idSc, amountSc);
  return buildAndSubmitTx(backerAddress, op);
}

/**
 * Claim funds for a campaign (recipient only)
 */
export async function claimCampaign(
  recipientAddress: string,
  campaignId: number
): Promise<string> {
  const contract = new Contract(CONTRACT_ID);
  
  const recipientSc = nativeToScVal(Address.fromString(recipientAddress));
  const idSc = nativeToScVal(BigInt(campaignId), { type: "u64" });

  const op = contract.call("claim_funds", recipientSc, idSc);
  return buildAndSubmitTx(recipientAddress, op);
}

/**
 * Reclaim a refund from a failed campaign
 */
export async function refundCampaign(
  backerAddress: string,
  campaignId: number
): Promise<string> {
  const contract = new Contract(CONTRACT_ID);
  
  const backerSc = nativeToScVal(Address.fromString(backerAddress));
  const idSc = nativeToScVal(BigInt(campaignId), { type: "u64" });

  const op = contract.call("refund", backerSc, idSc);
  return buildAndSubmitTx(backerAddress, op);
}
