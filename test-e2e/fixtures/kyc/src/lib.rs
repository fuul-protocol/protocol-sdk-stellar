#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

#[contract]
pub struct KycFixture;

#[contractimpl]
impl KycFixture {
    pub fn __constructor(e: Env, admin: Address) {
        e.storage().instance().set(&symbol_short!("admin"), &admin);
    }
    pub fn set_registered(e: Env, user: Address, registered: bool) {
        let admin: Address = e.storage().instance().get(&symbol_short!("admin")).unwrap();
        admin.require_auth();
        e.storage().persistent().set(&user, &registered);
    }
    pub fn is_user_kyc_registered(e: Env, user: Address) -> bool {
        e.storage().persistent().get(&user).unwrap_or(false)
    }
}
