# Deployment Guide and Script for Stellar/Soroban Testnet (Windows)

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  SorobandFund Contract Deployment Helper     " -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# Step 1: Configure Network
Write-Host "`n[1/5] Configuring Stellar Testnet in CLI..." -ForegroundColor Yellow
stellar network add `
  --global `
  --rpc-url "https://soroban-testnet.stellar.org:443" `
  --network-passphrase "Test SDF Network ; September 2015" `
  testnet

# Step 2: Create Deployer Identity
Write-Host "`n[2/5] Creating deployer account 'deployer'..." -ForegroundColor Yellow
stellar keys generate --global deployer --network testnet

# Get public key
$pubKey = stellar keys address deployer
Write-Host "Deployer Address: $pubKey" -ForegroundColor Green
Write-Host "Account automatically funded on Stellar Testnet!" -ForegroundColor Green

# Step 3: Build Contract
Write-Host "`n[3/5] Compiling contract to WebAssembly..." -ForegroundColor Yellow
$env:CARGO_TARGET_DIR="C:\Soroban_Build"
cargo build --target wasm32-unknown-unknown --release

# Step 4: Deploy Contract
Write-Host "`n[4/5] Deploying contract Wasm to Testnet..." -ForegroundColor Yellow
$contractId = stellar contract deploy `
  --wasm "C:\Soroban_Build\wasm32-unknown-unknown\release\soroband_fund.wasm" `
  --source-account deployer `
  --network testnet

Write-Host "`n==============================================" -ForegroundColor Green
Write-Host "CONTRACT DEPLOYED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "Contract ID: $contractId" -ForegroundColor Yellow
Write-Host "==============================================" -ForegroundColor Green

# Step 5: Save Info
Write-Host "`n[5/5] Saving contract address to frontend environment..." -ForegroundColor Yellow
$envFile = "frontend/.env"
"VITE_CONTRACT_ID=$contractId" | Out-File -FilePath $envFile -Encoding utf8
Write-Host "Saved Contract ID to $envFile!" -ForegroundColor Green
Write-Host "`nNow you can start the frontend: cd frontend; npm run dev" -ForegroundColor Cyan
