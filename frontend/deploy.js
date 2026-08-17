import * as StellarSDK from "@stellar/stellar-sdk";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const server = new StellarSDK.rpc.Server("https://soroban-testnet.stellar.org");
const networkPassphrase = StellarSDK.Networks.TESTNET;

async function deploy() {
  console.log("Generating deployer keypair...");
  const keypair = StellarSDK.Keypair.random();
  const publicKey = keypair.publicKey();
  console.log(`Deployer Address: ${publicKey}`);

  console.log("Funding deployer account via Friendbot...");
  const friendbotUrl = `https://friendbot.stellar.org?addr=${publicKey}`;
  const response = await fetch(friendbotUrl);
  if (!response.ok) {
    throw new Error(`Friendbot funding failed: ${response.statusText}`);
  }
  console.log("Account funded successfully!");

  // Wait a moment for the account to exist on ledger
  await new Promise((resolve) => setTimeout(resolve, 3000));

  let account = await server.getAccount(publicKey);

  // Absolute path to the compiled Wasm contract
  const wasmPath = "C:/Soroban_Build/wasm32-unknown-unknown/release/soroband_fund.wasm";
  console.log(`Reading Wasm file from: ${wasmPath}`);
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Wasm file not found at ${wasmPath}. Please compile the contract first.`);
  }
  const wasmBytes = fs.readFileSync(wasmPath);

  // 1. Upload WASM bytecode
  console.log("Building upload WASM transaction...");
  const uploadOp = StellarSDK.Operation.uploadContractWasm({ wasm: wasmBytes });
  let tx = new StellarSDK.TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase,
  })
    .addOperation(uploadOp)
    .setTimeout(120)
    .build();

  console.log("Simulating upload transaction...");
  let simulated = await server.simulateTransaction(tx);
  if (!StellarSDK.rpc.Api.isSimulationSuccess(simulated)) {
    throw new Error(`Upload simulation failed: ${JSON.stringify(simulated)}`);
  }

  tx = StellarSDK.rpc.assembleTransaction(tx, simulated).build();
  tx.sign(keypair);
  
  console.log("Submitting upload transaction...");
  let submitResponse = await server.sendTransaction(tx);
  if (submitResponse.status !== "PENDING") {
    throw new Error(`Upload submission failed: ${submitResponse.status}`);
  }

  console.log("Waiting for upload transaction to complete...");
  let txResult = await server.getTransaction(submitResponse.hash);
  while (txResult.status === "NOT_FOUND" || txResult.status === "PENDING") {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    txResult = await server.getTransaction(submitResponse.hash);
  }

  const finalStatusUpload = txResult.status;
  if (finalStatusUpload !== "SUCCESS") {
    throw new Error("Upload transaction failed on-chain.");
  }

  // Get Wasm Hash from simulation result
  if (!simulated.result) {
    throw new Error("Simulation result value missing.");
  }
  const wasmHashBuffer = StellarSDK.scValToNative(simulated.result.retval);
  const wasmHashHex = wasmHashBuffer.toString("hex");
  console.log(`Wasm uploaded successfully. Wasm Hash: ${wasmHashHex}`);

  // Fetch updated account sequence
  account = await server.getAccount(publicKey);

  // 2. Deploy Contract Instance
  console.log("Building deploy contract instance transaction...");
  const salt = crypto.randomBytes(32);
  const deployOp = StellarSDK.Operation.createCustomContract({
    wasmHash: wasmHashBuffer,
    address: new StellarSDK.Address(publicKey),
    salt,
  });

  tx = new StellarSDK.TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase,
  })
    .addOperation(deployOp)
    .setTimeout(120)
    .build();

  console.log("Simulating deploy transaction...");
  simulated = await server.simulateTransaction(tx);
  if (!StellarSDK.rpc.Api.isSimulationSuccess(simulated)) {
    throw new Error(`Deploy simulation failed: ${JSON.stringify(simulated)}`);
  }

  tx = StellarSDK.rpc.assembleTransaction(tx, simulated).build();
  tx.sign(keypair);

  console.log("Submitting deploy transaction...");
  submitResponse = await server.sendTransaction(tx);
  if (submitResponse.status !== "PENDING") {
    throw new Error(`Deploy submission failed: ${submitResponse.status}`);
  }

  console.log("Waiting for deploy transaction to complete...");
  txResult = await server.getTransaction(submitResponse.hash);
  while (txResult.status === "NOT_FOUND" || txResult.status === "PENDING") {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    txResult = await server.getTransaction(submitResponse.hash);
  }

  const finalStatusDeploy = txResult.status;
  if (finalStatusDeploy !== "SUCCESS") {
    throw new Error("Deploy transaction failed on-chain.");
  }

  if (!simulated.result) {
    throw new Error("Deploy simulation result value missing.");
  }
  const contractId = StellarSDK.scValToNative(simulated.result.retval);
  console.log(`\n==============================================`);
  console.log(`CONTRACT DEPLOYED SUCCESSFULLY!`);
  console.log(`Contract ID: ${contractId}`);
  console.log(`Transaction Hash: ${submitResponse.hash}`);
  console.log(`==============================================\n`);

  // Update .env file in frontend
  const envPath = path.resolve("./.env");
  console.log(`Saving Contract ID to ${envPath}...`);
  fs.writeFileSync(envPath, `VITE_CONTRACT_ID=${contractId}\n`);
  console.log("Done!");
}

deploy().catch((err) => {
  console.error("Deployment failed:", err);
});
