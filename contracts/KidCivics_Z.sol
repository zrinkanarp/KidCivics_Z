pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract VotingSystem is ZamaEthereumConfig {
    struct VotingOption {
        string name;
        euint32 encryptedCount;
        uint32 publicCount;
        bool isVerified;
    }

    struct VotingSession {
        string title;
        uint256 startTime;
        uint256 endTime;
        string[] optionIds;
        mapping(string => VotingOption) options;
        bool isActive;
    }

    mapping(string => VotingSession) public sessions;
    string[] public sessionIds;

    event SessionCreated(string indexed sessionId, address indexed creator);
    event VoteCast(string indexed sessionId, string indexed optionId);
    event ResultsVerified(string indexed sessionId);

    constructor() ZamaEthereumConfig() {}

    function createSession(
        string calldata sessionId,
        string calldata title,
        string[] calldata optionNames,
        uint256 startTime,
        uint256 endTime
    ) external {
        require(bytes(sessions[sessionId].title).length == 0, "Session already exists");
        require(optionNames.length > 0, "At least one option required");
        require(startTime < endTime, "Invalid time range");
        require(block.timestamp < endTime, "End time must be in future");

        VotingSession storage session = sessions[sessionId];
        session.title = title;
        session.startTime = startTime;
        session.endTime = endTime;
        session.isActive = true;

        for (uint256 i = 0; i < optionNames.length; i++) {
            string memory optionId = optionNames[i];
            require(bytes(optionNames[i]).length > 0, "Invalid option name");

            session.optionIds.push(optionId);
            session.options[optionId] = VotingOption({
                name: optionNames[i],
                encryptedCount: FHE.fromUint(0),
                publicCount: 0,
                isVerified: false
            });

            FHE.allowThis(session.options[optionId].encryptedCount);
            FHE.makePubliclyDecryptable(session.options[optionId].encryptedCount);
        }

        sessionIds.push(sessionId);
        emit SessionCreated(sessionId, msg.sender);
    }

    function castVote(
        string calldata sessionId,
        string calldata optionId,
        externalEuint32 encryptedVote,
        bytes calldata inputProof
    ) external {
        require(bytes(sessions[sessionId].title).length > 0, "Session does not exist");
        require(sessions[sessionId].isActive, "Session not active");
        require(block.timestamp >= sessions[sessionId].startTime, "Voting not started");
        require(block.timestamp <= sessions[sessionId].endTime, "Voting ended");

        VotingSession storage session = sessions[sessionId];
        require(bytes(session.options[optionId].name).length > 0, "Invalid option");

        require(FHE.isInitialized(FHE.fromExternal(encryptedVote, inputProof)), "Invalid encrypted vote");

        euint32 voteValue = FHE.fromExternal(encryptedVote, inputProof);
        session.options[optionId].encryptedCount = FHE.add(
            session.options[optionId].encryptedCount,
            voteValue
        );

        emit VoteCast(sessionId, optionId);
    }

    function verifyResults(
        string calldata sessionId,
        string calldata optionId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(sessions[sessionId].title).length > 0, "Session does not exist");
        require(!sessions[sessionId].isActive, "Session still active");
        require(block.timestamp > sessions[sessionId].endTime, "Session not ended");

        VotingSession storage session = sessions[sessionId];
        require(bytes(session.options[optionId].name).length > 0, "Invalid option");
        require(!session.options[optionId].isVerified, "Results already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(session.options[optionId].encryptedCount);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        session.options[optionId].publicCount = decodedValue;
        session.options[optionId].isVerified = true;

        emit ResultsVerified(sessionId);
    }

    function getOptionCount(string calldata sessionId, string calldata optionId) 
        external view returns (euint32) 
    {
        require(bytes(sessions[sessionId].title).length > 0, "Session does not exist");
        require(bytes(sessions[sessionId].options[optionId].name).length > 0, "Invalid option");
        return sessions[sessionId].options[optionId].encryptedCount;
    }

    function getPublicCount(string calldata sessionId, string calldata optionId)
        external view returns (uint32)
    {
        require(bytes(sessions[sessionId].title).length > 0, "Session does not exist");
        require(bytes(sessions[sessionId].options[optionId].name).length > 0, "Invalid option");
        require(sessions[sessionId].options[optionId].isVerified, "Results not verified");
        return sessions[sessionId].options[optionId].publicCount;
    }

    function getSessionDetails(string calldata sessionId)
        external view returns (
            string memory title,
            uint256 startTime,
            uint256 endTime,
            bool isActive
        )
    {
        require(bytes(sessions[sessionId].title).length > 0, "Session does not exist");
        VotingSession storage session = sessions[sessionId];
        return (
            session.title,
            session.startTime,
            session.endTime,
            session.isActive
        );
    }

    function getAllSessionIds() external view returns (string[] memory) {
        return sessionIds;
    }

    function getSessionOptions(string calldata sessionId) 
        external view returns (string[] memory)
    {
        require(bytes(sessions[sessionId].title).length > 0, "Session does not exist");
        return sessions[sessionId].optionIds;
    }

    function endSession(string calldata sessionId) external {
        require(bytes(sessions[sessionId].title).length > 0, "Session does not exist");
        require(msg.sender == sessions[sessionId].options[sessions[sessionId].optionIds[0]].creator, "Not creator");
        require(block.timestamp > sessions[sessionId].endTime, "Session not ended");
        sessions[sessionId].isActive = false;
    }
}

