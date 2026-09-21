import { useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers';

// WalletConnect Modal
let modal: any = null;

async function getModal() {
  if (modal) return modal;
  const { WalletConnectModal } = await import('@walletconnect/modal');
  modal = new WalletConnectModal({
    projectId: 'demo_project_id', // Replace with real WalletConnect project ID
    chains: ['1', '56', '137', '42161', '8453'], // Ethereum, BSC, Polygon, Arbitrum, Base
    explorerRecommendedWalletIds: undefined,
  });
  return modal;
}

const CHAIN_CONFIG: Record<number, { name: string; rpc: string; explorer: string; color: string }> = {
  1: { name: 'Ethereum', rpc: 'https://eth.llamarpc.com', explorer: 'https://etherscan.io', color: '#627EEA' },
  56: { name: 'BSC', rpc: 'https://bsc-dataseed.binance.org', explorer: 'https://bscscan.com', color: '#F0B90B' },
  137: { name: 'Polygon', rpc: 'https://polygon-rpc.com', explorer: 'https://polygonscan.com', color: '#8247E5' },
  42161: { name: 'Arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io', color: '#28A0F0' },
  8453: { name: 'Base', rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org', color: '#0052FF' },
};

export type WalletState = {
  connected: boolean;
  address: string;
  chainId: number;
  balance: string;
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
};

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    address: '',
    chainId: 1,
    balance: '0',
    provider: null,
    signer: null,
  });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  const connect = useCallback(async () => {
    setConnecting(true);
    setError('');
    try {
      const m = await getModal();
      m.openModal();
      await m.subscribeModal((state: any) => {
        if (state.open === false && !wallet.connected) {
          setConnecting(false);
        }
      });

      // Check for injected provider (MetaMask, etc.)
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        await provider.send('eth_requestAccounts', []);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        const network = await provider.getNetwork();
        const balance = await provider.getBalance(address);

        setWallet({
          connected: true,
          address,
          chainId: Number(network.chainId),
          balance: ethers.formatEther(balance),
          provider,
          signer,
        });

        // Listen for chain/account changes
        (window as any).ethereum.on('chainChanged', () => window.location.reload());
        (window as any).ethereum.on('accountsChanged', () => window.location.reload());
      } else {
        // Simulate connection for demo
        await new Promise(r => setTimeout(r, 1500));
        const mockAddr = '0x' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        setWallet({
          connected: true,
          address: mockAddr,
          chainId: 1,
          balance: '2.4831',
          provider: null,
          signer: null,
        });
      }
    } catch (e: any) {
      setError(e.message || 'Connection failed');
    } finally {
      setConnecting(false);
    }
  }, [wallet.connected]);

  const disconnect = useCallback(() => {
    setWallet({
      connected: false,
      address: '',
      chainId: 1,
      balance: '0',
      provider: null,
      signer: null,
    });
  }, []);

  const switchChain = useCallback(async (chainId: number) => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        await (window as any).ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }],
        });
      } catch (e: any) {
        if (e.code === 4902) {
          const config = CHAIN_CONFIG[chainId];
          if (config) {
            await (window as any).ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: `0x${chainId.toString(16)}`,
                chainName: config.name,
                rpcUrls: [config.rpc],
                blockExplorerUrls: [config.explorer],
              }],
            });
          }
        }
      }
    }
  }, []);

  // Auto-check if already connected
  useEffect(() => {
    const check = async () => {
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        const accounts = await (window as any).ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
          connect();
        }
      }
    };
    check();
  }, []);

  return {
    wallet,
    connecting,
    error,
    connect,
    disconnect,
    switchChain,
    chains: CHAIN_CONFIG,
  };
}
