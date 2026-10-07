import { xdr } from "@stellar/stellar-sdk";
import type { Api } from "@stellar/stellar-sdk/rpc";

/** Independent, deliberately small limits. These are test inputs, never network defaults. */
export function resourceConfigFixture(): Api.GetLedgerEntriesResponse {
  const i64 = (value: number) => BigInt(value);
  const settings = [
    xdr.ConfigSettingEntry.configSettingContractComputeV0(new xdr.ConfigSettingContractComputeV0({
      ledgerMaxInstructions: i64(200_000), txMaxInstructions: i64(100_000), feeRatePerInstructionsIncrement: i64(1), txMemoryLimit: 40_000_000,
    })),
    xdr.ConfigSettingEntry.configSettingContractLedgerCostV0(new xdr.ConfigSettingContractLedgerCostV0({
      ledgerMaxDiskReadEntries: 200, ledgerMaxDiskReadBytes: 20_000, ledgerMaxWriteLedgerEntries: 200, ledgerMaxWriteBytes: 20_000,
      txMaxDiskReadEntries: 40, txMaxDiskReadBytes: 10_000, txMaxWriteLedgerEntries: 30, txMaxWriteBytes: 10_000,
      feeDiskReadLedgerEntry: i64(1), feeWriteLedgerEntry: i64(1), feeDiskRead1Kb: i64(1), sorobanStateTargetSizeBytes: i64(1),
      rentFee1KbSorobanStateSizeLow: i64(1), rentFee1KbSorobanStateSizeHigh: i64(1), sorobanStateRentFeeGrowthFactor: 1,
    })),
    xdr.ConfigSettingEntry.configSettingContractLedgerCostExtV0(new xdr.ConfigSettingContractLedgerCostExtV0({ txMaxFootprintEntries: 60, feeWrite1Kb: i64(1) })),
    xdr.ConfigSettingEntry.configSettingContractBandwidthV0(new xdr.ConfigSettingContractBandwidthV0({ ledgerMaxTxsSizeBytes: 20_000, txMaxSizeBytes: 10_000, feeTxSize1Kb: i64(1) })),
    xdr.ConfigSettingEntry.configSettingContractDataKeySizeBytes(250),
  ];
  return { latestLedger: 100, entries: settings.map(setting => ({ lastModifiedLedgerSeq: 90,
    key: xdr.LedgerKey.configSetting(new xdr.LedgerKeyConfigSetting({ configSettingId: xdr.ConfigSettingId[setting.type] })),
    val: xdr.LedgerEntryData.configSetting(setting),
  })) };
}
