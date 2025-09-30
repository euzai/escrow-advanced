// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PayTo-escrow for ERC-721 (OpenZeppelin Contracts v5.x)
 * @notice Escrows an ERC-721 from Seller -> (escrow) -> Buyer, releasing upon off-chain PayTo payment confirmation.
 * @dev The contract emits events to drive an off-chain relayer that integrates with QuickStream PayTo APIs.
 */
contract Escrow is AccessControl, IERC721Receiver, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    
    // Default timeouts (can be adjusted per deal if needed)
    uint256 public constant DEFAULT_AGREEMENT_TIMEOUT = 7 days;
    uint256 public constant DEFAULT_PAYMENT_TIMEOUT = 30 days;
    
    enum State {
        None,
        Opened,
        NftDeposited,
        AgreementConfirmed,
        Paid,
        Cancelled,
        Refunded
    }

    struct Deal {
        address seller;
        address buyer;
        address nft;
        uint256 tokenId;
        uint256 priceCents;           // informational metadata (AUD cents)
        bytes32 correlationIdHash;    // keccak256(correlationIdRaw)
        bytes32 agreementTokenHash;   // keccak256(agreementToken)
        uint64 depositTimestamp;      // when NFT was deposited
        uint64 agreementTimestamp;    // when agreement was confirmed
        State state;
    }

    uint256 private _nextId;
    mapping(uint256 => Deal) private _deals;

    event EscrowOpened(
        uint256 indexed id,
        address indexed seller,
        address indexed buyer,
        address nft,
        uint256 tokenId,
        uint256 priceCents,
        string correlationIdRaw,
        bytes32 correlationIdHash
    );
    event NftDeposited(
        uint256 indexed id,
        address indexed nft,
        uint256 indexed tokenId
    );
    event PayToAgreementRequested(
        uint256 indexed id,
        string correlationIdRaw,
        bytes32 correlationIdHash
    );
    event AgreementConfirmed(
        uint256 indexed id,
        string agreementToken,
        bytes32 agreementTokenHash
    );
    event PayToPaymentRequested(
        uint256 indexed id,
        string correlationIdRaw,
        bytes32 correlationIdHash,
        string agreementToken
    );
    event PaymentConfirmed(
        uint256 indexed id,
        string receiptReference,
        uint256 amountCents,
        string currency
    );
    event NftReleased(uint256 indexed id, address indexed to);
    event EscrowCancelled(uint256 indexed id);
    event NftRefunded(uint256 indexed id, address indexed to);

    error NotSeller();
    error NotBuyer();
    error NotSellerOrAdmin();
    error WrongState(State required, State current);
    error InvalidNFT();
    error AlreadyDeposited();
    error AlreadyConfirmed();
    error AlreadyPaid();
    error ZeroAddress();
    error NotApproved();
    error InvalidPrice();
    error EmptyString();
    error TimeoutNotReached();

    constructor(address operator) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        if (operator != address(0)) {
            _grantRole(OPERATOR_ROLE, operator);
        }
    }

    /**
     * @notice Open a new escrow.
     * Must be called by Seller (msg.sender).
     */
    function openEscrow(
        address buyer,
        address nft,
        uint256 tokenId,
        uint256 priceCents,
        string calldata correlationIdRaw
    ) external returns (uint256 id) {
        if (buyer == address(0) || nft == address(0)) revert ZeroAddress();
        if (priceCents == 0) revert InvalidPrice();
        if (bytes(correlationIdRaw).length == 0) revert EmptyString();
        
        id = ++_nextId;
        bytes32 chash = keccak256(bytes(correlationIdRaw));

        _deals[id] = Deal({
            seller: msg.sender,
            buyer: buyer,
            nft: nft,
            tokenId: tokenId,
            priceCents: priceCents,
            correlationIdHash: chash,
            agreementTokenHash: bytes32(0),
            depositTimestamp: 0,
            agreementTimestamp: 0,
            state: State.Opened
        });

        emit EscrowOpened(
            id,
            msg.sender,
            buyer,
            nft,
            tokenId,
            priceCents,
            correlationIdRaw,
            chash
        );
    }

    /**
     * @notice Seller deposits the NFT into escrow (requires prior approval on the NFT contract).
     * Emits PayToAgreementRequested for the relayer to create a PayTo Agreement.
     */
    function depositNFT(uint256 id, string calldata correlationIdRaw) external {
        Deal storage d = _deals[id];
        if (d.state != State.Opened) revert WrongState(State.Opened, d.state);
        if (msg.sender != d.seller) revert NotSeller();
        
        // Verify correlation ID matches
        if (keccak256(bytes(correlationIdRaw)) != d.correlationIdHash) revert EmptyString();
        
        IERC721 nft = IERC721(d.nft);
        if (nft.ownerOf(d.tokenId) != msg.sender) revert InvalidNFT();
        if (nft.getApproved(d.tokenId) != address(this)) revert NotApproved();

        nft.safeTransferFrom(msg.sender, address(this), d.tokenId);

        d.depositTimestamp = uint64(block.timestamp);
        d.state = State.NftDeposited;
        
        emit NftDeposited(id, d.nft, d.tokenId);
        emit PayToAgreementRequested(id, correlationIdRaw, d.correlationIdHash);
    }

    /**
     * @notice Called by OPERATOR when PayTo Agreement is confirmed off-chain.
     * Stores the hash of agreementToken and emits PayToPaymentRequested.
     */
    function confirmAgreement(
        uint256 id,
        string calldata correlationIdRaw,
        string calldata agreementToken
    ) external onlyRole(OPERATOR_ROLE) {
        Deal storage d = _deals[id];
        if (d.state != State.NftDeposited) revert WrongState(State.NftDeposited, d.state);
        if (bytes(agreementToken).length == 0) revert EmptyString();
        
        // Verify correlation ID matches
        if (keccak256(bytes(correlationIdRaw)) != d.correlationIdHash) revert EmptyString();

        bytes32 tokenHash = keccak256(bytes(agreementToken));
        d.agreementTokenHash = tokenHash;
        d.agreementTimestamp = uint64(block.timestamp);
        d.state = State.AgreementConfirmed;

        emit AgreementConfirmed(id, agreementToken, tokenHash);
        emit PayToPaymentRequested(id, correlationIdRaw, d.correlationIdHash, agreementToken);
    }

    /**
     * @notice Called by OPERATOR when the PayTo payment has been confirmed off-chain.
     * Releases the NFT to the buyer.
     */
    function confirmPayment(
        uint256 id,
        string calldata receiptReference,
        uint256 amountCents,
        string calldata currency
    ) external onlyRole(OPERATOR_ROLE) nonReentrant {
        Deal storage d = _deals[id];
        if (d.state != State.AgreementConfirmed) revert WrongState(State.AgreementConfirmed, d.state);
        if (bytes(receiptReference).length == 0 || bytes(currency).length == 0) revert EmptyString();

        d.state = State.Paid;
        emit PaymentConfirmed(id, receiptReference, amountCents, currency);

        IERC721(d.nft).safeTransferFrom(address(this), d.buyer, d.tokenId);
        emit NftReleased(id, d.buyer);
    }

    /**
     * @notice Seller or admin can cancel before deposit.
     */
    function cancel(uint256 id) external {
        Deal storage d = _deals[id];
        if (d.state != State.Opened) revert WrongState(State.Opened, d.state);
        if (msg.sender != d.seller && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotSellerOrAdmin();
        }
        
        d.state = State.Cancelled;
        emit EscrowCancelled(id);
    }

    /**
     * @notice Allows seller to reclaim NFT if agreement not confirmed within timeout.
     * Or if payment not confirmed within timeout after agreement.
     */
    function refundNFT(uint256 id) external nonReentrant {
        Deal storage d = _deals[id];
        if (msg.sender != d.seller && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotSellerOrAdmin();
        }

        // Check if refund is allowed based on state and timeouts
        if (d.state == State.NftDeposited) {
            // Agreement timeout
            if (block.timestamp < d.depositTimestamp + DEFAULT_AGREEMENT_TIMEOUT) {
                revert TimeoutNotReached();
            }
        } else if (d.state == State.AgreementConfirmed) {
            // Payment timeout
            if (block.timestamp < d.agreementTimestamp + DEFAULT_PAYMENT_TIMEOUT) {
                revert TimeoutNotReached();
            }
        } else {
            revert WrongState(State.NftDeposited, d.state);
        }

        d.state = State.Refunded;
        
        IERC721(d.nft).safeTransferFrom(address(this), d.seller, d.tokenId);
        emit NftRefunded(id, d.seller);
    }

    /**
     * @notice Emergency admin function to cancel and refund NFT if deposited.
     */
    function emergencyRefund(uint256 id) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        Deal storage d = _deals[id];
        
        // Can only emergency refund if not already paid
        if (d.state == State.Paid || d.state == State.Refunded) {
            revert WrongState(State.NftDeposited, d.state);
        }
        
        State oldState = d.state;
        d.state = State.Refunded;
        
        // Only transfer NFT if it was actually deposited
        if (oldState == State.NftDeposited || oldState == State.AgreementConfirmed) {
            IERC721(d.nft).safeTransferFrom(address(this), d.seller, d.tokenId);
            emit NftRefunded(id, d.seller);
        }
        
        emit EscrowCancelled(id);
    }

    // -------- Views -------- //
    
    function getDeal(uint256 id) external view returns (Deal memory) {
        return _deals[id];
    }
    
    function nextId() external view returns (uint256) {
        return _nextId + 1;
    }
    
    function canRefund(uint256 id) external view returns (bool) {
        Deal storage d = _deals[id];
        
        if (d.state == State.NftDeposited) {
            return block.timestamp >= d.depositTimestamp + DEFAULT_AGREEMENT_TIMEOUT;
        } else if (d.state == State.AgreementConfirmed) {
            return block.timestamp >= d.agreementTimestamp + DEFAULT_PAYMENT_TIMEOUT;
        }
        
        return false;
    }

    // -------- ERC721 Receiver -------- //
    
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}