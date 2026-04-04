// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title IOptimisticOracleV3
 * @dev Minimal interface for UMA's Optimistic Oracle V3 (actual OOv3 API).
 */
interface IOptimisticOracleV3Real {
    struct EscalationManagerSettings {
        bool arbitrateViaEscalationManager;
        bool discardOracle;
        bool validateDisputers;
        address escalationManager;
    }

    struct Assertion {
        EscalationManagerSettings escalationManagerSettings;
        address asserter;
        uint64 assertionTime;
        bool settled;
        IERC20 currency;
        uint64 expirationTime;
        bool settlementResolution;
        bytes32 domainId;
        bytes32 identifier;
        uint256 bond;
        address callbackRecipient;
        address disputer;
    }

    function assertTruth(
        bytes calldata claim,
        address asserter,
        address callbackRecipient,
        address escalationManager,
        uint64 liveness,
        IERC20 currency,
        uint256 bond,
        bytes32 defaultIdentifier,
        bytes32 domainId
    ) external returns (bytes32);

    function disputeAssertion(bytes32 assertionId, address disputer) external;
    function settleAssertion(bytes32 assertionId) external;
    function getAssertion(bytes32 assertionId) external view returns (Assertion memory);
    function getMinimumBond(address currency) external view returns (uint256);
    function defaultIdentifier() external view returns (bytes32);
}

/**
 * @title DisputeRelay
 * @notice Arbitrum/Sepolia-side relay that bridges Dexetra settlement disputes to UMA's
 *         Optimistic Oracle V3 for trustless resolution via DVM vote.
 *
 *         Design: When a user challenges a settlement on HyperLiquid, the Dexetra backend
 *         calls escalateDisputeDirectToVote(), which:
 *           1. Asserts the PROPOSER's original price is correct (safe default)
 *           2. Immediately self-disputes to skip liveness and go straight to DVM vote
 *
 *         The DVM result flows back via assertionResolvedCallback, emitting a DisputeResolved
 *         event that the backend relays to HyperLiquid's resolveChallenge().
 */
contract DisputeRelay {
    using SafeERC20 for IERC20;

    IOptimisticOracleV3Real public immutable oov3;
    IERC20 public immutable bondToken;
    address public owner;

    // "ASSERT_TRUTH" as bytes32
    bytes32 public constant DEFAULT_IDENTIFIER =
        0x4153534552545f54525554480000000000000000000000000000000000000000;

    struct Dispute {
        address hlMarket;
        uint256 proposedPrice;
        uint256 challengedPrice;
        bool resolved;
        bool challengerWon;
        uint256 bondAmount;
        uint256 timestamp;
    }

    mapping(bytes32 => Dispute) public disputes;
    bytes32[] public allAssertionIds;

    event DisputeEscalated(
        bytes32 indexed assertionId,
        address indexed hlMarket,
        uint256 proposedPrice,
        uint256 challengedPrice,
        uint256 bondAmount,
        uint256 timestamp
    );

    event DisputeResolved(
        bytes32 indexed assertionId,
        address indexed hlMarket,
        bool challengerWon,
        uint256 winningPrice
    );

    event DisputeEscalatedToDVM(bytes32 indexed assertionId);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PoolFunded(address indexed funder, uint256 amount);
    event PoolWithdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "DisputeRelay: not owner");
        _;
    }

    constructor(address _oov3, address _bondToken, address _owner) {
        require(_oov3 != address(0), "DisputeRelay: zero oov3");
        require(_bondToken != address(0), "DisputeRelay: zero token");
        require(_owner != address(0), "DisputeRelay: zero owner");
        oov3 = IOptimisticOracleV3Real(_oov3);
        bondToken = IERC20(_bondToken);
        owner = _owner;
    }

    /**
     * @notice Escalate a Dexetra settlement dispute directly to UMA DVM vote.
     *         Asserts the proposer's price is correct, then immediately self-disputes
     *         to bypass the liveness window and go straight to DVM arbitration.
     *         Requires 2x bondAmount in the pool (one for assert, one for dispute).
     * @param hlMarket The HyperLiquid market Diamond address (for tracking)
     * @param proposedPrice The original settlement price being defended (6 decimals)
     * @param challengedPrice The challenger's alternative price (6 decimals)
     * @param claim Pre-built human-readable claim bytes for UMA DVM voters
     * @param bondAmount Bond per side in bond token units
     * @param liveness Minimum liveness in seconds (will be immediately overridden by dispute)
     */
    function escalateDisputeDirectToVote(
        address hlMarket,
        uint256 proposedPrice,
        uint256 challengedPrice,
        bytes calldata claim,
        uint256 bondAmount,
        uint64 liveness
    ) external onlyOwner returns (bytes32 assertionId) {
        require(hlMarket != address(0), "DisputeRelay: zero market");
        require(proposedPrice > 0, "DisputeRelay: zero proposed");
        require(challengedPrice > 0, "DisputeRelay: zero challenged");
        require(bondAmount > 0, "DisputeRelay: zero bond");
        require(claim.length > 0, "DisputeRelay: empty claim");

        uint256 totalNeeded = bondAmount * 2;
        require(
            bondToken.balanceOf(address(this)) >= totalNeeded,
            "DisputeRelay: insufficient pool balance"
        );

        bondToken.safeIncreaseAllowance(address(oov3), totalNeeded);

        // Step 1: Assert that the proposer's price is correct
        assertionId = oov3.assertTruth(
            claim,
            address(this),     // asserter = this contract
            address(this),     // callbackRecipient = this contract
            address(0),        // no custom escalation manager
            liveness,
            bondToken,
            bondAmount,
            DEFAULT_IDENTIFIER,
            bytes32(0)
        );

        // Step 2: Immediately dispute our own assertion → straight to DVM vote
        oov3.disputeAssertion(assertionId, address(this));

        disputes[assertionId] = Dispute({
            hlMarket: hlMarket,
            proposedPrice: proposedPrice,
            challengedPrice: challengedPrice,
            resolved: false,
            challengerWon: false,
            bondAmount: bondAmount,
            timestamp: block.timestamp
        });
        allAssertionIds.push(assertionId);

        emit DisputeEscalated(
            assertionId, hlMarket, proposedPrice, challengedPrice, bondAmount, block.timestamp
        );
    }

    /**
     * @notice Called by UMA OOv3 when the assertion is resolved (after DVM vote).
     * @dev assertedTruthfully = true means "proposer's price IS correct",
     *      so challengerWon = !assertedTruthfully.
     */
    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully) external {
        require(msg.sender == address(oov3), "DisputeRelay: only OOv3");
        Dispute storage d = disputes[assertionId];
        require(d.hlMarket != address(0), "DisputeRelay: unknown assertion");
        require(!d.resolved, "DisputeRelay: already resolved");

        d.resolved = true;
        d.challengerWon = !assertedTruthfully;

        emit DisputeResolved(
            assertionId,
            d.hlMarket,
            !assertedTruthfully,
            assertedTruthfully ? d.proposedPrice : d.challengedPrice
        );
    }

    /**
     * @notice Called by UMA OOv3 when the assertion is disputed.
     *         In direct-to-vote mode this fires immediately during escalateDisputeDirectToVote.
     */
    function assertionDisputedCallback(bytes32 assertionId) external {
        require(msg.sender == address(oov3), "DisputeRelay: only OOv3");
        emit DisputeEscalatedToDVM(assertionId);
    }

    // ═══════════════════════════════════════════════
    // Pool management
    // ═══════════════════════════════════════════════

    function deposit(uint256 amount) external {
        bondToken.safeTransferFrom(msg.sender, address(this), amount);
        emit PoolFunded(msg.sender, amount);
    }

    function withdraw(uint256 amount) external onlyOwner {
        bondToken.safeTransfer(owner, amount);
        emit PoolWithdrawn(owner, amount);
    }

    function poolBalance() external view returns (uint256) {
        return bondToken.balanceOf(address(this));
    }

    // ═══════════════════════════════════════════════
    // Views
    // ═══════════════════════════════════════════════

    function getDispute(bytes32 assertionId) external view returns (Dispute memory) {
        return disputes[assertionId];
    }

    function getDisputeCount() external view returns (uint256) {
        return allAssertionIds.length;
    }

    function getAssertionIdAt(uint256 index) external view returns (bytes32) {
        require(index < allAssertionIds.length, "DisputeRelay: out of bounds");
        return allAssertionIds[index];
    }

    function getOOv3Assertion(bytes32 assertionId)
        external
        view
        returns (IOptimisticOracleV3Real.Assertion memory)
    {
        return oov3.getAssertion(assertionId);
    }

    // ═══════════════════════════════════════════════
    // Admin
    // ═══════════════════════════════════════════════

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "DisputeRelay: zero addr");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

}
