// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMarketLifecycleFacet {
    // Initializer
    function initializeLifecycle(uint256 settlementTimestamp, address parent) external;

    // Keeper signals
    function startRolloverWindow() external;
    function startSettlementChallengeWindow() external;
    function linkRolloverChild(address childMarket, uint256 childSettlementTimestamp) external;
    function setParent(address parentMarket) external;

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
    function isInRolloverWindow() external view returns (bool);
    function isInSettlementChallengeWindow() external view returns (bool);
    function getMarketLineage() external view returns (address parent, address child);
}


