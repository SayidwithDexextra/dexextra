// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/LibDiamond.sol";
import "../libraries/OrderBookStorage.sol";

/**
 * @dev Minimal admin facet to retarget the CoreVault address for an OrderBook diamond.
 *      Keeps size small: one setter, owner-only.
 */
contract OrderBookVaultAdminFacet {
    using OrderBookStorage for OrderBookStorage.State;

    event VaultUpdated(address indexed oldVault, address indexed newVault);

    modifier onlyOwner() {
        LibDiamond.enforceIsContractOwner();
        _;
    }

    function setVault(address newVault) external onlyOwner {
        require(newVault != address(0), "vault=0");
        OrderBookStorage.State storage s = OrderBookStorage.state();
        address old = address(s.vault);
        s.vault = ICoreVault(newVault);
        emit VaultUpdated(old, newVault);
    }
}




