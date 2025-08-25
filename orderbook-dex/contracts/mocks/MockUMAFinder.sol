// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockUMAFinder
 * @dev Mock implementation of UMA Finder for testing
 * @notice Provides mock addresses for UMA protocol components
 */
contract MockUMAFinder {
    mapping(bytes32 => address) public implementations;

    constructor() {
        // Set default mock implementations
        implementations[bytes32("OptimisticOracleV3")] = address(this); // Use this contract as mock oracle
    }

    /**
     * @dev Gets implementation address for interface name
     * @param interfaceName The interface name
     * @return implementationAddress The implementation address
     */
    function getImplementationAddress(bytes32 interfaceName)
        external
        view
        returns (address implementationAddress)
    {
        address impl = implementations[interfaceName];
        if (impl == address(0)) {
            impl = address(this); // Default to this contract
        }
        return impl;
    }

    /**
     * @dev Sets implementation address (for testing)
     * @param interfaceName The interface name
     * @param implementationAddress The implementation address
     */
    function setImplementationAddress(bytes32 interfaceName, address implementationAddress) external {
        implementations[interfaceName] = implementationAddress;
    }

    // Mock OptimisticOracleV3 functions for testing
    function requestPrice(
        bytes32,    // identifier
        uint256,    // timestamp
        bytes memory, // ancillaryData
        address,    // currency
        uint256     // reward
    ) external pure returns (bytes32) {
        return keccak256("mock_request");
    }

    function hasPrice(
        address,    // requester
        bytes32,    // identifier
        uint256,    // timestamp
        bytes memory // ancillaryData
    ) external pure returns (bool) {
        return false; // Always return false for testing
    }

    function getRequest(
        address,    // requester
        bytes32,    // identifier
        uint256,    // timestamp
        bytes memory // ancillaryData
    ) external pure returns (
        bool,       // disputed
        bool,       // resolved
        bool,       // payoutRequestToPusher
        int256,     // resolvedPrice
        uint256,    // expirationTime
        uint256,    // reward
        uint256     // finalFee
    ) {
        return (false, false, false, 0, 0, 0, 0);
    }

    function settle(
        address,    // requester
        bytes32,    // identifier
        uint256,    // timestamp
        bytes memory // ancillaryData
    ) external pure returns (int256) {
        return 0; // Mock settlement value
    }

    function proposePrice(
        address,    // requester
        bytes32,    // identifier
        uint256,    // timestamp
        bytes memory, // ancillaryData
        int256      // proposedPrice
    ) external pure returns (uint256) {
        return 0; // Mock bond amount
    }

    function disputePrice(
        address,    // requester
        bytes32,    // identifier
        uint256,    // timestamp
        bytes memory // ancillaryData
    ) external pure returns (uint256) {
        return 0; // Mock bond amount
    }
}
