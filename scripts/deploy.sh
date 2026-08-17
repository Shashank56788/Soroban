#!/bin/bash

# Deployment Guide and Script for Stellar/Soroban Testnet (Unix/macOS/WSL)

set -e

echo -e "\033[0;36m==============================================\033[0m"
echo -e "\033[0;36m  SorobandFund Contract Deployment Helper     \033[0m"
echo -e "\033[0;36m==============================================\033[0m"

# Step 1: Configure Network
echo -e "\n\033[0;33m[1/5] Configuring Stellar Testnet in CLI...\033[0m"
stellar network add \
  --global \
  --rpc-url "https://soroban-testnet.stellar.org:443" \
  --network-passphrase "Test SDF Network ; September 2015" \
  testnet

# Step 2: Create Deployer Identity
echo -e "\n\033[0;33m[2/5] Creating deployer account 'deployer'...\033[0m"
stellar keys generate --global deployer --network testnet

# Get public key
pubKey=$(stellar keys address deployer)
echo -e "\033[0;32mDeployer Address: $pubKey\033[0m"
echo -e "\033[0;32mAccount automatically funded on Stellar Testnet!\033[0m"

# Step 3: Build Contract
echo -e "\n\033[0;33m[3/5] Compiling contract to WebAssembly...\033[0m"
cargo build --target wasm32-unknown-unknown --release

# Step 4: Deploy Contract
echo -e "\n\033[0;33m[4/5] Deploying contract Wasm to Testnet...\033[0m"
contractId=$(stellar contract deploy \
  --wasm "target/wasm32-unknown-unknown/release/soroband_fund.wasm" \
  --source-account deployer \
  --network testnet)

echo -e "\n\033[0;32m==============================================\033[0m"
echo -e "\033[0;32mCONTRACT DEPLOYED SUCCESSFULLY!\033[0m"
echo -e "\033[0;33mContract ID: $contractId\033[0m"
echo -e "\033[0;32m==============================================\033[0m"

# Step 5: Save Info
echo -e "\n\033[0;33m[5/5] Saving contract address to frontend environment...\033[0m"
echo "VITE_CONTRACT_ID=$contractId" > frontend/.env
echo -e "\033[0;32mSaved Contract ID to frontend/.env!\033[0m"
echo -e "\n\033[0;36mNow you can start the frontend: cd frontend && npm run dev\033[0m"
