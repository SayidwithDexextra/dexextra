// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IOrderRouter.sol";

/**
 * @title OrderBookLib
 * @dev Library for order book operations and data structures
 * @notice Provides efficient data structures and algorithms for order management
 */
library OrderBookLib {

    /**
     * @dev Red-Black Tree node for efficient price level management
     */
    struct RBNode {
        uint256 price;
        uint256 parent;
        uint256 left;
        uint256 right;
        bool isRed;
        bool exists;
        uint256 totalQuantity;
        uint256[] orderIds;
    }

    /**
     * @dev Red-Black Tree structure
     */
    struct RBTree {
        mapping(uint256 => RBNode) nodes;
        uint256 root;
        uint256 nodeCount;
    }

    /**
     * @dev Order book side (buy or sell)
     */
    struct OrderBookSide {
        RBTree priceTree;
        mapping(uint256 => uint256[]) priceToOrderIds;
        mapping(uint256 => uint256) orderIdToIndex;
        uint256 bestPrice;
        uint256 totalOrders;
        uint256 totalVolume;
    }

    /**
     * @dev Complete order book structure
     */
    struct OrderBook {
        OrderBookSide buyOrders;
        OrderBookSide sellOrders;
        mapping(uint256 => IOrderRouter.Order) orders;
        uint256 lastTradePrice;
        uint256 volume24h;
        uint256 high24h;
        uint256 low24h;
        uint256 totalTrades;
    }

    // Events
    event OrderAdded(uint256 indexed orderId, uint256 price, IOrderRouter.Side side, uint256 quantity);
    event OrderRemoved(uint256 indexed orderId, uint256 price, IOrderRouter.Side side);
    event PriceLevelUpdated(uint256 price, IOrderRouter.Side side, uint256 totalQuantity, uint256 orderCount);

    /**
     * @dev Adds an order to the order book
     * @param book Order book reference
     * @param order Order to add
     */
    function addOrder(OrderBook storage book, IOrderRouter.Order memory order) internal {
        require(order.quantity > 0, "OrderBookLib: Invalid quantity");
        require(order.price > 0, "OrderBookLib: Invalid price");

        book.orders[order.orderId] = order;
        
        OrderBookSide storage side = (order.side == IOrderRouter.Side.BUY) 
            ? book.buyOrders 
            : book.sellOrders;
            
        _addOrderToSide(side, order);
        _updateBestPrice(side, order.side);
        
        emit OrderAdded(order.orderId, order.price, order.side, order.quantity);
    }

    /**
     * @dev Removes an order from the order book
     * @param book Order book reference
     * @param orderId Order ID to remove
     */
    function removeOrder(OrderBook storage book, uint256 orderId) internal {
        IOrderRouter.Order storage order = book.orders[orderId];
        require(order.orderId != 0, "OrderBookLib: Order not found");

        OrderBookSide storage side = (order.side == IOrderRouter.Side.BUY) 
            ? book.buyOrders 
            : book.sellOrders;
            
        _removeOrderFromSide(side, order);
        _updateBestPrice(side, order.side);
        
        emit OrderRemoved(orderId, order.price, order.side);
        delete book.orders[orderId];
    }

    /**
     * @dev Updates an order quantity (for partial fills)
     * @param book Order book reference
     * @param orderId Order ID to update
     * @param newQuantity New order quantity
     */
    function updateOrderQuantity(
        OrderBook storage book, 
        uint256 orderId, 
        uint256 newQuantity
    ) internal {
        IOrderRouter.Order storage order = book.orders[orderId];
        require(order.orderId != 0, "OrderBookLib: Order not found");
        require(newQuantity <= order.quantity, "OrderBookLib: Invalid quantity");

        OrderBookSide storage side = (order.side == IOrderRouter.Side.BUY) 
            ? book.buyOrders 
            : book.sellOrders;

        // Update quantity in price level
        RBNode storage node = side.priceTree.nodes[order.price];
        if (node.exists) {
            node.totalQuantity = node.totalQuantity - order.quantity + newQuantity;
        }

        order.quantity = newQuantity;
        order.filledQuantity = order.quantity - newQuantity;

        if (newQuantity == 0) {
            removeOrder(book, orderId);
        }
    }

    /**
     * @dev Gets the best bid price
     * @param book Order book reference
     * @return price Best bid price (0 if no bids)
     */
    function getBestBid(OrderBook storage book) internal view returns (uint256 price) {
        return book.buyOrders.bestPrice;
    }

    /**
     * @dev Gets the best ask price
     * @param book Order book reference
     * @return price Best ask price (0 if no asks)
     */
    function getBestAsk(OrderBook storage book) internal view returns (uint256 price) {
        return book.sellOrders.bestPrice;
    }

    /**
     * @dev Gets orders at a specific price level
     * @param book Order book reference
     * @param side Order side
     * @param price Price level
     * @return orderIds Array of order IDs at this price
     */
    function getOrdersAtPrice(
        OrderBook storage book,
        IOrderRouter.Side side,
        uint256 price
    ) internal view returns (uint256[] memory orderIds) {
        OrderBookSide storage bookSide = (side == IOrderRouter.Side.BUY) 
            ? book.buyOrders 
            : book.sellOrders;
            
        RBNode storage node = bookSide.priceTree.nodes[price];
        return node.exists ? node.orderIds : new uint256[](0);
    }

    /**
     * @dev Gets total volume at a price level
     * @param book Order book reference
     * @param side Order side
     * @param price Price level
     * @return volume Total volume at this price
     */
    function getVolumeAtPrice(
        OrderBook storage book,
        IOrderRouter.Side side,
        uint256 price
    ) internal view returns (uint256 volume) {
        OrderBookSide storage bookSide = (side == IOrderRouter.Side.BUY) 
            ? book.buyOrders 
            : book.sellOrders;
            
        RBNode storage node = bookSide.priceTree.nodes[price];
        return node.exists ? node.totalQuantity : 0;
    }

    /**
     * @dev Internal function to add order to a specific side
     */
    function _addOrderToSide(OrderBookSide storage side, IOrderRouter.Order memory order) private {
        // Add to price tree
        RBNode storage node = side.priceTree.nodes[order.price];
        if (!node.exists) {
            node.price = order.price;
            node.exists = true;
            node.totalQuantity = order.quantity;
            node.orderIds = new uint256[](1);
            node.orderIds[0] = order.orderId;
            
            _insertNode(side.priceTree, order.price);
        } else {
            node.totalQuantity += order.quantity;
            node.orderIds.push(order.orderId);
        }

        side.orderIdToIndex[order.orderId] = node.orderIds.length - 1;
        side.totalOrders++;
        side.totalVolume += order.quantity;

        emit PriceLevelUpdated(order.price, order.side, node.totalQuantity, node.orderIds.length);
    }

    /**
     * @dev Internal function to remove order from a specific side
     */
    function _removeOrderFromSide(OrderBookSide storage side, IOrderRouter.Order storage order) private {
        RBNode storage node = side.priceTree.nodes[order.price];
        require(node.exists, "OrderBookLib: Price level not found");

        // Remove from order array
        uint256 index = side.orderIdToIndex[order.orderId];
        uint256 lastIndex = node.orderIds.length - 1;
        
        if (index != lastIndex) {
            node.orderIds[index] = node.orderIds[lastIndex];
            side.orderIdToIndex[node.orderIds[index]] = index;
        }
        
        node.orderIds.pop();
        node.totalQuantity -= order.quantity;
        delete side.orderIdToIndex[order.orderId];

        // Remove price level if no orders left
        if (node.orderIds.length == 0) {
            _deleteNode(side.priceTree, order.price);
            delete side.priceTree.nodes[order.price];
        }

        side.totalOrders--;
        side.totalVolume -= order.quantity;

        emit PriceLevelUpdated(order.price, order.side, node.totalQuantity, node.orderIds.length);
    }

    /**
     * @dev Updates the best price for a side
     */
    function _updateBestPrice(OrderBookSide storage side, IOrderRouter.Side orderSide) private {
        if (side.priceTree.root == 0) {
            side.bestPrice = 0;
            return;
        }

        if (orderSide == IOrderRouter.Side.BUY) {
            // For buy orders, best price is maximum
            side.bestPrice = _findMaxPrice(side.priceTree);
        } else {
            // For sell orders, best price is minimum
            side.bestPrice = _findMinPrice(side.priceTree);
        }
    }

    /**
     * @dev Finds the maximum price in the tree
     */
    function _findMaxPrice(RBTree storage tree) private view returns (uint256) {
        if (tree.root == 0) return 0;
        
        uint256 current = tree.root;
        while (tree.nodes[current].right != 0) {
            current = tree.nodes[current].right;
        }
        return current;
    }

    /**
     * @dev Finds the minimum price in the tree
     */
    function _findMinPrice(RBTree storage tree) private view returns (uint256) {
        if (tree.root == 0) return 0;
        
        uint256 current = tree.root;
        while (tree.nodes[current].left != 0) {
            current = tree.nodes[current].left;
        }
        return current;
    }

    /**
     * @dev Inserts a node into the Red-Black tree
     * @dev Simplified implementation - full RB tree logic would be more complex
     */
    function _insertNode(RBTree storage tree, uint256 price) private {
        if (tree.root == 0) {
            tree.root = price;
            tree.nodes[price].isRed = false; // Root is always black
            tree.nodeCount = 1;
            return;
        }

        // Simple BST insertion (full RB tree would include rebalancing)
        uint256 current = tree.root;
        uint256 parent = 0;
        
        while (current != 0) {
            parent = current;
            if (price < current) {
                current = tree.nodes[current].left;
            } else if (price > current) {
                current = tree.nodes[current].right;
            } else {
                return; // Node already exists
            }
        }

        tree.nodes[price].parent = parent;
        tree.nodes[price].isRed = true; // New nodes are red
        
        if (price < parent) {
            tree.nodes[parent].left = price;
        } else {
            tree.nodes[parent].right = price;
        }
        
        tree.nodeCount++;
    }

    /**
     * @dev Deletes a node from the Red-Black tree
     * @dev Enhanced implementation with proper BST deletion logic
     */
    function _deleteNode(RBTree storage tree, uint256 price) private {
        require(tree.nodes[price].exists, "OrderBookLib: Node does not exist");
        
        RBNode storage nodeToDelete = tree.nodes[price];
        uint256 replacementPrice = 0;
        
        // Case 1: Node has no children (leaf node)
        if (nodeToDelete.left == 0 && nodeToDelete.right == 0) {
            if (nodeToDelete.parent == 0) {
                tree.root = 0;
            } else {
                RBNode storage parent = tree.nodes[nodeToDelete.parent];
                if (parent.left == price) {
                    parent.left = 0;
                } else {
                    parent.right = 0;
                }
            }
        }
        // Case 2: Node has only right child
        else if (nodeToDelete.left == 0) {
            replacementPrice = nodeToDelete.right;
            _replaceNode(tree, price, replacementPrice);
        }
        // Case 3: Node has only left child
        else if (nodeToDelete.right == 0) {
            replacementPrice = nodeToDelete.left;
            _replaceNode(tree, price, replacementPrice);
        }
        // Case 4: Node has both children - find inorder successor
        else {
            uint256 successorPrice = _findMinPrice(tree, nodeToDelete.right);
            RBNode storage successor = tree.nodes[successorPrice];
            
            // Copy successor's data to node to delete
            nodeToDelete.price = successor.price;
            nodeToDelete.totalQuantity = successor.totalQuantity;
            nodeToDelete.orderIds = successor.orderIds;
            
            // Delete the successor (which has at most one child)
            if (successor.right != 0) {
                _replaceNode(tree, successorPrice, successor.right);
            } else {
                // Successor is a leaf
                RBNode storage successorParent = tree.nodes[successor.parent];
                if (successorParent.left == successorPrice) {
                    successorParent.left = 0;
                } else {
                    successorParent.right = 0;
                }
            }
            
            // Clean up successor node
            delete tree.nodes[successorPrice];
            tree.nodeCount--;
            return;
        }
        
        // Clean up the original node
        delete tree.nodes[price];
        tree.nodeCount--;
    }
    
    /**
     * @dev Replaces one node with another in the tree
     */
    function _replaceNode(RBTree storage tree, uint256 oldPrice, uint256 newPrice) private {
        RBNode storage oldNode = tree.nodes[oldPrice];
        RBNode storage newNode = tree.nodes[newPrice];
        
        // Update parent's child pointer
        if (oldNode.parent == 0) {
            tree.root = newPrice;
        } else {
            RBNode storage parent = tree.nodes[oldNode.parent];
            if (parent.left == oldPrice) {
                parent.left = newPrice;
            } else {
                parent.right = newPrice;
            }
        }
        
        // Update new node's parent
        newNode.parent = oldNode.parent;
    }
    
    /**
     * @dev Finds minimum price in a subtree
     */
    function _findMinPrice(RBTree storage tree, uint256 rootPrice) private view returns (uint256) {
        require(rootPrice != 0, "OrderBookLib: Invalid root price");
        
        uint256 current = rootPrice;
        while (tree.nodes[current].left != 0) {
            current = tree.nodes[current].left;
        }
        return current;
    }
}
