#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Symbol};

#[contract]
pub struct StorageFixture;

#[contractimpl]
impl StorageFixture {
    pub fn __constructor(e: Env, admin: Address) {
        e.storage().instance().set(&symbol_short!("admin"), &admin);
    }

    pub fn set_entries(e: Env, key: Symbol, temporary: u32, persistent: u32) {
        let admin: Address = e.storage().instance().get(&symbol_short!("admin")).unwrap();
        admin.require_auth();
        e.storage().temporary().set(&key, &temporary);
        e.storage().persistent().set(&key, &persistent);
    }

    pub fn get_temporary(e: Env, key: Symbol) -> Option<u32> {
        e.storage().temporary().get(&key)
    }

    pub fn get_persistent(e: Env, key: Symbol) -> Option<u32> {
        e.storage().persistent().get(&key)
    }
}
