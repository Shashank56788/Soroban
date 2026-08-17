#![cfg(test)]

use crate::{CrowdfundingContract, CrowdfundingContractClient, Error};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

fn setup_test_env<'a>(env: &Env) -> (
    CrowdfundingContractClient<'a>,
    Address, // creator
    Address, // recipient
    Address, // token
    token::Client<'a>,
    token::StellarAssetClient<'a>,
) {
    env.mock_all_auths();

    // Generate addresses
    let creator = Address::generate(env);
    let recipient = Address::generate(env);
    let token_admin = Address::generate(env);

    // Register Crowdfunding contract
    let contract_id = env.register_contract(None, CrowdfundingContract);
    let client = CrowdfundingContractClient::new(env, &contract_id);

    // Register Stellar Asset Contract (Token)
    let token_address = env.register_stellar_asset_contract(token_admin.clone());
    let token_client = token::Client::new(env, &token_address);
    let token_admin_client = token::StellarAssetClient::new(env, &token_address);

    (client, creator, recipient, token_address, token_client, token_admin_client)
}

#[test]
fn test_create_campaign() {
    let env = Env::default();
    let (client, creator, recipient, token_address, _, _) = setup_test_env(&env);

    let title = String::from_str(&env, "Save the Forests");
    let description = String::from_str(&env, "Planting trees globally.");
    let target_amount = 1000i128;
    let deadline = env.ledger().timestamp() + 3600; // 1 hour from now

    let campaign_id = client.create_campaign(
        &creator,
        &recipient,
        &token_address,
        &target_amount,
        &deadline,
        &title,
        &description,
    );

    assert_eq!(campaign_id, 1);

    let campaign = client.get_campaign(&campaign_id).unwrap();
    assert_eq!(campaign.id, 1);
    assert_eq!(campaign.creator, creator);
    assert_eq!(campaign.recipient, recipient);
    assert_eq!(campaign.target_amount, target_amount);
    assert_eq!(campaign.pledged_amount, 0);
    assert_eq!(campaign.deadline, deadline);
    assert_eq!(campaign.title, title);
    assert_eq!(campaign.description, description);
    assert_eq!(campaign.claimed, false);
}

#[test]
fn test_happy_path_claim() {
    let env = Env::default();
    let (client, creator, recipient, token_address, token_client, token_admin_client) = setup_test_env(&env);

    let title = String::from_str(&env, "Open Source Fund");
    let description = String::from_str(&env, "Funding core developers.");
    let target = 500i128;
    let deadline = env.ledger().timestamp() + 3600;

    let campaign_id = client.create_campaign(
        &creator,
        &recipient,
        &token_address,
        &target,
        &deadline,
        &title,
        &description,
    );

    let backer_1 = Address::generate(&env);
    let backer_2 = Address::generate(&env);

    token_admin_client.mint(&backer_1, &300);
    token_admin_client.mint(&backer_2, &250);

    // Pledge funds
    client.pledge(&backer_1, &campaign_id, &300);
    client.pledge(&backer_2, &campaign_id, &200);

    let campaign = client.get_campaign(&campaign_id).unwrap();
    assert_eq!(campaign.pledged_amount, 500);
    assert_eq!(client.get_pledge(&campaign_id, &backer_1), 300);
    assert_eq!(client.get_pledge(&campaign_id, &backer_2), 200);

    // Contract should hold 500 tokens
    assert_eq!(token_client.balance(&client.address), 500);

    // Try claiming early (should fail)
    let err = client.try_claim_funds(&recipient, &campaign_id).unwrap_err();
    assert_eq!(err, Ok(Error::CampaignNotExpired));

    // Travel in time past deadline
    env.ledger().set_timestamp(deadline + 10);

    // Claim funds
    client.claim_funds(&recipient, &campaign_id);

    // Verify balances
    assert_eq!(token_client.balance(&recipient), 500);
    assert_eq!(token_client.balance(&client.address), 0);

    let campaign_after = client.get_campaign(&campaign_id).unwrap();
    assert!(campaign_after.claimed);

    // Double claim should fail
    let err_double = client.try_claim_funds(&recipient, &campaign_id).unwrap_err();
    assert_eq!(err_double, Ok(Error::AlreadyClaimed));
}

#[test]
fn test_campaign_failed_refund() {
    let env = Env::default();
    let (client, creator, recipient, token_address, token_client, token_admin_client) = setup_test_env(&env);

    let target = 1000i128;
    let deadline = env.ledger().timestamp() + 3600;

    let campaign_id = client.create_campaign(
        &creator,
        &recipient,
        &token_address,
        &target,
        &deadline,
        &String::from_str(&env, "Failed Campaign"),
        &String::from_str(&env, "Will not meet goal"),
    );

    let backer = Address::generate(&env);
    token_admin_client.mint(&backer, &500);

    // Pledge 400 (target is 1000)
    client.pledge(&backer, &campaign_id, &400);

    // Try refunding early (should fail)
    let err_early = client.try_refund(&backer, &campaign_id).unwrap_err();
    assert_eq!(err_early, Ok(Error::CampaignNotExpired));

    // Move past deadline
    env.ledger().set_timestamp(deadline + 1);

    // Try claiming funds (should fail because goal not met)
    let err_claim = client.try_claim_funds(&recipient, &campaign_id).unwrap_err();
    assert_eq!(err_claim, Ok(Error::GoalNotMet));

    // Refund
    client.refund(&backer, &campaign_id);

    // Verify balances
    assert_eq!(token_client.balance(&backer), 500); // 100 left + 400 refund
    assert_eq!(token_client.balance(&client.address), 0);
    assert_eq!(client.get_pledge(&campaign_id, &backer), 0);
}

#[test]
fn test_validation_errors() {
    let env = Env::default();
    let (client, creator, recipient, token_address, _, _) = setup_test_env(&env);

    let title = String::from_str(&env, "Validation Test");
    let description = String::from_str(&env, "Testing validations.");
    let deadline = env.ledger().timestamp() + 3600;

    // Zero or negative target
    let err_target = client.try_create_campaign(
        &creator,
        &recipient,
        &token_address,
        &0,
        &deadline,
        &title,
        &description,
    ).unwrap_err();
    assert_eq!(err_target, Ok(Error::InvalidAmount));

    // Invalid deadline
    let err_deadline = client.try_create_campaign(
        &creator,
        &recipient,
        &token_address,
        &100,
        &env.ledger().timestamp(),
        &title,
        &description,
    ).unwrap_err();
    assert_eq!(err_deadline, Ok(Error::InvalidDeadline));

    // Pledge invalid campaign
    let backer = Address::generate(&env);
    let err_no_campaign = client.try_pledge(&backer, &999, &100).unwrap_err();
    assert_eq!(err_no_campaign, Ok(Error::CampaignNotFound));
}
