#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

#[contract]
pub struct MultiTokenFixture;

#[contractimpl]
impl MultiTokenFixture {
    pub fn __constructor(e: Env, admin: Address) {
        e.storage().instance().set(&symbol_short!("admin"), &admin);
    }
    pub fn mint(e: Env, to: Address, token_id: u32, amount: i128) {
        let admin: Address = e.storage().instance().get(&symbol_short!("admin")).unwrap();
        admin.require_auth();
        assert!(amount >= 0);
        let next = Self::balance(e.clone(), to.clone(), token_id)
            .checked_add(amount)
            .unwrap();
        e.storage().persistent().set(&(to, token_id), &next);
    }
    pub fn balance(e: Env, owner: Address, token_id: u32) -> i128 {
        e.storage()
            .persistent()
            .get(&(owner, token_id))
            .unwrap_or(0)
    }
    pub fn transfer(e: Env, from: Address, to: Address, token_id: u32, amount: i128) {
        from.require_auth();
        let balance = Self::balance(e.clone(), from.clone(), token_id);
        assert!(amount >= 0 && balance >= amount);
        e.storage()
            .persistent()
            .set(&(from, token_id), &(balance - amount));
        let next = Self::balance(e.clone(), to.clone(), token_id)
            .checked_add(amount)
            .unwrap();
        e.storage().persistent().set(&(to, token_id), &next);
    }
}
