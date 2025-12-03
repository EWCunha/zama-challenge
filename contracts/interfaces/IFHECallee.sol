// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";

interface IFHECallee {
    function fheCall(address sender, euint64 amount0, euint64 amount1, bytes calldata data) external;
}
