// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title IAssertionRecipient
 * @dev Callback interface that DisputeRelay implements.
 */
interface IAssertionRecipient {
    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully) external;
    function assertionDisputedCallback(bytes32 assertionId) external;
}

/**
 * @title SandboxOOv3
 * @notice Minimal Optimistic Oracle V3 implementation for test environments.
 *         Implements the same interface DisputeRelay calls on the real OOv3,
 *         but allows an admin to resolve assertions instantly via resolveAssertion().
 *
 *         Bond handling mirrors the real OOv3: asserter posts bond on assertTruth,
 *         disputer posts bond on disputeAssertion, winner receives both bonds on resolution.
 */
contract SandboxOOv3 {
    using SafeERC20 for IERC20;

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

    address public owner;
    uint64 public nextAssertionNonce;

    bytes32 public constant DEFAULT_IDENTIFIER =
        0x4153534552545f54525554480000000000000000000000000000000000000000;

    mapping(bytes32 => Assertion) public assertions;

    event AssertionMade(bytes32 indexed assertionId, address indexed asserter, uint256 bond);
    event AssertionDisputed(bytes32 indexed assertionId, address indexed disputer);
    event AssertionResolved(bytes32 indexed assertionId, bool assertedTruthfully);

    modifier onlyOwner() {
        require(msg.sender == owner, "SandboxOOv3: not owner");
        _;
    }

    constructor(address _owner) {
        require(_owner != address(0), "SandboxOOv3: zero owner");
        owner = _owner;
    }

    function assertTruth(
        bytes calldata /* claim */,
        address asserter,
        address callbackRecipient,
        address escalationManager,
        uint64 liveness,
        IERC20 currency,
        uint256 bond,
        bytes32 identifier,
        bytes32 domainId
    ) external returns (bytes32 assertionId) {
        assertionId = keccak256(abi.encode(block.chainid, address(this), nextAssertionNonce++));

        currency.safeTransferFrom(msg.sender, address(this), bond);

        assertions[assertionId] = Assertion({
            escalationManagerSettings: EscalationManagerSettings({
                arbitrateViaEscalationManager: false,
                discardOracle: false,
                validateDisputers: false,
                escalationManager: escalationManager
            }),
            asserter: asserter,
            assertionTime: uint64(block.timestamp),
            settled: false,
            currency: currency,
            expirationTime: uint64(block.timestamp) + liveness,
            settlementResolution: false,
            domainId: domainId,
            identifier: identifier,
            bond: bond,
            callbackRecipient: callbackRecipient,
            disputer: address(0)
        });

        emit AssertionMade(assertionId, asserter, bond);
    }

    function disputeAssertion(bytes32 assertionId, address disputer) external {
        Assertion storage a = assertions[assertionId];
        require(a.asserter != address(0), "SandboxOOv3: unknown assertion");
        require(!a.settled, "SandboxOOv3: already settled");
        require(a.disputer == address(0), "SandboxOOv3: already disputed");

        a.currency.safeTransferFrom(msg.sender, address(this), a.bond);
        a.disputer = disputer;

        emit AssertionDisputed(assertionId, disputer);

        if (a.callbackRecipient != address(0)) {
            IAssertionRecipient(a.callbackRecipient).assertionDisputedCallback(assertionId);
        }
    }

    /**
     * @notice Admin-only instant resolution. Replaces the DVM vote.
     * @param assertionId The assertion to resolve
     * @param assertedTruthfully true = proposer wins, false = challenger wins
     */
    function resolveAssertion(bytes32 assertionId, bool assertedTruthfully) external onlyOwner {
        Assertion storage a = assertions[assertionId];
        require(a.asserter != address(0), "SandboxOOv3: unknown assertion");
        require(!a.settled, "SandboxOOv3: already settled");

        a.settled = true;
        a.settlementResolution = assertedTruthfully;

        uint256 totalBond = a.bond;
        if (a.disputer != address(0)) {
            totalBond += a.bond;
        }

        address winner = assertedTruthfully ? a.asserter : a.disputer;
        if (winner == address(0)) winner = a.asserter;
        a.currency.safeTransfer(winner, totalBond);

        emit AssertionResolved(assertionId, assertedTruthfully);

        if (a.callbackRecipient != address(0)) {
            IAssertionRecipient(a.callbackRecipient).assertionResolvedCallback(
                assertionId,
                assertedTruthfully
            );
        }
    }

    function settleAssertion(bytes32 assertionId) external {
        Assertion storage a = assertions[assertionId];
        require(a.asserter != address(0), "SandboxOOv3: unknown assertion");
        require(a.settled, "SandboxOOv3: not yet resolved");
    }

    function getAssertion(bytes32 assertionId) external view returns (Assertion memory) {
        return assertions[assertionId];
    }

    function getMinimumBond(address /* currency */) external pure returns (uint256) {
        return 0;
    }

    function defaultIdentifier() external pure returns (bytes32) {
        return DEFAULT_IDENTIFIER;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "SandboxOOv3: zero addr");
        owner = newOwner;
    }
}
