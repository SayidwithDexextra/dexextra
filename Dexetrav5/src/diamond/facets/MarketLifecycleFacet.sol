// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/LibDiamond.sol";
import "../libraries/MarketLifecycleStorage.sol";

/**
 * @title MarketLifecycleFacet
 * @notice Adds one-year lifecycle metadata, rollover/challenge windows, and lineage pointers.
 *         All functions are additive and idempotent to minimize risk. Uses a dedicated
 *         diamond storage slot to avoid layout collisions.
 */
contract MarketLifecycleFacet {
    using MarketLifecycleStorage for MarketLifecycleStorage.State;

    uint256 private constant DEFAULT_ROLLOVER_LEAD = 30 days;
    uint256 private constant DEFAULT_CHALLENGE_LEAD = 24 hours;

    // === Events ===
    event RolloverWindowStarted(address indexed market, uint256 rolloverWindowStart, uint256 rolloverWindowEnd);
    event SettlementChallengeWindowStarted(address indexed market, uint256 challengeWindowStart, uint256 challengeWindowEnd);
    event RolloverCreated(address indexed parentMarket, address indexed childMarket, uint256 childSettlementTimestamp);

    // === Modifiers ===
    modifier onlyOwner() {
        LibDiamond.enforceIsContractOwner();
        _;
    }

    // === Internal helpers ===
    function _rolloverLead(MarketLifecycleStorage.State storage s) private view returns (uint256) {
        if (s.testingMode && s.rolloverLeadTimeOverride != 0) return s.rolloverLeadTimeOverride;
        return DEFAULT_ROLLOVER_LEAD;
    }
    function _challengeLead(MarketLifecycleStorage.State storage s) private view returns (uint256) {
        if (s.testingMode && s.challengeLeadTimeOverride != 0) return s.challengeLeadTimeOverride;
        return DEFAULT_CHALLENGE_LEAD;
    }

    // === Initializers ===
    /**
     * @notice One-time initializer for lifecycle data on new or legacy markets.
     * @dev Restricted to diamond owner for safety; subsequent calls revert.
     * @param settlementTimestamp Unix timestamp T0 + 365 days
     * @param parent Address of parent market (zero for genesis)
     */
    function initializeLifecycle(uint256 settlementTimestamp, address parent) external onlyOwner {
        require(settlementTimestamp > block.timestamp, "LC: invalid settlement");
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.settlementTimestamp == 0, "LC: already init");
        s.settlementTimestamp = settlementTimestamp;
        if (parent != address(0)) {
            s.parentMarket = parent;
        }
    }

    // === Keeper/worker signal functions ===
    /**
     * @notice Emits RolloverWindowStarted once when eligible (T0 - 30 days).
     * @dev Idempotent and time-gated.
     */
    function startRolloverWindow() external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.settlementTimestamp > 0, "LC: unset");
        require(!s.rolloverWindowStarted, "LC: already started");
        uint256 windowStart = s.settlementTimestamp - _rolloverLead(s);
        require(block.timestamp >= windowStart, "LC: too early");
        s.rolloverWindowStart = windowStart;
        s.rolloverWindowStarted = true;
        uint256 windowEnd = windowStart + _rolloverLead(s);
        emit RolloverWindowStarted(address(this), windowStart, windowEnd);
    }

    /**
     * @notice Emits SettlementChallengeWindowStarted once when eligible (T0 - 24h).
     * @dev Idempotent and time-gated.
     */
    function startSettlementChallengeWindow() external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.settlementTimestamp > 0, "LC: unset");
        require(!s.challengeWindowStarted, "LC: already started");
        uint256 windowStart = s.settlementTimestamp - _challengeLead(s);
        require(block.timestamp >= windowStart, "LC: too early");
        s.challengeWindowStart = windowStart;
        s.challengeWindowStarted = true;
        uint256 windowEnd = windowStart + _challengeLead(s);
        emit SettlementChallengeWindowStarted(address(this), windowStart, windowEnd);
    }

    /**
     * @notice Sets the child market pointer and emits RolloverCreated.
     * @dev Restricted to owner. Child's parent pointer can be set via setParent on the child.
     */
    function linkRolloverChild(address childMarket, uint256 childSettlementTimestamp) external onlyOwner {
        require(childMarket != address(0), "LC: child=0");
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.childMarket == address(0), "LC: child set");
        s.childMarket = childMarket;
        emit RolloverCreated(address(this), childMarket, childSettlementTimestamp);
    }

    /**
     * @notice Sets this market's parent pointer. One-time, owner only.
     */
    function setParent(address parentMarket) external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.parentMarket == address(0), "LC: parent set");
        s.parentMarket = parentMarket;
    }

    // === Views ===
    function getSettlementTimestamp() external view returns (uint256) {
        return MarketLifecycleStorage.state().settlementTimestamp;
    }
    function getRolloverWindowStart() external view returns (uint256) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        if (s.rolloverWindowStart != 0) return s.rolloverWindowStart;
        if (s.settlementTimestamp == 0) return 0;
        return s.settlementTimestamp - _rolloverLead(s);
    }
    function getChallengeWindowStart() external view returns (uint256) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        if (s.challengeWindowStart != 0) return s.challengeWindowStart;
        if (s.settlementTimestamp == 0) return 0;
        return s.settlementTimestamp - _challengeLead(s);
    }
    function isInRolloverWindow() external view returns (bool) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        if (s.settlementTimestamp == 0) return false;
        return block.timestamp >= (s.settlementTimestamp - _rolloverLead(s));
    }
    function isInSettlementChallengeWindow() external view returns (bool) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        if (s.settlementTimestamp == 0) return false;
        return block.timestamp >= (s.settlementTimestamp - _challengeLead(s));
    }
    function getMarketLineage() external view returns (address parent, address child) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        return (s.parentMarket, s.childMarket);
    }

    // === Testing controls (owner-only, safe defaults) ===
    function enableTestingMode(bool enabled) external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        s.testingMode = enabled;
    }
    function setLeadTimes(uint256 rolloverLeadSeconds, uint256 challengeLeadSeconds) external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.testingMode, "LC: testing off");
        s.rolloverLeadTimeOverride = rolloverLeadSeconds;
        s.challengeLeadTimeOverride = challengeLeadSeconds;
    }
    function setSettlementTimestamp(uint256 newSettlementTimestamp) external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.testingMode, "LC: testing off");
        require(newSettlementTimestamp > block.timestamp, "LC: bad ts");
        s.settlementTimestamp = newSettlementTimestamp;
    }
    function forceStartRolloverWindow() external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.testingMode, "LC: testing off");
        require(s.settlementTimestamp > 0, "LC: unset");
        require(!s.rolloverWindowStarted, "LC: already started");
        s.rolloverWindowStart = block.timestamp;
        s.rolloverWindowStarted = true;
        uint256 windowEnd = s.rolloverWindowStart + _rolloverLead(s);
        emit RolloverWindowStarted(address(this), s.rolloverWindowStart, windowEnd);
    }
    function forceStartSettlementChallengeWindow() external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.testingMode, "LC: testing off");
        require(s.settlementTimestamp > 0, "LC: unset");
        require(!s.challengeWindowStarted, "LC: already started");
        s.challengeWindowStart = block.timestamp;
        s.challengeWindowStarted = true;
        uint256 windowEnd = s.challengeWindowStart + _challengeLead(s);
        emit SettlementChallengeWindowStarted(address(this), s.challengeWindowStart, windowEnd);
    }

    // === Debug emitters (testing mode only) ===
    /**
     * @notice Emit RolloverWindowStarted for an arbitrary market address and start timestamp.
     * @dev Testing mode must be enabled. This does not mutate lifecycle storage.
     */
    function debugEmitRolloverWindowStarted(address market, uint256 rolloverWindowStart) external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.testingMode, "LC: testing off");
        require(market != address(0), "LC: market=0");
        require(rolloverWindowStart > 0, "LC: bad ts");
        uint256 rolloverWindowEnd = rolloverWindowStart + _rolloverLead(s);
        emit RolloverWindowStarted(market, rolloverWindowStart, rolloverWindowEnd);
    }

    /**
     * @notice Emit SettlementChallengeWindowStarted for an arbitrary market address and start timestamp.
     * @dev Testing mode must be enabled. This does not mutate lifecycle storage.
     */
    function debugEmitSettlementChallengeWindowStarted(address market, uint256 challengeWindowStart) external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.testingMode, "LC: testing off");
        require(market != address(0), "LC: market=0");
        require(challengeWindowStart > 0, "LC: bad ts");
        uint256 challengeWindowEnd = challengeWindowStart + _challengeLead(s);
        emit SettlementChallengeWindowStarted(market, challengeWindowStart, challengeWindowEnd);
    }

    /**
     * @notice Emit RolloverCreated for arbitrary parent/child addresses and child settlement timestamp.
     * @dev Testing mode must be enabled. This does not mutate lifecycle storage.
     */
    function debugEmitRolloverCreated(address parentMarket, address childMarket, uint256 childSettlementTimestamp) external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.testingMode, "LC: testing off");
        require(parentMarket != address(0) && childMarket != address(0), "LC: addr=0");
        require(childSettlementTimestamp > 0, "LC: bad ts");
        emit RolloverCreated(parentMarket, childMarket, childSettlementTimestamp);
    }
}


