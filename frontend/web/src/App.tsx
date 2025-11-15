import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface VoteData {
  id: number;
  title: string;
  encryptedVote: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface VoteStats {
  totalVotes: number;
  verifiedVotes: number;
  avgScore: number;
  recentActivity: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [votes, setVotes] = useState<VoteData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [creatingVote, setCreatingVote] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newVoteData, setNewVoteData] = useState({ title: "", description: "", voteValue: "" });
  const [selectedVote, setSelectedVote] = useState<VoteData | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

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
          message: "FHEVM initialization failed" 
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
            id: parseInt(businessId.replace('vote-', '')) || Date.now(),
            title: businessData.name,
            encryptedVote: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading vote data:', e);
        }
      }
      
      setVotes(votesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
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
      
      const voteValue = parseInt(newVoteData.voteValue) || 0;
      const businessId = `vote-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, voteValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newVoteData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newVoteData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Vote created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowVoteModal(false);
      setNewVoteData({ title: "", description: "", voteValue: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingVote(false); 
    }
  };

  const decryptVote = async (businessId: string): Promise<number | null> => {
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
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
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
      
      setTransactionStatus({ visible: true, status: "success", message: "Vote decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const getVoteStats = (): VoteStats => {
    const totalVotes = votes.length;
    const verifiedVotes = votes.filter(v => v.isVerified).length;
    const avgScore = votes.length > 0 
      ? votes.reduce((sum, v) => sum + v.publicValue1, 0) / votes.length 
      : 0;
    
    const recentActivity = votes.filter(v => 
      Date.now()/1000 - v.timestamp < 60 * 60 * 24
    ).length;

    return { totalVotes, verifiedVotes, avgScore, recentActivity };
  };

  const filteredVotes = votes.filter(vote =>
    vote.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    vote.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const faqItems = [
    { question: "What is FHE?", answer: "Fully Homomorphic Encryption allows computation on encrypted data without decryption." },
    { question: "How are votes encrypted?", answer: "Each vote is encrypted using Zama FHE before being stored on-chain." },
    { question: "Is my vote private?", answer: "Yes, votes remain encrypted and private throughout the process." },
    { question: "How does decryption work?", answer: "Decryption happens offline and is verified on-chain using zero-knowledge proofs." }
  ];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🎮 KidCivics Voting</h1>
            <p>FHE-Protected Children's Voting</p>
          </div>
          <ConnectButton />
        </header>
        
        <div className="welcome-section">
          <div className="welcome-card">
            <h2>Welcome to KidCivics! 🎨</h2>
            <p>Cast your vote securely with FHE encryption technology</p>
            <div className="feature-grid">
              <div className="feature-item">🔐 Encrypted Votes</div>
              <div className="feature-item">🎮 Child-Friendly</div>
              <div className="feature-item">📊 Live Results</div>
              <div className="feature-item">🛡️ Privacy Protected</div>
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
        <p>Initializing FHE Security System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading secure voting system...</p>
    </div>
  );

  const stats = getVoteStats();

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>🎮 KidCivics Voting</h1>
          <p>FHE-Protected Children's Voting Platform</p>
        </div>
        
        <div className="header-controls">
          <button className="faq-btn" onClick={() => setShowFAQ(!showFAQ)}>
            ❓ FAQ
          </button>
          <ConnectButton />
        </div>
      </header>

      {showFAQ && (
        <div className="faq-modal">
          <div className="faq-content">
            <h3>Frequently Asked Questions</h3>
            {faqItems.map((item, index) => (
              <div key={index} className="faq-item">
                <strong>Q: {item.question}</strong>
                <p>A: {item.answer}</p>
              </div>
            ))}
            <button className="close-faq" onClick={() => setShowFAQ(false)}>Close</button>
          </div>
        </div>
      )}

      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">🗳️</div>
            <div className="stat-info">
              <h3>{stats.totalVotes}</h3>
              <p>Total Votes</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">✅</div>
            <div className="stat-info">
              <h3>{stats.verifiedVotes}</h3>
              <p>Verified</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">📈</div>
            <div className="stat-info">
              <h3>{stats.recentActivity}</h3>
              <p>Today's Votes</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">🔐</div>
            <div className="stat-info">
              <h3>FHE</h3>
              <p>Encryption</p>
            </div>
          </div>
        </div>

        <div className="action-bar">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search votes..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <span>🔍</span>
          </div>
          
          <div className="action-buttons">
            <button className="test-btn" onClick={callIsAvailable}>
              Test Contract
            </button>
            <button className="refresh-btn" onClick={loadData} disabled={isRefreshing}>
              {isRefreshing ? "🔄" : "↻"} Refresh
            </button>
            <button className="create-vote-btn" onClick={() => setShowVoteModal(true)}>
              + New Vote
            </button>
          </div>
        </div>

        <div className="votes-section">
          <h2>📋 Current Votes</h2>
          
          <div className="votes-grid">
            {filteredVotes.length === 0 ? (
              <div className="no-votes">
                <p>No votes found {searchTerm && `for "${searchTerm}"`}</p>
                <button onClick={() => setShowVoteModal(true)}>
                  Create First Vote
                </button>
              </div>
            ) : (
              filteredVotes.map((vote) => (
                <div 
                  key={vote.id} 
                  className={`vote-card ${vote.isVerified ? 'verified' : ''}`}
                  onClick={() => setSelectedVote(vote)}
                >
                  <div className="vote-header">
                    <h3>{vote.title}</h3>
                    <span className={`status ${vote.isVerified ? 'verified' : 'pending'}`}>
                      {vote.isVerified ? '✅' : '🔒'}
                    </span>
                  </div>
                  
                  <p className="vote-desc">{vote.description}</p>
                  
                  <div className="vote-meta">
                    <span>By: {vote.creator.substring(0, 6)}...{vote.creator.substring(38)}</span>
                    <span>{new Date(vote.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  
                  <div className="vote-actions">
                    <button 
                      className={`view-btn ${selectedVote?.id === vote.id ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedVote(vote);
                        setDecryptedData(null);
                      }}
                    >
                      👀 View
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showVoteModal && (
        <VoteModal 
          onSubmit={createVote}
          onClose={() => setShowVoteModal(false)}
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
            setDecryptedData(null);
          }}
          decryptedData={decryptedData}
          isDecrypting={isDecrypting || fheIsDecrypting}
          onDecrypt={async () => {
            const result = await decryptVote(selectedVote.encryptedVote);
            if (result !== null) setDecryptedData(result);
          }}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

const VoteModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  voteData: any;
  setVoteData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, voteData, setVoteData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'voteValue') {
      const intValue = value.replace(/[^\d]/g, '');
      setVoteData({ ...voteData, [name]: intValue });
    } else {
      setVoteData({ ...voteData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>🎮 Create New Vote</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <span>🔐</span>
            <p>Your vote will be encrypted with FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Vote Title</label>
            <input 
              type="text" 
              name="title" 
              value={voteData.title} 
              onChange={handleChange} 
              placeholder="What's the vote about?" 
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={voteData.description} 
              onChange={handleChange} 
              placeholder="Describe the voting topic..."
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Your Vote (Number 1-10)</label>
            <input 
              type="number" 
              name="voteValue" 
              value={voteData.voteValue} 
              onChange={handleChange} 
              min="1" 
              max="10" 
              placeholder="Enter 1-10" 
            />
            <small>This will be FHE encrypted</small>
          </div>
        </div>
        
        <div className="modal-footer">
          <button className="cancel-btn" onClick={onClose}>Cancel</button>
          <button 
            className="submit-btn"
            onClick={onSubmit}
            disabled={creating || isEncrypting || !voteData.title || !voteData.voteValue}
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Vote"}
          </button>
        </div>
      </div>
    </div>
  );
};

const VoteDetailModal: React.FC<{
  vote: VoteData;
  onClose: () => void;
  decryptedData: number | null;
  isDecrypting: boolean;
  onDecrypt: () => void;
}> = ({ vote, onClose, decryptedData, isDecrypting, onDecrypt }) => {
  const displayValue = vote.isVerified ? vote.decryptedValue : decryptedData;

  return (
    <div className="modal-overlay">
      <div className="modal-content large">
        <div className="modal-header">
          <h2>📊 Vote Details</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="vote-info">
            <h3>{vote.title}</h3>
            <p className="vote-description">{vote.description}</p>
            
            <div className="vote-meta-grid">
              <div className="meta-item">
                <span>Creator:</span>
                <strong>{vote.creator.substring(0, 6)}...{vote.creator.substring(38)}</strong>
              </div>
              <div className="meta-item">
                <span>Created:</span>
                <strong>{new Date(vote.timestamp * 1000).toLocaleString()}</strong>
              </div>
              <div className="meta-item">
                <span>Status:</span>
                <strong className={vote.isVerified ? 'verified' : 'encrypted'}>
                  {vote.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                </strong>
              </div>
            </div>
          </div>
          
          <div className="vote-data-section">
            <h4>🔐 Vote Data</h4>
            <div className="data-display">
              <div className="data-item">
                <span>Encrypted Value:</span>
                <code>{vote.encryptedVote.substring(0, 20)}...</code>
              </div>
              
              <div className="data-item">
                <span>Decrypted Vote:</span>
                <strong className="vote-value">
                  {displayValue !== undefined && displayValue !== null ? 
                    `${displayValue} ${vote.isVerified ? '(On-chain)' : '(Local)'}` : 
                    '🔒 Encrypted'
                  }
                </strong>
              </div>
            </div>
            
            {!vote.isVerified && (
              <button 
                className={`decrypt-btn ${decryptedData !== null ? 'decrypted' : ''}`}
                onClick={onDecrypt}
                disabled={isDecrypting}
              >
                {isDecrypting ? '🔓 Decrypting...' : 
                 decryptedData !== null ? '✅ Decrypted' : '🔓 Decrypt Vote'}
              </button>
            )}
          </div>
          
          <div className="fhe-explanation">
            <h4>🎯 How FHE Protects Your Vote</h4>
            <div className="explanation-steps">
              <div className="step">1. Vote encrypted with FHE</div>
              <div className="step">2. Stored securely on blockchain</div>
              <div className="step">3. Can be counted without revealing individual votes</div>
              <div className="step">4. Only decrypted with proper authorization</div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button className="close-btn" onClick={onClose}>Close</button>
          {!vote.isVerified && (
            <button className="verify-btn" onClick={onDecrypt} disabled={isDecrypting}>
              {isDecrypting ? 'Verifying...' : 'Verify on-chain'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

