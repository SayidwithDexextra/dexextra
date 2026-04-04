// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/LibDiamond.sol";
import "../libraries/MarketLifecycleStorage.sol";
import "../libraries/OrderBookStorage.sol";

/**
 * @title MarketLifecycleFacet
 * @notice Adds one-year lifecycle metadata, rollover/challenge windows, lineage pointers,
 *         and settlement challenge bonds. Uses a dedicated diamond storage slot to avoid
 *         layout collisions.
 */
contract MarketLifecycleFacet {
    using MarketLifecycleStorage for MarketLifecycleStorage.State;

    uint256 private constant DEFAULT_ROLLOVER_LEAD = 30 days;
    uint256 private constant DEFAULT_CHALLENGE_LEAD = 24 hours;
    uint256 private constant DAYS_PER_YEAR = 365;
    uint256 private constant MIN_CHALLENGE_DURATION = 1 minutes;

    enum LifecycleState {
        Unsettled,
        Rollover,
        ChallengeWindow,
        Settled
    }

    // === Events ===
    event RolloverWindowStarted(address indexed market, uint256 rolloverWindowStart, uint256 rolloverWindowEnd);
    event SettlementChallengeWindowStarted(address indexed market, uint256 challengeWindowStart, uint256 challengeWindowEnd);
    event RolloverCreated(address indexed parentMarket, address indexed childMarket, uint256 childSettlementTimestamp);
    event LifecycleStateChanged(address indexed market, uint8 oldState, uint8 newState, uint256 timestamp, address indexed caller);
    event LifecycleInitialized(
        address indexed market,
        uint256 settlementTimestamp,
        address indexed parentMarket,
        bool devMode,
        uint256 lifecycleDurationSeconds,
        uint256 rolloverWindowStart,
        uint256 challengeWindowDuration
    );
    event LifecycleSync(
        address indexed market,
        address indexed caller,
        uint8 previousState,
        uint8 newState,
        bool progressed,
        bool devMode,
        bool settledOnChain,
        uint256 rolloverWindowStart,
        uint256 challengeWindowStart,
        uint256 challengeWindowEnd,
        uint256 timestamp
    );
    event LifecycleSettled(
        address indexed market,
        address indexed caller,
        bool settledOnChain,
        uint256 timestamp,
        uint256 challengeWindowStart,
        uint256 challengeWindowEnd
    );
    event RolloverLineageLinked(
        address indexed parentMarket,
        address indexed childMarket,
        address indexed caller,
        uint256 parentSettlementTimestamp,
        uint256 childSettlementTimestamp
    );
    event EvidenceCommitted(address indexed market, bytes32 indexed evidenceHash, address indexed committer, uint256 timestamp);
    event ChallengeBondConfigured(address indexed market, uint256 bondAmount, address slashRecipient);
    event SettlementChallenged(address indexed market, address indexed challenger, uint256 alternativePrice, uint256 bondAmount);
    event ChallengeResolved(address indexed market, address indexed challenger, bool challengerWon, uint256 bondAmount, address recipient);
    event SettlementPriceProposed(address indexed market, address indexed proposer, uint256 price, uint256 timestamp);
    event ProposalBondExemptUpdated(address indexed account, bool exempt);
    event ProposalBondReturned(address indexed market, address indexed proposer, uint256 amount);

    // === Modifiers ===
    modifier onlyOwner() {
        LibDiamond.enforceIsContractOwner();
        _;
    }

    // === Internal helpers ===
    function _lifecycleDuration(MarketLifecycleStorage.State storage s) private view returns (uint256) {
        if (s.lifecycleDurationSeconds != 0) return s.lifecycleDurationSeconds;
        return 365 days;
    }

    function _rolloverLead(MarketLifecycleStorage.State storage s) private view returns (uint256) {
        if (s.testingMode && s.rolloverLeadTimeOverride != 0) return s.rolloverLeadTimeOverride;
        if (s.rolloverLeadStored != 0) return s.rolloverLeadStored;
        uint256 duration = _lifecycleDuration(s);
        if (duration == 0) return DEFAULT_ROLLOVER_LEAD;
        uint256 lead = duration / 12;
        return lead == 0 ? 1 : lead;
    }

    function _challengeDuration(MarketLifecycleStorage.State storage s) private view returns (uint256) {
        if (s.testingMode && s.challengeLeadTimeOverride != 0) return s.challengeLeadTimeOverride;
        if (s.lifecycleDevMode) return DEFAULT_CHALLENGE_LEAD; // 24h fixed window in dev mode
        if (s.challengeWindowDuration != 0) return s.challengeWindowDuration;
        uint256 duration = _lifecycleDuration(s);
        if (duration == 0) return DEFAULT_CHALLENGE_LEAD;
        uint256 proportional = duration / DAYS_PER_YEAR;
        if (proportional < MIN_CHALLENGE_DURATION) return MIN_CHALLENGE_DURATION;
        return proportional;
    }

    function _rolloverWindowStart(MarketLifecycleStorage.State storage s) private view returns (uint256) {
        if (s.settlementTimestamp == 0) return 0;
        uint256 lead = _rolloverLead(s);
        if (lead >= s.settlementTimestamp) return 0;
        return s.settlementTimestamp - lead;
    }

    function _isContractSettled() private view returns (bool) {
        (bool ok, bytes memory data) = address(this).staticcall(abi.encodeWithSignature("isSettled()"));
        if (!ok || data.length < 32) return false;
        return abi.decode(data, (bool));
    }

    function _resolveChildSettlementTimestamp(address childMarket, uint256 fallbackTs) private view returns (uint256) {
        (bool ok, bytes memory data) = childMarket.staticcall(abi.encodeWithSignature("getSettlementTimestamp()"));
        if (ok && data.length >= 32) {
            uint256 ts = abi.decode(data, (uint256));
            if (ts > 0) return ts;
        }
        return fallbackTs;
    }

    function _currentLifecycleState(MarketLifecycleStorage.State storage s) private view returns (LifecycleState) {
        if (s.lifecycleSettled || _isContractSettled()) {
            return LifecycleState.Settled;
        }
        if (s.challengeWindowStarted) {
            uint256 challengeEnd = s.challengeWindowStart + _challengeDuration(s);
            if (block.timestamp >= challengeEnd) {
                return LifecycleState.Settled;
            }
            return LifecycleState.ChallengeWindow;
        }
        if (s.rolloverWindowStarted) {
            return LifecycleState.Rollover;
        }
        uint256 rolloverStart = _rolloverWindowStart(s);
        if (rolloverStart != 0 && block.timestamp >= rolloverStart) {
            return LifecycleState.Rollover;
        }
        return LifecycleState.Unsettled;
    }

    // === Initializers ===
    /**
     * @notice One-time initializer for lifecycle data on new or legacy markets.
     * @dev Restricted to diamond owner for safety; subsequent calls revert.
     * @param settlementTimestamp Unix timestamp when challenge phase begins (T0)
     * @param parent Address of parent market (zero for genesis)
     */
    function initializeLifecycle(uint256 settlementTimestamp, address parent) external onlyOwner {
        _initializeLifecycle(settlementTimestamp, parent, false, 0, 0);
    }

    /**
     * @notice One-time initializer with explicit dev mode toggle.
     */
    function initializeLifecycleWithMode(uint256 settlementTimestamp, address parent, bool devMode) external onlyOwner {
        _initializeLifecycle(settlementTimestamp, parent, devMode, 0, 0);
    }

    /**
     * @notice One-time initializer with explicit timing overrides.
     * @param rolloverLeadSeconds Explicit rollover lead in seconds (0 = proportional default)
     * @param challengeWindowSeconds Explicit challenge window duration (0 = proportional default)
     */
    function initializeLifecycleWithTiming(
        uint256 settlementTimestamp,
        address parent,
        bool devMode,
        uint256 rolloverLeadSeconds,
        uint256 challengeWindowSeconds
    ) external onlyOwner {
        _initializeLifecycle(settlementTimestamp, parent, devMode, rolloverLeadSeconds, challengeWindowSeconds);
    }

    function _initializeLifecycle(
        uint256 settlementTimestamp,
        address parent,
        bool devMode,
        uint256 rolloverLeadSeconds,
        uint256 challengeWindowSeconds
    ) private {
        require(settlementTimestamp > block.timestamp, "LC: invalid settlement");
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.settlementTimestamp == 0, "LC: already init");
        s.settlementTimestamp = settlementTimestamp;
        s.lifecycleDurationSeconds = settlementTimestamp - block.timestamp;

        if (challengeWindowSeconds > 0) {
            s.challengeWindowDuration = challengeWindowSeconds;
        } else {
            uint256 proportionalChallenge = s.lifecycleDurationSeconds / DAYS_PER_YEAR;
            s.challengeWindowDuration = proportionalChallenge < MIN_CHALLENGE_DURATION ? MIN_CHALLENGE_DURATION : proportionalChallenge;
        }

        if (rolloverLeadSeconds > 0) {
            s.rolloverLeadStored = rolloverLeadSeconds;
        }

        s.lifecycleDevMode = devMode;
        if (parent != address(0)) {
            s.parentMarket = parent;
        }
        emit LifecycleInitialized(
            address(this),
            s.settlementTimestamp,
            s.parentMarket,
            s.lifecycleDevMode,
            s.lifecycleDurationSeconds,
            _rolloverWindowStart(s),
            s.challengeWindowDuration
        );
    }

    /**
     * @notice Permissionless lifecycle progression. Any party may call when time/conditions are met.
     * @dev Idempotent and safe to call frequently from bots/UIs.
     */
    function syncLifecycle() external returns (uint8 previousState, uint8 newState) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.settlementTimestamp > 0, "LC: unset");

        bool devMode = s.lifecycleDevMode;
        bool progressed = false;
        bool settledOnChain = false;
        previousState = uint8(_currentLifecycleState(s));

        if (devMode) {
            if (previousState == uint8(LifecycleState.Unsettled)) {
                uint256 rolloverStart = block.timestamp;
                s.rolloverWindowStart = rolloverStart;
                s.rolloverWindowStarted = true;
                uint256 rolloverEnd = s.settlementTimestamp > rolloverStart ? s.settlementTimestamp : rolloverStart;
                emit RolloverWindowStarted(address(this), rolloverStart, rolloverEnd);
                progressed = true;
            } else if (previousState == uint8(LifecycleState.Rollover)) {
                // Challenge window begins at end of market timeline, never before settlementTimestamp
                uint256 challengeStart = block.timestamp >= s.settlementTimestamp
                    ? block.timestamp
                    : s.settlementTimestamp;
                s.challengeWindowStart = challengeStart;
                s.challengeWindowStarted = true;
                emit SettlementChallengeWindowStarted(address(this), challengeStart, challengeStart + _challengeDuration(s));
                progressed = true;
            } else if (previousState == uint8(LifecycleState.ChallengeWindow)) {
                uint256 challengeEnd = s.challengeWindowStart + _challengeDuration(s);
                require(block.timestamp >= challengeEnd, "LC: challenge window active");
                s.lifecycleSettled = true;
                progressed = true;
                emit LifecycleSettled(
                    address(this),
                    msg.sender,
                    false,
                    block.timestamp,
                    s.challengeWindowStart,
                    challengeEnd
                );
            }

            newState = uint8(_currentLifecycleState(s));
            if (newState != previousState) {
                emit LifecycleStateChanged(address(this), previousState, newState, block.timestamp, msg.sender);
            }
        } else {
            if (!s.rolloverWindowStarted) {
                uint256 rolloverStart = _rolloverWindowStart(s);
                if (rolloverStart != 0 && block.timestamp >= rolloverStart) {
                    s.rolloverWindowStart = rolloverStart;
                    s.rolloverWindowStarted = true;
                    emit RolloverWindowStarted(address(this), rolloverStart, s.settlementTimestamp);
                    progressed = true;
                }
            }

            if (!s.challengeWindowStarted && block.timestamp >= s.settlementTimestamp) {
                s.challengeWindowStart = block.timestamp;
                s.challengeWindowStarted = true;
                uint256 challengeEnd = s.challengeWindowStart + _challengeDuration(s);
                emit SettlementChallengeWindowStarted(address(this), s.challengeWindowStart, challengeEnd);
                progressed = true;
            }

            settledOnChain = _isContractSettled();
            if (settledOnChain && !s.lifecycleSettled) {
                s.lifecycleSettled = true;
                progressed = true;
                emit LifecycleSettled(
                    address(this),
                    msg.sender,
                    true,
                    block.timestamp,
                    s.challengeWindowStart,
                    s.challengeWindowStarted ? (s.challengeWindowStart + _challengeDuration(s)) : 0
                );
            } else if (!settledOnChain && s.challengeWindowStarted) {
                uint256 challengeEnd = s.challengeWindowStart + _challengeDuration(s);
                if (block.timestamp >= challengeEnd && !s.lifecycleSettled) {
                    s.lifecycleSettled = true;
                    progressed = true;
                    emit LifecycleSettled(
                        address(this),
                        msg.sender,
                        false,
                        block.timestamp,
                        s.challengeWindowStart,
                        challengeEnd
                    );
                }
            }
        }

        newState = uint8(_currentLifecycleState(s));
        if (newState != previousState) {
            emit LifecycleStateChanged(address(this), previousState, newState, block.timestamp, msg.sender);
        }
        uint256 challengeWindowEnd = s.challengeWindowStarted ? (s.challengeWindowStart + _challengeDuration(s)) : 0;
        emit LifecycleSync(
            address(this),
            msg.sender,
            previousState,
            newState,
            progressed,
            devMode,
            settledOnChain,
            s.rolloverWindowStart,
            s.challengeWindowStart,
            challengeWindowEnd,
            block.timestamp
        );
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
        uint256 windowStart = _rolloverWindowStart(s);
        require(block.timestamp >= windowStart, "LC: too early");
        s.rolloverWindowStart = windowStart;
        s.rolloverWindowStarted = true;
        uint256 windowEnd = s.settlementTimestamp;
        emit RolloverWindowStarted(address(this), windowStart, windowEnd);
    }

    /**
     * @notice Emits SettlementChallengeWindowStarted once when eligible (at or after settlementTimestamp).
     * @dev Idempotent and time-gated.
     */
    function startSettlementChallengeWindow() external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.settlementTimestamp > 0, "LC: unset");
        require(!s.challengeWindowStarted, "LC: already started");
        require(block.timestamp >= s.settlementTimestamp, "LC: too early");
        uint256 windowStart = block.timestamp;
        s.challengeWindowStart = windowStart;
        s.challengeWindowStarted = true;
        uint256 windowEnd = windowStart + _challengeDuration(s);
        emit SettlementChallengeWindowStarted(address(this), windowStart, windowEnd);
    }

    // === Permissionless settlement price proposal ===

    /**
     * @notice Propose an initial settlement price for this market.
     * @dev Callable by ANYONE during the active challenge window. First valid
     *      proposal wins — subsequent proposals revert (use challengeSettlement
     *      to dispute). Bond-exempt addresses (AI workers) skip the bond;
     *      all other callers must escrow the configured challengeBondAmount.
     * @param price Settlement price in 6-decimal format (e.g. 1e6 = $1.00)
     */
    function proposeSettlementPrice(uint256 price) external {
        require(price > 0, "LC: price=0");
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();

        require(s.challengeWindowStarted, "LC: window not started");
        require(!s.lifecycleSettled, "LC: already settled");
        uint256 challengeEnd = s.challengeWindowStart + _challengeDuration(s);
        require(block.timestamp < challengeEnd, "LC: window expired");

        require(!s.settlementProposed, "LC: already proposed");

        uint256 bondEscrowed = 0;
        if (s.challengeBondAmount > 0 && !s.proposalBondExempt[msg.sender]) {
            OrderBookStorage.State storage obs = OrderBookStorage.state();
            require(address(obs.vault) != address(0), "LC: vault not set");
            require(
                obs.vault.getAvailableCollateral(msg.sender) >= s.challengeBondAmount,
                "LC: insufficient collateral for bond"
            );
            obs.vault.deductFees(msg.sender, s.challengeBondAmount, address(this));
            bondEscrowed = s.challengeBondAmount;
        }

        s.proposedSettlementPrice = price;
        s.proposedSettlementBy = msg.sender;
        s.settlementProposed = true;
        s.proposalBondEscrowed = bondEscrowed;

        emit SettlementPriceProposed(address(this), msg.sender, price, block.timestamp);
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
     * @notice Permissionless lineage linker for rollover markets by contract address.
     * @dev Best-effort on child linkage via registerParentFromRollover on the child contract.
     */
    function linkRolloverChildByAddress(address childMarket, uint256 childSettlementTimestamp) external returns (bool) {
        require(childMarket != address(0), "LC: child=0");
        require(childMarket != address(this), "LC: self");
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.settlementTimestamp > 0, "LC: unset");

        if (!s.lifecycleDevMode) {
            uint256 rolloverStart = _rolloverWindowStart(s);
            require(rolloverStart != 0 && block.timestamp >= rolloverStart, "LC: pre-rollover");
            require(block.timestamp < s.settlementTimestamp, "LC: post-settlement");
        }
        require(!s.lifecycleLinking, "LC: linking");

        if (s.childMarket == address(0)) {
            s.childMarket = childMarket;
            emit RolloverCreated(address(this), childMarket, childSettlementTimestamp);
        } else {
            require(s.childMarket == childMarket, "LC: child mismatch");
        }

        uint256 resolvedChildSettlement = _resolveChildSettlementTimestamp(childMarket, childSettlementTimestamp);
        s.lifecycleLinking = true;
        (bool ok, ) = childMarket.call(
            abi.encodeWithSignature("registerParentFromRollover(address)", address(this))
        );
        s.lifecycleLinking = false;
        require(ok, "LC: child link failed");

        emit RolloverLineageLinked(
            address(this),
            childMarket,
            msg.sender,
            s.settlementTimestamp,
            resolvedChildSettlement
        );
        return true;
    }

    /**
     * @notice Sets this market's parent pointer. One-time, owner only.
     */
    function setParent(address parentMarket) external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.parentMarket == address(0), "LC: parent set");
        s.parentMarket = parentMarket;
    }

    /**
     * @notice Called by a parent market to register parent linkage on this child.
     * @dev Requires msg.sender to be the parent market address.
     */
    function registerParentFromRollover(address parentMarket) external returns (bool) {
        require(parentMarket != address(0), "LC: parent=0");
        require(msg.sender == parentMarket, "LC: caller!=parent");
        require(parentMarket != address(this), "LC: self");

        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        if (s.parentMarket == address(0)) {
            s.parentMarket = parentMarket;
        } else {
            require(s.parentMarket == parentMarket, "LC: parent mismatch");
        }
        return true;
    }

    // === Views ===
    function getSettlementTimestamp() external view returns (uint256) {
        return MarketLifecycleStorage.state().settlementTimestamp;
    }
    function getRolloverWindowStart() external view returns (uint256) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        if (s.rolloverWindowStart != 0) return s.rolloverWindowStart;
        if (s.settlementTimestamp == 0) return 0;
        return _rolloverWindowStart(s);
    }
    function getChallengeWindowStart() external view returns (uint256) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        if (s.challengeWindowStart != 0) return s.challengeWindowStart;
        if (s.settlementTimestamp == 0) return 0;
        return s.settlementTimestamp;
    }
    function isInRolloverWindow() external view returns (bool) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        if (s.settlementTimestamp == 0) return false;
        if (_currentLifecycleState(s) == LifecycleState.Settled) return false;
        uint256 rolloverStart = s.rolloverWindowStart != 0 ? s.rolloverWindowStart : _rolloverWindowStart(s);
        if (rolloverStart == 0) return false;
        if (s.lifecycleDevMode && s.rolloverWindowStarted) return !s.challengeWindowStarted;
        return block.timestamp >= rolloverStart && block.timestamp < s.settlementTimestamp;
    }
    function isInSettlementChallengeWindow() external view returns (bool) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        if (!s.challengeWindowStarted) return false;
        if (_currentLifecycleState(s) == LifecycleState.Settled) return false;
        return block.timestamp >= s.challengeWindowStart
            && block.timestamp < (s.challengeWindowStart + _challengeDuration(s));
    }
    function getChallengeWindowEnd() external view returns (uint256) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        if (s.challengeWindowStart != 0) return s.challengeWindowStart + _challengeDuration(s);
        if (s.settlementTimestamp == 0) return 0;
        return s.settlementTimestamp + _challengeDuration(s);
    }
    function getLifecycleState() external view returns (uint8) {
        return uint8(_currentLifecycleState(MarketLifecycleStorage.state()));
    }
    function isLifecycleDevMode() external view returns (bool) {
        return MarketLifecycleStorage.state().lifecycleDevMode;
    }
    function getMarketLineage() external view returns (address parent, address child) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        return (s.parentMarket, s.childMarket);
    }
    function getProposedSettlementPrice() external view returns (uint256 price, address proposer, bool proposed) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        return (s.proposedSettlementPrice, s.proposedSettlementBy, s.settlementProposed);
    }
    function getRolloverLead() external view returns (uint256) {
        return _rolloverLead(MarketLifecycleStorage.state());
    }
    function getChallengeWindowDuration() external view returns (uint256) {
        return _challengeDuration(MarketLifecycleStorage.state());
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
        uint256 windowEnd = s.settlementTimestamp;
        emit RolloverWindowStarted(address(this), s.rolloverWindowStart, windowEnd);
    }
    function forceStartSettlementChallengeWindow() external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.testingMode, "LC: testing off");
        require(s.settlementTimestamp > 0, "LC: unset");
        require(!s.challengeWindowStarted, "LC: already started");
        s.challengeWindowStart = block.timestamp;
        s.challengeWindowStarted = true;
        uint256 windowEnd = s.challengeWindowStart + _challengeDuration(s);
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
        uint256 challengeWindowEnd = challengeWindowStart + _challengeDuration(s);
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

    // === Evidence Commitment ===

    /**
     * @notice Commit the Wayback URL and its hash on-chain at proposal time.
     * @dev Called once. The hash is computed on-chain from the URL so both are guaranteed consistent.
     *      Immutable after set — reverts if evidence was already committed.
     * @param evidenceUrl The full Wayback Machine URL used as the data source for the proposed price
     */
    function commitEvidence(string calldata evidenceUrl) external onlyOwner {
        require(bytes(evidenceUrl).length > 0, "LC: empty url");
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.proposedEvidenceHash == bytes32(0), "LC: evidence already committed");
        bytes32 evidenceHash = keccak256(bytes(evidenceUrl));
        s.proposedEvidenceHash = evidenceHash;
        s.proposedEvidenceUrl = evidenceUrl;
        emit EvidenceCommitted(address(this), evidenceHash, msg.sender, block.timestamp);
    }

    function getProposedEvidence() external view returns (bytes32 evidenceHash, string memory evidenceUrl) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        return (s.proposedEvidenceHash, s.proposedEvidenceUrl);
    }

    // === Settlement Challenge Bond ===

    /**
     * @notice Configure the bond required to challenge a settlement.
     * @param bondAmount Amount in 6-decimal USDC units (e.g. 50e6 = 50 USDC)
     * @param slashRecipient Treasury address that receives slashed bonds
     */
    function setChallengeBondConfig(uint256 bondAmount, address slashRecipient) external onlyOwner {
        require(slashRecipient != address(0), "LC: slash=0");
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        s.challengeBondAmount = bondAmount;
        s.challengeSlashRecipient = slashRecipient;
        emit ChallengeBondConfigured(address(this), bondAmount, slashRecipient);
    }

    /**
     * @notice Challenge the proposed settlement by posting a bond and alternative price.
     * @dev Callable by anyone during the active challenge window. Bond-exempt addresses
     *      (AI workers) skip the bond; all other callers must escrow challengeBondAmount.
     *      Only one active challenge per market.
     * @param alternativePrice The challenger's proposed settlement price (6 decimals)
     */
    function challengeSettlement(uint256 alternativePrice) external {
        require(alternativePrice > 0, "LC: price=0");
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();

        require(s.challengeWindowStarted, "LC: window not started");
        require(!s.lifecycleSettled, "LC: already settled");
        uint256 challengeEnd = s.challengeWindowStart + _challengeDuration(s);
        require(block.timestamp < challengeEnd, "LC: window expired");

        require(!s.challengeActive, "LC: challenge exists");

        OrderBookStorage.State storage obs = OrderBookStorage.state();
        require(address(obs.vault) != address(0), "LC: vault not set");

        uint256 bondToEscrow = 0;
        if (!s.proposalBondExempt[msg.sender]) {
            require(s.challengeBondAmount > 0, "LC: bond not configured");
            require(obs.vault.getAvailableCollateral(msg.sender) >= s.challengeBondAmount, "LC: insufficient collateral");
            obs.vault.deductFees(msg.sender, s.challengeBondAmount, address(this));
            bondToEscrow = s.challengeBondAmount;
        }

        s.challenger = msg.sender;
        s.challengedPrice = alternativePrice;
        s.challengeBondEscrowed = bondToEscrow;
        s.challengeActive = true;
        s.challengeResolved = false;

        emit SettlementChallenged(address(this), msg.sender, alternativePrice, bondToEscrow);
    }

    /**
     * @notice Resolve an active challenge: refund the bond to the challenger or slash it to treasury.
     * @param challengerWins If true, bond is returned to challenger. If false, bond goes to slash recipient.
     */
    function resolveChallenge(bool challengerWins) external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.challengeActive, "LC: no active challenge");
        require(!s.challengeResolved, "LC: already resolved");

        OrderBookStorage.State storage obs = OrderBookStorage.state();
        address recipient;
        if (challengerWins) {
            recipient = s.challenger;
        } else {
            recipient = s.challengeSlashRecipient;
            require(recipient != address(0), "LC: slash recipient=0");
        }

        obs.vault.deductFees(address(this), s.challengeBondEscrowed, recipient);

        s.challengeResolved = true;
        s.challengeActive = false;
        s.challengerWon = challengerWins;

        emit ChallengeResolved(address(this), s.challenger, challengerWins, s.challengeBondEscrowed, recipient);
    }

    // === Challenge Bond Views ===

    function getChallengeBondConfig() external view returns (uint256 bondAmount, address slashRecipient) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        return (s.challengeBondAmount, s.challengeSlashRecipient);
    }

    function getActiveChallengeInfo() external view returns (
        bool active,
        address challengerAddr,
        uint256 challengedPriceVal,
        uint256 bondEscrowed,
        bool resolved,
        bool won
    ) {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        return (
            s.challengeActive,
            s.challenger,
            s.challengedPrice,
            s.challengeBondEscrowed,
            s.challengeResolved,
            s.challengerWon
        );
    }

    // === Proposal Bond Exemption ===

    /**
     * @notice Mark an address as exempt from the proposal/challenge bond requirement.
     * @dev Intended for trusted AI worker addresses that propose prices without collateral.
     * @param account The address to exempt or un-exempt
     * @param exempt  True to exempt, false to revoke exemption
     */
    function setProposalBondExempt(address account, bool exempt) external onlyOwner {
        require(account != address(0), "LC: zero addr");
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        s.proposalBondExempt[account] = exempt;
        emit ProposalBondExemptUpdated(account, exempt);
    }

    /**
     * @notice Check whether an address is exempt from the proposal/challenge bond.
     */
    function isProposalBondExempt(address account) external view returns (bool) {
        return MarketLifecycleStorage.state().proposalBondExempt[account];
    }

    /**
     * @notice Return the escrowed proposal bond to the original proposer.
     * @dev Called by the owner after settlement finalizes unopposed. No-ops if
     *      no bond was escrowed (exempt proposer or zero bond config).
     */
    function returnProposalBond() external onlyOwner {
        MarketLifecycleStorage.State storage s = MarketLifecycleStorage.state();
        require(s.settlementProposed, "LC: no proposal");
        require(!s.challengeActive, "LC: active challenge");

        uint256 amount = s.proposalBondEscrowed;
        if (amount == 0) return;

        address proposer = s.proposedSettlementBy;
        require(proposer != address(0), "LC: no proposer");

        s.proposalBondEscrowed = 0;

        OrderBookStorage.State storage obs = OrderBookStorage.state();
        require(address(obs.vault) != address(0), "LC: vault not set");
        obs.vault.deductFees(address(this), amount, proposer);

        emit ProposalBondReturned(address(this), proposer, amount);
    }
}


