// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMarketLifecycleFacet {
    // Initializer
    function initializeLifecycle(uint256 settlementTimestamp, address parent) external;
    function initializeLifecycleWithMode(uint256 settlementTimestamp, address parent, bool devMode) external;
    function initializeLifecycleWithTiming(
        uint256 settlementTimestamp, address parent, bool devMode,
        uint256 rolloverLeadSeconds, uint256 challengeWindowSeconds
    ) external;

    // Keeper signals
    function startRolloverWindow() external;
    function startSettlementChallengeWindow() external;
    function syncLifecycle() external returns (uint8 previousState, uint8 newState);
    function linkRolloverChild(address childMarket, uint256 childSettlementTimestamp) external;
    function linkRolloverChildByAddress(address childMarket, uint256 childSettlementTimestamp) external returns (bool);
    function setParent(address parentMarket) external;
    function registerParentFromRollover(address parentMarket) external returns (bool);

    // Permissionless settlement
    function proposeSettlementPrice(uint256 price) external;

    // Testing controls
    function enableTestingMode(bool enabled) external;
    function setLeadTimes(uint256 rolloverLeadSeconds, uint256 challengeLeadSeconds) external;
    function setSettlementTimestamp(uint256 newSettlementTimestamp) external;
    function forceStartRolloverWindow() external;
    function forceStartSettlementChallengeWindow() external;

    // Debug emitters (testing mode)
    function debugEmitRolloverWindowStarted(address market, uint256 rolloverWindowStart) external;
    function debugEmitSettlementChallengeWindowStarted(address market, uint256 challengeWindowStart) external;
    function debugEmitRolloverCreated(address parentMarket, address childMarket, uint256 childSettlementTimestamp) external;

    // Views
    function getSettlementTimestamp() external view returns (uint256);
    function getRolloverWindowStart() external view returns (uint256);
    function getChallengeWindowStart() external view returns (uint256);
    function getChallengeWindowEnd() external view returns (uint256);
    function isInRolloverWindow() external view returns (bool);
    function isInSettlementChallengeWindow() external view returns (bool);
    function getLifecycleState() external view returns (uint8);
    function isLifecycleDevMode() external view returns (bool);
    function getMarketLineage() external view returns (address parent, address child);
    function getProposedSettlementPrice() external view returns (uint256 price, address proposer, bool proposed);
    function getRolloverLead() external view returns (uint256);
    function getChallengeWindowDuration() external view returns (uint256);
}


