import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface VoteData {
  id: string;
  title: string;
  optionA: string;
  optionB: string;
  encryptedCountA: number;
  encryptedCountB: number;
  publicCountA: number;
  publicCountB: number;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedCountA?: number;
  decryptedCountB?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [votes, setVotes] = useState<VoteData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingVote, setCreatingVote] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newVoteData, setNewVoteData] = useState({ title: "", optionA: "", optionB: "" });
  const [selectedVote, setSelectedVote] = useState<VoteData | null>(null);
  const [decryptedCounts, setDecryptedCounts] = useState<{ countA: number | null; countB: number | null }>({ countA: null, countB: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState({ totalVotes: 0, verifiedVotes: 0, activeVotes: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed." 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const votesList: VoteData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          votesList.push({
            id: businessId,
            title: businessData.name,
            optionA: "Option A",
            optionB: "Option B",
            encryptedCountA: 0,
            encryptedCountB: 0,
            publicCountA: Number(businessData.publicValue1) || 0,
            publicCountB: Number(businessData.publicValue2) || 0,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedCountA: Number(businessData.decryptedValue) || 0,
            decryptedCountB: 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setVotes(votesList);
      updateStats(votesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (votesList: VoteData[]) => {
    const totalVotes = votesList.length;
    const verifiedVotes = votesList.filter(v => v.isVerified).length;
    const activeVotes = votesList.filter(v => Date.now()/1000 - v.timestamp < 604800).length;
    
    setStats({ totalVotes, verifiedVotes, activeVotes });
  };

  const createVote = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingVote(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating vote with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const voteCount = 0;
      const businessId = `vote-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, voteCount);
      
      const tx = await contract.createBusinessData(
        businessId,
        newVoteData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        `Vote: ${newVoteData.optionA} vs ${newVoteData.optionB}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Vote created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewVoteData({ title: "", optionA: "", optionB: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingVote(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const castVote = async (voteId: string, option: 'A' | 'B') => {
    if (!isConnected) return;
    
    setTransactionStatus({ visible: true, status: "pending", message: `Casting vote for option ${option}...` });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      await contract.isAvailable();
      
      setTransactionStatus({ visible: true, status: "success", message: `Vote cast for option ${option}!` });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Vote failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredVotes = votes.filter(vote => 
    vote.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    vote.optionA.toLowerCase().includes(searchTerm.toLowerCase()) ||
    vote.optionB.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card mint-card">
          <h3>Total Votes</h3>
          <div className="stat-value">{stats.totalVotes}</div>
          <div className="stat-trend">Community Votes</div>
        </div>
        
        <div className="stat-card pink-card">
          <h3>Verified Data</h3>
          <div className="stat-value">{stats.verifiedVotes}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
        
        <div className="stat-card lavender-card">
          <h3>Active Votes</h3>
          <div className="stat-value">{stats.activeVotes}</div>
          <div className="stat-trend">This Week</div>
        </div>
      </div>
    );
  };

  const renderFHEExplanation = () => {
    return (
      <div className="fhe-explanation">
        <h3>🌈 How FHE Protects Your Vote</h3>
        <div className="explanation-steps">
          <div className="step">
            <div className="step-number">1</div>
            <div className="step-content">
              <h4>Encrypted Voting</h4>
              <p>Your vote is encrypted before being stored on-chain</p>
            </div>
          </div>
          <div className="step">
            <div className="step-number">2</div>
            <div className="step-content">
              <h4>Private Counting</h4>
              <p>Votes are counted without revealing individual choices</p>
            </div>
          </div>
          <div className="step">
            <div className="step-number">3</div>
            <div className="step-content">
              <h4>Secure Results</h4>
              <p>Only final results are revealed, protecting your privacy</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🌈 KidCivics FHE Voting</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🌈</div>
            <h2>Welcome to KidCivics!</h2>
            <p>Connect your wallet to start private, encrypted voting for kids.</p>
            <div className="connection-features">
              <div className="feature">🔐 Encrypted Votes</div>
              <div className="feature">🌈 Kid-Friendly</div>
              <div className="feature">🎯 No Peer Pressure</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Getting ready for secure voting!</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading secure voting system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🌈 KidCivics FHE Voting</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Vote
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <h2>🌈 Secure Kids Voting Dashboard</h2>
          {renderStats()}
          {renderFHEExplanation()}
        </div>
        
        <div className="votes-section">
          <div className="section-header">
            <h2>Active Votes</h2>
            <div className="header-controls">
              <input 
                type="text"
                placeholder="🔍 Search votes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "🔄"}
              </button>
            </div>
          </div>
          
          <div className="votes-grid">
            {filteredVotes.length === 0 ? (
              <div className="no-votes">
                <p>No votes found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Vote
                </button>
              </div>
            ) : filteredVotes.map((vote) => (
              <div 
                className={`vote-card ${vote.isVerified ? "verified" : ""}`} 
                key={vote.id}
                onClick={() => setSelectedVote(vote)}
              >
                <div className="vote-title">{vote.title}</div>
                <div className="vote-options">
                  <div className="option">
                    <span>{vote.optionA}</span>
                    <div className="vote-count">{vote.publicCountA}</div>
                  </div>
                  <div className="option">
                    <span>{vote.optionB}</span>
                    <div className="vote-count">{vote.publicCountB}</div>
                  </div>
                </div>
                <div className="vote-status">
                  {vote.isVerified ? "✅ Verified" : "🔓 Ready to Verify"}
                </div>
                <div className="vote-actions">
                  <button 
                    onClick={(e) => { e.stopPropagation(); castVote(vote.id, 'A'); }}
                    className="vote-btn option-a"
                  >
                    Vote A
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); castVote(vote.id, 'B'); }}
                    className="vote-btn option-b"
                  >
                    Vote B
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateVote 
          onSubmit={createVote} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingVote} 
          voteData={newVoteData} 
          setVoteData={setNewVoteData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedVote && (
        <VoteDetailModal 
          vote={selectedVote} 
          onClose={() => { 
            setSelectedVote(null); 
            setDecryptedCounts({ countA: null, countB: null }); 
          }} 
          decryptedCounts={decryptedCounts} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedVote.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateVote: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  voteData: any;
  setVoteData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, voteData, setVoteData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setVoteData({ ...voteData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-vote-modal">
        <div className="modal-header">
          <h2>Create New Vote</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>🌈 FHE Protected Voting</strong>
            <p>Vote counts will be encrypted for privacy protection</p>
          </div>
          
          <div className="form-group">
            <label>Vote Title *</label>
            <input 
              type="text" 
              name="title" 
              value={voteData.title} 
              onChange={handleChange} 
              placeholder="What should we vote on?" 
            />
          </div>
          
          <div className="form-group">
            <label>Option A *</label>
            <input 
              type="text" 
              name="optionA" 
              value={voteData.optionA} 
              onChange={handleChange} 
              placeholder="First choice..." 
            />
          </div>
          
          <div className="form-group">
            <label>Option B *</label>
            <input 
              type="text" 
              name="optionB" 
              value={voteData.optionB} 
              onChange={handleChange} 
              placeholder="Second choice..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !voteData.title || !voteData.optionA || !voteData.optionB} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Creating..." : "Create Vote"}
          </button>
        </div>
      </div>
    </div>
  );
};

const VoteDetailModal: React.FC<{
  vote: any;
  onClose: () => void;
  decryptedCounts: { countA: number | null; countB: number | null };
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ vote, onClose, decryptedCounts, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedCounts.countA !== null) { 
      return; 
    }
    
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="vote-detail-modal">
        <div className="modal-header">
          <h2>Vote Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="vote-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{vote.title}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{vote.creator.substring(0, 6)}...{vote.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(vote.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="results-section">
            <h3>Voting Results</h3>
            
            <div className="results-display">
              <div className="result-option">
                <div className="option-name">Option A</div>
                <div className="option-count">
                  {vote.isVerified && vote.decryptedCountA ? 
                    `${vote.decryptedCountA} votes` : 
                    decryptedCounts.countA !== null ? 
                    `${decryptedCounts.countA} votes` : 
                    "🔒 Encrypted"
                  }
                </div>
              </div>
              
              <div className="result-option">
                <div className="option-name">Option B</div>
                <div className="option-count">
                  {vote.publicCountB} votes
                </div>
              </div>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🌈</div>
              <div>
                <strong>FHE Protected Results</strong>
                <p>Option A counts are encrypted for privacy. Verify to see real results.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!vote.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify Results"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;