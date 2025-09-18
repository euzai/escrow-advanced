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
    enum State {
        None,
        Opened,
        NftDeposited,
        AgreementConfirmed,
        Paid,
        Cancelled
    }

    struct Deal {
        address seller;
        address buyer;
        address nft;
        uint256 tokenId;
        uint256 priceCents;           // informational metadata (AUD cents)
        string correlationIdRaw;      // e.g. "INV-123456790" (PayTo endToEndId)
        bytes32 correlationIdHash;    // keccak256(correlationIdRaw)
        bytes32 agreementTokenHash;   // keccak256(agreementToken)
        bool nftDeposited;
        bool agreementConfirmed;
        bool paymentConfirmed;
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

    error NotSeller();
    error NotBuyer();
    error WrongState(State required, State current);
    error InvalidNFT();
    error AlreadyDeposited();
    error AlreadyConfirmed();
    error AlreadyPaid();
    error ZeroAddress();
    error NotApproved();

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
        id = ++_nextId;
        bytes32 chash = keccak256(bytes(correlationIdRaw));

        _deals[id] = Deal({
            seller: msg.sender,
            buyer: buyer,
            nft: nft,
            tokenId: tokenId,
            priceCents: priceCents,
            correlationIdRaw: correlationIdRaw,
            correlationIdHash: chash,
            agreementTokenHash: bytes32(0),
            nftDeposited: false,
            agreementConfirmed: false,
            paymentConfirmed: false,
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
    function depositNFT(uint256 id) external {
        Deal storage d = _deals[id];
        if (d.state != State.Opened) revert WrongState(State.Opened, d.state);
        if (msg.sender != d.seller) revert NotSeller();
        if (d.nftDeposited) revert AlreadyDeposited();
        
        IERC721 nft = IERC721(d.nft);
        if (nft.ownerOf(d.tokenId) != msg.sender) revert InvalidNFT();
        // Check if the escrow contract is approved to transfer the NFT
        if (nft.getApproved(d.tokenId) != address(this)) revert NotApproved();

        // Use safeTransferFrom to ensure the NFT is received by the contract
        nft.safeTransferFrom(msg.sender, address(this), d.tokenId);

        d.nftDeposited = true;
        d.state = State.NftDeposited;
        emit PayToAgreementRequested(id, d.correlationIdRaw, d.correlationIdHash);
    }

    /**
     * @notice Called by OPERATOR when PayTo Agreement is confirmed off-chain.
     * Stores the hash of agreementToken and emits PayToPaymentRequested.
     */
    function confirmAgreement(uint256 id, string calldata agreementToken)
        external
        onlyRole(OPERATOR_ROLE)
    {
        Deal storage d = _deals[id];
        if (d.state != State.NftDeposited) revert WrongState(State.NftDeposited, d.state);
        if (d.agreementConfirmed) revert AlreadyConfirmed();

        bytes32 tokenHash = keccak256(bytes(agreementToken));
        d.agreementTokenHash = tokenHash;
        d.agreementConfirmed = true;
        d.state = State.AgreementConfirmed;

        emit AgreementConfirmed(id, agreementToken, tokenHash);
        emit PayToPaymentRequested(id, d.correlationIdRaw, d.correlationIdHash, agreementToken);
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
        if (d.paymentConfirmed) revert AlreadyPaid();

        d.paymentConfirmed = true;
        d.state = State.Paid;
        emit PaymentConfirmed(id, receiptReference, amountCents, currency);

        IERC721(d.nft).safeTransferFrom(address(this), d.buyer, d.tokenId);
        emit NftReleased(id, d.buyer);
    }

    /**
     * @notice Optional: Seller may cancel before deposit (or admin in emergencies).
     */
    function cancel(uint256 id) external {
        Deal storage d = _deals[id];
        if (d.state != State.Opened) revert WrongState(State.Opened, d.state);
        if (msg.sender != d.seller && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert NotSeller();
        d.state = State.Cancelled;
        emit EscrowCancelled(id);
    }

    // -------- Views -------- //
    function getDeal(uint256 id) external view returns (Deal memory) { return _deals[id]; }
    function nextId() external view returns (uint256) { return _nextId + 1; }

    // ERC721 Receiver
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}