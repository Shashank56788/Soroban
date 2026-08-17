import React, { useState, useEffect } from "react";
import { 
  getCampaignCount, 
  getCampaign, 
  getPledge, 
  createCampaign, 
  pledgeCampaign, 
  claimCampaign, 
  refundCampaign,
  NATIVE_TOKEN_ADDRESS
} from "./contracts/crowdfunding";
import type { Campaign } from "./contracts/crowdfunding";
import { isConnected, requestAccess, getAddress } from "@stellar/freighter-api";
import { 
  Wallet, 
  PlusCircle, 
  Coins, 
  Clock, 
  Award, 
  User, 
  AlertTriangle, 
  Loader2, 
  X, 
  CheckCircle2, 
  ArrowUpRight 
} from "lucide-react";

export default function App() {
  const [walletConnected, setWalletConnected] = useState(false);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [pledgeAmount, setPledgeAmount] = useState("");
  const [userPledge, setUserPledge] = useState("0");

  // Create campaign form states
  const [recipient, setRecipient] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Notification Toast states
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | null }>({
    message: "",
    type: null
  });

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: "", type: null }), 5000);
  };

  // Check wallet connection
  const checkWallet = async () => {
    try {
      const connection = await isConnected();
      if (connection && connection.isConnected) {
        const addressRes = await getAddress();
        if (addressRes && addressRes.address && !addressRes.error) {
          setUserAddress(addressRes.address);
          setWalletConnected(true);
        }
      }
    } catch (e) {
      console.error("Failed to fetch wallet info:", e);
    }
  };

  const connectWallet = async () => {
    setTxLoading(true);
    try {
      const connection = await isConnected();
      if (!connection || !connection.isConnected) {
        showToast("Please install or unlock the Freighter extension.", "error");
        setTxLoading(false);
        return;
      }
      
      const access = await requestAccess();
      if (access && access.address && !access.error) {
        setUserAddress(access.address);
        setWalletConnected(true);
        showToast("Freighter Wallet connected successfully!", "success");
      } else if (access && access.error) {
        showToast(`Access denied: ${access.error}`, "error");
      }
    } catch (e: any) {
      showToast(e.message || "Failed to connect wallet", "error");
    } finally {
      setTxLoading(false);
    }
  };

  // Load campaigns from contract
  const loadData = async () => {
    setLoading(true);
    try {
      const count = await getCampaignCount();
      const loaded: Campaign[] = [];
      for (let i = 1; i <= count; i++) {
        const camp = await getCampaign(i);
        if (camp) {
          loaded.push(camp);
        }
      }
      // Order campaigns by ID descending (newest first)
      setCampaigns(loaded.reverse());
    } catch (e) {
      console.error("Failed to load campaigns:", e);
      showToast("Error loading contract state. Is the contract ID correct?", "error");
    } finally {
      setLoading(false);
    }
  };

  // Fetch backer's pledge for selected campaign
  const loadUserPledge = async (campaignId: number) => {
    if (!userAddress) return;
    try {
      const pledgedRaw = await getPledge(campaignId, userAddress);
      // Convert 7 decimal places back to standard number string
      const pledged = (Number(pledgedRaw) / 10000000).toString();
      setUserPledge(pledged);
    } catch (e) {
      console.error("Error loading user pledge:", e);
    }
  };

  useEffect(() => {
    checkWallet();
    loadData();
  }, []);

  useEffect(() => {
    if (selectedCampaign) {
      loadUserPledge(selectedCampaign.id);
    }
  }, [selectedCampaign, userAddress]);

  // Create Campaign handler
  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAddress) {
      showToast("Connect your wallet first!", "error");
      return;
    }
    const target = parseFloat(targetAmount);
    if (isNaN(target) || target <= 0) {
      showToast("Target amount must be greater than 0.", "error");
      return;
    }
    const deadlineTimestamp = Math.floor(new Date(deadlineDate).getTime() / 1000);
    if (isNaN(deadlineTimestamp) || deadlineTimestamp <= Math.floor(Date.now() / 1000)) {
      showToast("Deadline must be a future date.", "error");
      return;
    }

    setTxLoading(true);
    try {
      const txHash = await createCampaign(
        userAddress,
        recipient || userAddress, // fallback to creator
        NATIVE_TOKEN_ADDRESS,
        target,
        deadlineTimestamp,
        title,
        description
      );
      showToast(`Campaign created successfully! Hash: ${txHash.slice(0, 10)}...`, "success");
      setShowCreateModal(false);
      
      // Reset form
      setRecipient("");
      setTargetAmount("");
      setDeadlineDate("");
      setTitle("");
      setDescription("");
      
      // Reload lists
      loadData();
    } catch (e: any) {
      showToast(e.message || "Failed to create campaign", "error");
    } finally {
      setTxLoading(false);
    }
  };

  // Pledge handler
  const handlePledge = async () => {
    if (!selectedCampaign || !userAddress) return;
    const amount = parseFloat(pledgeAmount);
    if (isNaN(amount) || amount <= 0) {
      showToast("Pledge amount must be greater than 0.", "error");
      return;
    }

    setTxLoading(true);
    try {
      const txHash = await pledgeCampaign(userAddress, selectedCampaign.id, amount);
      showToast(`Successfully pledged ${amount} XLM! Hash: ${txHash.slice(0, 10)}...`, "success");
      setPledgeAmount("");
      
      // Refresh modal campaign state and total campaigns list
      const updated = await getCampaign(selectedCampaign.id);
      if (updated) setSelectedCampaign(updated);
      loadData();
    } catch (e: any) {
      showToast(e.message || "Pledge failed.", "error");
    } finally {
      setTxLoading(false);
    }
  };

  // Claim handler
  const handleClaim = async () => {
    if (!selectedCampaign || !userAddress) return;
    setTxLoading(true);
    try {
      const txHash = await claimCampaign(userAddress, selectedCampaign.id);
      showToast(`Funds claimed successfully! Hash: ${txHash.slice(0, 10)}...`, "success");
      
      const updated = await getCampaign(selectedCampaign.id);
      if (updated) setSelectedCampaign(updated);
      loadData();
    } catch (e: any) {
      showToast(e.message || "Claim failed.", "error");
    } finally {
      setTxLoading(false);
    }
  };

  // Refund handler
  const handleRefund = async () => {
    if (!selectedCampaign || !userAddress) return;
    setTxLoading(true);
    try {
      const txHash = await refundCampaign(userAddress, selectedCampaign.id);
      showToast(`Refund processed successfully! Hash: ${txHash.slice(0, 10)}...`, "success");
      
      const updated = await getCampaign(selectedCampaign.id);
      if (updated) setSelectedCampaign(updated);
      loadData();
    } catch (e: any) {
      showToast(e.message || "Refund failed.", "error");
    } finally {
      setTxLoading(false);
    }
  };

  // Calculations for stats
  const totalRaised = campaigns.reduce((acc, c) => acc + Number(c.pledged_amount) / 10000000, 0);
  const activeCount = campaigns.filter(c => c.deadline > Math.floor(Date.now() / 1000) && !c.claimed).length;

  return (
    <div className="relative min-h-screen">
      {/* Toast Notification */}
      {toast.type && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border transition-all duration-300 ${
          toast.type === "success" 
            ? "bg-emerald-950/80 border-emerald-500/50 text-emerald-200" 
            : "bg-red-950/80 border-red-500/50 text-red-200"
        }`}>
          {toast.type === "success" ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertTriangle className="w-5 h-5 text-red-400" />}
          <span className="text-sm font-medium">{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-brand-bg/85 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30">
              <Coins className="w-6 h-6 text-indigo-400" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">
              Soroban<span className="text-indigo-400">Fund</span>
            </span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => connectWallet()}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
                walletConnected 
                  ? "bg-indigo-950/40 border-indigo-500/30 text-indigo-300"
                  : "bg-indigo-600 border-indigo-500 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
              }`}
              disabled={txLoading}
            >
              <Wallet className="w-4 h-4" />
              {walletConnected && userAddress 
                ? `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`
                : "Connect Wallet"
              }
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        
        {/* Hero Section */}
        <div className="mb-10 text-center md:text-left md:flex md:items-center md:justify-between">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-white mb-2 text-glow-primary">
              Fund the Future on Stellar
            </h1>
            <p className="text-gray-400 text-base max-w-xl">
              Launch transparent, trustless, and milestone-backed crowdfunding campaigns using Soroban smart contracts.
            </p>
          </div>
          <div className="mt-6 md:mt-0">
            <button
              onClick={() => {
                if (!walletConnected) {
                  showToast("Please connect your wallet first.", "error");
                  return;
                }
                setShowCreateModal(true);
              }}
              className="flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold shadow-lg shadow-indigo-500/25 transition-all transform active:scale-95"
            >
              <PlusCircle className="w-5 h-5" />
              Launch Campaign
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-12">
          <div className="glass-panel rounded-2xl p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-400">Total XLM Raised</span>
              <Coins className="w-5 h-5 text-indigo-400" />
            </div>
            <div className="text-3xl font-bold text-white">{totalRaised.toLocaleString(undefined, { maximumFractionDigits: 2 })} XLM</div>
          </div>
          <div className="glass-panel rounded-2xl p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-400">Active Campaigns</span>
              <Clock className="w-5 h-5 text-purple-400" />
            </div>
            <div className="text-3xl font-bold text-white">{activeCount}</div>
          </div>
          <div className="glass-panel rounded-2xl p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-400">Total Launch Projects</span>
              <Award className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="text-3xl font-bold text-white">{campaigns.length}</div>
          </div>
        </div>

        {/* Campaign Section */}
        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
          Discover Campaigns
          {loading && <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />}
        </h2>

        {campaigns.length === 0 && !loading ? (
          <div className="glass-panel rounded-2xl p-12 text-center">
            <Coins className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-1">No campaigns active</h3>
            <p className="text-gray-400 max-w-sm mx-auto text-sm">
              Be the first to create a campaign and kickstart your dream project on Soroban!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {campaigns.map((campaign) => {
              const target = Number(campaign.target_amount) / 10000000;
              const pledged = Number(campaign.pledged_amount) / 10000000;
              const pct = Math.min((pledged / target) * 100, 100);
              const isExpired = campaign.deadline < Math.floor(Date.now() / 1000);
              
              let statusLabel = "Active";
              let statusColor = "bg-indigo-500/20 text-indigo-300 border-indigo-500/30";
              if (campaign.claimed) {
                statusLabel = "Completed";
                statusColor = "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
              } else if (isExpired) {
                if (pledged >= target) {
                  statusLabel = "Target Met";
                  statusColor = "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
                } else {
                  statusLabel = "Expired";
                  statusColor = "bg-red-500/20 text-red-300 border-red-500/30";
                }
              }

              return (
                <div 
                  key={campaign.id} 
                  onClick={() => setSelectedCampaign(campaign)}
                  className="glass-panel glass-panel-hover rounded-2xl p-6 flex flex-col justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-xs font-mono px-2.5 py-1 rounded-full border bg-white/5 border-white/10 text-gray-400">
                        ID: #{campaign.id}
                      </span>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${statusColor}`}>
                        {statusLabel}
                      </span>
                    </div>

                    <h3 className="text-lg font-bold text-white group-hover:text-indigo-400 transition-colors line-clamp-1 mb-2">
                      {campaign.title}
                    </h3>
                    <p className="text-gray-400 text-sm line-clamp-3 mb-6">
                      {campaign.description}
                    </p>
                  </div>

                  <div>
                    {/* Progress Bar */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between text-xs font-medium mb-1">
                        <span className="text-gray-400">Progress</span>
                        <span className="text-white font-bold">{pct.toFixed(0)}%</span>
                      </div>
                      <div className="w-full h-2 bg-indigo-950/60 rounded-full overflow-hidden border border-indigo-950/80 mb-2">
                        <div 
                          className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 progress-bar-shimmer"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center justify-between pt-4 border-t border-white/5">
                      <div>
                        <span className="text-xs text-gray-400 block">Raised</span>
                        <span className="text-sm font-bold text-white">{pledged.toLocaleString()} XLM</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-gray-400 block">Target</span>
                        <span className="text-sm font-bold text-indigo-300">{target.toLocaleString()} XLM</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-lg glass-panel rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <h3 className="text-lg font-bold text-white">Create New Campaign</h3>
              <button 
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleCreateCampaign} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Project Title</label>
                <input 
                  type="text" 
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-white/10 bg-white/5 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 text-sm"
                  placeholder="E.g., Carbon Offset Forest"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Description</label>
                <textarea 
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-white/10 bg-white/5 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 text-sm h-24"
                  placeholder="Detail what your project will achieve..."
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Target Amount (XLM)</label>
                  <input 
                    type="number" 
                    step="0.00001"
                    value={targetAmount}
                    onChange={(e) => setTargetAmount(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-white/10 bg-white/5 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 text-sm"
                    placeholder="1000"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Deadline</label>
                  <input 
                    type="date" 
                    value={deadlineDate}
                    onChange={(e) => setDeadlineDate(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-white/10 bg-white/5 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 text-sm"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Recipient Address (Optional)</label>
                <input 
                  type="text" 
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-white/10 bg-white/5 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 text-sm font-mono"
                  placeholder="G... (Defaults to your connected wallet)"
                />
              </div>

              <button
                type="submit"
                className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition shadow-lg shadow-indigo-500/10 disabled:opacity-50"
                disabled={txLoading}
              >
                {txLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Deploy to Testnet"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Details & Backing Modal */}
      {selectedCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-lg glass-panel rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/20 bg-indigo-500/10">
                  ID: #{selectedCampaign.id}
                </span>
                <h3 className="text-lg font-bold text-white">Campaign Details</h3>
              </div>
              <button 
                onClick={() => {
                  setSelectedCampaign(null);
                  setUserPledge("0");
                }}
                className="p-1 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <h4 className="text-xl font-bold text-white mb-2">{selectedCampaign.title}</h4>
                <p className="text-gray-400 text-sm">{selectedCampaign.description}</p>
              </div>

              {/* Campaign State Metas */}
              <div className="grid grid-cols-2 gap-4 py-4 px-4 bg-white/5 border border-white/10 rounded-xl">
                <div>
                  <span className="text-xs text-gray-400 block mb-0.5">Recipient</span>
                  <span className="text-xs text-indigo-300 font-mono line-clamp-1 hover:underline" title={selectedCampaign.recipient}>
                    {selectedCampaign.recipient.slice(0, 10)}...{selectedCampaign.recipient.slice(-6)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block mb-0.5">End Date</span>
                  <span className="text-xs text-white font-medium flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-purple-400" />
                    {new Date(selectedCampaign.deadline * 1000).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Progress and Stats */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold mb-1">
                  <span className="text-gray-400">Total Pledged</span>
                  <span className="text-white font-mono">
                    {(Number(selectedCampaign.pledged_amount) / 10000000).toLocaleString()} / {(Number(selectedCampaign.target_amount) / 10000000).toLocaleString()} XLM
                  </span>
                </div>
                <div className="w-full h-3 bg-indigo-950/60 rounded-full overflow-hidden border border-indigo-950/80 mb-2">
                  <div 
                    className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 progress-bar-shimmer"
                    style={{ width: `${Math.min((Number(selectedCampaign.pledged_amount) / Number(selectedCampaign.target_amount)) * 100, 100)}%` }}
                  />
                </div>
              </div>

              {/* Wallet actions */}
              <div className="pt-4 border-t border-white/5 space-y-4">
                {userAddress && (
                  <div className="flex items-center justify-between text-sm py-2 px-3 bg-white/5 rounded-lg border border-white/5">
                    <span className="text-gray-400 flex items-center gap-1.5">
                      <User className="w-4 h-4 text-indigo-400" />
                      Your Pledge
                    </span>
                    <span className="font-bold text-white font-mono">{userPledge} XLM</span>
                  </div>
                )}

                {(() => {
                  const target = Number(selectedCampaign.target_amount) / 10000000;
                  const pledged = Number(selectedCampaign.pledged_amount) / 10000000;
                  const isExpired = selectedCampaign.deadline < Math.floor(Date.now() / 1000);

                  if (!walletConnected) {
                    return (
                      <button
                        onClick={() => connectWallet()}
                        className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition"
                      >
                        <Wallet className="w-5 h-5" />
                        Connect Wallet to Back Project
                      </button>
                    );
                  }

                  if (selectedCampaign.claimed) {
                    return (
                      <div className="flex items-center gap-2 text-sm font-semibold p-4 rounded-xl border border-emerald-500/20 bg-emerald-950/20 text-emerald-300">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        Funds have been successfully claimed by the recipient!
                      </div>
                    );
                  }

                  if (isExpired) {
                    if (pledged >= target) {
                      // Recipient claimable
                      const isRecipient = userAddress === selectedCampaign.recipient;
                      return (
                        <div className="space-y-3">
                          <div className="text-sm p-4 rounded-xl border border-indigo-500/20 bg-indigo-950/20 text-indigo-300">
                            The campaign goal was met! The campaign is ready to be claimed.
                          </div>
                          {isRecipient ? (
                            <button
                              onClick={handleClaim}
                              className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white font-bold transition shadow-lg"
                              disabled={txLoading}
                            >
                              {txLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Claim Campaign Funds"}
                            </button>
                          ) : (
                            <button
                              className="w-full px-4 py-3 rounded-xl bg-gray-800 text-gray-500 font-bold cursor-not-allowed text-sm"
                              disabled
                            >
                              Claimable only by Recipient
                            </button>
                          )}
                        </div>
                      );
                    } else {
                      // Refund path
                      const hasBacked = parseFloat(userPledge) > 0;
                      return (
                        <div className="space-y-3">
                          <div className="text-sm p-4 rounded-xl border border-red-500/20 bg-red-950/20 text-red-300">
                            The campaign has expired and failed to meet its target.
                          </div>
                          {hasBacked ? (
                            <button
                              onClick={handleRefund}
                              className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold transition"
                              disabled={txLoading}
                            >
                              {txLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Claim My Refund"}
                            </button>
                          ) : (
                            <button
                              className="w-full px-4 py-3 rounded-xl bg-gray-800 text-gray-500 font-bold cursor-not-allowed text-sm"
                              disabled
                            >
                              Refund Only for Backers
                            </button>
                          )}
                        </div>
                      );
                    }
                  }

                  // Active campaign - Pledge input
                  return (
                    <div className="space-y-4">
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step="0.00001"
                          value={pledgeAmount}
                          onChange={(e) => setPledgeAmount(e.target.value)}
                          className="flex-1 px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 text-sm font-mono"
                          placeholder="Pledge amount (XLM)..."
                          disabled={txLoading}
                        />
                        <button
                          onClick={handlePledge}
                          className="flex items-center gap-1.5 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition disabled:opacity-50"
                          disabled={txLoading}
                        >
                          {txLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Back Project"}
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
