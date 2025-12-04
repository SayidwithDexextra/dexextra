// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICoreVault {
    // Restricted in CoreVault to ORDERBOOK_ROLE or FACTORY_ROLE depending on method
    function transferCollateral(address from, address to, uint256 amount) external;
    // V2 external credit ledger (EXTERNAL_CREDITOR_ROLE)
    function creditExternal(address user, uint256 amount) external;
    function debitExternal(address user, uint256 amount) external;
}


