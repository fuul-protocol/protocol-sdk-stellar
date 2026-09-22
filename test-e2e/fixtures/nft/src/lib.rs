#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

#[contract]
pub struct NftFixture;

#[contractimpl]
impl NftFixture {
    pub fn __constructor(e: Env, admin: Address) {
        e.storage().instance().set(&symbol_short!("admin"), &admin);
    }
    pub fn mint(e: Env, to: Address, token_id: u32) {
        let admin: Address = e.storage().instance().get(&symbol_short!("admin")).unwrap();
        admin.require_auth();
        assert!(!e.storage().persistent().has(&token_id));
        e.storage().persistent().set(&token_id, &to);
    }
    pub fn owner(e: Env, token_id: u32) -> Address {
        e.storage().persistent().get(&token_id).unwrap()
    }
    pub fn transfer(e: Env, from: Address, to: Address, token_id: u32) {
        from.require_auth();
        assert_eq!(Self::owner(e.clone(), token_id), from);
        e.storage().persistent().set(&token_id, &to);
    }
}
