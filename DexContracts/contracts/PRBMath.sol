// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title PRBMath
/// @author Paul Razvan Berg
/// @notice A gas-efficient and safe Solidity library for binary fixed-point arithmetic.
/// @dev The math is overflowing-safe.
library PRBMath {
    /**
     * @dev Emitted when the result of a multiplication overflows.
     * @param result The supposedly correct result.
     */
    error MulOverflow(uint256 result);

    /**
     * @dev Returns the most significant bit of a number.
     * @param x The number to check.
     * @return msb The most significant bit of the number.
     */
    function mostSignificantBit(uint256 x) internal pure returns (uint256 msb) {
        if (x >= 2**128) {
            x >>= 128;
            msb += 128;
        }
        if (x >= 2**64) {
            x >>= 64;
            msb += 64;
        }
        if (x >= 2**32) {
            x >>= 32;
            msb += 32;
        }
        if (x >= 2**16) {
            x >>= 16;
            msb += 16;
        }
        if (x >= 2**8) {
            x >>= 8;
            msb += 8;
        }
        if (x >= 2**4) {
            x >>= 4;
            msb += 4;
        }
        if (x >= 2**2) {
            x >>= 2;
            msb += 2;
        }
        if (x >= 2**1) {
            msb += 1;
        }
    }

    /**
     * @dev Calculates the integer square root of a number.
     * @param x The number to square root.
     * @return result The integer square root of the number.
     */
    function sqrt(uint256 x) internal pure returns (uint256 result) {
        if (x == 0) {
            return 0;
        }

        // The following code is ported from the Babylonian method for computing the square root of a number.
        // See https://en.wikipedia.org/wiki/Methods_of_computing_square_roots#Babylonian_method
        result = 1 << (mostSignificantBit(x) >> 1);
        result = (result + x / result) >> 1;
        result = (result + x / result) >> 1;
        result = (result + x / result) >> 1;
        result = (result + x / result) >> 1;
        result = (result + x / result) >> 1;
        result = (result + x / result) >> 1;
        result = (result + x / result) >> 1;
        result = (result + x / result) >> 1;

        // The operations above might have rounded down the result. If that is the case, we increment the result.
        uint256 squared = result * result;
        if (squared < x) {
            result++;
        }

        // If the next squared number is still lesser than or equal to x, that means we haven't reached the closest
        // integer square root and we need to increment the result again.
        if ((result * result) <= x) {
            // This is a branch that should not be reachable.
        } else {
            result--;
        }
    }
} 