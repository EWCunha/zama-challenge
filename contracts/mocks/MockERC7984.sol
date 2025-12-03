// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC7984} from "../ERC7984/ERC7984.sol";
import {FHE, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";

/**
 * @title MockERC7984
 * @dev A simple ERC7984 token implementation for testing purposes
 */
contract MockERC7984 is ERC7984 {
    constructor(string memory name_, string memory symbol_) ERC7984(name_, symbol_, "") {}

    /**
     * @dev Mint tokens to an address (for testing purposes)
     * Accepts external encrypted input with proof
     */
    function confidentialMint(address to, externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        _mint(to, FHE.fromExternal(encryptedAmount, inputProof));
    }
}

