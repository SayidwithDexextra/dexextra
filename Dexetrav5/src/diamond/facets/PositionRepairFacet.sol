// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibDiamond} from "../libraries/LibDiamond.sol";
import {OrderBookStorage} from "../libraries/OrderBookStorage.sol";

/**
 * @title PositionRepairFacet
 * @notice Emergency repair facet for corrupted position/order data
 * @dev Deploy this facet, add it via diamondCut, use to repair, then optionally remove
 * 
 * ROOT CAUSE: Storage layout changed when prevOrderId was moved to end of Order struct.
 * This caused existing order data to be misinterpreted, resulting in:
 *   - order fields reading garbage data (e.g., filled = 1,777,845,541 when amount = 1)
 *   - getUserPosition() causing ARRAY_RANGE_ERROR due to corrupted values
 * 
 * AFFECTED USERS:
 *   - 0xfeDc3AE13DBfED752185410E688588675B393A75 (Order #1: amount=1, filled=1777845541)
 *   - 0x33D4d0E6b58dA502b9C360365e33039B809b628e (corrupted position storage)
 */
contract PositionRepairFacet {
    bytes32 constant DIAMOND_ADMIN_ROLE = keccak256("DIAMOND_ADMIN_ROLE");
    
    event UserOrdersCleared(address indexed user, uint256 orderCount);
    event OrderReset(uint256 indexed orderId, uint256 oldAmount, uint256 newAmount);
    event PositionCleared(address indexed user);
    
    modifier onlyAdmin() {
        require(
            LibDiamond.diamondStorage().contractOwner == msg.sender ||
            _hasAdminRole(msg.sender),
            "PositionRepairFacet: Not admin"
        );
        _;
    }
    
    function _hasAdminRole(address account) internal view returns (bool) {
        // Check AccessControl role storage (OpenZeppelin pattern)
        bytes32 roleSlot = keccak256(abi.encode(DIAMOND_ADMIN_ROLE, uint256(0)));
        bytes32 memberSlot = keccak256(abi.encode(account, roleSlot));
        bool hasRole;
        assembly {
            hasRole := sload(memberSlot)
        }
        return hasRole;
    }
    
    /**
     * @notice Clear all orders for a user to reset their state
     * @dev This cancels all orders and clears position cache - use with caution
     * @param user Address of the corrupted user
     */
    function adminClearUserOrders(address user) external onlyAdmin {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        
        uint256[] memory orderIds = s.userOrders[user];
        uint256 count = orderIds.length;
        
        for (uint256 i = 0; i < count; i++) {
            uint256 orderId = orderIds[i];
            // Zero out the order
            delete s.orders[orderId];
            // Clear filled amount
            delete s.filledAmounts[orderId];
        }
        
        // Clear user's order list
        delete s.userOrders[user];
        
        // Clear position cache if it exists
        delete s.positionCache[user];
        
        // Clear market user tracking
        s.hasActivePosition[user] = false;
        
        emit UserOrdersCleared(user, count);
    }
    
    /**
     * @notice Reset a single order's amount to a valid value (or 0 to cancel)
     * @param orderId The corrupted order ID
     * @param newAmount New amount value (set to 0 to effectively cancel)
     */
    function adminResetOrder(uint256 orderId, uint256 newAmount) external onlyAdmin {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        OrderBookStorage.Order storage order = s.orders[orderId];
        
        uint256 oldAmount = order.amount;
        
        // Reset the order
        order.amount = newAmount;
        order.marginRequired = 0;
        
        // Ensure filled <= newAmount
        if (s.filledAmounts[orderId] > newAmount) {
            s.filledAmounts[orderId] = newAmount;
        }
        
        emit OrderReset(orderId, oldAmount, newAmount);
    }
    
    /**
     * @notice Clear position cache for a user
     * @param user Address to clear
     */
    function adminClearPositionCache(address user) external onlyAdmin {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        delete s.positionCache[user];
        s.hasActivePosition[user] = false;
        emit PositionCleared(user);
    }
    
    /**
     * @notice Diagnose a user's order state
     * @param user Address to diagnose
     * @return orderIds Array of order IDs
     * @return amounts Array of order amounts
     * @return filledAmts Array of filled amounts
     * @return traders Array of trader addresses
     */
    function adminDiagnoseUser(address user) external view returns (
        uint256[] memory orderIds,
        uint256[] memory amounts,
        uint256[] memory filledAmts,
        address[] memory traders
    ) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        
        orderIds = s.userOrders[user];
        uint256 len = orderIds.length;
        
        amounts = new uint256[](len);
        filledAmts = new uint256[](len);
        traders = new address[](len);
        
        for (uint256 i = 0; i < len; i++) {
            OrderBookStorage.Order storage order = s.orders[orderIds[i]];
            amounts[i] = order.amount;
            filledAmts[i] = s.filledAmounts[orderIds[i]];
            traders[i] = order.trader;
        }
    }
    
    /**
     * @notice Get repair facet version
     */
    function repairFacetVersion() external pure returns (string memory) {
        return "1.0.0";
    }
}
