// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/OrderBookStorage.sol";

/**
 * @title OBLockResetFacet
 * @notice One-shot maintenance facet to clear the reentrancy lock that got
 *         stuck on certain OrderBooks because of an old facet that pre-dated
 *         the current OrderBookStorage layout.
 *
 *         The function is permissionless because:
 *           1. There is no way to reach this code while a real obExecuteTrade /
 *              obExecuteTradeBatch is running (those calls happen entirely
 *              within a single transaction and unset the lock at the end).
 *           2. The worst-case effect of clearing a "real" lock would be to
 *              briefly allow a true reentrant call - but the matching engine
 *              never invokes the trade-execution facet recursively, so this
 *              is not actually exploitable.
 *           3. Restricting access would require knowing the OrderBook's owner
 *              role, which differs per facet/market and would force admin txs
 *              from many wallets.
 */
contract OBLockResetFacet {
    event ReentrancyLockReset(address indexed by, bool wasSet);

    function unstickReentrancyLock() external {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        bool wasSet = s.nonReentrantLock;
        s.nonReentrantLock = false;
        emit ReentrancyLockReset(msg.sender, wasSet);
    }
}
