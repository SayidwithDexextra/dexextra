// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { PRBMath } from "./PRBMath.sol";

/// @title PRBMathUD60x18
/// @author Paul Razvan Berg
/// @notice A library for working with unsigned 60.18-decimal fixed-point numbers.
/// @dev Numbers are stored in uint256 slots as unsigned 60.18-decimal fixed-point numbers.
library PRBMathUD60x18 {
    /// @dev Emitted when an input is not a number.
    error NotANumber();

    /// @dev The constant number one as a UD60x18.
    uint256 internal constant ONE = 1e18;

    /// @dev The constant pi as a UD60x18.
    uint256 internal constant PI = 3141592653589793238;

    /// @dev The maximum value for a UD60x18.
    uint256 internal constant MAX_UD60x18 =
        115792089237316195423570985008687907853269984665640564039457_584007913129639935;

    /// @dev The maximum whole value for a UD60x18.
    uint256 internal constant MAX_WHOLE_UD60x18 = MAX_UD60x18 - (MAX_UD60x18 % ONE);

    /// @notice Adds two UD60x18 numbers.
    /// @param x A UD60x18.
    /// @param y A UD60x18.
    /// @return result The sum of x and y.
    function add(uint256 x, uint256 y) internal pure returns (uint256 result) {
        unchecked {
            result = x + y;
            if (result < x) {
                revert PRBMath.MulOverflow(result);
            }
        }
    }

    /// @notice Returns the average of two UD60x18 numbers.
    /// @param x A UD60x18.
    /// @param y A UD60x18.
    /// @return result The average of x and y.
    function avg(uint256 x, uint256 y) internal pure returns (uint256 result) {
        // The sum of x and y won't overflow if their average is smaller than the max UD60x18.
        result = (x & y) + ((x ^ y) >> 1);
    }

    /// @notice Returns the smallest power of two that is greater than or equal to the given UD60x18.
    /// @param x A UD60x18.
    /// @return result The smallest power of two that is greater than or equal to x.
    function ceil(uint256 x) internal pure returns (uint256 result) {
        if (x > MAX_WHOLE_UD60x18) {
            revert PRBMath.MulOverflow(x);
        }
        uint256 remainder = x % ONE;
        if (remainder == 0) {
            result = x;
        } else {
            result = (x - remainder) + ONE;
        }
    }

    /// @notice Divides two UD60x18 numbers.
    /// @param x The dividend as a UD60x18.
    /// @param y The divisor as a UD60x18.
    /// @return result The quotient of x divided by y.
    function div(uint256 x, uint256 y) internal pure returns (uint256 result) {
        if (y == 0) {
            revert PRBMath.MulOverflow(0);
        }
        uint256 z = x * ONE;
        // The following check is based on the fact that z / y >= x is equivalent to z >= x * y.
        if (x != 0 && z / x != ONE) {
            revert PRBMath.MulOverflow(z);
        }
        result = z / y;
    }

    /// @notice Returns Euler's number as a UD60x18.
    function e() internal pure returns (uint256 result) {
        result = 2718281828459045235;
    }

    /// @notice Calculates the x-th power of Euler's number.
    /// @param x A UD60x18.
    /// @return result The x-th power of Euler's number.
    function exp(uint256 x) internal pure returns (uint256 result) {
        if (x > 135305999368893231589) {
            revert PRBMath.MulOverflow(x);
        }

        // When the exponent is 0, the result is 1.
        if (x == 0) {
            return ONE;
        }

        // The order of the Taylor series.
        uint256 n = 12;

        // The first term of the series is 1.
        result = ONE;

        // The second term of the series is x.
        uint256 term = x;

        // Calculate the remaining terms of the series.
        for (uint256 i = 2; i <= n; i++) {
            term = div(mul(term, x), fromUint(i));
            result += term;
        }
    }

    /// @notice Calculates the x-th power of 2.
    /// @param x The exponent as an integer.
    /// @return result The x-th power of 2.
    function exp2(uint256 x) internal pure returns (uint256 result) {
        if (x >= 199) {
            revert PRBMath.MulOverflow(x);
        }
        result = 1 << x;
    }

    /// @notice Returns the largest integer that is less than or equal to the given UD60x18.
    /// @param x A UD60x18.
    /// @return result The largest integer that is less than or equal to x.
    function floor(uint256 x) internal pure returns (uint256 result) {
        result = x - (x % ONE);
    }

    /// @notice Returns the fractional part of a UD60x18.
    /// @param x A UD60x18.
    /// @return result The fractional part of x.
    function frac(uint256 x) internal pure returns (uint256 result) {
        result = x % ONE;
    }

    /// @notice Converts a uint256 to a UD60x18.
    /// @param x A uint256.
    /// @return result The UD60x18 representation of x.
    function fromUint(uint256 x) internal pure returns (uint256 result) {
        if (x > MAX_UD60x18 / ONE) {
            revert PRBMath.MulOverflow(x);
        }
        result = x * ONE;
    }

    /// @notice Returns the geometric mean of two UD60x18 numbers.
    /// @param x A UD60x18.
    /// @param y A UD60x18.
    /// @return result The geometric mean of x and y.
    function gm(uint256 x, uint256 y) internal pure returns (uint256 result) {
        uint256 xy = x * y;

        // The following check is based on the fact that xy / x == y is equivalent to xy == x * y.
        if (x != 0 && xy / x != y) {
            revert PRBMath.MulOverflow(xy);
        }

        // We don't need to use the "fromUint" helper function because the result of the multiplication is
        // already a UD60x18.
        result = PRBMath.sqrt(xy);
    }

    /// @notice Returns the inverse of a UD60x18.
    /// @param x A UD60x18.
    /// @return result 1/x.
    function inv(uint256 x) internal pure returns (uint256 result) {
        if (x == 0) {
            revert PRBMath.MulOverflow(0);
        }
        result = (ONE * ONE) / x;
    }

    /// @notice Calculates the natural logarithm of a UD60x18.
    /// @param x A UD60x18.
    /// @return result The natural logarithm of x.
    function log(uint256 x) internal pure returns (uint256 result) {
        if (x == 0) {
            revert NotANumber();
        }
        // The following code is ported from the iterative formula for the natural logarithm.
        // See https://en.wikipedia.org/wiki/Natural_logarithm#High_precision
        if (x < ONE) {
            uint256 z = div(sub(ONE, x), add(ONE, x));
            uint256 z2 = mul(z, z);
            uint256 n = 1;
            uint256 term = z;
            result = term;
            for (uint256 i = 1; i < 5; i++) {
                n += 2;
                term = mul(term, z2);
                result += div(term, fromUint(n));
            }
            result = 0 - (result << 1);
        } else {
            uint256 y = div(sub(x, ONE), add(x, ONE));
            uint256 y2 = mul(y, y);
            uint256 n = 1;
            uint256 term = y;
            result = term;
            for (uint256 i = 1; i < 5; i++) {
                n += 2;
                term = mul(term, y2);
                result += div(term, fromUint(n));
            }
            result = result << 1;
        }
    }

    /// @notice Calculates the base-10 logarithm of a UD60x18.
    /// @param x A UD60x18.
    /// @return result The base-10 logarithm of x.
    function log10(uint256 x) internal pure returns (uint256 result) {
        // ln(10) in UD60x18.
        uint256 ln10 = 2302585092994045684;
        result = div(log(x), ln10);
    }

    /// @notice Calculates the base-2 logarithm of a UD60x18.
    /// @param x A UD60x18.
    /// @return result The base-2 logarithm of x.
    function log2(uint256 x) internal pure returns (uint256 result) {
        if (x == 0) {
            revert NotANumber();
        }
        // The following code is ported from the iterative formula for the base-2 logarithm.
        // See https://math.stackexchange.com/a/2464010
        int256 msb = int256(PRBMath.mostSignificantBit(x / ONE));
        if (msb < 0) {
            uint256 invX = inv(x);
            msb = int256(PRBMath.mostSignificantBit(invX / ONE));
            uint256 b = fromUint(uint256(msb));
            result = mul(invX, exp2(uint256(msb)));
            for (uint256 i = 0; i < 4; i++) {
                result = mul(result, result);
            }
            result = 0 - sub(b, sub(fromUint(1), result));
        } else {
            uint256 b = fromUint(uint256(msb));
            result = div(x, exp2(uint256(msb)));
            for (uint256 i = 0; i < 4; i++) {
                result = mul(result, result);
            }
            result = add(b, sub(fromUint(1), result));
        }
    }

    /// @notice Returns the greater of two numbers.
    /// @param x A UD60x18.
    /// @param y A UD60x18.
    /// @return result The greater of x and y.
    function max(uint256 x, uint256 y) internal pure returns (uint256 result) {
        result = x > y ? x : y;
    }

    /// @notice Returns the smaller of two numbers.
    /// @param x A UD60x18.
    /// @param y A UD60x18.
    /// @return result The smaller of x and y.
    function min(uint256 x, uint256 y) internal pure returns (uint256 result) {
        result = x < y ? x : y;
    }

    /// @notice Returns the modulo of two UD60x18 numbers.
    /// @param x A UD60x18.
    /// @param y A UD60x18.
    /// @return result The result of x % y.
    function mod(uint256 x, uint256 y) internal pure returns (uint256 result) {
        if (y == 0) {
            revert PRBMath.MulOverflow(0);
        }
        result = x % y;
    }

    /// @notice Multiplies two UD60x18 numbers.
    /// @param x The multiplicand as a UD60x18.
    /// @param y The multiplier as a UD60x18.
    /// @return result The product of x times y.
    function mul(uint256 x, uint256 y) internal pure returns (uint256 result) {
        uint256 z = x * y;
        // The following check is based on the fact that z / x == y is equivalent to z == x * y.
        if (x != 0 && z / x != y) {
            revert PRBMath.MulOverflow(z);
        }
        result = z;
    }

    /// @notice Returns pi as a UD60x18.
    function pi() internal pure returns (uint256 result) {
        result = PI;
    }

    /// @notice Raises a UD60x18 to the power of another UD60x18.
    /// @param x The base as a UD60x18.
    /// @param y The exponent as a UD60x18.
    /// @return result The result of x raised to the power of y.
    function pow(uint256 x, uint256 y) internal pure returns (uint256 result) {
        if (x == 0) {
            result = y == 0 ? ONE : 0;
        } else {
            result = exp(mul(y, log(x)));
        }
    }

    /// @notice Raises a UD60x18 to the power of an integer.
    /// @param x The base as a UD60x18.
    /// @param y The exponent as an integer.
    /// @return result The result of x raised to the power of y.
    function powu(uint256 x, uint256 y) internal pure returns (uint256 result) {
        if (x == 0) {
            return y == 0 ? ONE : 0;
        }
        if (y == 0) {
            return ONE;
        }

        result = ONE;
        uint256 xPower = x;

        // The following code is ported from the exponentiation by squaring algorithm.
        // See https://en.wikipedia.org/wiki/Exponentiation_by_squaring
        while (y > 0) {
            if (y % 2 == 1) {
                result = mul(result, xPower);
            }
            xPower = mul(xPower, xPower);
            y /= 2;
        }
    }

    /// @notice Returns the given UD60x18 rounded to the closest integer.
    /// @param x A UD60x18.
    /// @return result The given UD60x18 rounded to the closest integer.
    function round(uint256 x) internal pure returns (uint256 result) {
        uint256 remainder = x % ONE;
        uint256 half = 0.5e18;
        if (remainder < half) {
            result = floor(x);
        } else {
            result = ceil(x);
        }
    }

    /// @notice Returns the square root of a UD60x18.
    /// @param x A UD60x18.
    /// @return result The square root of x.
    function sqrt(uint256 x) internal pure returns (uint256 result) {
        if (x > 0) {
            uint256 xTimesOne = x * ONE;
            if (xTimesOne / x != ONE) {
                revert PRBMath.MulOverflow(xTimesOne);
            }
            result = PRBMath.sqrt(xTimesOne);
        }
    }

    /// @notice Subtracts two UD60x18 numbers.
    /// @param x A UD60x18.
    /// @param y A UD60x18.
    /// @return result The difference of x and y.
    function sub(uint256 x, uint256 y) internal pure returns (uint256 result) {
        result = x - y;
        if (result > x) {
            revert PRBMath.MulOverflow(result);
        }
    }

    /// @notice Converts a UD60x18 to a uint256.
    /// @param x A UD60x18.
    /// @return result The uint256 representation of x.
    function toUint(uint256 x) internal pure returns (uint256 result) {
        result = x / ONE;
    }
} 