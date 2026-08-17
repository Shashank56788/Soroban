#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short, token, Address, Env, Symbol, String,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidAmount = 1,
    InvalidDeadline = 2,
    CampaignExpired = 3,
    CampaignNotExpired = 4,
    GoalNotMet = 5,
    GoalMet = 6,
    AlreadyClaimed = 7,
    NoPledge = 8,
    CampaignNotFound = 9,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Campaign {
    pub id: u64,
    pub creator: Address,
    pub recipient: Address,
    pub token: Address,
    pub target_amount: i128,
    pub pledged_amount: i128,
    pub deadline: u64,
    pub title: String,
    pub description: String,
    pub claimed: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    CampaignCount,
    Campaign(u64),
    Pledge(u64, Address),
}

const COUNTER_KEY: Symbol = symbol_short!("COUNT");

#[contract]
pub struct CrowdfundingContract;

#[contractimpl]
impl CrowdfundingContract {
    /// Create a new crowdfunding campaign.
    pub fn create_campaign(
        env: Env,
        creator: Address,
        recipient: Address,
        token: Address,
        target_amount: i128,
        deadline: u64,
        title: String,
        description: String,
    ) -> Result<u64, Error> {
        creator.require_auth();

        if target_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let current_time = env.ledger().timestamp();
        if deadline <= current_time {
            return Err(Error::InvalidDeadline);
        }

        let mut count: u64 = env.storage().instance().get(&COUNTER_KEY).unwrap_or(0);
        count += 1;
        env.storage().instance().set(&COUNTER_KEY, &count);

        let campaign = Campaign {
            id: count,
            creator: creator.clone(),
            recipient,
            token,
            target_amount,
            pledged_amount: 0,
            deadline,
            title,
            description,
            claimed: false,
        };

        let campaign_key = DataKey::Campaign(count);
        env.storage().persistent().set(&campaign_key, &campaign);

        // Emit Campaign Created Event
        env.events().publish(
            (symbol_short!("created"), count),
            (creator, target_amount, deadline),
        );

        Ok(count)
    }

    /// Back a campaign by pledging tokens.
    pub fn pledge(env: Env, backer: Address, campaign_id: u64, amount: i128) -> Result<(), Error> {
        backer.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let campaign_key = DataKey::Campaign(campaign_id);
        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&campaign_key)
            .ok_or(Error::CampaignNotFound)?;

        if env.ledger().timestamp() >= campaign.deadline {
            return Err(Error::CampaignExpired);
        }

        // Transfer tokens from backer to this contract
        let token_client = token::Client::new(&env, &campaign.token);
        token_client.transfer(&backer, &env.current_contract_address(), &amount);

        // Update individual backer pledge
        let pledge_key = DataKey::Pledge(campaign_id, backer.clone());
        let current_pledge: i128 = env.storage().persistent().get(&pledge_key).unwrap_or(0);
        env.storage().persistent().set(&pledge_key, &(current_pledge + amount));

        // Update campaign total pledged
        campaign.pledged_amount += amount;
        env.storage().persistent().set(&campaign_key, &campaign);

        // Emit Pledge Event
        env.events().publish(
            (symbol_short!("pledge"), campaign_id),
            (backer, amount),
        );

        Ok(())
    }

    /// Claim the funds if the deadline is met and the target is reached.
    pub fn claim_funds(env: Env, recipient: Address, campaign_id: u64) -> Result<(), Error> {
        recipient.require_auth();

        let campaign_key = DataKey::Campaign(campaign_id);
        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&campaign_key)
            .ok_or(Error::CampaignNotFound)?;

        if campaign.recipient != recipient {
            return Err(Error::GoalNotMet); // unauthorized recipient error can reuse this or return an auth error
        }

        if env.ledger().timestamp() < campaign.deadline {
            return Err(Error::CampaignNotExpired);
        }

        if campaign.pledged_amount < campaign.target_amount {
            return Err(Error::GoalNotMet);
        }

        if campaign.claimed {
            return Err(Error::AlreadyClaimed);
        }

        // Transfer funds to recipient
        let token_client = token::Client::new(&env, &campaign.token);
        token_client.transfer(&env.current_contract_address(), &campaign.recipient, &campaign.pledged_amount);

        campaign.claimed = true;
        env.storage().persistent().set(&campaign_key, &campaign);

        // Emit Claim Event
        env.events().publish(
            (symbol_short!("claim"), campaign_id),
            (campaign.recipient.clone(), campaign.pledged_amount),
        );

        Ok(())
    }

    /// Reclaim a refund if the campaign failed to meet its goal and deadline is passed.
    pub fn refund(env: Env, backer: Address, campaign_id: u64) -> Result<(), Error> {
        backer.require_auth();

        let campaign_key = DataKey::Campaign(campaign_id);
        let campaign: Campaign = env
            .storage()
            .persistent()
            .get(&campaign_key)
            .ok_or(Error::CampaignNotFound)?;

        if env.ledger().timestamp() < campaign.deadline {
            return Err(Error::CampaignNotExpired);
        }

        if campaign.pledged_amount >= campaign.target_amount {
            return Err(Error::GoalMet);
        }

        let pledge_key = DataKey::Pledge(campaign_id, backer.clone());
        let pledge_amount: i128 = env
            .storage()
            .persistent()
            .get(&pledge_key)
            .ok_or(Error::NoPledge)?;

        if pledge_amount <= 0 {
            return Err(Error::NoPledge);
        }

        // Transfer back the pledged tokens
        let token_client = token::Client::new(&env, &campaign.token);
        token_client.transfer(&env.current_contract_address(), &backer, &pledge_amount);

        // Reset pledge
        env.storage().persistent().remove(&pledge_key);

        // Emit Refund Event
        env.events().publish(
            (symbol_short!("refund"), campaign_id),
            (backer, pledge_amount),
        );

        Ok(())
    }

    /// Read campaign details.
    pub fn get_campaign(env: Env, campaign_id: u64) -> Option<Campaign> {
        let campaign_key = DataKey::Campaign(campaign_id);
        env.storage().persistent().get(&campaign_key)
    }

    /// Read pledge amount for a backer.
    pub fn get_pledge(env: Env, campaign_id: u64, backer: Address) -> i128 {
        let pledge_key = DataKey::Pledge(campaign_id, backer);
        env.storage().persistent().get(&pledge_key).unwrap_or(0)
    }

    /// Read the total number of campaigns.
    pub fn get_campaign_count(env: Env) -> u64 {
        env.storage().instance().get(&COUNTER_KEY).unwrap_or(0)
    }
}

mod test;
